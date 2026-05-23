/**
 * utils/cloud-adapter/factory.ts — Adapter factory
 */
import { loadSecrets } from "../secrets-loader.js";
import { WebDAVAdapter } from "./webdav.js";
import { S3Adapter } from "./s3.js";
import { SFTPAdapter } from "./sftp.js";
import { SambaAdapter } from "./samba.js";
const PROVIDER_CHECKS = [
    { name: "webdav", check: WebDAVAdapter.isConfigured, create: (s) => new WebDAVAdapter(s) },
    { name: "s3", check: S3Adapter.isConfigured, create: (s) => new S3Adapter(s) },
    { name: "sftp", check: SFTPAdapter.isConfigured, create: (s, opts) => new SFTPAdapter(s, opts) },
    { name: "samba", check: SambaAdapter.isConfigured, create: (s, opts) => new SambaAdapter(s, opts) },
];
export function createAdapters(secretsPath, opts) {
    const secrets = loadSecrets(secretsPath);
    const adapters = new Map();
    const statuses = [];
    for (const { name, check, create } of PROVIDER_CHECKS) {
        if (check(secrets)) {
            try {
                adapters.set(name, create(secrets, opts));
                statuses.push({ provider: name, configured: true, message: "✅ 已配置" });
            }
            catch (err) {
                statuses.push({ provider: name, configured: false, message: `⚠️ 配置错误: ${err instanceof Error ? err.message : String(err)}` });
            }
        }
        else {
            statuses.push({ provider: name, configured: false, message: "— 未配置" });
        }
    }
    return { adapters, statuses };
}
export function createAdapter(provider, secretsPath, opts) {
    const secrets = loadSecrets(secretsPath);
    const entry = PROVIDER_CHECKS.find(p => p.name === provider);
    if (!entry || !entry.check(secrets))
        return null;
    return entry.create(secrets, opts);
}
