/**
 * features/cloud-sync/sync-ops.ts — Upload / download / bidirectional sync.
 *
 * Pure sync operations, no tool registration.
 */
import fs from "node:fs";
import path from "node:path";
import type { MemoryStore } from "../../utils/memory-store.ts";
import type { CloudAdapter } from "../../utils/cloud-adapter.ts";
import { remotePath, markSynced } from "./state.ts";

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
      if (file.filename.endsWith(".sync-source") || file.filename === ".cloud-sync-state.json") continue;
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
      result.errors.push(`${file.filename}: ${err instanceof Error ? err.message : String(err)}`);
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
      result.errors.push(`MEMORY.md: ${err instanceof Error ? err.message : String(err)}`);
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
        if (remote.name.endsWith(".sync-source") || remote.name === ".cloud-sync-state.json") continue;
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
        result.errors.push(`${remote.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err: unknown) {
    result.errors.push(`list failed: ${err instanceof Error ? err.message : String(err)}`);
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
