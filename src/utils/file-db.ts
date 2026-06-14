/**
 * utils/vector/file-db.ts — Pure filesystem fallback database.
 *
 * Used when neither node:sqlite (Node 22+) nor better-sqlite3 is available.
 * Persists data as daily .md files + a lightweight JSON index.
 */
import fs from "node:fs";
import path from "node:path";
import type { SQLiteRow } from "../platform/db/types.ts";
import type { UnifiedDB, UnifiedStatement } from "./db-compat.ts";

/**
 * FileDB — zero-dependency fallback that stores memory entries as
 * daily markdown files in a base directory, with a JSON index for fast
 * date-based lookups.
 */
export class FileDB implements UnifiedDB {
  private baseDir: string;
  private indexPath: string;
  private index: Map<string, string[]>;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.indexPath = path.join(baseDir, ".yaoyao-index.json");
    this.index = new Map();
    this._loadIndex();
  }

  private _loadIndex() {
    try {
      if (fs.existsSync(this.indexPath)) {
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
        } catch {
          raw = {};
        }
        for (const [k, v] of Object.entries(raw)) {
          this.index.set(k, v as string[]);
        }
      }
    } catch { /* ignore corrupt index */ }
  }

  private _saveIndex() {
    try {
      const obj: Record<string, string[]> = {};
      for (const [k, v] of this.index) obj[k] = v;
      fs.writeFileSync(this.indexPath, JSON.stringify(obj), "utf-8");
    } catch { /* best effort */ }
  }

  exec(_sql: string): void {
    // No-op for file-db; schema is implicit
  }

  prepare(sql: string): UnifiedStatement {
    const lowered = sql.toLowerCase().trim();

    if (lowered.startsWith("insert into yaoyao_meta")) {
      return {
        run: (...args: unknown[]) => {
          const date = args[0] as string;
          const userText = args[1] as string;
          const asstText = args[2] as string;
          const dailyPath = path.join(this.baseDir, `${date}.md`);
          const entry = `\n### ${new Date().toISOString()}\n**User:** ${userText}\n**AI:** ${asstText}\n`;
          fs.appendFileSync(dailyPath, entry, "utf-8");
          const existing = this.index.get(date) || [];
          if (!existing.includes(dailyPath)) {
            existing.push(dailyPath);
            this.index.set(date, existing);
            this._saveIndex();
          }
          return { lastInsertRowid: Date.now(), changes: 1 };
        },
        all: () => [],
        get: () => undefined,
      };
    }

    if (lowered.includes("from yaoyao_fts") && lowered.includes("match")) {
      return {
        run: () => ({ changes: 0 }),
        all: (...args: unknown[]) => this._search(args[0] as string, args[1] as number),
        get: () => undefined,
      };
    }

    if (lowered.includes("count(*)")) {
      const count = this._countAll();
      return {
        run: () => ({ changes: 0 }),
        all: () => [{ c: count } as SQLiteRow],
        get: () => ({ c: count } as SQLiteRow),
      };
    }

    if (lowered.startsWith("delete from yaoyao_meta")) {
      return {
        run: (...args: unknown[]) => {
          const date = args[0] as string;
          const file = path.join(this.baseDir, `${date}.md`);
          try { fs.unlinkSync(file); } catch { /* */ }
          this.index.delete(date);
          this._saveIndex();
          return { changes: 1 };
        },
        all: () => [],
        get: () => undefined,
      };
    }

    if (lowered.startsWith("pragma journal_mode")) {
      return {
        run: () => ({ changes: 0 }),
        all: () => [{ journal_mode: "delete" } as SQLiteRow],
        get: () => ({ journal_mode: "delete" } as SQLiteRow),
      };
    }

    return {
      run: () => ({ changes: 0 }),
      all: () => [],
      get: () => undefined,
    };
  }

  close(): void {
    this._saveIndex();
  }

  enableLoadExtension?(): void {
    // Not supported in file-db
  }

  // ── FileDB search implementation ──
  private _search(query: string, limit: number): SQLiteRow[] {
    const results: SQLiteRow[] = [];
    let files: string[];
    try { files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/)); } catch { files = []; }
    const q = query.toLowerCase();

    for (const file of files) {
      const filePath = path.join(this.baseDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.toLowerCase().includes(q)) {
        const lines = content.split("\n");
        const idx = lines.findIndex(l => l.toLowerCase().includes(q));
        const snippet = idx >= 0 ? lines[idx].slice(0, 200) : "";
        results.push({
          id: results.length + 1,
          rowid: results.length + 1,
          date: file.replace(".md", ""),
          snippet: snippet,
          rank: -results.length,
        });
      }
    }

    return results.slice(0, limit);
  }

  private _countAll(): number {
    try {
      return fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md")).length;
    } catch { return 0; }
  }
}
