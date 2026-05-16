/**
 * core/export/export.ts — Pure export logic, zero platform awareness.
 */

import type { UnifiedDB, SQLiteRow } from "../../platform/db/types.js";

export interface ExportRow {
  date: string;
  user_text: string;
  asst_text: string;
}

export function queryForExport(
  db: UnifiedDB,
  limit: number,
  dateFrom?: string,
  dateTo?: string,
  keyword?: string
): ExportRow[] {
  if (!db) throw new TypeError("queryForExport: db is required");
  if (!Number.isFinite(limit) || limit < 1) limit = 100;
  let sql = "SELECT date, user_text, asst_text FROM memory_meta WHERE 1=1";
  const args: (string | number)[] = [];

  if (dateFrom) { sql += " AND date >= ?"; args.push(dateFrom); }
  if (dateTo)   { sql += " AND date <= ?"; args.push(dateTo); }
  if (keyword)  {
    const safeKw = keyword.replace(/\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    sql += " AND (user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\')";
    args.push(`%${safeKw}%`, `%${safeKw}%`);
  }

  sql += " ORDER BY date DESC LIMIT ?";
  args.push(limit);

  const rows = db.prepare(sql).all(...args);
  return rows.map((r: SQLiteRow) => ({
    date: String(r.date || ""),
    user_text: String(r.user_text || ""),
    asst_text: String(r.asst_text || ""),
  }));
}

export function formatJSONL(rows: ExportRow[]): string {
  if (!Array.isArray(rows)) throw new TypeError("formatJSONL: rows must be an array");
  return rows.map(r => JSON.stringify(r)).join("\n") + "\n";
}
