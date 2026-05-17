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
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB cap per file
export class FileDB {
    baseDir;
    indexPath;
    index; // date -> [filenames]
    constructor(baseDir) {
        this.baseDir = baseDir;
        // Build a simple in-memory index from existing files
        this.indexPath = path.join(baseDir, ".filedb_index.json");
        this.index = new Map();
        try {
            if (fs.existsSync(this.indexPath)) {
                const raw = fs.readFileSync(this.indexPath, "utf-8");
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                }
                catch {
                    parsed = {};
                }
                for (const [k, v] of Object.entries(parsed)) {
                    if (Array.isArray(v))
                        this.index.set(k, v);
                }
            }
        }
        catch { /* ignore corrupt index */ }
        try {
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }
        }
        catch { /* best effort */ }
    }
    exec(_sql) { }
    prepare(sql) {
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
                all: (...args) => {
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
                        return this._search(args[0] || "", limit);
                    }
                    catch {
                        return [];
                    }
                },
                get: (...args) => {
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
                        const rows = this._search(args[0] || "", 1);
                        return rows[0];
                    }
                    catch {
                        return undefined;
                    }
                },
            };
        }
        // ── DELETE FROM memory_meta ──
        if (lower.startsWith("delete")) {
            const dateMatch = lower.match(/date\s*=\s*\?/);
            return {
                run: (...args) => {
                    try {
                        if (dateMatch && args.length > 0) {
                            const filePath = path.join(this.baseDir, `${String(args[0])}.md`);
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                                return { lastInsertRowid: 0, changes: 1 };
                            }
                        }
                        return { lastInsertRowid: 0, changes: 0 };
                    }
                    catch {
                        return { lastInsertRowid: 0, changes: 0 };
                    }
                },
                all: () => [],
                get: () => undefined,
            };
        }
        // ── INSERT ──
        if (lower.startsWith("insert")) {
            return {
                run: (...args) => {
                    try {
                        const date = String(args[0] || "");
                        const text = String(args[1] || "");
                        const filePath = path.join(this.baseDir, `${date}.md`);
                        fs.appendFileSync(filePath, text + "\n");
                        return { lastInsertRowid: 1, changes: 1 };
                    }
                    catch {
                        return { lastInsertRowid: 0, changes: 0 };
                    }
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
    close() { }
    // ── FileDB search implementation ──
    _search(query, limit) {
        const results = [];
        let files;
        try {
            files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
        }
        catch {
            return [];
        }
        const q = query.toLowerCase();
        for (const file of files) {
            const filePath = path.join(this.baseDir, file);
            let content;
            try {
                const stat = fs.statSync(filePath);
                if (stat.size > MAX_FILE_BYTES)
                    continue; // skip massive files
                content = fs.readFileSync(filePath, "utf-8");
            }
            catch {
                continue;
            }
            if (content.toLowerCase().includes(q)) {
                const lines = content.split("\n");
                const idx = lines.findIndex(l => l.toLowerCase().includes(q));
                const snippet = idx >= 0 ? lines[idx].slice(0, 200) : "";
                results.push({
                    id: results.length + 1,
                    rowid: results.length + 1,
                    date: file.replace(".md", ""),
                    snippet: snippet,
                    rank: -results.length, // pseudo-rank
                });
            }
        }
        return results.slice(0, limit);
    }
    _listAll(limit) {
        let files;
        try {
            files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
        }
        catch {
            return [];
        }
        return files.slice(0, limit).map(f => ({
            rowid: f,
            date: f.replace(".md", ""),
            snippet: "",
            user_text: "",
            asst_text: "",
        }));
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
export function createFileDB(dbPath) {
    const baseDir = path.dirname(dbPath);
    try {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    catch { /* best effort — caller may have read-only fs */ }
    return new FileDB(baseDir);
}
