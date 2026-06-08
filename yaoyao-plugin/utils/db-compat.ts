/**
 * DB Compatibility Layer — automatic SQLite implementation selection.
 *
 * Tries (in order):
 *   1. node:sqlite      — Node 22+ built-in, zero deps
 *   2. better-sqlite3   — npm package, works on Node 18/20
 *   3. file-db fallback — pure filesystem, zero deps, works everywhere
 *
 * All callers use the UnifiedDB interface; they never touch node:sqlite directly.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';
import type { SQLiteRow } from '../platform/db/types.ts';
import { FileDB } from './file-db.ts';

// ── Unified DB Interface ──

export interface UnifiedDB {
  exec(sql: string): void;
  prepare(sql: string): UnifiedStatement;
  close(): void;
  /** Only available on native SQLite (node:sqlite / better-sqlite3) */
  enableLoadExtension?(enabled: boolean): void;
  /** Expose raw driver for edge cases */
  _raw?: unknown;
}

export interface UnifiedStatement {
  run(...args: unknown[]): { lastInsertRowid?: number; changes?: number };
  all(...args: unknown[]): SQLiteRow[];
  get(...args: unknown[]): SQLiteRow | undefined;
}

export type DBBackend = 'node-sqlite' | 'better-sqlite3' | 'file-db';

export interface DBCompatResult {
  db: UnifiedDB;
  backend: DBBackend;
  supportsFTS5: boolean;
  supportsWAL: boolean;
  supportsExtensions: boolean;
}

// ── Raw DB shape (duck-typed so we don't need @types/better-sqlite3) ──

interface RawNodeDB {
  exec(sql: string): void;
  prepare(sql: string): unknown;
  close(): void;
  enableLoadExtension?(enabled: boolean): void;
}

interface RawStmt {
  run(...args: unknown[]): { lastInsertRowid?: number; changes?: number };
  all(...args: unknown[]): SQLiteRow[];
  get(...args: unknown[]): SQLiteRow | undefined;
}

// ── Backend Detection ──

function detectBackend(logger?: PluginLogger): DBBackend {
  try {
    const _require = createRequire(import.meta.url);
    _require('node:sqlite');
    logger?.info?.('[yaoyao-memory:db-compat] Using node:sqlite (Node 22+)');
    return 'node-sqlite';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory]  fall through : ${msg}`);
  }

  try {
    const _require = createRequire(import.meta.url);
    _require('better-sqlite3');
    logger?.info?.('[yaoyao-memory:db-compat] Using better-sqlite3 (npm)');
    return 'better-sqlite3';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory]  fall through : ${msg}`);
  }

  logger?.warn?.(
    '[yaoyao-memory:db-compat] No SQLite available, falling back to file-db (pure filesystem mode)',
  );
  return 'file-db';
}

// ── Node:sqlite Wrapper ──

function wrapNodeSqlite(rawDb: RawNodeDB): UnifiedDB {
  return {
    exec(sql: string) {
      rawDb.exec(sql);
    },
    prepare(sql: string) {
      const stmt = rawDb.prepare(sql) as RawStmt;
      return {
        run(...args: unknown[]) {
          return stmt.run(...args);
        },
        all(...args: unknown[]) {
          return stmt.all(...args);
        },
        get(...args: unknown[]) {
          return stmt.get(...args);
        },
      };
    },
    close() {
      rawDb.close();
    },
    enableLoadExtension(enabled: boolean) {
      rawDb.enableLoadExtension?.(enabled);
    },
    _raw: rawDb,
  };
}

// ── Better-sqlite3 Wrapper ──

function wrapBetterSqlite3(rawDb: RawNodeDB): UnifiedDB {
  return {
    exec(sql: string) {
      rawDb.exec(sql);
    },
    prepare(sql: string) {
      const stmt = rawDb.prepare(sql) as RawStmt;
      return {
        run(...args: unknown[]) {
          return stmt.run(...args);
        },
        all(...args: unknown[]) {
          return stmt.all(...args);
        },
        get(...args: unknown[]) {
          return stmt.get(...args);
        },
      };
    },
    close() {
      rawDb.close();
    },
    _raw: rawDb,
  };
}

// ── Factory ──

export function createCompatDB(
  dbPath: string,
  config?: { allowExtension?: boolean },
  logger?: PluginLogger,
): DBCompatResult {
  const backend = detectBackend(logger);

  switch (backend) {
    case 'node-sqlite': {
      const _require = createRequire(import.meta.url);
      const { DatabaseSync } = _require('node:sqlite');
      const rawDb = new DatabaseSync(dbPath, {
        allowExtension: config?.allowExtension ?? true,
      }) as RawNodeDB;
      return {
        db: wrapNodeSqlite(rawDb),
        backend,
        supportsFTS5: true,
        supportsWAL: true,
        supportsExtensions: true,
      };
    }

    case 'better-sqlite3': {
      const _require = createRequire(import.meta.url);
      const Database = _require('better-sqlite3');
      const rawDb = new Database(dbPath) as RawNodeDB;
      return {
        db: wrapBetterSqlite3(rawDb),
        backend,
        supportsFTS5: true,
        supportsWAL: true,
        supportsExtensions: false,
      };
    }

    case 'file-db': {
      const baseDir = path.dirname(dbPath);
      fs.mkdirSync(baseDir, { recursive: true });
      const db = new FileDB(baseDir);
      return {
        db,
        backend,
        supportsFTS5: false,
        supportsWAL: false,
        supportsExtensions: false,
      };
    }
  }
}

/** Report current DB capability for healthcheck/install-check */
export function getDBCapability(): {
  backend: DBBackend | 'unknown';
  nodeSqliteAvailable: boolean;
  betterSqlite3Available: boolean;
} {
  let nodeSqlite = false;
  let betterSqlite3 = false;
  try {
    const _require = createRequire(import.meta.url);
    _require('node:sqlite');
    nodeSqlite = true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory]  : ${msg}`);
  }
  try {
    const _require = createRequire(import.meta.url);
    _require('better-sqlite3');
    betterSqlite3 = true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory]  : ${msg}`);
  }

  const backend: DBBackend | 'unknown' = nodeSqlite
    ? 'node-sqlite'
    : betterSqlite3
      ? 'better-sqlite3'
      : 'unknown';
  return { backend, nodeSqliteAvailable: nodeSqlite, betterSqlite3Available: betterSqlite3 };
}
