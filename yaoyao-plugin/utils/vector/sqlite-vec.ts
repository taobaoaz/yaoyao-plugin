/**
 * SqliteVecBackend — default vector search using sqlite-vec extension.
 * Zero external dependencies beyond the sqlite-vec npm package.
 */
import { createRequire } from "node:module";
import type { UnifiedDB } from "../../platform/db/compat.ts";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../memory-store.ts";
import type { VectorBackend, EmbeddedSearchResult } from "./types.ts";

const _require = createRequire(import.meta.url);

export class SqliteVecBackend implements VectorBackend {
  name = "sqlite-vec";
  isAvailable = false;

  private db: UnifiedDB | null = null;
  private config: YaoyaoMemoryConfig = {};
  private logger?: PluginLogger;
  private dimensions = 1024;
  private snippetMaxLen = 500;
  private searchMaxLimit = 100;
  private supportsExtensions = false;

  init(db: UnifiedDB, config: YaoyaoMemoryConfig, logger?: PluginLogger): boolean {
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.dimensions = config.embedding?.dimensions ?? 1024;
    this.snippetMaxLen = Math.min(Math.max(config.snippetMaxLen ?? 500, 100), 2000);
    this.searchMaxLimit = Math.min(Math.max(config.searchMaxLimit ?? 100, 10), 1000);

    try {
      // Detect if SQLite supports extensions (Node 22 native sqlite)
      this.supportsExtensions = db.enableLoadExtension !== undefined;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:vec] Extension detection failed: ${msg}`);
      this.supportsExtensions = false;
    }

    if (!this.supportsExtensions) {
      logger?.warn?.("[yaoyao-memory:vec] SQLite extensions not supported — vector search disabled");
      this.isAvailable = false;
      return false;
    }

    try {
      const sqliteVec = _require("sqlite-vec") as Record<string, unknown>;
      if (db.enableLoadExtension) {
        db.enableLoadExtension(true);
        (sqliteVec.load as (raw: unknown) => void)(db._raw || db);
      }

      db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(" +
          `embedding float[${this.dimensions}]` +
        ")"
      );

      db.exec(
        "CREATE TABLE IF NOT EXISTS memory_vec_meta (" +
          "id INTEGER PRIMARY KEY, " +
          "meta_id INTEGER, " +
          "model TEXT, " +
          `dimensions INTEGER DEFAULT ${this.dimensions}, ` +
          "created_at TEXT DEFAULT (datetime('now'))" +
        ")"
      );

      this.isAvailable = true;
      logger?.info?.("[yaoyao-memory:vec] sqlite-vec backend initialized");
      return true;
    } catch (e: unknown) {
      logger?.warn?.(`[yaoyao-memory:vec] sqlite-vec not available: ${(e as Error).message}`);
      this.isAvailable = false;
      return false;
    }
  }

  storeVector(metaId: number, embedding: Float32Array): boolean {
    if (metaId <= 0 || !this.isAvailable || !this.db) return false;
    try {
      // Normalize to unit length for correct cosine similarity from L2 distance
      let norm = 0;
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i] * embedding[i];
      }
      norm = Math.sqrt(norm);
      const normalized = norm === 0
        ? new Float32Array(embedding.length)
        : new Float32Array(embedding.map(v => v / norm));

      const jsonArr = "[" + Array.from(normalized).join(",") + "]";

      this.db.exec("BEGIN");
      try {
        this.db.prepare("DELETE FROM memory_vec WHERE rowid = ?").run(metaId);
        this.db.prepare("INSERT INTO memory_vec(rowid, embedding) VALUES(?, ?)").run(metaId, jsonArr);
        this.db.exec("COMMIT");
      } catch (txErr: unknown) {
        try { this.db.exec("ROLLBACK"); } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger?.warn?.(`[yaoyao-memory:vec] ROLLBACK failed: ${msg}`);
        }
        throw txErr;
      }
      return true;
    } catch (err: unknown) {
      this.logger?.warn?.(`[yaoyao-memory:vec] storeVector error: ${(err as Error).message}`);
      return false;
    }
  }

  vectorSearch(embedding: Float32Array, limit: number = 10): EmbeddedSearchResult[] {
    if (!this.isAvailable || !this.db) return [];
    try {
      const jsonArr = "[" + Array.from(embedding).join(",") + "]";
      const stmt = this.db.prepare(
        "SELECT v.rowid, m.date, m.user_text, m.asst_text, v.distance " +
        "FROM memory_vec v " +
        "JOIN memory_meta m ON v.rowid = m.id " +
        "WHERE v.embedding MATCH ? AND k = ?"
      );
      const rows = stmt.all(jsonArr, Math.min(Math.max(limit, 1), this.searchMaxLimit));

      return (rows as Array<{ rowid: number; date: string; user_text: string; asst_text: string; distance: number }>).map(row => {
        // vec0 uses L2 distance. For unit-normalized vectors: cosine ≈ 1 - (L2^2 / 2)
        const cosineSim = 1 - (row.distance || 0) / 2;
        const snippet = `${row.user_text || ""} ${row.asst_text || ""}`.trim();
        return {
          id: row.rowid,
          filename: row.date ? `${row.date}.md` : "memory.db",
          snippet: snippet.slice(0, this.snippetMaxLen),
          score: Math.max(0, cosineSim),
          date: row.date || "",
          asst_text: (row.asst_text || "").slice(0, this.snippetMaxLen),
          vectorScore: Math.max(0, cosineSim),
          hybridScore: Math.max(0, cosineSim),
        };
      });
    } catch (err: unknown) {
      this.logger?.warn?.(`[yaoyao-memory:vec] vectorSearch error: ${(err as Error).message}`);
      return [];
    }
  }

  /** Delete vectors whose rowid no longer exists in memory_meta */
  deleteOrphans(): void {
    if (!this.isAvailable || !this.db) return;
    try {
      this.db.exec(
        "DELETE FROM memory_vec WHERE NOT EXISTS (SELECT 1 FROM memory_meta WHERE memory_meta.id = memory_vec.rowid)"
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger?.warn?.(`[yaoyao-memory:vec] deleteOrphans failed: ${msg}`);
    }
  }

  getVectorCount(): number {
    if (!this.isAvailable || !this.db) return 0;
    try {
      const row = this.db.prepare("SELECT COUNT(*) as c FROM memory_vec").get() as { c: number } | undefined;
      return row?.c ?? 0;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger?.warn?.(`[yaoyao-memory:vec] getVectorCount failed: ${msg}`);
      return 0;
    }
  }

  getDimensions(): number {
    if (!this.isAvailable || !this.db) return 0;
    try {
      const row = this.db.prepare("SELECT dimensions FROM memory_vec_meta LIMIT 1").get() as { dimensions: number } | undefined;
      return row?.dimensions ?? this.dimensions;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger?.warn?.(`[yaoyao-memory:vec] getDimensions failed: ${msg}`);
      return this.dimensions;
    }
  }

  close(): void {
    this.db = null;
    this.isAvailable = false;
  }
}
