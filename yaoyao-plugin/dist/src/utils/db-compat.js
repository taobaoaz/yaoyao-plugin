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
import { FileDB } from "./file-db.js";
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
