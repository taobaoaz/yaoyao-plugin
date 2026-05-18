/**
 * features/unify/provider.ts — Unified backend data access.
 *
 * Reads from OpenClaw DB, .dreams events, and yaoyao indices.
 * Pure data access, no tool registration.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCompatDB } from "../../storage/bridge.ts";
import type { SQLiteRow } from "../../storage/bridge.ts";

function getOpenClawMemoryDir() {
  return path.join(os.homedir(), ".openclaw", "memory");
}

export function queryOpenClawDB(sql: string, params?: unknown[]): SQLiteRow[] | null {
  const dbPath = path.join(getOpenClawMemoryDir(), "main.sqlite");
  try { if (!fs.existsSync(dbPath)) return null; } catch { return null; }
  try {
    const { db } = createCompatDB(dbPath);
    const rows = db.prepare(sql).all(...(params || []));
    db.close();
    return rows as SQLiteRow[];
  } catch {
    return null;
  }
}

export function readDreams(memoryDir: string) {
  const result = { events: [] as unknown[], shortTermRecall: null as unknown };
  const eventsPath = path.join(memoryDir, ".dreams", "events.jsonl");
  const recallPath = path.join(memoryDir, ".dreams", "short-term-recall.json");
  try {
    if (fs.existsSync(eventsPath)) {
      const lines = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
      result.events = lines.slice(-20).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
  } catch { /* best effort */ }
  try {
    if (fs.existsSync(recallPath)) {
      try { result.shortTermRecall = JSON.parse(fs.readFileSync(recallPath, "utf8")); }
      catch { result.shortTermRecall = []; }
    }
  } catch { /* best effort */ }
  return result;
}

export function getYaoyaoDbPath(memoryDir: string): string {
  return path.join(memoryDir, ".yaoyao.db");
}

export function getDailyFilesCount(memoryDir: string): number {
  try {
    return fs.existsSync(memoryDir)
      ? fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length
      : 0;
  } catch { return 0; }
}
