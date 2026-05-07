/**
 * Cloud adapter architecture — zero external dependency implementation.
 * Supports: WebDAV, S3 (AWS Sig V4), SFTP (system sftp), Samba (net use / smbclient).
 *
 * All HTTP-based adapters use node:https / node:http directly.
 * Shell-based adapters (SFTP, Samba) invoke system commands via child_process.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { execFile, execSync } from "node:child_process";
import { loadSecrets, type Secrets } from "./secrets-loader.js";

// ============================================================================
// Types
// ============================================================================

export interface CloudFileEntry {
  name: string;
  size: number;
  modified: number; // ms epoch
}

export interface CloudAdapter {
  readonly provider: string;
  upload(localPath: string, remotePath: string): Promise<boolean>;
  download(remotePath: string, localPath: string): Promise<boolean>;
  list(remotePath?: string): Promise<CloudFileEntry[]>;
  delete(remotePath: string): Promise<boolean>;
  exists(remotePath: string): Promise<boolean>;
}

export interface AdapterStatus {
  provider: string;
  configured: boolean;
  message: string;
}

// ============================================================================
// WebDAV Adapter — uses node:http(s) PUT/GET/PROPFIND/DELETE
// ============================================================================

class WebDAVAdapter implements CloudAdapter {
  readonly provider = "webdav";
  private baseUrl: string;
  private username: string;
  private password: string;

  constructor(secrets: Secrets) {
    this.baseUrl = (secrets.WEBDAV_URL || "").replace(/\/+$/, "");
    this.username = secrets.WEBDAV_USERNAME || "";
    this.password = secrets.WEBDAV_PASSWORD || "";
  }

  static isConfigured(s: Secrets): boolean {
    return !!(s.WEBDAV_URL && s.WEBDAV_USERNAME);
  }

  private buildUrl(remotePath: string): string {
    const clean = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
    return `${this.baseUrl}/${clean}`;
  }

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.username}:${this.password}`).toString("base64");
  }

  private request(method: string, url: string, headers: Record<string, string> = {}, body?: Buffer): Promise<{ status: number; data: Buffer }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === "https:" ? https : http;
      const opts: https.RequestOptions = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          ...headers,
          Authorization: this.authHeader(),
        },
      };
      const req = mod.request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try {
      const data = fs.readFileSync(localPath);
      const { status } = await this.request("PUT", this.buildUrl(remotePath), { "Content-Type": "application/octet-stream" }, data);
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try {
      const { status, data } = await this.request("GET", this.buildUrl(remotePath));
      if (status !== 200) return false;
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, data);
      return true;
    } catch {
      return false;
    }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      const { status, data } = await this.request("PROPFIND", this.buildUrl(remotePath), { Depth: "1" });
      if (status !== 207) return [];
      // Parse multistatus XML — extract href + getlastmodified + getcontentlength
      const xml = data.toString("utf-8");
      const entries: CloudFileEntry[] = [];
      const responses = xml.split(/<d:response>/i).slice(1);
      for (const resp of responses) {
        const hrefMatch = resp.match(/<d:href[^>]*>([^<]+)/i);
        const sizeMatch = resp.match(/<d:getcontentlength[^>]*>(\d+)/i);
        const modMatch = resp.match(/<d:getlastmodified[^>]*>([^<]+)/i);
        if (hrefMatch) {
          const name = hrefMatch[1].split("/").filter(Boolean).pop() || "";
          if (!name) continue;
          entries.push({
            name,
            size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
            modified: modMatch ? new Date(modMatch[1]).getTime() : 0,
          });
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async delete(remotePath: string): Promise<boolean> {
    try {
      const { status } = await this.request("DELETE", this.buildUrl(remotePath));
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const { status } = await this.request("HEAD", this.buildUrl(remotePath));
      return status === 200;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// S3 Adapter — AWS Signature V4 via node:https
// ============================================================================

class S3Adapter implements CloudAdapter {
  readonly provider = "s3";
  private endpoint: string;
  private accessKey: string;
  private secretKey: string;
  private bucket: string;
  private region: string;

  constructor(secrets: Secrets) {
    this.endpoint = (secrets.S3_ENDPOINT || "").replace(/\/+$/, "");
    this.accessKey = secrets.S3_ACCESS_KEY || "";
    this.secretKey = secrets.S3_SECRET_KEY || "";
    this.bucket = secrets.S3_BUCKET || "";
    this.region = secrets.S3_REGION || "auto";
  }

  static isConfigured(s: Secrets): boolean {
    return !!(s.S3_ENDPOINT && s.S3_ACCESS_KEY && s.S3_SECRET_KEY && s.S3_BUCKET);
  }

  /** AWS Signature V4 signing */
  private signRequest(method: string, path: string, headers: Record<string, string>, bodySha256: string, date: Date): Record<string, string> {
    const service = "s3";
    const dateStamp = date.toISOString().replace(/[-:]/g, "").slice(0, 8);
    const amzDate = dateStamp + "T" + date.toISOString().replace(/[-:]/g, "").slice(9, 15) + "Z";
    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;

    headers["x-amz-date"] = amzDate;
    headers["x-amz-content-sha256"] = bodySha256;
    if (this.bucket.includes(".")) {
      headers["Host"] = new URL(this.endpoint).host;
    }

    const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
    const signedHeaders = signedHeaderKeys.join(";");
    const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]!.trim()}`).join("\n") + "\n";

    const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, bodySha256].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

    const hmac = (key: Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
    let signingKey = hmac(Buffer.from("AWS4" + this.secretKey), dateStamp);
    signingKey = hmac(signingKey, this.region);
    signingKey = hmac(signingKey, service);
    signingKey = hmac(signingKey, "aws4_request");

    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }

  private buildUrl(key: string): string {
    // Path-style: endpoint/bucket/key
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    return `${this.endpoint}/${this.bucket}/${cleanKey}`;
  }

  private s3Path(key: string): string {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    return `/${this.bucket}/${cleanKey}`;
  }

  private async doRequest(method: string, key: string, extraHeaders: Record<string, string> = {}, body?: Buffer): Promise<{ status: number; data: Buffer }> {
    const urlStr = this.buildUrl(key);
    const parsed = new URL(urlStr);
    const bodyData = body || Buffer.alloc(0);
    const bodySha256 = crypto.createHash("sha256").update(bodyData).digest("hex");

    const headers: Record<string, string> = {
      Host: parsed.host,
      ...extraHeaders,
    };

    this.signRequest(method, this.s3Path(key), headers, bodySha256, new Date());

    return new Promise((resolve, reject) => {
      const mod = parsed.protocol === "https:" ? https : http;
      const opts: https.RequestOptions = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers,
      };
      const req = mod.request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      if (bodyData.length > 0) req.write(bodyData);
      req.end();
    });
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try {
      const data = fs.readFileSync(localPath);
      const { status } = await this.doRequest("PUT", remotePath, { "Content-Length": String(data.length) }, data);
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try {
      const { status, data } = await this.doRequest("GET", remotePath);
      if (status !== 200) return false;
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, data);
      return true;
    } catch {
      return false;
    }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      const prefix = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
      // ListObjectsV2 via query string
      const urlStr = this.buildUrl(prefix);
      const parsed = new URL(urlStr);
      parsed.search = "?list-type=2&prefix=" + encodeURIComponent(prefix);

      const bodySha256 = crypto.createHash("sha256").update("").digest("hex");
      const s3Path = this.s3Path(prefix) + parsed.search;

      const headers: Record<string, string> = { Host: parsed.host };
      this.signRequest("GET", s3Path, headers, bodySha256, new Date());

      return new Promise((resolve, reject) => {
        const mod = parsed.protocol === "https:" ? https : http;
        const opts: https.RequestOptions = {
          method: "GET",
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: s3Path,
          headers,
        };
        const req = mod.request(opts, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const xml = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode !== 200) return resolve([]);
            const entries: CloudFileEntry[] = [];
            const contents = xml.split(/<Contents>/).slice(1);
            for (const c of contents) {
              const keyMatch = c.match(/<Key>([^<]+)/);
              const sizeMatch = c.match(/<Size>(\d+)/);
              const modMatch = c.match(/<LastModified>([^<]+)/);
              if (keyMatch) {
                entries.push({
                  name: keyMatch[1].split("/").pop() || keyMatch[1],
                  size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
                  modified: modMatch ? new Date(modMatch[1]).getTime() : 0,
                });
              }
            }
            resolve(entries);
          });
        });
        req.on("error", reject);
        req.end();
      });
    } catch {
      return [];
    }
  }

  async delete(remotePath: string): Promise<boolean> {
    try {
      const { status } = await this.doRequest("DELETE", remotePath);
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const { status } = await this.doRequest("HEAD", remotePath);
      return status === 200;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// SFTP Adapter — delegates to system sftp command
// ============================================================================

class SFTPAdapter implements CloudAdapter {
  readonly provider = "sftp";
  private host: string;
  private port: number;
  private username: string;
  private password: string;

  constructor(secrets: Secrets) {
    this.host = secrets.SFTP_HOST || "";
    this.port = parseInt(secrets.SFTP_PORT || "22", 10);
    this.username = secrets.SFTP_USERNAME || "";
    this.password = secrets.SFTP_PASSWORD || "";
  }

  static isConfigured(s: Secrets): boolean {
    return !!(s.SFTP_HOST && s.SFTP_USERNAME);
  }

  private async runSftp(commands: string[]): Promise<{ ok: boolean; stdout: string }> {
    return new Promise((resolve) => {
      // Build batch file
      const batch = commands.join("\n");
      const args = [
        "-o", "StrictHostKeyChecking=no",
        "-o", "BatchMode=yes",
        "-P", String(this.port),
      ];

      // Use password via sshpass if available, otherwise key-based
      let cmd: string;
      let cmdArgs: string[];
      let envOverride: Record<string, string> | undefined;
      if (this.password) {
        // sshpass with SSHPASS env var to avoid exposing password in process list
        cmd = "sshpass";
        cmdArgs = ["-e", "sftp", ...args, `${this.username}@${this.host}`];
        envOverride = { ...process.env as Record<string, string>, SSHPASS: this.password };
      } else {
        cmd = "sftp";
        cmdArgs = [...args, `${this.username}@${this.host}`];
      }

      const child = execFile(cmd, cmdArgs, { timeout: 30000, env: envOverride || process.env }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, stdout: stderr || err.message });
        } else {
          resolve({ ok: true, stdout: stdout || "" });
        }
      });
      if (child.stdin) {
        child.stdin.write(batch + "\n");
        child.stdin.end();
      }
    });
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try {
      const { ok } = await this.runSftp([`put "${localPath.replace(/\\/g, "/")}" "${remotePath}"`]);
      return ok;
    } catch {
      return false;
    }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      const { ok } = await this.runSftp([`get "${remotePath}" "${localPath.replace(/\\/g, "/")}"`]);
      return ok;
    } catch {
      return false;
    }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      const { ok, stdout } = await this.runSftp([`ls -l "${remotePath}"`]);
      if (!ok) return [];
      const entries: CloudFileEntry[] = [];
      for (const line of stdout.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          entries.push({
            name: parts.slice(8).join(" "),
            size: parseInt(parts[4], 10) || 0,
            modified: 0, // parsing ls -l dates is fragile, skip
          });
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async delete(remotePath: string): Promise<boolean> {
    try {
      const { ok } = await this.runSftp([`rm "${remotePath}"`]);
      return ok;
    } catch {
      return false;
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const { ok } = await this.runSftp([`stat "${remotePath}"`]);
      return ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Samba Adapter — uses net use (Windows) or smbclient (Linux/Mac)
// ============================================================================

class SambaAdapter implements CloudAdapter {
  readonly provider = "samba";
  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private share: string;
  private remotePath: string;
  private isWindows: boolean;

  constructor(secrets: Secrets) {
    this.host = secrets.SAMBA_HOST || "";
    this.port = parseInt(secrets.SAMBA_PORT || "445", 10);
    this.username = secrets.SAMBA_USER || "";
    this.password = secrets.SAMBA_PASSWORD || "";
    this.share = secrets.SAMBA_SHARE || "memory";
    this.remotePath = (secrets.SAMBA_REMOTE_PATH || "/").replace(/^\/+|\/+$/g, "");
    this.isWindows = process.platform === "win32";
  }

  static isConfigured(s: Secrets): boolean {
    return !!(s.SAMBA_HOST && s.SAMBA_USER);
  }

  /** Get UNC path for Windows */
  private uncPath(remotePath: string): string {
    const clean = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
    const subPath = this.remotePath ? `${this.remotePath}/${clean}` : clean;
    return `\\\\${this.host}\\${this.share}\\${subPath.replace(/\//g, "\\")}`;
  }

  /** Get smbclient target */
  private smbTarget(): string {
    return `//${this.host}/${this.share}`;
  }

  /** Ensure drive is mounted on Windows */
  /** Run smbclient with password passed via PASSWD env var (not command line) */
  private smbCmd(args: string): Buffer {
    return execSync(`smbclient "${this.smbTarget()}" -U "${this.username}" -p ${this.port} -c "${args}"`, {
      timeout: 15000,
      env: { ...process.env as Record<string, string>, PASSWD: this.password },
    });
  }

  private ensureMounted(): string | null {
    if (!this.isWindows) return null;
    const driveLetter = "Z:"; // dedicated letter for yaoyao-memory
    const unc = `\\\\${this.host}\\${this.share}`;

    try {
      // Check if already mounted
      const existing = execSync(`net use ${driveLetter}`, { encoding: "utf-8", timeout: 5000 });
      if (existing.includes(unc)) return driveLetter;
    } catch {
      // Not mounted, try to mount
    }

    try {
      execSync(`net use ${driveLetter} ${unc} /user:"${this.username}" /persistent:no`, {
        encoding: "utf-8",
        timeout: 10000,
        env: { ...process.env as Record<string, string>, PASSWD: this.password },
      });
      return driveLetter;
    } catch {
      return null;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        const dest = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        const destDir = path.dirname(dest);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(localPath, dest);
        return true;
      } else {
        // smbclient
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        const cmd = `mkdir ${path.dirname(remoteFile)} 2>/dev/null; put ${localPath} ${remoteFile}`;
        this.smbCmd(cmd);
        return true;
      }
    } catch {
      return false;
    }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        const src = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        fs.copyFileSync(src, localPath);
        return true;
      } else {
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        const cmd = `get ${remoteFile} ${localPath}`;
        this.smbCmd(cmd);
        return true;
      }
    } catch {
      return false;
    }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return [];
        const dir = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
          .filter(f => fs.statSync(path.join(dir, f)).isFile())
          .map(f => {
            const stat = fs.statSync(path.join(dir, f));
            return { name: f, size: stat.size, modified: stat.mtimeMs };
          });
      } else {
        const dir = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        const cmd = `ls ${dir}/*`;
        const output = this.smbCmd(cmd).toString("utf-8");
        const entries: CloudFileEntry[] = [];
        for (const line of output.split("\n")) {
          // smbclient ls format: "  filename                          A        123  Thu Jan  1 00:00:00 2025"
          const match = line.match(/\s+(\S+)\s+[A|D]\s+(\d+)/);
          if (match) {
            entries.push({ name: match[1], size: parseInt(match[2], 10), modified: 0 });
          }
        }
        return entries;
      }
    } catch {
      return [];
    }
  }

  async delete(remotePath: string): Promise<boolean> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        const target = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        fs.unlinkSync(target);
        return true;
      } else {
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        const cmd = `rm ${remoteFile}`;
        this.smbCmd(cmd);
        return true;
      }
    } catch {
      return false;
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        return fs.existsSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`);
      } else {
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        const cmd = `ls ${remoteFile}`;
        this.smbCmd(cmd);
        return true;
      }
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Adapter Factory
// ============================================================================

export interface AdapterFactoryResult {
  adapters: Map<string, CloudAdapter>;
  statuses: AdapterStatus[];
}

const PROVIDER_CHECKS: Array<{ name: string; check: (s: Secrets) => boolean; create: (s: Secrets) => CloudAdapter }> = [
  { name: "webdav", check: WebDAVAdapter.isConfigured, create: (s) => new WebDAVAdapter(s) },
  { name: "s3", check: S3Adapter.isConfigured, create: (s) => new S3Adapter(s) },
  { name: "sftp", check: SFTPAdapter.isConfigured, create: (s) => new SFTPAdapter(s) },
  { name: "samba", check: SambaAdapter.isConfigured, create: (s) => new SambaAdapter(s) },
];

/**
 * Create all configured cloud adapters from secrets.env.
 */
export function createAdapters(secretsPath?: string): AdapterFactoryResult {
  const secrets = loadSecrets(secretsPath);
  const adapters = new Map<string, CloudAdapter>();
  const statuses: AdapterStatus[] = [];

  for (const { name, check, create } of PROVIDER_CHECKS) {
    if (check(secrets)) {
      try {
        adapters.set(name, create(secrets));
        statuses.push({ provider: name, configured: true, message: "✅ 已配置" });
      } catch (err: any) {
        statuses.push({ provider: name, configured: false, message: `⚠️ 配置错误: ${err.message}` });
      }
    } else {
      statuses.push({ provider: name, configured: false, message: "— 未配置" });
    }
  }

  return { adapters, statuses };
}

/**
 * Create a single adapter by provider name.
 */
export function createAdapter(provider: string, secretsPath?: string): CloudAdapter | null {
  const secrets = loadSecrets(secretsPath);
  const entry = PROVIDER_CHECKS.find(p => p.name === provider);
  if (!entry || !entry.check(secrets)) return null;
  return entry.create(secrets);
}
