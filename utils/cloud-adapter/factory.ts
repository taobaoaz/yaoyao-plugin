/**
 * utils/cloud-adapter/factory.ts — Adapter factory
 */
import { loadSecrets } from "../secrets-loader.ts";
import { WebDAVAdapter } from "./webdav.ts";
import { S3Adapter } from "./s3.ts";
import { SFTPAdapter } from "./sftp.ts";
import { SambaAdapter } from "./samba.ts";
import type { Secrets } from "../secrets-loader.ts";
import type { CloudAdapter, AdapterStatus, AdapterFactoryOpts } from "./types.ts";

export interface AdapterFactoryResult {
  adapters: Map<string, CloudAdapter>;
  statuses: AdapterStatus[];
}

const PROVIDER_CHECKS: Array<{
  name: string;
  check: (s: Secrets) => boolean;
  create: (s: Secrets, opts?: AdapterFactoryOpts) => CloudAdapter;
}> = [
  { name: "webdav", check: WebDAVAdapter.isConfigured, create: (s) => new WebDAVAdapter(s) },
  { name: "s3", check: S3Adapter.isConfigured, create: (s) => new S3Adapter(s) },
  { name: "sftp", check: SFTPAdapter.isConfigured, create: (s, opts) => new SFTPAdapter(s, opts) },
  { name: "samba", check: SambaAdapter.isConfigured, create: (s, opts) => new SambaAdapter(s, opts) },
];

export function createAdapters(secretsPath?: string, opts?: AdapterFactoryOpts): AdapterFactoryResult {
  const secrets = loadSecrets(secretsPath);
  const adapters = new Map<string, CloudAdapter>();
  const statuses: AdapterStatus[] = [];
  for (const { name, check, create } of PROVIDER_CHECKS) {
    if (check(secrets)) {
      try { adapters.set(name, create(secrets, opts)); statuses.push({ provider: name, configured: true, message: "✅ 已配置" }); }
      catch (err) { statuses.push({ provider: name, configured: false, message: `⚠️ 配置错误: ${err instanceof Error ? err.message : String(err)}` }); }
    } else {
      statuses.push({ provider: name, configured: false, message: "— 未配置" });
    }
  }
  return { adapters, statuses };
}

export function createAdapter(provider: string, secretsPath?: string, opts?: AdapterFactoryOpts): CloudAdapter | null {
  const secrets = loadSecrets(secretsPath);
  const entry = PROVIDER_CHECKS.find(p => p.name === provider);
  if (!entry || !entry.check(secrets)) return null;
  return entry.create(secrets, opts);
}
