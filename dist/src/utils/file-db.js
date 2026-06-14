/**
 * utils/vector/file-db.ts — Pure filesystem fallback database.
 *
 * Used when neither node:sqlite (Node 22+) nor better-sqlite3 is available.
 * Persists data as daily .md files + a lightweight JSON index.
 */
import fs from "node:fs";
import path from "node:path";
/**
 * FileDB — zero-dependency fallback that stores memory entries as
 * daily markdown files in a base directory, with a JSON index for fast
 * date-based lookups.
 */
export class FileDB {
    baseDir;
    indexPath;
    index;
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.indexPath = path.join(baseDir, ".yaoyao-index.json");
        this.index = new Map();
        this._loadIndex();
    }
    _loadIndex() {
        try {
            if (fs.existsSync(this.indexPath)) {
                let raw;
                try {
                    raw = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
                }
                catch {
                    raw = {};
                }
                for (const [k, v] of Object.entries(raw)) {
                    this.index.set(k, v);
                }
            }
        }
        catch { /* ignore corrupt index */ }
    }
    _saveIndex() {
        try {
            const obj = {};
            for (const [k, v] of this.index)
                obj[k] = v;
            fs.writeFileSync(this.indexPath, JSON.stringify(obj), "utf-8");
        }
        catch { /* best effort */ }
    }
    exec(_sql) {
        // No-op for file-db; schema is implicit
    }
    prepare(sql) {
        const lowered = sql.toLowerCase().trim();
        if (lowered.startsWith("insert into yaoyao_meta")) {
            return {
                run: (...args) => {
                    const date = args[0];
                    const userText = args[1];
                    const asstText = args[2];
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
                all: (...args) => this._search(args[0], args[1]),
                get: () => undefined,
            };
        }
        if (lowered.includes("count(*)")) {
            const count = this._countAll();
            return {
                run: () => ({ changes: 0 }),
                all: () => [{ c: count }],
                get: () => ({ c: count }),
            };
        }
        if (lowered.startsWith("delete from yaoyao_meta")) {
            return {
                run: (...args) => {
                    const date = args[0];
                    const file = path.join(this.baseDir, `${date}.md`);
                    try {
                        fs.unlinkSync(file);
                    }
                    catch { /* */ }
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
                all: () => [{ journal_mode: "delete" }],
                get: () => ({ journal_mode: "delete" }),
            };
        }
        return {
            run: () => ({ changes: 0 }),
            all: () => [],
            get: () => undefined,
        };
    }
    close() {
        this._saveIndex();
    }
    enableLoadExtension() {
        // Not supported in file-db
    }
    // ── FileDB search implementation ──
    _search(query, limit) {
        const results = [];
        let files;
        try {
            files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
        }
        catch {
            files = [];
        }
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
    _countAll() {
        try {
            return fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md")).length;
        }
        catch {
            return 0;
        }
    }
}
