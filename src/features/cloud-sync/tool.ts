/**
 * features/cloud-sync/tool.ts — memory_cloud_sync tool (modular).
 */

import { clampNum } from "../../utils/clamp.js";
import fs from "node:fs";
import path from "node:path";
import type { MemoryStore } from "../../utils/memory-store.js";
import { createAdapters, createAdapter, type CloudAdapter } from "../../utils/cloud-adapter.js";
import { loadSecrets, getSecretsPath } from "../../utils/secrets-loader.js";
import { withErrorHandling } from "../../tools/common.js";
import type { ToolRegistration } from "../../tools/common.js";
import { formatSyncResult, formatStatus, type SyncResult, type SyncState } from "../../core/cloud/cloud.js";

const REMOTE_BASE = "yaoyao-memory";
const SYNC_STATE_FILE = ".cloud-sync-state.json";
const SYNC_MARKER = ".sync-source";

function remotePath(filename: string): string {
  return `${REMOTE_BASE}/${filename}`;
}

function loadSyncState(baseDir: string): SyncState {
  const fp = path.join(baseDir, SYNC_STATE_FILE);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return { lastSync: 0, uploaded: [], downloaded: [] };
  }
}

function saveSyncState(baseDir: string, state: SyncState): void {
  const fp = path.join(baseDir, SYNC_STATE_FILE);
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
}

function markSynced(filePath: string, provider: string, baseDir: string): void {
  try {
    const rel = path.relative(baseDir, filePath);
    const markerDir = path.join(baseDir, ".sync-meta");
    const markerPath = path.join(markerDir, rel + SYNC_MARKER);
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({ provider, time: Date.now() }), "utf-8");
  } catch { /* best effort */ }
}

async function doUpload(adapter: CloudAdapter, store: MemoryStore, dryRun: boolean, since?: number): Promise<SyncResult> {
  const result: SyncResult = { provider: adapter.provider, action: "upload", uploaded: [], downloaded: [], skipped: [], errors: [] };
  const files = store.listFiles();

  for (const file of files) {
    try {
      if (file.filename.endsWith(SYNC_MARKER) || file.filename === SYNC_STATE_FILE) continue;
      if (since && file.modified < since) {
        result.skipped.push(file.filename);
        continue;
      }
      const rp = remotePath(file.filename);
      if (dryRun) {
        result.uploaded.push(`${file.filename} (dry-run)`);
        continue;
      }
      const ok = await adapter.upload(file.path, rp);
      if (ok) {
        result.uploaded.push(file.filename);
        markSynced(file.path, adapter.provider, store.baseDir);
      } else {
        result.errors.push(file.filename);
      }
    } catch (err: unknown) {
      result.errors.push(`${file.filename}: ${(err as Error).message}`);
    }
  }

  const memoryMd = path.join(store.baseDir, "..", "MEMORY.md");
  if (fs.existsSync(memoryMd)) {
    try {
      const stat = fs.statSync(memoryMd);
      if (!since || stat.mtimeMs > since) {
        const rp = remotePath("MEMORY.md");
        if (dryRun) {
          result.uploaded.push("MEMORY.md (dry-run)");
        } else {
          const ok = await adapter.upload(memoryMd, rp);
          if (ok) result.uploaded.push("MEMORY.md");
          else result.errors.push("MEMORY.md");
        }
      }
    } catch { /* skip */ }
  }

  return result;
}

async function doDownload(adapter: CloudAdapter, store: MemoryStore, dryRun: boolean, conflictPolicy: string): Promise<SyncResult> {
  const result: SyncResult = { provider: adapter.provider, action: "download", uploaded: [], downloaded: [], skipped: [], errors: [] };

  try {
    const remoteFiles = await adapter.list(remotePath(""));
    for (const remote of remoteFiles) {
      try {
        if (remote.name.endsWith(SYNC_MARKER) || remote.name === SYNC_STATE_FILE) continue;
        const localPath = path.join(store.baseDir, remote.name);
        const exists = fs.existsSync(localPath);

        if (exists) {
          const localStat = fs.statSync(localPath);
          if (conflictPolicy === "keep_both") {
            const newPath = path.join(store.baseDir, `${remote.name}.cloud-${Date.now()}`);
            if (!dryRun) {
              const ok = await adapter.download(remotePath(remote.name), newPath);
              if (ok) result.downloaded.push(`${remote.name} → ${path.basename(newPath)} (keep_both)`);
              else result.errors.push(remote.name);
            } else {
              result.downloaded.push(`${remote.name} (dry-run, keep_both)`);
            }
            continue;
          }
          if (remote.modified > 0 && localStat.mtimeMs > remote.modified) {
            result.skipped.push(`${remote.name} (local newer)`);
            continue;
          }
        }

        if (dryRun) {
          result.downloaded.push(`${remote.name} (dry-run)`);
          continue;
        }
        const ok = await adapter.download(remotePath(remote.name), localPath);
        if (ok) {
          result.downloaded.push(remote.name);
          markSynced(localPath, adapter.provider, store.baseDir);
        } else {
          result.errors.push(remote.name);
        }
      } catch (err: unknown) {
        result.errors.push(`${remote.name}: ${(err as Error).message}`);
      }
    }
  } catch (err: unknown) {
    result.errors.push(`list failed: ${(err as Error).message}`);
  }

  return result;
}

async function doBidirectional(adapter: CloudAdapter, store: MemoryStore, dryRun: boolean, conflictPolicy: string): Promise<SyncResult> {
  const result = await doUpload(adapter, store, dryRun);
  const downResult = await doDownload(adapter, store, dryRun, conflictPolicy);
  result.downloaded = downResult.downloaded;
  result.skipped = downResult.skipped;
  result.errors.push(...downResult.errors);
  result.action = "bidirectional";
  return result;
}

const TEMPLATE = `# 云备份凭证配置
# 取消注释并填写你要使用的服务

# --- WebDAV (坚果云/Nextcloud/ownCloud) ---
# WEBDAV_URL=https://dav.jianguoyun.com/dav/
# WEBDAV_USERNAME=email@example.com
# WEBDAV_PASSWORD=***

# --- S3/OSS ---
# S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
# S3_ACCESS_KEY=***
# S3_SECRET_KEY=***
# S3_BUCKET=bucket-name
# S3_REGION=auto

# --- SFTP ---
# SFTP_HOST=192.168.1.100
# SFTP_PORT=22
# SFTP_USERNAME=user
# SFTP_PASSWORD=***

# --- Samba/NAS ---
# SAMBA_HOST=192.168.10.216
# SAMBA_USER=user
# SAMBA_PASSWORD=***
# SAMBA_SHARE=共享名
# SAMBA_PORT=445
# SAMBA_REMOTE_PATH=/`;

export function createCloudSyncTool(store: MemoryStore): ToolRegistration {
  return {
    name: "memory_cloud_sync",
    label: "Cloud Sync",
    description: "☁️ 云备份同步 — 支持多种云服务(WebDAV/S3/SFTP/Samba)备份记忆数据。操作: status(检查状态) / upload(上传到云端) / download(从云端恢复) / bidirectional(双向同步) / configure(配置云服务)",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "upload", "download", "bidirectional", "configure"],
          description: "操作: status=检查云服务状态, upload=上传到云端, download=从云端恢复, bidirectional=双向同步(冲突策略可选), configure=配置/查看凭证",
        },
        provider: {
          type: "string",
          enum: ["webdav", "s3", "sftp", "samba"],
          description: "云服务类型，不指定则对所有已配置的服务执行",
        },
        dryRun: {
          type: "boolean",
          description: "预览模式，只显示会执行的操作，不实际传输",
          default: false,
        },
        cmdTimeoutMs: {
          type: "number",
          description: "云命令超时（毫秒，默认 30000）",
          default: 30000,
        },
        conflictPolicy: {
          type: "string",
          enum: ["newer", "keep_both"],
          description: "双向同步冲突策略: newer=保留更新的文件, keep_both=保留双方(重命名远程文件)",
          default: "newer",
        },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action);
      const provider = params.provider ? String(params.provider) : undefined;
      const dryRun = !!params.dryRun;
      const cmdTimeoutMs = clampNum(params.cmdTimeoutMs, 30_000, 3_000, 120_000);
      const conflictPolicy = String(params.conflictPolicy || "newer");

      const adapterOpts = {
        timeoutMs: cmdTimeoutMs,
        smbTimeoutMs: cmdTimeoutMs,
        mountTimeoutMs: cmdTimeoutMs,
        mountCheckTimeoutMs: Math.max(1_000, Math.min(30_000, cmdTimeoutMs / 3)),
      };

      if (action === "status") {
        const { statuses } = createAdapters(undefined, adapterOpts);
        return { content: [{ type: "text", text: formatStatus(statuses) }] };
      }

      if (action === "configure") {
        const secretsPath = getSecretsPath();
        const secrets = loadSecrets();
        const keys = Object.keys(secrets);
        if (keys.length === 0) {
          return { content: [{ type: "text", text: `📝 凭证文件路径: ${secretsPath}\n\n当前未配置任何凭证。模板:\n\n${TEMPLATE}` }] };
        }
        const { statuses } = createAdapters(undefined, adapterOpts);
        const lines = [`📝 凭证文件: ${secretsPath}`, "", "当前配置:"];
        for (const [key, value] of Object.entries(secrets)) {
          const masked = key.includes("PASSWORD") || key.includes("SECRET") || key.includes("KEY") ? "****" : value;
          lines.push(`  ${key}=${masked}`);
        }
        lines.push("", formatStatus(statuses));
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      const { adapters, statuses } = createAdapters(undefined, adapterOpts);
      const configuredAdapters: CloudAdapter[] = [];

      if (provider) {
        const adapter = createAdapter(provider, undefined, adapterOpts) || adapters.get(provider);
        if (!adapter) {
          return { content: [{ type: "text", text: `❌ 云服务 ${provider} 未配置。请先编辑 ${getSecretsPath()} 添加凭证。` }] };
        }
        configuredAdapters.push(adapter);
      } else {
        if (adapters.size === 0) {
          return { content: [{ type: "text", text: `❌ 未检测到任何云服务配置。请先编辑 ${getSecretsPath()} 添加凭证。\n\n使用 configure 操作查看配置模板。` }] };
        }
        configuredAdapters.push(...adapters.values());
      }

      const results: string[] = [];
      const state = loadSyncState(store.baseDir);

      for (const adapter of configuredAdapters) {
        try {
          let syncResult: SyncResult;
          switch (action) {
            case "upload":
              syncResult = await doUpload(adapter, store, dryRun, state.lastSync);
              break;
            case "download":
              syncResult = await doDownload(adapter, store, dryRun, conflictPolicy);
              break;
            case "bidirectional":
              syncResult = await doBidirectional(adapter, store, dryRun, conflictPolicy);
              break;
            default:
              return { content: [{ type: "text", text: `❌ 未知操作: ${action}` }] };
          }
          results.push(formatSyncResult(syncResult));
        } catch (err: unknown) {
          results.push(`❌ [${adapter.provider}] 同步失败: ${(err as Error).message}`);
        }
      }

      if (!dryRun) {
        state.lastSync = Date.now();
        saveSyncState(store.baseDir, state);
      }

      const dryRunTag = dryRun ? " (预览模式)" : "";
      return { content: [{ type: "text", text: `☁️ 云同步完成${dryRunTag}\n\n${results.join("\n\n---\n\n")}` }] };
    }),
  };
}
