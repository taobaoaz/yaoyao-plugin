/**
 * storage/fts.ts — FTS5 search engine.
 *
 * Pure FTS5 operations: indexing, search with sanitization, LIKE fallback.
 * No knowledge of vector search or hybrid fusion.
 */
import type { UnifiedDB } from "../platform/db/types.ts";
import type { SearchResult, FtsRow, LikeRow } from "./types.ts";

/** Configurable limits */
export interface FtsConfig {
  snippetMaxLen: number;
  searchMaxLimit: number;
  likeFallbackScore: number;
}

const DEFAULT_FTS_CONFIG: FtsConfig = {
  snippetMaxLen: 500,
  searchMaxLimit: 100,
  likeFallbackScore: 0.5,
};

/** Normalize FTS5 rank (negative = better) to a [0,1] score */
function rankToScore(rank: number | null | undefined): number {
  const r = Number(rank);
  if (!Number.isFinite(r)) return 0.3;
  if (r < 0) return Math.min(1, Math.max(0.1, -r / 15));
  return 0.3;
}

/** Sanitize query for FTS5 MATCH syntax. */
function sanitizeFTSQuery(query: string): string {
  let s = query
    .replace(/["^`()~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!s) return "";
  s = s.replace(/(^|\s)\*+(?=\s|$)/g, "$1")
       .replace(/\*{2,}/g, "*");
  return s.trim();
}

export function createFtsEngine(config?: Partial<FtsConfig>) {
  const cfg = { ...DEFAULT_FTS_CONFIG, ...config };

  return {
    /** Index a conversation turn in FTS5. Returns the row id or -1. */
    indexTurn(db: UnifiedDB, userText: string, asstText: string, date: string, meta?: string): number {
      try {
        db.exec("BEGIN TRANSACTION");
        try {
          const stmt = db.prepare(
            "INSERT INTO memory_meta (date, user_text, asst_text, meta) VALUES (?, ?, ?, ?)"
          );
          const result = stmt.run(date, userText.slice(0, cfg.snippetMaxLen), asstText.slice(0, cfg.snippetMaxLen), meta || null);
          const rowId = Number(result.lastInsertRowid);

          const stmt2 = db.prepare(
            "INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)"
          );
          stmt2.run(rowId, date, userText.slice(0, cfg.snippetMaxLen), asstText.slice(0, cfg.snippetMaxLen));

          db.exec("COMMIT");
          return rowId;
        } catch (err: unknown) {
          try { db.exec("ROLLBACK"); } catch { /* ignore */ }
          throw err;
        }
      } catch (err: unknown) {
        return -1;
      }
    },

    /** FTS5 full-text search with LIKE fallback for CJK. */
    search(db: UnifiedDB, query: string, limit: number = 10): SearchResult[] {
      const safeQuery = sanitizeFTSQuery(query);
      if (!safeQuery) {
        return this.searchAll(db, limit);
      }

      // Try FTS5 first
      const stmt = db.prepare(
        `SELECT rowid, date, user_text, asst_text,
                snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank
         FROM memory_fts WHERE memory_fts MATCH ?
         ORDER BY rank LIMIT ?`
      );
      const rows = stmt.all(safeQuery, Math.min(Math.max(limit, 1), cfg.searchMaxLimit)) as unknown as FtsRow[];

      if (rows.length > 0) {
        return rows.map(row => ({
          id: row.rowid,
          filename: row.date ? `${row.date}.md` : "memory.db",
          snippet: (row.snippet || "").slice(0, cfg.snippetMaxLen),
          score: rankToScore(row.rank),
          date: row.date || "",
          asst_text: (row.asst_text || "").slice(0, cfg.snippetMaxLen),
        }));
      }

      // FTS5 miss → LIKE fallback for CJK
      const safeLikeQuery = query.slice(0, 200)
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const likeQuery = `%${safeLikeQuery}%`;
      const likeStmt = db.prepare(
        `SELECT id, date, user_text, asst_text FROM memory_meta
         WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\'
         ORDER BY id DESC LIMIT ?`
      );
      const likeRows = likeStmt.all(likeQuery, likeQuery, Math.min(Math.max(limit, 1), cfg.searchMaxLimit)) as unknown as LikeRow[];

      if (likeRows.length > 0) {
        return likeRows.map(row => ({
          id: row.id,
          filename: row.date ? `${row.date}.md` : "memory.db",
          snippet: `${row.user_text || ""} ${row.asst_text || ""}`.trim().slice(0, cfg.snippetMaxLen),
          score: cfg.likeFallbackScore,
          date: row.date || "",
          asst_text: (row.asst_text || "").slice(0, cfg.snippetMaxLen),
        }));
      }

      return [];
    },

    /** Full table scan: latest entries (no filter). */
    searchAll(db: UnifiedDB, limit: number = 10): SearchResult[] {
      const rows = db.prepare(
        "SELECT id, date, user_text, asst_text FROM memory_meta ORDER BY id DESC LIMIT ?"
      ).all(Math.min(Math.max(limit, 1), cfg.searchMaxLimit)) as unknown as LikeRow[];

      return rows.map(r => ({
        id: r.id,
        filename: r.date ? `${r.date}.md` : "memory.db",
        snippet: (r.user_text || r.asst_text || "").slice(0, cfg.snippetMaxLen),
        score: 1.0,
        date: r.date || "",
        asst_text: (r.asst_text || "").slice(0, cfg.snippetMaxLen),
      }));
    },

    /** Schedule FTS5 rebuild (deferred batch). */
    scheduleRebuild(db: UnifiedDB): void {
      // Best-effort; caller must handle debounce
      try {
        db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
      } catch { /* best effort */ }
    },

    /** Delete by exact date match. Returns count. */
    deleteByDate(db: UnifiedDB, date: string): number {
      try {
        const result = db.prepare("DELETE FROM memory_meta WHERE date = ?").run(date);
        return Number(result.changes ?? 0);
      } catch {
        return 0;
      }
    },

    /** Delete by LIKE pattern on user_text or asst_text. Returns count. */
    deleteByKeyword(db: UnifiedDB, keyword: string): number {
      try {
        const safe = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const pattern = `%${safe}%`;
        const result = db.prepare(
          "DELETE FROM memory_meta WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\'"
        ).run(pattern, pattern);
        return Number(result.changes ?? 0);
      } catch {
        return 0;
      }
    },
  };
}

export type FtsEngine = ReturnType<typeof createFtsEngine>;
