/**
 * SQLite database layer — FTS5 + sqlite-vec vector search.
 *
 * Uses native Node 22 node:sqlite + sqlite-vec npm package for vector search.
 *
 * Stores both FTS5 index and vector embeddings in a single .yaoyao.db file.
 */

import { getProp } from "./config.ts";
import { clampNum } from "./clamp.ts";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createCompatDB, type UnifiedDB, type DBCompatResult } from "../platform/db/compat.ts";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "./memory-store.ts";
import { createVectorBackend } from "./vector/index.ts";
import type { VectorBackend } from "./vector/types.ts";

import { reciprocalRankFusion, type RankedDoc } from "./rrf.ts";

// ──────────────────────────── Types ────────────────────────────

export interface SearchResult {
  id?: number;
  filename: string;
  snippet: string;
  score: number;
  date: string;
  asst_text?: string;
  metadata?: string;
}

export interface EmbeddedSearchResult extends SearchResult {
  /** Cosine similarity score from vector search (0-1) */
  vectorScore: number;
  /** Hybrid score combining FTS5 rank + vector similarity */
  hybridScore: number;
}

export interface DBStats {
  totalMemories: number;
  datesSummary: Array<{ date: string; count: number }>;
  ftsEnabled: boolean;
  vecEnabled: boolean;
  totalVectors: number;
  dimensions: number;
}

// ──────────────────────────── Helpers ────────────────────────────

/** Compute a normalized score from FTS5 rank (negative = better) */
function computeScore(rank: number | null | undefined): number {
  const r = Number(rank);
  if (!Number.isFinite(r)) return 0.3;
  if (r < 0) {
    return Math.min(1, Math.max(0.1, -r / 15));
  }
  return 0.3;
}

// ──────────────────────────── DB Bridge ────────────────────────────

export function createDB(config: YaoyaoMemoryConfig, logger?: PluginLogger) {
  let baseDir = config.memoryDir || path.join(os.homedir(), ".openclaw", "workspace", "memory");
  baseDir = path.resolve(baseDir);
  if (/[\x00-\x1f]/.test(baseDir)) {
    throw new TypeError("memoryDir contains invalid control characters");
  }
  const dbPath = path.join(baseDir, ".yaoyao.db");
  let backend: VectorBackend | null = null;
  let vecEnabled = false;

  // Configurable limits (not hardcoded)
  const snippetMaxLen = clampNum(getProp(config, "snippetMaxLen", 500), 500, 100, 5000);
  const searchMaxLimit = clampNum(getProp(config, "searchMaxLimit", 100), 100, 10, 1000);
  const likeFallbackScore = clampNum(getProp(config, "likeFallbackScore", 0.5), 0.5, 0.1, 1);

  const log = (msg: string) => logger?.debug?.(`[yaoyao-memory:db] ${msg}`);
  let db: UnifiedDB | null = null;
  let initFailed = false; // fail-fast guard: once init fails, skip retries
  let dbBackend: DBCompatResult | null = null;

  /** Initialize database — create tables if not exist */
  function init(): boolean {
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });

      dbBackend = createCompatDB(dbPath, { allowExtension: true }, logger);
      db = dbBackend.db;

      const dbBackendType = dbBackend.backend;
      const supportsWAL = dbBackend.supportsWAL;
      const supportsFTS5 = dbBackend.supportsFTS5;
      const supportsExtensions = dbBackend.supportsExtensions;

      // Handle WAL setup only for real SQLite backends
      if (dbBackendType !== "file-db") {
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
            db = null;
            for (const ext of ["-wal", "-shm"]) {
              try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
            }
            dbBackend = createCompatDB(dbPath, { allowExtension: true }, logger);
            db = dbBackend.db;
            try {
              db.exec("PRAGMA journal_mode = WAL");
            } catch {
              log("WAL recovery failed, continuing with default journal mode");
            }
          } else {
            log(`WAL setup failed: ${(e as Error).message}, continuing with default journal mode`);
          }
        }
        db.exec("PRAGMA busy_timeout = 5000");
        db.exec("PRAGMA cache_size = -65536");
      }

      // FTS5 table for full-text search (only if backend supports it)
      if (supportsFTS5) {
        db.exec(
          "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
            "date, user_text, asst_text, " +
            "tokenize='unicode61'" +
          ")"
        );
      }

      // Metadata table for L1 memories
      db.exec(
        "CREATE TABLE IF NOT EXISTS memory_meta (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
          "date TEXT NOT NULL, " +
          "user_text TEXT, " +
          "asst_text TEXT, " +
          "meta TEXT, " +
          "access_count INTEGER DEFAULT 0, " +
          "tier TEXT DEFAULT 'active', " +
          "importance REAL DEFAULT 0.5, " +
          "created_at TEXT DEFAULT (datetime('now'))" +
        ")"
      );

      // Initialize pluggable vector backend (sqlite-vec default, hnswlib optional)
      backend = createVectorBackend(db, config, logger);
      vecEnabled = backend?.isAvailable ?? false;

      log(`DB initialized: ${dbPath} (dbBackend=${dbBackendType}, fts5=${supportsFTS5}, vec=${vecEnabled}, vecBackend=${backend?.name ?? 'none'})`);
      return true;
    } catch (err: unknown) {
      logger?.error?.(`[yaoyao-memory:db] Init failed: ${(err as Error).message}`);
      initFailed = true;
      return false;
    }
  }

  /** Ensure DB is initialized */
  function ensureDB(): UnifiedDB {
    if (!db && !initFailed) {
      init();
    }
    if (!db) {
      throw new Error("Database failed to initialize");
    }
    return db;
  }

  /** Index a conversation turn in FTS5. Returns the row id (>0) or -1 on failure.
   * @param meta Optional JSON metadata (e.g. risk flags) — stored in memory_meta but NOT indexed in FTS5
   */
  function indexTurn(userText: string, asstText: string, date: string, meta?: string): number {
    try {
      const d = ensureDB();
      d.exec("BEGIN TRANSACTION");
      try {
        const stmt = d.prepare(
          "INSERT INTO memory_meta (date, user_text, asst_text, meta) VALUES (?, ?, ?, ?)"
        );
        const result = stmt.run(date, userText.slice(0, snippetMaxLen), asstText.slice(0, snippetMaxLen), meta || null);
        const rowId = Number(result.lastInsertRowid);

        const stmt2 = d.prepare(
          "INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)"
        );
        stmt2.run(rowId, date, userText.slice(0, snippetMaxLen), asstText.slice(0, snippetMaxLen));

        d.exec("COMMIT");
        return rowId;
      } catch (err: unknown) {
        try { d.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
        throw err;
      }
    } catch (err: unknown) {
      log(`indexTurn error: ${(err as Error).message}`);
      return -1;
    }
  }

  /** Sanitize query string for FTS5 MATCH syntax.
   * Removes characters that can cause FTS5 syntax errors while keeping search terms readable.
   * Preserves valid prefix wildcards (e.g.  `word*`) for prefix search.
   * 
   * ⚠️ Security note: this is "sanitization for syntax safety", not a security boundary.
   * FTS5 MATCH uses prepared statements (parametric `?` binding), so SQL injection is not possible.
   * This function prevents FTS5 syntax errors (e.g. unmatched quotes) that would crash the query.
   */
  function sanitizeFTSQuery(query: string): string {
    // FTS5 special chars that cause syntax errors if unescaped:
    //   "  - unmatched quote → syntax error
    //   ^  - anchor operator → syntax error on partial match
    //   `  - escape char → syntax error
    //   () - grouping → syntax error when unbalanced
    //   ~  - NEAR operator → requires number param, causes error
    // Remove all of them; keep + (AND sign) and - (exclusion) as they're safe standalone.
    let s = query
      .replace(/["^`()~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (!s) return "";
    // Remove isolated/leading asterisks that break FTS5 syntax,
    // but preserve valid prefix wildcards like "word*".
    s = s.replace(/(^|\s)\*+(?=\s|$)/g, "$1")   // leading or isolated *
         .replace(/\*{2,}/g, "*");                // collapse multiple *
    return s.trim();
  }

  /** FTS5 full-text search + LIKE fallback for Chinese (FTS5 unicode61 tokenizer doesn't segment CJK) */
  function search(query: string, limit: number = 10): SearchResult[] {
    try {
      const d = ensureDB();
      const safeQuery = sanitizeFTSQuery(query);

      // Empty query → skip FTS5 (which errors on empty MATCH) and go straight to LIKE
      if (!safeQuery) {
        return searchAll(limit);
      }

      // Try FTS5 first
      const stmt = d.prepare(
        "SELECT rowid, date, user_text, asst_text, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
        "FROM memory_fts WHERE memory_fts MATCH ? " +
        "ORDER BY rank LIMIT ?"
      );
      const rows = stmt.all(safeQuery, Math.min(Math.max(limit, 1), searchMaxLimit));

      // FTS5 returns results, use them
      if (rows.length > 0) {
        return (rows as Array<{ rowid: number; date: string; user_text: string; asst_text: string; snippet: string; rank: number }>).map(row => ({
          id: row.rowid,
          filename: row.date ? `${row.date}.md` : "memory.db",
          snippet: (row.snippet || "").slice(0, snippetMaxLen),
          score: computeScore(row.rank),
          date: row.date || "",
          asst_text: (row.asst_text || "").slice(0, snippetMaxLen),
        }));
      }

      // ── FTS5 returned nothing → try LIKE fallback for CJK text ──
      // FTS5 unicode61 tokenizer treats each Chinese character as a separate token,
      // so multi-character words like "天气" or "今天" fail to match.
      // LIKE is character-based and handles CJK correctly.
      const safeLikeQuery = query.slice(0, 200).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const likeQuery = `%${safeLikeQuery}%`;
      const likeStmt = d.prepare(
        "SELECT id, date, user_text, asst_text FROM memory_meta " +
        "WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\' " +
        "ORDER BY id DESC LIMIT ?"
      );
      const likeRows = likeStmt.all(likeQuery, likeQuery, Math.min(Math.max(limit, 1), searchMaxLimit));

      if (likeRows.length > 0) {
        log(`FTS5 miss → LIKE fallback found ${likeRows.length} results for "${query.slice(0, 30)}"`);
        return (likeRows as Array<{ id: number; date: string; user_text: string; asst_text: string }>).map(row => ({
          id: row.id,
          filename: row.date ? `${row.date}.md` : "memory.db",
          snippet: `${row.user_text || ""} ${row.asst_text || ""}`.trim().slice(0, snippetMaxLen),
          score: likeFallbackScore,
          date: row.date || "",
          asst_text: (row.asst_text || "").slice(0, snippetMaxLen),
        }));
      }

      // Empty across the board
      return [];
    } catch (err: unknown) {
      log(`search error: ${(err as Error).message}`);
      return [];
    }
  }

  /** Full-scan search (no FTS, no LIKE filtering — returns latest entries). Used when query is empty. */
  function searchAll(limit: number): SearchResult[] {
    try {
      const d = ensureDB();
      const rows = d.prepare(
        "SELECT id, date, user_text, asst_text FROM memory_meta ORDER BY id DESC LIMIT ?"
      ).all(Math.min(Math.max(limit, 1), searchMaxLimit)) as Array<{ id: number; date: string; user_text: string | null; asst_text: string | null }>;
      return rows.map(r => ({
        id: r.id,
        filename: r.date ? `${r.date}.md` : "memory.db",
        snippet: (r.user_text || r.asst_text || "").slice(0, snippetMaxLen),
        score: 1.0,
        date: r.date || "",
        asst_text: (r.asst_text || "").slice(0, snippetMaxLen),
      }));
    } catch {
      return [];
    }
  }

  /** Vector similarity search via pluggable backend (sqlite-vec or hnswlib) */
  function vectorSearch(embedding: Float32Array, limit: number = 10): EmbeddedSearchResult[] {
    return backend?.vectorSearch(embedding, limit) ?? [];
  }

  /** Hybrid search: FTS5 + vector weighted combination */
  function hybridSearch(query: string, embedding: Float32Array | null, limit: number = 10): EmbeddedSearchResult[] {
    const ftsResults = search(query, limit);

    if (!embedding || ftsResults.length === 0) {
      return ftsResults.map(r => ({
        ...r,
        vectorScore: 0,
        hybridScore: r.score * 0.6,
      }));
    }

    const vecResults = vectorSearch(embedding, limit);

    const merged = new Map<string, EmbeddedSearchResult>();

    for (const r of ftsResults) {
      merged.set(`${r.date}|${r.snippet}|${r.id}`, {
        ...r,
        vectorScore: 0,
        hybridScore: r.score * 0.6,
      });
    }

    for (const r of vecResults) {
      const key = `${r.date}|${r.snippet}|${r.id}`;
      if (merged.has(key)) {
        const existing = merged.get(key)!;
        existing.vectorScore = r.vectorScore;
        existing.hybridScore = (existing.score * 0.6) + (r.vectorScore * 0.4);
      } else {
        merged.set(key, {
          ...r,
          score: r.vectorScore * 0.4,
          hybridScore: r.vectorScore * 0.4,
        });
      }
    }

    return [...merged.values()]
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, limit);
  }

  /** RRF Hybrid search: Reciprocal Rank Fusion of FTS5 + vector results.
   *  Replaces simple weighted combination with rank-based fusion (k=60).
   */
  function rrfHybridSearch(query: string, embedding: Float32Array | null, limit: number = 10, k = 60): EmbeddedSearchResult[] {
    const ftsResults = search(query, limit * 2); // overfetch for better fusion

    if (!embedding || ftsResults.length === 0) {
      return ftsResults.slice(0, limit).map(r => ({
        ...r,
        vectorScore: 0,
        hybridScore: r.score,
      }));
    }

    const vecResults = vectorSearch(embedding, limit * 2);

    // Build ranked doc lists for RRF
    const ftsRanked: RankedDoc[] = ftsResults.map((r, i) => ({
      id: `${r.date}|${r.snippet}|${r.id || i}`,
      doc: { ...r, source: "fts" as const },
      originalScore: r.score,
    }));

    const vecRanked: RankedDoc[] = vecResults.map((r, i) => ({
      id: `${r.date}|${r.snippet}|${r.id || i}`,
      doc: { ...r, source: "vec" as const },
      originalScore: r.vectorScore,
    }));

    const fused = reciprocalRankFusion([ftsRanked, vecRanked], k);

    // Map back to EmbeddedSearchResult
    const results: EmbeddedSearchResult[] = [];
    for (const f of fused.slice(0, limit)) {
      const doc = f.doc as Record<string, unknown>;
      results.push({
        id: doc.id as number,
        filename: String(doc.filename || ""),
        snippet: String(doc.snippet || ""),
        score: Number(doc.originalScore || 0),
        date: String(doc.date || ""),
        vectorScore: f.ranks[1] >= 0 ? Number(doc.originalScore || 0) : 0,
        hybridScore: f.rrfScore,
      });
    }

    return results;
  }

  /** Store a vector embedding via pluggable backend. */
  function storeVector(metaId: number, embedding: Float32Array): boolean {
    return backend?.storeVector(metaId, embedding) ?? false;
  }

  let pendingRebuild = false;
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRebuild() {
    if (pendingRebuild) return;
    pendingRebuild = true;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      try {
        ensureDB().exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
      } catch { /* best effort */ }
      pendingRebuild = false;
      rebuildTimer = null;
    }, 500);
  }

  /** Delete memory entries from FTS5 and meta tables by date */
  function deleteByDate(date: string): number {
    try {
      const d = ensureDB();
      const metaResult = d.prepare("DELETE FROM memory_meta WHERE date = ?").run(date);
      const deleted = Number(metaResult.changes ?? 0);
      // Defer FTS5 rebuild to batch multiple deletions
      scheduleRebuild();
      // Clean up orphan vectors (backend-specific)
      try { backend?.deleteOrphans?.(); } catch { /* best effort */ }
      log(`deleteByDate: ${deleted} entries removed for ${date}`);
      return deleted;
    } catch (err: unknown) {
      log(`deleteByDate error: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Delete memory entries matching a like pattern from user_text or asst_text */
  function deleteByKeyword(keyword: string): number {
    try {
      const d = ensureDB();
      const safeKw = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${safeKw}%`;
      const result = d.prepare(
        "DELETE FROM memory_meta WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\'"
      ).run(pattern, pattern);
      const deleted = Number(result.changes ?? 0);
      if (deleted > 0) {
        scheduleRebuild();
        try { backend?.deleteOrphans?.(); } catch { /* best effort */ }
      }
      log(`deleteByKeyword: ${deleted} entries removed for "${keyword}"`);
      return deleted;
    } catch (err: unknown) {
      log(`deleteByKeyword error: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Get database stats */
  function getStats(): DBStats {
    try {
      const d = ensureDB();

      const totalCount = d.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as { c: number } | undefined;
      const total = totalCount?.c ?? 0;

      const datesRaw = d.prepare(
        "SELECT date, COUNT(*) as c FROM memory_meta GROUP BY date ORDER BY date DESC LIMIT 10"
      ).all() as Array<{ date: string; c: number }>;

      let vecCount = 0;
      let dimensions = 0;
      try {
        vecCount = backend?.getVectorCount?.() ?? 0;
        dimensions = backend?.getDimensions?.() ?? config.embedding?.dimensions ?? 0;
      } catch {
        // vec backend may not be initialized
      }

      return {
        totalMemories: total,
        datesSummary: datesRaw.map(r => ({ date: r.date, count: r.c })),
        ftsEnabled: true,
        vecEnabled,
        totalVectors: vecCount,
        dimensions,
      };
    } catch (err: unknown) {
      log(`getStats error: ${(err as Error).message}`);
      return { totalMemories: 0, datesSummary: [], ftsEnabled: false, vecEnabled: false, totalVectors: 0, dimensions: 0 };
    }
  }

  /** Get local date string for a given timezone */
  function getLocalDate(tz?: string): string {
    try {
      return new Date().toLocaleDateString("sv-SE", { timeZone: tz || "Asia/Shanghai" });
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  /** Close database connection */
  function close(): void {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    backend?.close();
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
  }

  /** Get all tags from memory_tags table (created by memory_tag tool) */
  function getAllTags(): Array<{ tag: string; memory_id: number }> {
    try {
      const d = ensureDB();
      const rows = d.prepare("SELECT tag, memory_id FROM memory_tags").all() as Array<{ tag: string; memory_id: number }>;
      return rows;
    } catch {
      return [];
    }
  }

  /** Get all meta entries with id and filename (derived from date) */
  function getAllMeta(): Array<{ id: number; filename: string }> {
    try {
      const d = ensureDB();
      const rows = d.prepare("SELECT id, date FROM memory_meta").all() as Array<{ id: number; date: string }>;
      return rows.map(r => ({ id: r.id, filename: r.date ? `${r.date}.md` : `${r.id}.md` }));
    } catch {
      return [];
    }
  }

  /** Expose the raw DB instance for tools that need direct SQL access (e.g., memory-tag). */
  function getRawDb(): UnifiedDB {
    return ensureDB();
  }

  /** Get most recent memory entries by date (for fallback when no keywords). */
  function getLatestMemory(limit: number = 1): SearchResult[] {
    return searchAll(limit);
  }

  /** Simple key-value config store (for import checkpoints, etc.) */
  function getConfig(key: string, defaultValue?: string | null): string | null {
    try {
      const d = ensureDB();
      const tableExists = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_config'").get() as { name: string } | undefined;
      if (!tableExists) {
        d.exec("CREATE TABLE IF NOT EXISTS memory_config (key TEXT PRIMARY KEY, value TEXT)");
        return defaultValue ?? null;
      }
      const row = d.prepare("SELECT value FROM memory_config WHERE key = ?").get(key) as { value: string } | undefined;
      return row ? row.value : (defaultValue ?? null);
    } catch {
      return defaultValue ?? null;
    }
  }

  function setConfig(key: string, value: string): void {
    try {
      const d = ensureDB();
      d.exec("CREATE TABLE IF NOT EXISTS memory_config (key TEXT PRIMARY KEY, value TEXT)");
      d.prepare("INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)").run(key, value);
    } catch { /* best effort */ }
  }

  /** Update metadata for a memory row */
  function updateMetadata(id: number, metadata: string): void {
    try {
      const d = ensureDB();
      d.prepare("UPDATE memory_meta SET meta = ? WHERE id = ?").run(metadata, id);
    } catch { /* best effort */ }
  }
  function incrementAccessCount(id: number): void {
    const d = ensureDB();
    if (!d) return;
    try {
      const row = d.prepare("SELECT access_count, tier, importance FROM memory_meta WHERE id = ?").get(id) as { access_count: number; tier: string; importance: number } | undefined;
      if (!row) return;
      const newCount = (row.access_count || 0) + 1;
      let newTier = row.tier || "active";
      if (newCount >= 10 && (row.importance || 0) >= 0.8) newTier = "core";
      else if (newCount >= 3) newTier = "working";
      d.prepare("UPDATE memory_meta SET access_count = ?, tier = ? WHERE id = ?").run(newCount, newTier, id);
    } catch { /* best effort */ }
  }

  return { init, indexTurn, search, searchAll, vectorSearch, hybridSearch, rrfHybridSearch, storeVector, deleteByDate, deleteByKeyword, getLatestMemory, getStats, close, dbPath, getRawDb, getAllTags, getAllMeta, getLocalDate, getConfig, setConfig, updateMetadata, incrementAccessCount };
}

export type DBBridge = ReturnType<typeof createDB>;
