/**
 * DB Compatibility Layer — automatic SQLite implementation selection.
 *
 * Tries (in order):
 *   1. node:sqlite      — Node 22+ built-in, zero deps
 *   2. better-sqlite3   — npm package, works on Node 18/20
 *   3. file-db fallback — pure filesystem, zero deps, works everywhere
 *
 * All callers use the UnifiedDB interface; they never touch node:sqlite directly.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
// ── Backend Detection ──
function detectBackend(logger) {
    try {
        const _require = createRequire(import.meta.url);
        _require("node:sqlite");
        logger?.info?.("[yaoyao-memory:db-compat] Using node:sqlite (Node 22+)");
        return "node-sqlite";
    }
    catch { /* fall through */ }
    try {
        const _require = createRequire(import.meta.url);
        _require("better-sqlite3");
        logger?.info?.("[yaoyao-memory:db-compat] Using better-sqlite3 (npm)");
        return "better-sqlite3";
    }
    catch { /* fall through */ }
    logger?.warn?.("[yaoyao-memory:db-compat] No SQLite available, falling back to file-db (pure filesystem mode)");
    return "file-db";
}
// ── Node:sqlite Wrapper ──
function wrapNodeSqlite(rawDb) {
    return {
        exec(sql) { rawDb.exec(sql); },
        prepare(sql) {
            const stmt = rawDb.prepare(sql);
            return {
                run(...args) { return stmt.run(...args); },
                all(...args) { return stmt.all(...args); },
                get(...args) { return stmt.get(...args); },
            };
        },
        close() { rawDb.close(); },
        enableLoadExtension(enabled) { rawDb.enableLoadExtension?.(enabled); },
        _raw: rawDb,
    };
}
// ── Better-sqlite3 Wrapper ──
function wrapBetterSqlite3(rawDb) {
    return {
        exec(sql) { rawDb.exec(sql); },
        prepare(sql) {
            const stmt = rawDb.prepare(sql);
            return {
                run(...args) { return stmt.run(...args); },
                all(...args) { return stmt.all(...args); },
                get(...args) { return stmt.get(...args); },
            };
        },
        close() { rawDb.close(); },
        _raw: rawDb,
    };
}
// ── FileDB (pure filesystem fallback) ──
class FileDB {
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
                const raw = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
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
        if (lowered.startsWith("insert into memory_meta")) {
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
        if (lowered.includes("from memory_fts") && lowered.includes("match")) {
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
        if (lowered.startsWith("delete from memory_meta")) {
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
        const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
        const q = query.toLowerCase();
        for (const file of files) {
            const filePath = path.join(this.baseDir, file);
            const content = fs.readFileSync(filePath, "utf-8");
            if (content.toLowerCase().includes(q)) {
                const lines = content.split("\n");
                const idx = lines.findIndex(l => l.toLowerCase().includes(q));
                const snippet = idx >= 0 ? lines[idx].slice(0, 200) : "";
                results.push({
                    rowid: filePath,
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
// ── Factory ──
export function createCompatDB(dbPath, config, logger) {
    const backend = detectBackend(logger);
    switch (backend) {
        case "node-sqlite": {
            const _require = createRequire(import.meta.url);
            const { DatabaseSync } = _require("node:sqlite");
            const rawDb = new DatabaseSync(dbPath, { allowExtension: config?.allowExtension ?? true });
            return {
                db: wrapNodeSqlite(rawDb),
                backend,
                supportsFTS5: true,
                supportsWAL: true,
                supportsExtensions: true,
            };
        }
        case "better-sqlite3": {
            const _require = createRequire(import.meta.url);
            const Database = _require("better-sqlite3");
            const rawDb = new Database(dbPath);
            return {
                db: wrapBetterSqlite3(rawDb),
                backend,
                supportsFTS5: true,
                supportsWAL: true,
                supportsExtensions: false,
            };
        }
        case "file-db": {
            const baseDir = path.dirname(dbPath);
            fs.mkdirSync(baseDir, { recursive: true });
            const db = new FileDB(baseDir);
            return {
                db,
                backend,
                supportsFTS5: false,
                supportsWAL: false,
                supportsExtensions: false,
            };
        }
    }
}
/** Report current DB capability for healthcheck/install-check */
export function getDBCapability() {
    let nodeSqlite = false;
    let betterSqlite3 = false;
    try {
        const _require = createRequire(import.meta.url);
        _require("node:sqlite");
        nodeSqlite = true;
    }
    catch { /* */ }
    try {
        const _require = createRequire(import.meta.url);
        _require("better-sqlite3");
        betterSqlite3 = true;
    }
    catch { /* */ }
    const backend = nodeSqlite ? "node-sqlite" : betterSqlite3 ? "better-sqlite3" : "unknown";
    return { backend, nodeSqliteAvailable: nodeSqlite, betterSqlite3Available: betterSqlite3 };
}
