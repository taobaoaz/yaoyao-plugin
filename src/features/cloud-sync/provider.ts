/**
 * features/cloud-sync/provider.ts — Cloud sync I/O operations.
 *
 * Upload, download, bidirectional sync, state management, and config template.
 * Pure logic, no tool registration details.
 */
import fs from "node:fs";
import path from "node:path";
import type { MemoryStore } from "../../utils/memory-store.ts";
import type { CloudAdapter } from "../../utils/cloud-adapter.ts";
import type { SyncState } from "../../core/cloud/cloud.ts";

const REMOTE_BASE = "yaoyao-memory";
const SYNC_STATE_FILE = ".cloud-sync-state.json";
const SYNC_MARKER = ".sync-source";

export function remotePath(filename: string): string {
  return `${REMOTE_BASE}/${filename}`;
}

export function loadSyncState(baseDir: string): SyncState {
  const fp = path.join(baseDir, SYNC_STATE_FILE);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return { lastSync: 0, uploaded: [], downloaded: [] };
  }
}

export function saveSyncState(baseDir: string, state: SyncState): void {
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

export interface SyncOptions {
  dryRun: boolean;
  conflictPolicy: string;
}

export interface SyncResult {
  provider: string;
  action: string;
  uploaded: string[];
  downloaded: string[];
  skipped: string[];
  errors: string[];
}

export async function doUpload(
  adapter: CloudAdapter,
  store: MemoryStore,
  options: SyncOptions,
  sinceMs?: number,
): Promise<SyncResult> {
  const result: SyncResult = {
    provider: adapter.provider, action: "upload",
    uploaded: [], downloaded: [], skipped: [], errors: [],
  };
  const files = store.listFiles();

  for (const file of files) {
    try {
      if (file.filename.endsWith(SYNC_MARKER) || file.filename === SYNC_STATE_FILE) continue;
      if (sinceMs && file.modified < sinceMs) {
        result.skipped.push(file.filename);
        continue;
      }
      const rp = remotePath(file.filename);
      if (options.dryRun) {
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

  // MEMORY.md in workspace root (parent of memoryDir)
  const workspaceDir = path.dirname(store.baseDir);
  const memoryMd = path.join(workspaceDir, "MEMORY.md");
  if (fs.existsSync(memoryMd)) {
    try {
      const stat = fs.statSync(memoryMd);
      if (!sinceMs || stat.mtimeMs > sinceMs) {
        const rp = remotePath("MEMORY.md");
        if (options.dryRun) {
          result.uploaded.push("MEMORY.md (dry-run)");
        } else {
          const ok = await adapter.upload(memoryMd, rp);
          if (ok) result.uploaded.push("MEMORY.md");
          else result.errors.push("MEMORY.md");
        }
      }
    } catch (err: unknown) {
      result.errors.push(`MEMORY.md: ${(err as Error).message}`);
    }
  }

  return result;
}

export async function doDownload(
  adapter: CloudAdapter,
  store: MemoryStore,
  options: SyncOptions,
): Promise<SyncResult> {
  const result: SyncResult = {
    provider: adapter.provider, action: "download",
    uploaded: [], downloaded: [], skipped: [], errors: [],
  };

  try {
    const remoteFiles = await adapter.list(remotePath(""));
    for (const remote of remoteFiles) {
      try {
        if (remote.name.endsWith(SYNC_MARKER) || remote.name === SYNC_STATE_FILE) continue;
        const safeName = path.normalize(remote.name).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[\/\\]+/, "");
        if (safeName !== remote.name || path.isAbsolute(remote.name)) {
          result.errors.push(`${remote.name}: 非法文件名（路径遍历嫌疑），已跳过`);
          continue;
        }
        const localPath = path.join(store.baseDir, safeName);
        const exists = fs.existsSync(localPath);

        if (exists) {
          const localStat = fs.statSync(localPath);
          if (options.conflictPolicy === "keep_both") {
            const newPath = path.join(store.baseDir, `${remote.name}.cloud-${Date.now()}`);
            if (!options.dryRun) {
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

        if (options.dryRun) {
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

export async function doBidirectional(
  adapter: CloudAdapter,
  store: MemoryStore,
  options: SyncOptions,
): Promise<SyncResult> {
  const result = await doUpload(adapter, store, options);
  const downResult = await doDownload(adapter, store, options);
  result.downloaded = downResult.downloaded;
  result.skipped = downResult.skipped;
  result.errors.push(...downResult.errors);
  result.action = "bidirectional";
  return result;
}

export const TEMPLATE = `# 云备份凭证配置
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
