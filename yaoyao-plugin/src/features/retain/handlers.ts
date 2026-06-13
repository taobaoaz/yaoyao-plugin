/**
 * features/retain/handlers.ts — Retain action handlers.
 *
 * Pure logic for check/boost/important actions.
 * I/O is delegated to store.ts, formatting to core/retain/retain.ts.
 */
import type { MemoryStore } from "../../utils/memory-store.ts";
import type { DBBridge } from "../../utils/db-bridge.ts";
import {
  detectAtRisk,
  formatRetainCheck,
  formatBoostResult,
  formatImportantResult,
  type MemoryItem,
} from "../../core/retain/retain.ts";
import { loadBoostRecords, appendBoostRecord, loadImportantTags, saveImportantTags } from "./store.ts";

export async function handleCheck(
  store: MemoryStore,
  db: DBBridge,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const baseDir = store.baseDir;
  const boostRecords = loadBoostRecords(baseDir);
  const importantTags = loadImportantTags(baseDir);

  const allMemories: MemoryItem[] = [];
  try {
    const results = db.search("", 500);
    for (const r of results) {
      const keyword = r.snippet.slice(0, 60).replace(/[^\w\u4e00-\u9fff\s]/g, "").trim() || "untitled";
      allMemories.push({ keyword, filename: r.filename || "unknown", snippet: r.snippet.slice(0, 120) });
    }
  } catch { /* best effort */ }

  const atRisk = detectAtRisk(allMemories, boostRecords, importantTags, 7);
  const text = formatRetainCheck(allMemories.length, boostRecords.length, importantTags.length, atRisk);
  return { content: [{ type: "text", text }] };
}

export async function handleBoost(
  store: MemoryStore,
  db: DBBridge,
  keyword: string,
  filename?: string,
  reason?: string,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const baseDir = store.baseDir;

  const record = { keyword, filename, boostedAt: new Date().toISOString(), reason };
  try {
    appendBoostRecord(baseDir, record);
  } catch (err: unknown) {
    return { content: [{ type: "text", text: `❌ 写入强化记录失败: ${(err as Error).message || "未知错误"}` }] };
  }

  let matchedCount = 0;
  try {
    matchedCount = db.search(keyword, 20).length;
  } catch { /* best effort */ }

  const text = formatBoostResult(keyword, filename, reason, record.boostedAt, matchedCount);
  return { content: [{ type: "text", text }] };
}

export async function handleImportant(
  store: MemoryStore,
  keyword: string,
  filename?: string,
  reason?: string,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const baseDir = store.baseDir;
  const tags = loadImportantTags(baseDir);

  if (tags.some(t => t.keyword === keyword && (filename ? t.filename === filename : true))) {
    return { content: [{ type: "text", text: `ℹ️ 该记忆已标记为重要: keyword="${keyword}"${filename ? `, filename="${filename}"` : ""}` }] };
  }

  const tag = { keyword, filename, reason, taggedAt: new Date().toISOString() };
  tags.push(tag);
  try {
    saveImportantTags(baseDir, tags);
  } catch (err: unknown) {
    return { content: [{ type: "text", text: `❌ 写入重要标签失败: ${(err as Error).message || "未知错误"}` }] };
  }

  const text = formatImportantResult(keyword, filename, reason, tag.taggedAt);
  return { content: [{ type: "text", text }] };
}
