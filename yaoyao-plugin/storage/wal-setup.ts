/**
 * storage/wal-setup.ts — WAL mode setup with recovery.
 */
import fs from 'node:fs';
import type { UnifiedDB, DBCompatResult } from '../platform/db/compat.ts';
import { createCompatDB } from '../platform/db/compat.ts';
import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';

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
  if (dbBackend.backend === 'file-db') return;
  try {
    db.exec('PRAGMA journal_mode = WAL');
    const mode = db.prepare('PRAGMA journal_mode').get() as Record<string, unknown> | undefined;
    const walEnabled = String(mode?.journal_mode) === 'wal' || String(mode) === 'wal';
    if (!walEnabled) {
      log('WAL mode not supported by filesystem, continuing with default journal mode');
    }
  } catch (e: unknown) {
    if (e instanceof Error ? e.message : String(e)?.includes('disk I/O')) {
      log('Stale WAL files detected, cleaning up');
      try {
        db.close();
      } catch (e2: unknown) {
        const msg = e2 instanceof Error ? e2.message : String(e2);
        console.warn(`[yaoyao-memory:wal] Close DB failed: ${msg}`);
      }
      for (const ext of ['-wal', '-shm']) {
        try {
          fs.unlinkSync(dbPath + ext);
        } catch (e2: unknown) {
          const msg = e2 instanceof Error ? e2.message : String(e2);
          console.warn(`[yaoyao-memory:wal] Unlink WAL file failed: ${msg}`);
        }
      }
      const newBackend = createCompatDB(dbPath, { allowExtension: true }, loggerRef);
      Object.assign(db, newBackend.db);
      try {
        newBackend.db.exec('PRAGMA journal_mode = WAL');
      } catch (e2: unknown) {
        const msg = e2 instanceof Error ? e2.message : String(e2);
        console.warn(`[yaoyao-memory:wal] WAL recovery failed: ${msg}`);
        log('WAL recovery failed');
      }
    } else {
      log(`WAL setup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:wal] Set busy timeout failed: ${msg}`);
  }
  try {
    db.exec('PRAGMA cache_size = -65536');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:wal] Set cache size failed: ${msg}`);
  }
}
