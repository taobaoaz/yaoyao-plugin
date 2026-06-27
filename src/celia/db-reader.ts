/**
 * celia/db-reader.ts — read-only bridge into celia's SQLite store.
 *
 * v1.9.1: In read-only bridge mode (celiaBridge.mode="read-only"), this opens
 * celia's `celia_memory.db` WITHOUT spawning the server, and lets yaoyao's
 * unique analysis tools (graph / trends / quality) fold celia's data into
 * their results. celia's schema is from celia-memory-architecture §7.1.
 *
 * Strict read-only guarantees:
 *   - DB is opened with readOnly=true; no exec of writes.
 *   - Only SELECT queries are issued.
 *   - If the DB / table is missing or unreadable, every method returns []
 *     and logs once — never throws, never breaks the calling tool.
 *
 * Backend: tries node:sqlite (Node 22+) readOnly first, then better-sqlite3
 * readonly, then gives up gracefully. Independent of yaoyao's own DB backend
 * selection so it cannot affect the main store.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

type Logger = { debug?: (m: string) => void; warn?: (m: string) => void };

/** Minimal read-only statement interface (only what we need). */
interface ReadonlyStmt {
  all(...args: unknown[]): unknown[];
}
interface ReadonlyDb {
  prepare(sql: string): ReadonlyStmt;
  close(): void;
}

export interface CeliaAtomicFact {
  id: number;
  content: string;
  category?: string;
  confidence?: number;
  source?: string;
  created_at_ms?: number;
}

export interface CeliaConversation {
  id: number;
  conversation_id: string;
  content: string;
  created_at_ms: number;
}

export interface CeliaGlobalSummary {
  type: string; // 'edge' | 'cloud_s' | 'cloud_l'
  content: string;
  updated_at_ms?: number;
}

/**
 * Read-only accessor for celia's database. Construct with the celia dbPath;
 * call open() before use (no-op if already open or unavailable).
 */
export class CeliaDbReader {
  private db: ReadonlyDb | null = null;
  private warnedMissing = false;

  constructor(
    private dbPath: string,
    private logger: Logger = {},
  ) {}

  /** Resolve the default celia db path if none given. */
  static resolvePath(explicit?: string): string {
    if (explicit && existsSync(explicit)) return explicit;
    return join(homedir(), ".openclaw", "workspace", "memory", "celia_memory", "celia_memory.db");
  }

  /** Open the DB read-only. Returns false if unavailable (logged once). */
  open(): boolean {
    if (this.db) return true;
    const p = existsSync(this.dbPath) ? this.dbPath : "";
    if (!p) {
      if (!this.warnedMissing) {
        this.logger.debug?.(`[yaoyao:celia:db] celia db not found at ${this.dbPath}; read-only bridge inactive`);
        this.warnedMissing = true;
      }
      return false;
    }
    // 1. node:sqlite (Node 22+) readOnly
    try {
      const _require = createRequire(import.meta.url);
      const { DatabaseSync } = _require("node:sqlite");
      const raw = new DatabaseSync(p, { readOnly: true });
      this.db = {
        prepare: (sql: string) => raw.prepare(sql),
        close: () => raw.close(),
      };
      this.logger.debug?.("[yaoyao:celia:db] opened via node:sqlite (readOnly)");
      return true;
    } catch {
      // fall through
    }
    // 2. better-sqlite3 readonly
    try {
      const _require = createRequire(import.meta.url);
      const Database = _require("better-sqlite3");
      const raw = new Database(p, { readonly: true });
      this.db = {
        prepare: (sql: string) => raw.prepare(sql),
        close: () => raw.close(),
      };
      this.logger.debug?.("[yaoyao:celia:db] opened via better-sqlite3 (readonly)");
      return true;
    } catch (e) {
      if (!this.warnedMissing) {
        this.logger.warn?.(`[yaoyao:celia:db] cannot open celia db read-only: ${(e as Error).message}`);
        this.warnedMissing = true;
      }
      return false;
    }
  }

  /** Close the DB handle (idempotent). */
  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }

  /** Whether a celia table exists (used to probe availability per-table). */
  private hasTable(name: string): boolean {
    if (!this.db) return false;
    try {
      const row = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .all(name) as Array<{ name: string }>;
      return row.length > 0;
    } catch {
      return false;
    }
  }

  /** Read L2 atomic facts matching a query (FTS5 if available, else LIKE). */
  readAtomicFacts(query: string, topK = 5): CeliaAtomicFact[] {
    if (!this.open() || !this.hasTable("mem_atomic")) return [];
    const like = `%${(query || "").trim()}%`;
    try {
      if (this.hasTable("mem_atomic_fts")) {
        return this.db!.prepare(
          "SELECT a.id, a.content, a.category, a.confidence, a.source, a.created_at_ms " +
          "FROM mem_atomic_fts f JOIN mem_atomic a ON a.id = f.rowid " +
          "WHERE f.content MATCH ? ORDER BY a.confidence DESC LIMIT ?",
        ).all(query, topK) as CeliaAtomicFact[];
      }
      return this.db!.prepare(
        "SELECT id, content, category, confidence, source, created_at_ms " +
        "FROM mem_atomic WHERE content LIKE ? ORDER BY confidence DESC LIMIT ?",
      ).all(like, topK) as CeliaAtomicFact[];
    } catch (e) {
      this.logger.debug?.(`[yaoyao:celia:db] readAtomicFacts failed: ${(e as Error).message}`);
      return [];
    }
  }

  /** Read raw conversations (L0) matching a query. */
  readConversations(query: string, topK = 5): CeliaConversation[] {
    if (!this.open() || !this.hasTable("mem_conversation")) return [];
    const like = `%${(query || "").trim()}%`;
    try {
      return this.db!.prepare(
        "SELECT id, conversation_id, content, created_at_ms " +
        "FROM mem_conversation WHERE content LIKE ? ORDER BY created_at_ms DESC LIMIT ?",
      ).all(like, topK) as CeliaConversation[];
    } catch (e) {
      this.logger.debug?.(`[yaoyao:celia:db] readConversations failed: ${(e as Error).message}`);
      return [];
    }
  }

  /** Read L0 global user overview by tier. */
  readGlobalSummary(tier: "edge" | "cloud_s" | "cloud_l" = "edge"): CeliaGlobalSummary[] {
    if (!this.open() || !this.hasTable("mem_global")) return [];
    try {
      return this.db!.prepare(
        "SELECT type, content, updated_at_ms FROM mem_global WHERE type = ? " +
        "ORDER BY updated_at_ms DESC LIMIT 1",
      ).all(tier) as CeliaGlobalSummary[];
    } catch (e) {
      this.logger.debug?.(`[yaoyao:celia:db] readGlobalSummary failed: ${(e as Error).message}`);
      return [];
    }
  }

  /** Read L1 scene index entries (path + summary). */
  readSceneIndex(): Array<{ path: string; summary?: string }> {
    if (!this.open() || !this.hasTable("mem_l1_index")) return [];
    try {
      return this.db!.prepare(
        "SELECT path, summary FROM mem_l1_index ORDER BY updated_at_ms DESC",
      ).all() as Array<{ path: string; summary?: string }>;
    } catch (e) {
      this.logger.debug?.(`[yaoyao:celia:db] readSceneIndex failed: ${(e as Error).message}`);
      return [];
    }
  }
}
