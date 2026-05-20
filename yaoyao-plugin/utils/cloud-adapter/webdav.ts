/**
 * utils/cloud-adapter/webdav.ts — WebDAV adapter via node:http(s)
 */
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import type { Secrets } from "../secrets-loader.ts";
import type { CloudAdapter, CloudFileEntry } from "./types.ts";

export class WebDAVAdapter implements CloudAdapter {
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
        method, hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: { ...headers, Authorization: this.authHeader() },
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] Error: ${msg}`);
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] Error: ${msg}`);
      return false;
    }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      const { status, data } = await this.request("PROPFIND", this.buildUrl(remotePath), { Depth: "1" });
      if (status !== 207) return [];
      const xml = data.toString("utf-8");
      const entries: CloudFileEntry[] = [];
      for (const resp of xml.split(/<d:response>/i).slice(1)) {
        const hrefMatch = resp.match(/<d:href[^>]*>([^<]+)/i);
        const sizeMatch = resp.match(/<d:getcontentlength[^>]*>(\d+)/i);
        const modMatch = resp.match(/<d:getlastmodified[^>]*>([^<]+)/i);
        if (hrefMatch) {
          const name = hrefMatch[1].split("/").filter(Boolean).pop() || "";
          if (!name) continue;
          entries.push({ name, size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0, modified: modMatch ? new Date(modMatch[1]).getTime() : 0 });
        }
      }
      return entries;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] Error: ${msg}`);
      return [];
    }
  }

  async delete(remotePath: string): Promise<boolean> {
    try { const { status } = await this.request("DELETE", this.buildUrl(remotePath)); return status >= 200 && status < 300; }
    catch { return false; }
  }

  async exists(remotePath: string): Promise<boolean> {
    try { const { status } = await this.request("HEAD", this.buildUrl(remotePath)); return status === 200; }
    catch { return false; }
  }
}
