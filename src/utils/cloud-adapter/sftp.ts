/**
 * utils/cloud-adapter/sftp.ts — SFTP adapter via system sftp command
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { Secrets } from "../secrets-loader.ts";
import type { CloudAdapter, CloudFileEntry, AdapterFactoryOpts } from "./types.ts";

export class SFTPAdapter implements CloudAdapter {
  readonly provider = "sftp";
  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private timeoutMs: number;

  constructor(secrets: Secrets, opts?: AdapterFactoryOpts) {
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
      const batch = commands.join("\n");
      const args = ["-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-P", String(this.port)];
      let cmd: string; let cmdArgs: string[]; let envOverride: Record<string, string> | undefined;
      if (this.password) {
        cmd = "sshpass"; cmdArgs = ["-e", "sftp", ...args, `${this.username}@${this.host}`];
        envOverride = { ...process.env as Record<string, string>, SSHPASS: this.password };
      } else {
        cmd = "sftp"; cmdArgs = [...args, `${this.username}@${this.host}`];
      }
      const child = execFile(cmd, cmdArgs, { timeout: this.timeoutMs, env: envOverride || process.env }, (err, stdout, stderr) => {
        resolve(err ? { ok: false, stdout: stderr || err.message } : { ok: true, stdout: stdout || "" });
      });
      if (child.stdin) { child.stdin.write(batch + "\n"); child.stdin.end(); }
    });
  }

  private esc(p: string): string { return p.replace(/"/g, '\\"'); }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try { const { ok } = await this.runSftp([`put "${this.esc(localPath.replace(/\\/g, "/"))}" "${this.esc(remotePath)}"`]); return ok; }
    catch { return false; }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try { fs.mkdirSync(path.dirname(localPath), { recursive: true }); const { ok } = await this.runSftp([`get "${this.esc(remotePath)}" "${this.esc(localPath.replace(/\\/g, "/"))}"`]); return ok; }
    catch { return false; }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      const { ok, stdout } = await this.runSftp([`ls -l "${this.esc(remotePath)}"`]);
      if (!ok) return [];
      const entries: CloudFileEntry[] = [];
      for (const line of stdout.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) entries.push({ name: parts.slice(8).join(" "), size: parseInt(parts[4], 10) || 0, modified: 0 });
      }
      return entries;
    } catch { return []; }
  }

  async delete(remotePath: string): Promise<boolean> {
    try { const { ok } = await this.runSftp([`rm "${this.esc(remotePath)}"`]); return ok; }
    catch { return false; }
  }

  async exists(remotePath: string): Promise<boolean> {
    try { const { ok } = await this.runSftp([`stat "${this.esc(remotePath)}"`]); return ok; }
    catch { return false; }
  }
}
