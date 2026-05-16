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

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { SQLiteRow } from "../platform/db/types.js";

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

export type DBBackend = "node-sqlite" | "better-sqlite3" | "file-db";

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
    _require("node:sqlite");
    logger?.info?.("[yaoyao-memory:db-compat] Using node:sqlite (Node 22+)");
    return "node-sqlite";
  } catch { /* fall through */ }

  try {
    const _require = createRequire(import.meta.url);
    _require("better-sqlite3");
    logger?.info?.("[yaoyao-memory:db-compat] Using better-sqlite3 (npm)");
    return "better-sqlite3";
  } catch { /* fall through */ }

  logger?.warn?.("[yaoyao-memory:db-compat] No SQLite available, falling back to file-db (pure filesystem mode)");
  return "file-db";
}

// ── Node:sqlite Wrapper ──

function wrapNodeSqlite(rawDb: RawNodeDB): UnifiedDB {
  return {
    exec(sql: string) { rawDb.exec(sql); },
    prepare(sql: string) {
      const stmt = rawDb.prepare(sql) as RawStmt;
      return {
        run(...args: unknown[]) { return stmt.run(...args); },
        all(...args: unknown[]) { return stmt.all(...args); },
        get(...args: unknown[]) { return stmt.get(...args); },
      };
    },
    close() { rawDb.close(); },
    enableLoadExtension(enabled: boolean) { rawDb.enableLoadExtension?.(enabled); },
    _raw: rawDb,
  };
}

// ── Better-sqlite3 Wrapper ──

function wrapBetterSqlite3(rawDb: RawNodeDB): UnifiedDB {
  return {
    exec(sql: string) { rawDb.exec(sql); },
    prepare(sql: string) {
      const stmt = rawDb.prepare(sql) as RawStmt;
      return {
        run(...args: unknown[]) { return stmt.run(...args); },
        all(...args: unknown[]) { return stmt.all(...args); },
        get(...args: unknown[]) { return stmt.get(...args); },
      };
    },
    close() { rawDb.close(); },
    _raw: rawDb,
  };
}

// ── FileDB (pure filesystem fallback) ──

class FileDB implements UnifiedDB {
  private baseDir: string;
  private indexPath: string;
  private index: Map<string, string[]>;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.indexPath = path.join(baseDir, ".yaoyao-index.json");
    this.index = new Map();
    this._loadIndex();
  }

  private _loadIndex() {
    try {
      if (fs.existsSync(this.indexPath)) {
        let raw: unknown;
        try {
          raw = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
        } catch {
          raw = {};
        }
        for (const [k, v] of Object.entries(raw)) {
          this.index.set(k, v as string[]);
        }
      }
    } catch { /* ignore corrupt index */ }
  }

  private _saveIndex() {
    try {
      const obj: Record<string, string[]> = {};
      for (const [k, v] of this.index) obj[k] = v;
      fs.writeFileSync(this.indexPath, JSON.stringify(obj), "utf-8");
    } catch { /* best effort */ }
  }

  exec(_sql: string): void {
    // No-op for file-db; schema is implicit
  }

  prepare(sql: string): UnifiedStatement {
    const lowered = sql.toLowerCase().trim();

    if (lowered.startsWith("insert into memory_meta")) {
      return {
        run: (...args: unknown[]) => {
          const date = args[0] as string;
          const userText = args[1] as string;
          const asstText = args[2] as string;
          const dailyPath = path.join(this.baseDir, `${date}.md`);
          const entry = `\n### ${new Date().toISOString()}\n**User:** ${userText}\n**AI:** ${asstText}\n`;
          fs.appendFileSync(dailyPath, entry, "utf-8");
          const existing = this.index.get(date) || [];
          if (!existing.includes(dailyPath)) {
            existing.push(dailyPath);
            this.index.set(date, existing);
            this._saveIndex();
          }
          return { lastInsertRowid: Date.now(), changes: 1 };
        },
        all: () => [],
        get: () => undefined,
      };
    }

    if (lowered.includes("from memory_fts") && lowered.includes("match")) {
      return {
        run: () => ({ changes: 0 }),
        all: (...args: unknown[]) => this._search(args[0] as string, args[1] as number),
        get: () => undefined,
      };
    }

    if (lowered.includes("count(*)")) {
      const count = this._countAll();
      return {
        run: () => ({ changes: 0 }),
        all: () => [{ c: count } as SQLiteRow],
        get: () => ({ c: count } as SQLiteRow),
      };
    }

    if (lowered.startsWith("delete from memory_meta")) {
      return {
        run: (...args: unknown[]) => {
          const date = args[0] as string;
          const file = path.join(this.baseDir, `${date}.md`);
          try { fs.unlinkSync(file); } catch { /* */ }
          this.index.delete(date);
          this._saveIndex();
          return { changes: 1 };
        },
        all: () => [],
        get: () => undefined,
      };
    }

    if (lowered.startsWith("pragma journal_mode")) {
      return {
        run: () => ({ changes: 0 }),
        all: () => [{ journal_mode: "delete" } as SQLiteRow],
        get: () => ({ journal_mode: "delete" } as SQLiteRow),
      };
    }

    return {
      run: () => ({ changes: 0 }),
      all: () => [],
      get: () => undefined,
    };
  }

  close(): void {
    this._saveIndex();
  }

  enableLoadExtension?(): void {
    // Not supported in file-db
  }

  // ── FileDB search implementation ──
  private _search(query: string, limit: number): SQLiteRow[] {
    const results: SQLiteRow[] = [];
    let files: string[];
    try { files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/)); } catch { files = []; }
    const q = query.toLowerCase();

    for (const file of files) {
      const filePath = path.join(this.baseDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.toLowerCase().includes(q)) {
        const lines = content.split("\n");
        const idx = lines.findIndex(l => l.toLowerCase().includes(q));
        const snippet = idx >= 0 ? lines[idx].slice(0, 200) : "";
        results.push({
          id: results.length + 1,
          rowid: results.length + 1,
          date: file.replace(".md", ""),
          snippet: snippet,
          rank: -results.length,
        });
      }
    }

    return results.slice(0, limit);
  }

  private _countAll(): number {
    try {
      return fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md")).length;
    } catch { return 0; }
  }
}

// ── Factory ──

export function createCompatDB(dbPath: string, config?: { allowExtension?: boolean }, logger?: PluginLogger): DBCompatResult {
  const backend = detectBackend(logger);

  switch (backend) {
    case "node-sqlite": {
      const _require = createRequire(import.meta.url);
      const { DatabaseSync } = _require("node:sqlite");
      const rawDb = new DatabaseSync(dbPath, { allowExtension: config?.allowExtension ?? true }) as RawNodeDB;
      return {
        db: wrapNodeSqlite(rawDb),
        backend,
        supportsFTS5: true,
        supportsWAL: true,
        supportsExtensions: true,
      };
    }

    case "better-sqlite3": {
      const _require = createRequire(import.meta.url);
      const Database = _require("better-sqlite3");
      const rawDb = new Database(dbPath) as RawNodeDB;
      return {
        db: wrapBetterSqlite3(rawDb),
        backend,
        supportsFTS5: true,
        supportsWAL: true,
        supportsExtensions: false,
      };
    }

    case "file-db": {
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
  backend: DBBackend | "unknown";
  nodeSqliteAvailable: boolean;
  betterSqlite3Available: boolean;
} {
  let nodeSqlite = false;
  let betterSqlite3 = false;
  try {
    const _require = createRequire(import.meta.url);
    _require("node:sqlite");
    nodeSqlite = true;
  } catch { /* */ }
  try {
    const _require = createRequire(import.meta.url);
    _require("better-sqlite3");
    betterSqlite3 = true;
  } catch { /* */ }

  const backend: DBBackend | "unknown" = nodeSqlite ? "node-sqlite" : betterSqlite3 ? "better-sqlite3" : "unknown";
  return { backend, nodeSqliteAvailable: nodeSqlite, betterSqlite3Available: betterSqlite3 };
}
