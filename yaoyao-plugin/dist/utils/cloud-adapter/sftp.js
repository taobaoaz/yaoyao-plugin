/**
 * utils/cloud-adapter/sftp.ts — SFTP adapter via system sftp command
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
export class SFTPAdapter {
    provider = 'sftp';
    host;
    port;
    username;
    password;
    timeoutMs;
    constructor(secrets, opts) {
        this.host = secrets.SFTP_HOST || '';
        this.port = parseInt(secrets.SFTP_PORT || '22', 10);
        this.username = secrets.SFTP_USERNAME || '';
        this.password = secrets.SFTP_PASSWORD || '';
        this.timeoutMs = Math.max(3_000, Math.min(120_000, opts?.timeoutMs ?? parseInt(secrets.SFTP_TIMEOUT_MS || '30000', 10)));
    }
    static isConfigured(s) {
        return !!(s.SFTP_HOST && s.SFTP_USERNAME);
    }
    async runSftp(commands) {
        return new Promise((resolve) => {
            const batch = commands.join('\n');
            const args = [
                '-o',
                'StrictHostKeyChecking=no',
                '-o',
                'BatchMode=yes',
                '-P',
                String(this.port),
            ];
            let cmd;
            let cmdArgs;
            let envOverride;
            if (this.password) {
                cmd = 'sshpass';
                cmdArgs = ['-e', 'sftp', ...args, `${this.username}@${this.host}`];
                envOverride = { ...process.env, SSHPASS: this.password };
            }
            else {
                cmd = 'sftp';
                cmdArgs = [...args, `${this.username}@${this.host}`];
            }
            const child = execFile(cmd, cmdArgs, { timeout: this.timeoutMs, env: envOverride || process.env }, (err, stdout, stderr) => {
                resolve(err ? { ok: false, stdout: stderr || err.message } : { ok: true, stdout: stdout || '' });
            });
            if (child.stdin) {
                child.stdin.write(batch + '\n');
                child.stdin.end();
            }
        });
    }
    esc(p) {
        return p.replace(/"/g, '\\"');
    }
    async upload(localPath, remotePath) {
        try {
            const { ok } = await this.runSftp([
                `put "${this.esc(localPath.replace(/\\/g, '/'))}" "${this.esc(remotePath)}"`,
            ]);
            return ok;
        }
        catch {
            return false;
        }
    }
    async download(remotePath, localPath) {
        try {
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            const { ok } = await this.runSftp([
                `get "${this.esc(remotePath)}" "${this.esc(localPath.replace(/\\/g, '/'))}"`,
            ]);
            return ok;
        }
        catch {
            return false;
        }
    }
    async list(remotePath = '/') {
        try {
            const { ok, stdout } = await this.runSftp([`ls -l "${this.esc(remotePath)}"`]);
            if (!ok)
                return [];
            const entries = [];
            for (const line of stdout.split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 9)
                    entries.push({
                        name: parts.slice(8).join(' '),
                        size: parseInt(parts[4], 10) || 0,
                        modified: 0,
                    });
            }
            return entries;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:sftp] Operation failed: ${msg}`);
            return [];
        }
    }
    async delete(remotePath) {
        try {
            const { ok } = await this.runSftp([`rm "${this.esc(remotePath)}"`]);
            return ok;
        }
        catch {
            return false;
        }
    }
    async exists(remotePath) {
        try {
            const { ok } = await this.runSftp([`stat "${this.esc(remotePath)}"`]);
            return ok;
        }
        catch {
            return false;
        }
    }
}
