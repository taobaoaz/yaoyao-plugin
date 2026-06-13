/**
 * utils/cloud-adapter/samba.ts — Samba adapter (net use / smbclient)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { clampNum } from "../clamp.ts";
import type { Secrets } from "../secrets-loader.ts";
import type { CloudAdapter, CloudFileEntry } from "./types.ts";

export interface SambaOpts {
  smbTimeoutMs?: number;
  mountCheckTimeoutMs?: number;
  mountTimeoutMs?: number;
}

export class SambaAdapter implements CloudAdapter {
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

  constructor(secrets: Secrets, opts?: SambaOpts) {
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

  private smbCmd(args: string[]): Buffer {
    return execFileSync("smbclient", [`//${this.host}/${this.share}`, "-U", this.username, "-p", String(this.port), "-c", args.join(";")], {
      timeout: this.smbTimeoutMs,
      env: { ...process.env as Record<string, string>, PASSWD: this.password },
    });
  }

  private ensureMounted(): string | null {
    if (!this.isWindows) return null;
    const driveLetter = "Z:";
    const unc = `\\\\${this.host}\\${this.share}`;
    try {
      if (execSync(`net use ${driveLetter}`, { encoding: "utf-8", timeout: this.mountCheckTimeoutMs }).includes(unc)) return driveLetter;
    } catch { /* unmounted */ }
    try {
      execFileSync("net", ["use", driveLetter, unc, `/user:${this.username}`, "/persistent:no"], { encoding: "utf-8", timeout: this.mountTimeoutMs, env: { ...process.env as Record<string, string>, PASSWD: this.password } });
      return driveLetter;
    } catch { return null; }
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted(); if (!drive) return false;
        const dest = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(localPath, dest); return true;
      }
      const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
      this.smbCmd([`mkdir ${path.dirname(rf)} 2>/dev/null`, `put ${localPath} ${rf}`]); return true;
    } catch { return false; }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      if (this.isWindows) {
        const drive = this.ensureMounted(); if (!drive) return false;
        fs.copyFileSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`, localPath); return true;
      }
      const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
      this.smbCmd([`get ${rf} ${localPath}`]); return true;
    } catch { return false; }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted(); if (!drive) return [];
        const dir = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => {
          const s = fs.statSync(path.join(dir, f)); return { name: f, size: s.size, modified: s.mtimeMs };
        });
      }
      const dir = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
      const output = this.smbCmd([`ls ${dir}/*`]).toString("utf-8");
      const entries: CloudFileEntry[] = [];
      for (const line of output.split("\n")) {
        const m = line.match(/\s+(\S+)\s+[A|D]\s+(\d+)/);
        if (m) entries.push({ name: m[1], size: parseInt(m[2], 10), modified: 0 });
      }
      return entries;
    } catch { return []; }
  }

  async delete(remotePath: string): Promise<boolean> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted(); if (!drive) return false;
        fs.unlinkSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`); return true;
      }
      const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
      this.smbCmd([`rm ${rf}`]); return true;
    } catch { return false; }
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      if (this.isWindows) {
        const drive = this.ensureMounted(); if (!drive) return false;
        return fs.existsSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`);
      }
      const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
      this.smbCmd([`ls ${rf}`]); return true;
    } catch { return false; }
  }
}
