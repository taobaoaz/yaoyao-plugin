/**
 * core/search/search.ts — Pure search logic, zero platform awareness.
 */

import type { UnifiedDB, SQLiteRow } from '../../storage/bridge.ts';

export interface SearchResult {
  id?: number;
  filename: string;
  date: string;
  snippet: string;
  score: number;
  user_text: string;
  asst_text: string;
}

export function searchFTS(db: UnifiedDB, query: string, limit: number): SearchResult[] {
  if (!db) throw new TypeError('searchFTS: db is required');
  if (typeof query !== 'string') throw new TypeError('searchFTS: query must be a string');
  if (!Number.isFinite(limit) || limit < 1) limit = 10;

  const sql = `SELECT m.id, m.date, m.user_text, m.asst_text, f.rank AS score
    FROM memory_fts f
    JOIN memory_meta m ON f.rowid = m.id
    WHERE memory_fts MATCH ?
    ORDER BY f.rank
    LIMIT ?`;
  const rows = db.prepare(sql).all(query, limit);

  return rows.map((row: SQLiteRow) => ({
    id: Number(row.id || 0),
    filename: `${String(row.date || 'memory')}.md`,
    date: String(row.date || ''),
    snippet: `${String(row.user_text || '')} ${String(row.asst_text || '')}`.trim().slice(0, 500),
    score:
      Number.isFinite(Number(row.score)) && Number(row.score) < 0
        ? Math.min(1, Math.max(0.1, -Number(row.score) / 15))
        : 0.3,
    user_text: String(row.user_text || ''),
    asst_text: String(row.asst_text || ''),
  }));
}
