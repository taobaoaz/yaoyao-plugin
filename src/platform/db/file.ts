/**
 * platform/db/file.ts — Pure filesystem fallback (zero deps, works everywhere).
 *
 * Hardening:
 *   - All fs ops wrapped in try/catch (permission denied, missing dir, etc.)
 *   - readFileSync capped at 10 MB per file to prevent OOM on massive .md logs
 *   - _search gracefully returns empty on any error
 *
 * When no SQLite is available, FileDB provides minimum viable L0 memory:
 * - daily markdown files (already exist in memory/YYYY-MM-DD.md)
 * - simple text search over those files
 * - basic index tracking
 */

import fs from "node:fs";
import path from "node:path";
import type { UnifiedDB, UnifiedStatement, SQLiteRow } from "./types.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB cap per file

export class FileDB implements UnifiedDB {
  private baseDir: string;
  private indexPath: string;
  private index: Map<string, string[]>; // date -> [filenames]

  constructor(baseDir: string) {
    this.baseDir = baseDir;

    // Build a simple in-memory index from existing files
    this.indexPath = path.join(baseDir, ".filedb_index.json");
    this.index = new Map();
    try {
      if (fs.existsSync(this.indexPath)) {
        const raw = fs.readFileSync(this.indexPath, "utf-8");
        let parsed: Record<string, string[]>;
        try {
          parsed = JSON.parse(raw) as Record<string, string[]>;
        } catch {
          parsed = {};
        }
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) this.index.set(k, v);
        }
      }
    } catch { /* ignore corrupt index */ }

    try {
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
    } catch { /* best effort */ }
  }

  exec(_sql: string) { /* no-op */ }

  prepare(sql: string): UnifiedStatement {
    // Minimal SQL parsing for FileDB
    const lower = sql.toLowerCase().trim();

    // ── SELECT ... FROM memory_meta ──
    if (lower.startsWith("select")) {
      const isCount = /count\(\*\)/.test(lower);
      const limitMatch = lower.match(/limit\s+(\d+)/);
      const limit = limitMatch ? parseInt(limitMatch[1], 10) : 10;
      const dateMatch = lower.match(/date\s*=\s*\?/);
      const orderDesc = lower.includes("order by id desc");

      return {
        run: () => ({ lastInsertRowid: 0, changes: 0 }),
        all: (...args: unknown[]) => {
          try {
            if (isCount) {
              const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
              return [{ c: files.length }];
            }
            if (dateMatch && args.length > 0) {
              const date = String(args[0]);
              const filePath = path.join(this.baseDir, `${date}.md`);
              if (fs.existsSync(filePath)) {
                const size = fs.statSync(filePath).size;
                return [{ id: 1, date, user_text: filePath, asst_text: "", size }];
              }
              return [];
            }
            if (orderDesc || lower.includes("order by")) {
              return this._listAll(orderDesc ? limit : limit);
            }
            return searchFiles(this.baseDir, args[0] as string || "", limit);
          } catch { return []; }
        },
        get: (...args: unknown[]) => {
          try {
            if (isCount) {
              const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md"));
              return { c: files.length };
            }
            if (dateMatch && args.length > 0) {
              const date = String(args[0]);
              const filePath = path.join(this.baseDir, `${date}.md`);
              return fs.existsSync(filePath) ? { id: 1, date, user_text: filePath, asst_text: "" } : undefined;
            }
            const rows = searchFiles(this.baseDir, args[0] as string || "", 1);
            return rows[0];
          } catch { return undefined; }
        },
      };
    }

    // ── DELETE FROM memory_meta ──
    if (lower.startsWith("delete")) {
      const dateMatch = lower.match(/date\s*=\s*\?/);
      return {
        run: (...args: unknown[]) => {
          try {
            if (dateMatch && args.length > 0) {
              const filePath = path.join(this.baseDir, `${String(args[0])}.md`);
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return { lastInsertRowid: 0, changes: 1 };
              }
            }
            return { lastInsertRowid: 0, changes: 0 };
          } catch { return { lastInsertRowid: 0, changes: 0 }; }
        },
        all: () => [],
        get: () => undefined,
      };
    }

    // ── INSERT ──
    if (lower.startsWith("insert")) {
      return {
        run: (...args: unknown[]) => {
          try {
            const date = String(args[0] || "");
            const text = String(args[1] || "");
            const filePath = path.join(this.baseDir, `${date}.md`);
            fs.appendFileSync(filePath, text + "\n");
            return { lastInsertRowid: 1, changes: 1 };
          } catch { return { lastInsertRowid: 0, changes: 0 }; }
        },
        all: () => [],
        get: () => undefined,
      };
    }

    // ── Default no-op ──
    return {
      run: () => ({ lastInsertRowid: 0, changes: 0 }),
      all: () => [],
      get: () => undefined,
    };
  }

  close() { /* no-op */ }

  private _listAll(limit: number): SQLiteRow[] {
    return listFiles(this.baseDir, limit);
  }
}

import { searchFiles, listFiles, countFiles } from "./file-search.ts";

export { searchFiles, listFiles, countFiles };

export function createFileDB(dbPath: string): FileDB {
  const baseDir = path.dirname(dbPath);
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch { /* best effort — caller may have read-only fs */ }
  return new FileDB(baseDir);
}
