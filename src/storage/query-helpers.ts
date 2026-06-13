/**
 * storage/query-helpers.ts — Pure SQL query helpers for Storage.
 *
 * All functions accept a UnifiedDB instance (or getter) and perform
 * read/write operations. No closure dependencies.
 */
import type { UnifiedDB } from "../platform/db/compat.ts";
import type { VectorStore } from "./vector-store.ts";
import type { DBStats, SearchResult } from "./types.ts";

export function getStats(db: UnifiedDB, vector: VectorStore | null): DBStats {
  try {
    const totalCount = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as { c: number } | undefined;
    const total = totalCount?.c ?? 0;
    const datesRaw = db.prepare(
      "SELECT date, COUNT(*) as c FROM memory_meta GROUP BY date ORDER BY date DESC LIMIT 10"
    ).all() as Array<{ date: string; c: number }>;
    let vecCount = 0;
    let dims = 0;
    try { vecCount = vector?.count() ?? 0; dims = vector?.dimensions() ?? 0; } catch { /* ignore */ }
    return {
      totalMemories: total,
      datesSummary: datesRaw.map(r => ({ date: r.date, count: r.c })),
      ftsEnabled: true,
      vecEnabled: vector?.isAvailable ?? false,
      totalVectors: vecCount,
      dimensions: dims,
    };
  } catch {
    return { totalMemories: 0, datesSummary: [], ftsEnabled: false, vecEnabled: false, totalVectors: 0, dimensions: 0 };
  }
}

export function getAllTags(db: UnifiedDB): Array<{ tag: string; memory_id: number }> {
  try {
    const rows = db.prepare("SELECT tag, memory_id FROM memory_tags").all() as Array<{ tag: string; memory_id: number }>;
    return rows;
  } catch { return []; }
}

export function getAllMeta(db: UnifiedDB): Array<{ id: number; filename: string }> {
  try {
    const rows = db.prepare("SELECT id, date FROM memory_meta").all() as Array<{ id: number; date: string }>;
    return rows.map(r => ({ id: r.id, filename: r.date ? `${r.date}.md` : `${r.id}.md` }));
  } catch { return []; }
}

export function getConfig(db: UnifiedDB, key: string, defaultValue?: string | null): string | null {
  try {
    const row = db.prepare("SELECT value FROM memory_config WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : (defaultValue ?? null);
  } catch { return defaultValue ?? null; }
}

export function setConfig(db: UnifiedDB, key: string, value: string): void {
  try {
    db.prepare("INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)").run(key, value);
  } catch { /* best effort */ }
}

export function updateMetadata(db: UnifiedDB, id: number, metadata: string): void {
  try {
    db.prepare("UPDATE memory_meta SET meta = ? WHERE id = ?").run(metadata, id);
  } catch { /* best effort */ }
}

export function incrementAccessCount(db: UnifiedDB, id: number): void {
  try {
    const row = db.prepare("SELECT access_count, tier, importance FROM memory_meta WHERE id = ?").get(id) as {
      access_count: number; tier: string; importance: number } | undefined;
    if (!row) return;
    const newCount = (row.access_count || 0) + 1;
    let newTier = row.tier || "active";
    if (newCount >= 10 && (row.importance || 0) >= 0.8) newTier = "core";
    else if (newCount >= 3) newTier = "working";
    db.prepare("UPDATE memory_meta SET access_count = ?, tier = ? WHERE id = ?")
      .run(newCount, newTier, id);
  } catch { /* best effort */ }
}

export function getMemoryMeta(db: UnifiedDB, id: number): string | null {
  try {
    const row = db.prepare("SELECT meta FROM memory_meta WHERE id = ?").get(id) as { meta: string | null } | undefined;
    return row?.meta ?? null;
  } catch { return null; }
}

export function searchByMetaRelations(db: UnifiedDB, limit: number): Array<{ id: number; date: string; user_text: string | null; meta: string }> {
  try {
    const rows = db.prepare(
      "SELECT id, date, user_text, meta FROM memory_meta " +
      "WHERE meta IS NOT NULL AND json_extract(meta, '$.relations') IS NOT NULL " +
      "ORDER BY id DESC LIMIT ?"
    ).all(limit) as Array<{ id: number; date: string; user_text: string | null; meta: string }>;
    return rows;
  } catch { return []; }
}

export function countTags(db: UnifiedDB): { total: number; unique: number } {
  try {
    const totalRow = db.prepare("SELECT COUNT(*) as c FROM memory_tags").get() as { c: number } | undefined;
    const uniqueRow = db.prepare("SELECT COUNT(DISTINCT tag) as c FROM memory_tags").get() as { c: number } | undefined;
    return { total: totalRow?.c ?? 0, unique: uniqueRow?.c ?? 0 };
  } catch { return { total: 0, unique: 0 }; }
}

export function getRecentRawMemories(db: UnifiedDB, limit: number): Array<{ id: number; user_text: string; asst_text: string; date: string }> {
  try {
    const rows = db.prepare(
      "SELECT id, user_text, asst_text, date FROM memory_meta ORDER BY date DESC, id DESC LIMIT ?"
    ).all(limit) as Array<{ id: number; user_text: string; asst_text: string; date: string }>;
    return rows;
  } catch { return []; }
}

export function searchByLike(db: UnifiedDB, query: string, limit: number): Array<{ id: number; user_text: string; asst_text: string; date: string }> {
  try {
    const pattern = `%${query}%`;
    const rows = db.prepare(
      "SELECT id, user_text, asst_text, date FROM memory_meta " +
      "WHERE user_text LIKE ? OR asst_text LIKE ? ORDER BY date DESC LIMIT ?"
    ).all(pattern, pattern, limit) as Array<{ id: number; user_text: string; asst_text: string; date: string }>;
    return rows;
  } catch { return []; }
}

export function batchSetConfig(db: UnifiedDB, entries: Array<{ key: string; value: string }>): void {
  if (entries.length === 0) return;
  try {
    db.exec("BEGIN TRANSACTION");
    const stmt = db.prepare("INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)");
    for (const e of entries) stmt.run(e.key, e.value);
    db.exec("COMMIT");
  } catch { /* best effort */ }
}
