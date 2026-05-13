/**
 * core/search/search.ts — Pure search logic, zero platform awareness.
 */

import type { UnifiedDB, SQLiteRow } from "../../platform/db/types.js";

export interface SearchResult {
  filename: string;
  date: string;
  snippet: string;
  score: number;
  user_text: string;
  asst_text: string;
}

export function searchFTS(db: UnifiedDB, query: string, limit: number): SearchResult[] {
  if (!db) throw new TypeError("searchFTS: db is required");
  if (typeof query !== "string") throw new TypeError("searchFTS: query must be a string");
  if (!Number.isFinite(limit) || limit < 1) limit = 10;

  const sql = `SELECT m.date, m.filename, m.user_text, m.asst_text, m.snippet, f.rank AS score
    FROM memory_fts f
    JOIN memory_meta m ON f.date = m.date AND f.filename = m.filename
    WHERE memory_fts MATCH ?
    ORDER BY f.rank
    LIMIT ?`;
  const rows = db.prepare(sql).all(query, limit);

  return rows.map((row: SQLiteRow) => ({
    filename: String(row.filename || ""),
    date: String(row.date || ""),
    snippet: String(row.snippet || ""),
    score: Number(row.score || 0),
    user_text: String(row.user_text || ""),
    asst_text: String(row.asst_text || ""),
  }));
}
