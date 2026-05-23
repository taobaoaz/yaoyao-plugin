/**
 * utils/cloud-adapter/webdav.ts — WebDAV adapter via node:http(s)
 */
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
export class WebDAVAdapter {
    provider = "webdav";
    baseUrl;
    username;
    password;
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
                method, hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                path: parsed.pathname + parsed.search,
                headers: { ...headers, Authorization: this.authHeader() },
            };
            const req = mod.request(opts, (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks) }));
            });
            req.on("error", reject);
            if (body)
                req.write(body);
            req.end();
        });
    }
    async upload(localPath, remotePath) {
        try {
            const data = fs.readFileSync(localPath);
            const { status } = await this.request("PUT", this.buildUrl(remotePath), { "Content-Type": "application/octet-stream" }, data);
            return status >= 200 && status < 300;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:webdav] Operation failed: ${msg}`);
            return false;
        }
    }
    async download(remotePath, localPath) {
        try {
            const { status, data } = await this.request("GET", this.buildUrl(remotePath));
            if (status !== 200)
                return false;
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, data);
            return true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:webdav] Operation failed: ${msg}`);
            return false;
        }
    }
    async list(remotePath = "/") {
        try {
            const { status, data } = await this.request("PROPFIND", this.buildUrl(remotePath), { Depth: "1" });
            if (status !== 207)
                return [];
            const xml = data.toString("utf-8");
            const entries = [];
            for (const resp of xml.split(/<d:response>/i).slice(1)) {
                const hrefMatch = resp.match(/<d:href[^>]*>([^<]+)/i);
                const sizeMatch = resp.match(/<d:getcontentlength[^>]*>(\d+)/i);
                const modMatch = resp.match(/<d:getlastmodified[^>]*>([^<]+)/i);
                if (hrefMatch) {
                    const name = hrefMatch[1].split("/").filter(Boolean).pop() || "";
                    if (!name)
                        continue;
                    entries.push({ name, size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0, modified: modMatch ? new Date(modMatch[1]).getTime() : 0 });
                }
            }
            return entries;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:webdav] Operation failed: ${msg}`);
            return [];
        }
    }
    async delete(remotePath) {
        try {
            const { status } = await this.request("DELETE", this.buildUrl(remotePath));
            return status >= 200 && status < 300;
        }
        catch {
            return false;
        }
    }
    async exists(remotePath) {
        try {
            const { status } = await this.request("HEAD", this.buildUrl(remotePath));
            return status === 200;
        }
        catch {
            return false;
        }
    }
}
