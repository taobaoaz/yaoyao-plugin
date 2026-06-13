/**
 * utils/cloud-adapter/s3.ts — S3 adapter via AWS Signature V4
 */
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Secrets } from "../secrets-loader.ts";
import type { CloudAdapter, CloudFileEntry } from "./types.ts";

export class S3Adapter implements CloudAdapter {
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

  private usePathStyle(): boolean { return this.bucket.includes("."); }
  private targetHost(): string {
    const h = new URL(this.endpoint).host;
    return this.usePathStyle() ? h : `${this.bucket}.${h}`;
  }

  private signRequest(method: string, path: string, headers: Record<string, string>, bodySha256: string, d: Date): Record<string, string> {
    const dateStamp = d.toISOString().replace(/[-:]/g, "").slice(0, 8);
    const amzDate = dateStamp + "T" + d.toISOString().replace(/[-:]/g, "").slice(9, 15) + "Z";
    const credScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    headers["x-amz-date"] = amzDate;
    headers["x-amz-content-sha256"] = bodySha256;
    headers.Host = this.targetHost();
    const signedKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
    const signedHeaders = signedKeys.join(";");
    const cHeaders = signedKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]!}`).join("\n") + "\n";
    const cReq = [method, path, "", cHeaders, signedHeaders, bodySha256].join("\n");
    const sTs = ["AWS4-HMAC-SHA256", amzDate, credScope, crypto.createHash("sha256").update(cReq).digest("hex")].join("\n");
    const hmac = (k: Buffer, d: string) => crypto.createHmac("sha256", k).update(d).digest();
    let sk = hmac(Buffer.from("AWS4" + this.secretKey), dateStamp);
    sk = hmac(sk, this.region); sk = hmac(sk, "s3"); sk = hmac(sk, "aws4_request");
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${crypto.createHmac("sha256", sk).update(sTs).digest("hex")}`;
    return headers;
  }

  private async doReq(method: string, key: string, xh: Record<string, string> = {}, body?: Buffer): Promise<{ status: number; data: Buffer }> {
    const bodyData = body || Buffer.alloc(0);
    const bodySha256 = crypto.createHash("sha256").update(bodyData).digest("hex");
    const targetHost = this.targetHost();
    const s3Path = this.usePathStyle() ? `/${this.bucket}/${key.replace(/^\//, "")}` : `/${key.replace(/^\//, "")}`;
    const pe = new URL(this.endpoint);
    const port = pe.port || (pe.protocol === "https:" ? 443 : 80);
    const mod = pe.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request({ method, hostname: targetHost, port, path: s3Path, headers: this.signRequest(method, s3Path, { Host: targetHost, ...xh }, bodySha256, new Date()) }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      if (bodyData.length > 0) req.write(bodyData);
      req.end();
    });
  }

  async upload(localPath: string, remotePath: string): Promise<boolean> {
    try { const data = fs.readFileSync(localPath); const { status } = await this.doReq("PUT", remotePath, { "Content-Length": String(data.length) }, data); return status >= 200 && status < 300; }
    catch { return false; }
  }

  async download(remotePath: string, localPath: string): Promise<boolean> {
    try { const { status, data } = await this.doReq("GET", remotePath); if (status !== 200) return false; fs.mkdirSync(path.dirname(localPath), { recursive: true }); fs.writeFileSync(localPath, data); return true; }
    catch { return false; }
  }

  async list(remotePath: string = "/"): Promise<CloudFileEntry[]> {
    try {
      const prefix = remotePath.replace(/^\//, "");
      const targetHost = this.targetHost();
      const query = `?list-type=2&prefix=${encodeURIComponent(prefix)}`;
      const listPath = this.usePathStyle() ? `/${this.bucket}${query}` : `/${query}`;
      const bodySha256 = crypto.createHash("sha256").update("").digest("hex");
      const pe = new URL(this.endpoint);
      const port = pe.port || (pe.protocol === "https:" ? 443 : 80);
      const mod = pe.protocol === "https:" ? https : http;
      return await new Promise((resolve, reject) => {
        const req = mod.request({ method: "GET", hostname: targetHost, port, path: listPath, headers: this.signRequest("GET", listPath, { Host: targetHost }, bodySha256, new Date()) }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", c => chunks.push(c));
          res.on("end", () => {
            if (res.statusCode !== 200) return resolve([]);
            const entries: CloudFileEntry[] = [];
            for (const c of Buffer.concat(chunks).toString("utf-8").split(/<Contents>/).slice(1)) {
              const km = c.match(/<Key>([^<]+)/); const sm = c.match(/<Size>(\d+)/); const mm = c.match(/<LastModified>([^<]+)/);
              if (km) entries.push({ name: km[1].split("/").pop() || km[1], size: sm ? parseInt(sm[1], 10) : 0, modified: mm ? new Date(mm[1]).getTime() : 0 });
            }
            resolve(entries);
          });
        });
        req.on("error", reject); req.end();
      });
    } catch { return []; }
  }

  async delete(remotePath: string): Promise<boolean> {
    try { const { status } = await this.doReq("DELETE", remotePath); return status >= 200 && status < 300; }
    catch { return false; }
  }

  async exists(remotePath: string): Promise<boolean> {
    try { const { status } = await this.doReq("HEAD", remotePath); return status === 200; }
    catch { return false; }
  }
}
