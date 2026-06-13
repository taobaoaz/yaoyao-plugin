/**
 * core/import/import.ts — Pure import logic, zero platform awareness.
 */

import type { UnifiedDB, SQLiteRow } from "../../storage/bridge.ts";

export interface ImportEntry {
  date: string;
  user_text: string;
  asst_text: string;
}

export interface ParseResult {
  entries: ImportEntry[];
  errors: string[];
}

export function parseJSONL(jsonlData: string): ParseResult {
  if (typeof jsonlData !== "string") throw new TypeError("parseJSONL: jsonlData must be a string");
  const lines = jsonlData.split("\n").filter(l => l.trim());
  const entries: ImportEntry[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(lines[i]) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date))) {
        errors.push(`第 ${i + 1} 行缺少有效 date 字段（格式应为 YYYY-MM-DD）`);
        continue;
      }
      if (!parsed.user_text && !parsed.asst_text) {
        errors.push(`第 ${i + 1} 行至少需要 user_text 或 asst_text`);
        continue;
      }
      entries.push({
        date: String(parsed.date).slice(0, 10),
        user_text: String(parsed.user_text || ""),
        asst_text: String(parsed.asst_text || ""),
      });
    } catch (e: unknown) {
      errors.push(`第 ${i + 1} 行 JSON 解析失败: ${(e as Error).message}`);
    }
  }

  return { entries, errors };
}

export function batchImport(db: UnifiedDB, entries: ImportEntry[]): number {
  if (!db) throw new TypeError("batchImport: db is required");
  if (!Array.isArray(entries)) throw new TypeError("batchImport: entries must be an array");
  const insertedMeta = db.prepare(
    "INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)"
  );
  const insertedFts = db.prepare(
    "INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)"
  );

  let successCount = 0;
  db.exec("BEGIN TRANSACTION");
  try {
    for (const entry of entries) {
      const r = insertedMeta.run(entry.date, entry.user_text, entry.asst_text);
      const rowId = Number(r.lastInsertRowid);
      if (!Number.isFinite(rowId) || rowId <= 0) {
        throw new Error(`Invalid lastInsertRowid: ${r.lastInsertRowid}`);
      }
      insertedFts.run(rowId, entry.date, entry.user_text, entry.asst_text);
      successCount++;
    }
    db.exec("COMMIT");
  } catch (txErr: unknown) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw txErr;
  }
  return successCount;
}

export function getTotalCount(db: UnifiedDB): number {
  if (!db) throw new TypeError("getTotalCount: db is required");
  const row = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as SQLiteRow | undefined;
  return Number(row?.c ?? 0);
}
