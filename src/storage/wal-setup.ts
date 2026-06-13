/**
 * storage/wal-setup.ts — WAL mode setup with recovery.
 */
import fs from "node:fs";
import type { UnifiedDB, DBCompatResult } from "../platform/db/compat.ts";
import { createCompatDB } from "../platform/db/compat.ts";
import type { PluginLogger } from "../openclaw-sdk/plugin-entry.ts";

let loggerRef: PluginLogger | undefined;

export function setLoggerRef(logger: PluginLogger | undefined): void {
  loggerRef = logger;
}

export function setupWAL(
  db: UnifiedDB,
  dbPath: string,
  dbBackend: DBCompatResult,
  log: (msg: string) => void,
): void {
  if (dbBackend.backend === "file-db") return;
  try {
    db.exec("PRAGMA journal_mode = WAL");
    const mode = db.prepare("PRAGMA journal_mode").get() as Record<string, unknown> | undefined;
    const walEnabled = String(mode?.journal_mode) === "wal" || String(mode) === "wal";
    if (!walEnabled) {
      log("WAL mode not supported by filesystem, continuing with default journal mode");
    }
  } catch (e: unknown) {
    if ((e as Error).message?.includes("disk I/O")) {
      log("Stale WAL files detected, cleaning up");
      try { db.close(); } catch { /* ignore */ }
      for (const ext of ["-wal", "-shm"]) {
        try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
      }
      const newBackend = createCompatDB(dbPath, { allowExtension: true }, loggerRef);
      Object.assign(db, newBackend.db);
      try { newBackend.db.exec("PRAGMA journal_mode = WAL"); } catch { log("WAL recovery failed"); }
    } else {
      log(`WAL setup failed: ${(e as Error).message}`);
    }
  }
  try { db.exec("PRAGMA busy_timeout = 5000"); } catch { /* ignore */ }
  try { db.exec("PRAGMA cache_size = -65536"); } catch { /* ignore */ }
}
