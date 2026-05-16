/**
 * platform/db/npm.ts — better-sqlite3 (npm package) wrapper.
 * Works on Node 18/20 where node:sqlite is not available.
 *
 * Hardening:
 *   - Constructor wrapped in try/catch for missing native bindings / read-only fs
 *   - Returns null on failure so compat.ts can cascade to next backend
 */

import { createRequire } from "node:module";
import type { UnifiedDB, UnifiedStatement } from "./types.ts";

export function createNpmDB(dbPath: string): UnifiedDB | null {
  try {
    const _require = createRequire(import.meta.url);
    const Database = _require("better-sqlite3");
    const rawDb = new Database(dbPath);

    return {
      exec(sql: string) { rawDb.exec(sql); },
      prepare(sql: string): UnifiedStatement {
        const stmt = rawDb.prepare(sql);
        return {
          run(...args: unknown[]) {
            const info = stmt.run(...args);
            return { lastInsertRowid: info?.lastInsertRowid, changes: info?.changes };
          },
          all(...args: unknown[]) { return stmt.all(...args); },
          get(...args: unknown[]) { return stmt.get(...args); },
        };
      },
      close() { rawDb.close(); },
      // better-sqlite3 extension loading differs; leave undefined
      _raw: rawDb,
    };
  } catch { return null; }
}

export function isNpmAvailable(): boolean {
  try {
    const _require = createRequire(import.meta.url);
    _require("better-sqlite3");
    return true;
  } catch { return false; }
}
