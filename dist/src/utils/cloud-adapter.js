/**
 * Cloud adapter architecture — zero external dependency implementation.
 * Supports: WebDAV, S3 (AWS Sig V4), SFTP (system sftp), Samba (net use / smbclient).
 *
 * All HTTP-based adapters use node:https / node:http directly.
 * Shell-based adapters (SFTP, Samba) invoke system commands via child_process.
 */
import fsMod from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { execFile, execSync } from "node:child_process";
import { loadSecrets } from "./secrets-loader.js";

class WebDAVAdapter {
  provider = "webdav";

  constructor(secrets) {
    this.baseUrl = (secrets.WEBDAV_URL || "").replace(/\/+$/, "");
    this.username = secrets.WEBDAV_USERNAME || "";
    this.password = secrets.WEBDAV_PASSWORD || "";
  }

  static isConfigured(s) {
    return !!(s.WEBDAV_URL && s.WEBDAV_USERNAME);
  }

  buildUrl(remotePath) {
    const clean = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
    return `${this.baseUrl}/${clean}`;
  }

  authHeader() {
    return "Basic " + Buffer.from(`${this.username}:${this.password}`).toString("base64");
  }

  request(method, url, headers = {}, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === "https:" ? https : http;
      const opts = {
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
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async upload(localPath, remotePath) {
    try {
      const data = fsMod.readFileSync(localPath);
      const { status } = await this.request("PUT", this.buildUrl(remotePath), { "Content-Type": "application/octet-stream" }, data);
      return status >= 200 && status < 300;
    } catch { return false; }
  }

  async download(remotePath, localPath) {
    try {
      const { status, data } = await this.request("GET", this.buildUrl(remotePath));
      if (status !== 200) return false;
      fsMod.mkdirSync(path.dirname(localPath), { recursive: true });
      fsMod.writeFileSync(localPath, data);
      return true;
    } catch { return false; }
  }

  async list(remotePath = "/") {
    try {
      const { status, data } = await this.request("PROPFIND", this.buildUrl(remotePath), { Depth: "1" });
      if (status !== 207) return [];
      const xml = data.toString("utf-8");
      const entries = [];
      const responses = xml.split(/<d:response>/i).slice(1);
      for (const resp of responses) {
        const hrefMatch = resp.match(/<d:href[^>]*>([^<]+)/i);
        const sizeMatch = resp.match(/<d:getcontentlength[^>]*(\d+)/i);
        const modMatch = resp.match(/<d:getlastmodified[^>]*>([^<]+)/i);
        if (hrefMatch) {
          const name = hrefMatch[1].split("/").filter(Boolean).pop() || "";
          if (!name) continue;
          entries.push({ name, size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0, modified: modMatch ? new Date(modMatch[1]).getTime() : 0 });
        }
      }
      return entries;
    } catch { return []; }
  }

  async delete(remotePath) {
    try {
      const { status } = await this.request("DELETE", this.buildUrl(remotePath));
      return status >= 200 && status < 300;
    } catch { return false; }
  }

  async exists(remotePath) {
    try {
      const { status } = await this.request("HEAD", this.buildUrl(remotePath));
      return status === 200;
    } catch { return false; }
  }
}

class S3Adapter {
  provider = "s3";

  constructor(secrets) {
    this.endpoint = (secrets.S3_ENDPOINT || "").replace(/\/+$/, "");
    this.accessKey = secrets.S3_ACCESS_KEY || "";
    this.secretKey = secrets.S3_SECRET_KEY || "";
    this.bucket = secrets.S3_BUCKET || "";
    this.region = secrets.S3_REGION || "auto";
  }

  static isConfigured(s) {
    return !!(s.S3_ENDPOINT && s.S3_ACCESS_KEY && s.S3_SECRET_KEY && s.S3_BUCKET);
  }

  signRequest(method, path, headers, bodySha256, date) {
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
    const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)].trim()}`).join("\n") + "\n";
    const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, bodySha256].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
    let signingKey = hmac(Buffer.from("AWS4" + this.secretKey), dateStamp);
    signingKey = hmac(signingKey, this.region);
    signingKey = hmac(signingKey, service);
    signingKey = hmac(signingKey, "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }

  buildUrl(key) {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    return `${this.endpoint}/${this.bucket}/${cleanKey}`;
  }

  s3Path(key) {
    const cleanKey = key.startsWith("/") ? key.slice(1) : key;
    return `/${this.bucket}/${cleanKey}`;
  }

  async doRequest(method, key, extraHeaders = {}, body) {
    const urlStr = this.buildUrl(key);
    const parsed = new URL(urlStr);
    const bodyData = body || Buffer.alloc(0);
    const bodySha256 = crypto.createHash("sha256").update(bodyData).digest("hex");
    const headers = { Host: parsed.host, ...extraHeaders };
    this.signRequest(method, this.s3Path(key), headers, bodySha256, new Date());
    return new Promise((resolve, reject) => {
      const mod = parsed.protocol === "https:" ? https : http;
      const opts = { method, hostname: parsed.hostname, port: parsed.port || (parsed.protocol === "https:" ? 443 : 80), path: parsed.pathname + parsed.search, headers };
      const req = mod.request(opts, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      if (bodyData.length > 0) req.write(bodyData);
      req.end();
    });
  }

  async upload(localPath, remotePath) {
    try {
      const data = fsMod.readFileSync(localPath);
      const { status } = await this.doRequest("PUT", remotePath, { "Content-Length": String(data.length) }, data);
      return status >= 200 && status < 300;
    } catch { return false; }
  }

  async download(remotePath, localPath) {
    try {
      const { status, data } = await this.doRequest("GET", remotePath);
      if (status !== 200) return false;
      fsMod.mkdirSync(path.dirname(localPath), { recursive: true });
      fsMod.writeFileSync(localPath, data);
      return true;
    } catch { return false; }
  }

  async list(remotePath = "/") {
    try {
      const prefix = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
      const urlStr = this.buildUrl(prefix);
      const parsed = new URL(urlStr);
      parsed.search = "?list-type=2&prefix=" + encodeURIComponent(prefix);
      const bodySha256 = crypto.createHash("sha256").update("").digest("hex");
      const s3Path = this.s3Path(prefix) + parsed.search;
      const headers = { Host: parsed.host };
      this.signRequest("GET", s3Path, headers, bodySha256, new Date());
      return new Promise((resolve, reject) => {
        const mod = parsed.protocol === "https:" ? https : http;
        const opts = { method: "GET", hostname: parsed.hostname, port: parsed.port || undefined, path: s3Path, headers };
        const req = mod.request(opts, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const xml = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode !== 200) return resolve([]);
            const entries = [];
            const contents = xml.split(/<Contents>/).slice(1);
            for (const c of contents) {
              const keyMatch = c.match(/<Key>([^<]+)/);
              const sizeMatch = c.match(/<Size>(\d+)/);
              const modMatch = c.match(/<LastModified>([^<]+)/);
              if (keyMatch) {
                entries.push({ name: keyMatch[1].split("/").pop() || keyMatch[1], size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0, modified: modMatch ? new Date(modMatch[1]).getTime() : 0 });
              }
            }
            resolve(entries);
          });
        });
        req.on("error", reject);
        req.end();
      });
    } catch { return []; }
  }

  async delete(remotePath) {
    try {
      const { status } = await this.doRequest("DELETE", remotePath);
      return status >= 200 && status < 300;
    } catch { return false; }
  }

  async exists(remotePath) {
    try {
      const { status } = await this.doRequest("HEAD", remotePath);
      return status === 200;
    } catch { return false; }
  }
}

class SFTPAdapter {
  provider = "sftp";

  constructor(secrets) {
    this.host = secrets.SFTP_HOST || "";
    this.port = parseInt(secrets.SFTP_PORT || "22", 10);
    this.username = secrets.SFTP_USERNAME || "";
    this.password = secrets.SFTP_PASSWORD || "";
  }

  static isConfigured(s) {
    return !!(s.SFTP_HOST && s.SFTP_USERNAME);
  }

  async runSftp(commands) {
    return new Promise((resolve) => {
      const batch = commands.join("\n");
      const args = ["-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-P", String(this.port)];
      let cmd, cmdArgs, envOverride;
      if (this.password) {
        cmd = "sshpass";
        cmdArgs = ["-e", "sftp", ...args, `${this.username}@${this.host}`];
        envOverride = { ...process.env, SSHPASS: this.password };
      } else {
        cmd = "sftp";
        cmdArgs = [...args, `${this.username}@${this.host}`];
      }
      const child = execFile(cmd, cmdArgs, { timeout: 30000, env: envOverride || process.env }, (err, stdout, stderr) => {
        if (err) resolve({ ok: false, stdout: stderr || err.message });
        else resolve({ ok: true, stdout: stdout || "" });
      });
      if (child.stdin) { child.stdin.write(batch + "\n"); child.stdin.end(); }
    });
  }

  async upload(localPath, remotePath) {
    try {
      const { ok } = await this.runSftp([`put "${localPath.replace(/\\/g, "/")}" "${remotePath}"`]);
      return ok;
    } catch { return false; }
  }

  async download(remotePath, localPath) {
    try {
      fsMod.mkdirSync(path.dirname(localPath), { recursive: true });
      const { ok } = await this.runSftp([`get "${remotePath}" "${localPath.replace(/\\/g, "/")}"`]);
      return ok;
    } catch { return false; }
  }

  async list(remotePath = "/") {
    try {
      const { ok, stdout } = await this.runSftp([`ls -l "${remotePath}"`]);
      if (!ok) return [];
      const entries = [];
      for (const line of stdout.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          entries.push({ name: parts.slice(8).join(" "), size: parseInt(parts[4], 10) || 0, modified: 0 });
        }
      }
      return entries;
    } catch { return []; }
  }

  async delete(remotePath) {
    try {
      const { ok } = await this.runSftp([`rm "${remotePath}"`]);
      return ok;
    } catch { return false; }
  }

  async exists(remotePath) {
    try {
      const { ok } = await this.runSftp([`stat "${remotePath}"`]);
      return ok;
    } catch { return false; }
  }
}

class SambaAdapter {
  provider = "samba";

  constructor(secrets) {
    this.host = secrets.SAMBA_HOST || "";
    this.port = parseInt(secrets.SAMBA_PORT || "445", 10);
    this.username = secrets.SAMBA_USER || "";
    this.password = secrets.SAMBA_PASSWORD || "";
    this.share = secrets.SAMBA_SHARE || "memory";
    this.remotePath = (secrets.SAMBA_REMOTE_PATH || "/").replace(/^\/+|\/+$/g, "");
    this.isWindows = process.platform === "win32";
  }

  static isConfigured(s) {
    return !!(s.SAMBA_HOST && s.SAMBA_USER);
  }

  uncPath(remotePath) {
    const clean = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
    const subPath = this.remotePath ? `${this.remotePath}/${clean}` : clean;
    return `\\\\${this.host}\\${this.share}\\${subPath.replace(/\//g, "\\")}`;
  }

  smbTarget() { return `//${this.host}/${this.share}`; }

  smbCmd(args) {
    return execSync(`smbclient "${this.smbTarget()}" -U "${this.username}" -p ${this.port} -c "${args}"`, {
      timeout: 15000, env: { ...process.env, PASSWD: this.password }
    });
  }

  ensureMounted() {
    if (!this.isWindows) return null;
    const driveLetter = "Z:";
    const unc = `\\\\${this.host}\\${this.share}`;
    try {
      const existing = execSync(`net use ${driveLetter}`, { encoding: "utf-8", timeout: 5000 });
      if (existing.includes(unc)) return driveLetter;
    } catch {}
    try {
      execSync(`net use ${driveLetter} ${unc} /user:"${this.username}" /persistent:no`, {
        encoding: "utf-8", timeout: 10000, env: { ...process.env, PASSWD: this.password }
      });
      return driveLetter;
    } catch { return null; }
  }

  async upload(localPath, remotePath) {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        const dest = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        fsMod.mkdirSync(path.dirname(dest), { recursive: true });
        fsMod.copyFileSync(localPath, dest);
        return true;
      } else {
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        this.smbCmd(`mkdir ${path.dirname(remoteFile)} 2>/dev/null; put ${localPath} ${remoteFile}`);
        return true;
      }
    } catch { return false; }
  }

  async download(remotePath, localPath) {
    try {
      fsMod.mkdirSync(path.dirname(localPath), { recursive: true });
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        fsMod.copyFileSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`, localPath);
        return true;
      } else {
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        this.smbCmd(`get ${remoteFile} ${localPath}`);
        return true;
      }
    } catch { return false; }
  }

  async list(remotePath = "/") {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return [];
        const dir = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        if (!fsMod.existsSync(dir)) return [];
        return fsMod.readdirSync(dir).filter(f => fsMod.statSync(path.join(dir, f)).isFile()).map(f => {
          const stat = fsMod.statSync(path.join(dir, f));
          return { name: f, size: stat.size, modified: stat.mtimeMs };
        });
      } else {
        const dir = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        const output = this.smbCmd(`ls ${dir}/*`).toString("utf-8");
        const entries = [];
        for (const line of output.split("\n")) {
          const match = line.match(/\s+(\S+)\s+[A|D]\s+(\d+)/);
          if (match) entries.push({ name: match[1], size: parseInt(match[2], 10), modified: 0 });
        }
        return entries;
      }
    } catch { return []; }
  }

  async delete(remotePath) {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        fsMod.unlinkSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`);
        return true;
      } else {
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        this.smbCmd(`rm ${remoteFile}`);
        return true;
      }
    } catch { return false; }
  }

  async exists(remotePath) {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted();
        if (!drive) return false;
        return fsMod.existsSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`);
      } else {
        const remoteFile = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
        this.smbCmd(`ls ${remoteFile}`);
        return true;
      }
    } catch { return false; }
  }
}

const PROVIDER_CHECKS = [
  { name: "webdav", check: WebDAVAdapter.isConfigured, create: (s) => new WebDAVAdapter(s) },
  { name: "s3", check: S3Adapter.isConfigured, create: (s) => new S3Adapter(s) },
  { name: "sftp", check: SFTPAdapter.isConfigured, create: (s) => new SFTPAdapter(s) },
  { name: "samba", check: SambaAdapter.isConfigured, create: (s) => new SambaAdapter(s) },
];

export function createAdapters(secretsPath) {
  const secrets = loadSecrets(secretsPath);
  const adapters = new Map();
  const statuses = [];
  for (const { name, check, create } of PROVIDER_CHECKS) {
    if (check(secrets)) {
      try {
        adapters.set(name, create(secrets));
        statuses.push({ provider: name, configured: true, message: "✅ 已配置" });
      } catch (err) {
        statuses.push({ provider: name, configured: false, message: "⚠️ 配置错误: " + err.message });
      }
    } else {
      statuses.push({ provider: name, configured: false, message: "— 未配置" });
    }
  }
  return { adapters, statuses };
}

export function createAdapter(provider, secretsPath) {
  const secrets = loadSecrets(secretsPath);
  const entry = PROVIDER_CHECKS.find(p => p.name === provider);
  if (!entry || !entry.check(secrets)) return null;
  return entry.create(secrets);
}
