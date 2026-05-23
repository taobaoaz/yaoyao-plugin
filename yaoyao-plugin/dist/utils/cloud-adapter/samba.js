/**
 * utils/cloud-adapter/samba.ts — Samba adapter (net use / smbclient)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { clampNum } from "../clamp.js";
export class SambaAdapter {
    provider = "samba";
    host;
    port;
    username;
    password;
    share;
    remotePath;
    isWindows;
    smbTimeoutMs;
    mountCheckTimeoutMs;
    mountTimeoutMs;
    constructor(secrets, opts) {
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
    static isConfigured(s) {
        return !!(s.SAMBA_HOST && s.SAMBA_USER);
    }
    smbCmd(args) {
        return execFileSync("smbclient", [`//${this.host}/${this.share}`, "-U", this.username, "-p", String(this.port), "-c", args.join(";")], {
            timeout: this.smbTimeoutMs,
            env: { ...process.env, PASSWD: this.password },
        });
    }
    ensureMounted() {
        if (!this.isWindows)
            return null;
        const driveLetter = "Z:";
        const unc = `\\\\${this.host}\\${this.share}`;
        try {
            if (execSync(`net use ${driveLetter}`, { encoding: "utf-8", timeout: this.mountCheckTimeoutMs }).includes(unc))
                return driveLetter;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:samba] Unmount check failed: ${msg}`);
        }
        try {
            execFileSync("net", ["use", driveLetter, unc, `/user:${this.username}`, "/persistent:no"], { encoding: "utf-8", timeout: this.mountTimeoutMs, env: { ...process.env, PASSWD: this.password } });
            return driveLetter;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:samba] Mount failed: ${msg}`);
            return null;
        }
    }
    async upload(localPath, remotePath) {
        try {
            if (this.isWindows) {
                const drive = this.ensureMounted();
                if (!drive)
                    return false;
                const dest = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.copyFileSync(localPath, dest);
                return true;
            }
            const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
            this.smbCmd([`mkdir ${path.dirname(rf)} 2>/dev/null`, `put ${localPath} ${rf}`]);
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:cloud-adapter] Operation failed: ${msg}`);
            return false;
        }
    }
    async download(remotePath, localPath) {
        try {
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            if (this.isWindows) {
                const drive = this.ensureMounted();
                if (!drive)
                    return false;
                fs.copyFileSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`, localPath);
                return true;
            }
            const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
            this.smbCmd([`get ${rf} ${localPath}`]);
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:cloud-adapter] Operation failed: ${msg}`);
            return false;
        }
    }
    async list(remotePath = "/") {
        try {
            if (this.isWindows) {
                const drive = this.ensureMounted();
                if (!drive)
                    return [];
                const dir = `${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`;
                if (!fs.existsSync(dir))
                    return [];
                return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => {
                    const s = fs.statSync(path.join(dir, f));
                    return { name: f, size: s.size, modified: s.mtimeMs };
                });
            }
            const dir = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
            const output = this.smbCmd([`ls ${dir}/*`]).toString("utf-8");
            const entries = [];
            for (const line of output.split("\n")) {
                const m = line.match(/\s+(\S+)\s+[A|D]\s+(\d+)/);
                if (m)
                    entries.push({ name: m[1], size: parseInt(m[2], 10), modified: 0 });
            }
            return entries;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:cloud-adapter] Operation failed: ${msg}`);
            return [];
        }
    }
    async delete(remotePath) {
        try {
            if (this.isWindows) {
                const drive = this.ensureMounted();
                if (!drive)
                    return false;
                fs.unlinkSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`);
                return true;
            }
            const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
            this.smbCmd([`rm ${rf}`]);
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:cloud-adapter] Operation failed: ${msg}`);
            return false;
        }
    }
    async exists(remotePath) {
        try {
            if (this.isWindows) {
                const drive = this.ensureMounted();
                if (!drive)
                    return false;
                return fs.existsSync(`${drive}\\${this.remotePath}\\${remotePath.replace(/\//g, "\\")}`);
            }
            const rf = this.remotePath ? `${this.remotePath}/${remotePath}` : remotePath;
            this.smbCmd([`ls ${rf}`]);
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:cloud-adapter] Operation failed: ${msg}`);
            return false;
        }
    }
}
