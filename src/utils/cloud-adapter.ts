/**
 * Cloud adapter architecture — zero external dependency implementation.
 * Supports: WebDAV, S3 (AWS Sig V4), SFTP (system sftp), Samba (net use / smbclient).
 *
 * All HTTP-based adapters use node:https / node:http directly.
 * Shell-based adapters (SFTP, Samba) invoke system commands via child_process.
 */
import { clampNum } from "./clamp.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { execFile, execSync, execFileSync } from "node:child_process";
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
    const endpointHost = new URL(this.endpoint).host;
    if (this.bucket.includes(".")) {
      // Path-style: bucket with dots can't be a valid virtual-hosted subdomain
      headers["Host"] = endpointHost;
    } else {
      // Virtual-hosted-style: bucket in host header (clean bucket name)
      headers["Host"] = `${this.bucket}.${endpointHost}`;
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

  /** 
   * S3 request path — uses path-style or virtual-hosted style based on bucket name.
   * Path-style: /bucket/key (for bucket names containing dots)
   * Virtual-hosted-style: /key (for clean bucket names, bucket is in Host header)
   */
  private s3Path(key: string): string {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    if (this.bucket.includes(".")) {
      // Path-style: bucket in path
      return `/${this.bucket}/${cleanKey}`;
    }
    // Virtual-hosted-style: bucket in host, key in path
    return `/${cleanKey}`;
  }

  private async doRequest(method: string, key: string, extraHeaders: Record<string, string> = {}, body?: Buffer): Promise<{ status: number; data: Buffer }> {
    const bodyData = body || Buffer.alloc(0);
    const bodySha256 = crypto.createHash("sha256").update(bodyData).digest("hex");

    const endpointHost = new URL(this.endpoint).host;
    const isPathStyle = this.bucket.includes(".");

    // Determine the actual hostname to connect to
    const targetHost = isPathStyle ? endpointHost : `${this.bucket}.${endpointHost}`;
    const s3Path = this.s3Path(key);

    const headers: Record<string, string> = {
      Host: targetHost,
      ...extraHeaders,
    };

    this.signRequest(method, s3Path, headers, bodySha256, new Date());

    const parsedEndpoint = new URL(this.endpoint);
    const port = parsedEndpoint.port || (parsedEndpoint.protocol === "https:" ? 443 : 80);

    return new Promise((resolve, reject) => {
      const mod = parsedEndpoint.protocol === "https:" ? https : http;
      const opts: https.RequestOptions = {
        method,
        hostname: targetHost,
        port,
        path: s3Path,
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
      const bodySha256 = crypto.createHash("sha256").update("").digest("hex");

      const endpointHost = new URL(this.endpoint).host;
      const isPathStyle = this.bucket.includes(".");
      const targetHost = isPathStyle ? endpointHost : `${this.bucket}.${endpointHost}`;

      // ListObjectsV2 — prefix only in query string, not in pathname
      const query = "?list-type=2&prefix=" + encodeURIComponent(prefix);
      // Path: / for path-style, or /?list-type=2... for virtual-hosted style
      // Both work because list-type=2 doesn't need a specific path
      const listPath = isPathStyle ? `/${this.bucket}${query}` : `/${query}`;

      const headers: Record<string, string> = { Host: targetHost };
      this.signRequest("GET", listPath, headers, bodySha256, new Date());

      return new Promise((resolve, reject) => {
        const parsedEndpoint = new URL(this.endpoint);
        const port = parsedEndpoint.port || (parsedEndpoint.protocol === "https:" ? 443 : 80);
        const mod = parsedEndpoint.protocol === "https:" ? https : http;
        const opts: https.RequestOptions = {
          method: "GET",
          hostname: targetHost,
          port,
          path: listPath,
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
  private timeoutMs: number;

  constructor(secrets: Secrets, opts?: { timeoutMs?: number }) {
    this.host = secrets.SFTP_HOST || "";
    this.port = parseInt(secrets.SFTP_PORT || "22", 10);
    this.username = secrets.SFTP_USERNAME || "";
    this.password = secrets.SFTP_PASSWORD || "";
    this.timeoutMs = Math.max(3_000, Math.min(120_000, opts?.timeoutMs ?? parseInt(secrets.SFTP_TIMEOUT_MS || "30000", 10)));
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

      const child = execFile(cmd, cmdArgs, { timeout: this.timeoutMs, env: envOverride || process.env }, (err, stdout, stderr) => {
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

  // Helper: escape double quotes in user-supplied path strings for SFTP batch commands
  private esc(path: string): string {
    return path.replace(/"/g, '\\"');
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try {
      const escapedLocal = this.esc(localPath.replace(/\\/g, "/"));
      const escapedRemote = this.esc(remotePath);
      const { ok } = await this.runSftp([`put "${escapedLocal}" "${escapedRemote}"`]);
      return ok;
    } catch {
      return false;
    }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      const escapedRemote = this.esc(remotePath);
      const escapedLocal = this.esc(localPath.replace(/\\/g, "/"));
      const { ok } = await this.runSftp([`get "${escapedRemote}" "${escapedLocal}"`]);
      return ok;
    } catch {
      return false;
    }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      const { ok, stdout } = await this.runSftp([`ls -l "${this.esc(remotePath)}"`]);
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
      const { ok } = await this.runSftp([`rm "${this.esc(remotePath)}"`]);
      return ok;
    } catch {
      return false;
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const { ok } = await this.runSftp([`stat "${this.esc(remotePath)}"`]);
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
  private smbTimeoutMs: number;
  private mountCheckTimeoutMs: number;
  private mountTimeoutMs: number;

  constructor(secrets: Secrets, opts?: { smbTimeoutMs?: number; mountCheckTimeoutMs?: number; mountTimeoutMs?: number }) {
    this.host = secrets.SAMBA_HOST || "";
    this.port = parseInt(secrets.SAMBA_PORT || "445", 10);
    this.username = secrets.SAMBA_USER || "";
    this.password = secrets.SAMBA_PASSWORD || "";
    this.share = secrets.SAMBA_SHARE || "memory";
    this.remotePath = (secrets.SAMBA_REMOTE_PATH || "/").replace(/^\/+|\/+$/g, "");
    this.isWindows = process.platform === "win32";
    this.smbTimeoutMs = clampNum(opts?.smbTimeoutMs, 15_000, 3_000, 60_000);
    this.mountCheckTimeoutMs = clampNum(opts?.mountCheckTimeoutMs, 5_000, 1_000, 30_000);
    this.mountTimeoutMs = clampNum(opts?.mountTimeoutMs, 10_000, 3_000, 60_000);
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

  /** Run smbclient with execFile + args array to prevent shell injection */
  private smbCmd(args: string[]): Buffer {
    const cmdArgs = [
      `//${this.host}/${this.share}`,
      "-U", this.username,
      "-p", String(this.port),
      "-c", args.join(";"),
    ];
    return execFileSync("smbclient", cmdArgs, {
      timeout: this.smbTimeoutMs,
      env: { ...process.env as Record<string, string>, PASSWD: this.password },
    });
  }

  private ensureMounted(): string | null {
    if (!this.isWindows) return null;
    const driveLetter = "Z:";
    const esc = (s: string) => s.replace(/[&|^$%`;]/g, "").replace(/"/g, '""');
    const unc = `\\\\${this.host}\\${this.share}`;

    try {
      // Check if already mounted
      const existing = execSync(`net use ${driveLetter}`, { encoding: "utf-8", timeout: this.mountCheckTimeoutMs });
      if (existing.includes(unc)) return driveLetter;
    } catch {
      // Not mounted, try to mount
    }

    try {
      execSync(`net use ${driveLetter} ${unc} /user:"${esc(this.username)}" /persistent:no`, {
        encoding: "utf-8",
        timeout: this.mountTimeoutMs,
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
        this.smbCmd([
          `mkdir ${path.dirname(remoteFile)} 2>/dev/null`,
          `put ${localPath} ${remoteFile}`,
        ]);
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
        this.smbCmd([`get ${remoteFile} ${localPath}`]);
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
        const output = this.smbCmd([`ls ${dir}/*`]).toString("utf-8");
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
        this.smbCmd([`rm ${remoteFile}`]);
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
        this.smbCmd([`ls ${remoteFile}`]);
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

export interface AdapterFactoryOpts {
  timeoutMs?: number;
  smbTimeoutMs?: number;
  mountCheckTimeoutMs?: number;
  mountTimeoutMs?: number;
}

const PROVIDER_CHECKS: Array<{ name: string; check: (s: Secrets) => boolean; create: (s: Secrets, opts?: AdapterFactoryOpts) => CloudAdapter }> = [
  { name: "webdav", check: WebDAVAdapter.isConfigured, create: (s) => new WebDAVAdapter(s) },
  { name: "s3", check: S3Adapter.isConfigured, create: (s) => new S3Adapter(s) },
  { name: "sftp", check: SFTPAdapter.isConfigured, create: (s, opts) => new SFTPAdapter(s, opts) },
  { name: "samba", check: SambaAdapter.isConfigured, create: (s, opts) => new SambaAdapter(s, opts) },
];

/**
 * Create all configured cloud adapters from secrets.env.
 */
export function createAdapters(secretsPath?: string, opts?: AdapterFactoryOpts): AdapterFactoryResult {
  const secrets = loadSecrets(secretsPath);
  const adapters = new Map<string, CloudAdapter>();
  const statuses: AdapterStatus[] = [];

  for (const { name, check, create } of PROVIDER_CHECKS) {
    if (check(secrets)) {
      try {
        adapters.set(name, create(secrets, opts));
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
export function createAdapter(provider: string, secretsPath?: string, opts?: AdapterFactoryOpts): CloudAdapter | null {
  const secrets = loadSecrets(secretsPath);
  const entry = PROVIDER_CHECKS.find(p => p.name === provider);
  if (!entry || !entry.check(secrets)) return null;
  return entry.create(secrets, opts);
}
