/**
 * storage/fts.ts — FTS5 search engine.
 *
 * Pure FTS5 operations: indexing, search with sanitization, LIKE fallback.
 * No knowledge of vector search or hybrid fusion.
 */
import type { UnifiedDB } from "../platform/db/types.ts";
import type { SearchResult, FtsRow, LikeRow } from "./types.ts";
import { rankToScore, sanitizeFTSQuery } from "./fts-utils.ts";
import { extractCjkBigrams } from "./fts-cjk.ts";

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

export function createFtsEngine(config?: Partial<FtsConfig>) : unknown {
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
          try { db.exec("ROLLBACK"); } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory]  ignore : ${msg}`);
    }
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
      const cjkBigrams = extractCjkBigrams(query);
      const likeTerms = cjkBigrams.length > 0 ? cjkBigrams : [safeLikeQuery];

      const likeStmt = db.prepare(
        `SELECT id, date, user_text, asst_text FROM memory_meta
         WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\'
         ORDER BY id DESC LIMIT ?`
      );

      const seenIds = new Set<number>();
      const likeRows: LikeRow[] = [];
      for (const term of likeTerms) {
        const pattern = `%${term}%`;
        const batch = likeStmt.all(pattern, pattern, Math.min(Math.max(limit, 1), cfg.searchMaxLimit)) as unknown as LikeRow[];
        for (const row of batch) {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            likeRows.push(row);
          }
        }
        if (likeRows.length >= Math.min(Math.max(limit, 1), cfg.searchMaxLimit)) break;
      }

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
      try {
        db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
      } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory]  best effort : ${msg}`);
    }
    },

    /** Delete by exact date match. Returns count. */
    deleteByDate(db: UnifiedDB, date: string): number {
      try {
        const result = db.prepare("DELETE FROM memory_meta WHERE date = ?").run(date);
        return Number(result.changes ?? 0);
      } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:storage] Operation failed: ${msg}`);
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
      } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:storage] Operation failed: ${msg}`);
      return 0;
    }
    },
  };
}

export type FtsEngine = ReturnType<typeof createFtsEngine>;
