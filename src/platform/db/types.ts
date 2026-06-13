/**
 * platform/db/types.ts — Unified database interface.
 *
 * All database backends (node:sqlite, better-sqlite3, file-db)
 * implement this interface. Callers never touch driver-specific APIs.
 */

export type SQLiteValue = string | number | boolean | null | Buffer | Uint8Array;
export type SQLiteRow = Record<string, SQLiteValue>;

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

export type DBBackend = "node-sqlite" | "better-sqlite3" | "file-db";

export interface DBCompatResult {
  db: UnifiedDB;
  backend: DBBackend;
  supportsFTS5: boolean;
  supportsWAL: boolean;
  supportsExtensions: boolean;
}
