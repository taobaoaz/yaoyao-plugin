/**
 * platform/db/compat.ts — Automatic database backend selection with cascade fallback.
 *
 * Tries (in order, with failure recovery at each step):
 *   1. node:sqlite      — Node 22+ built-in
 *   2. better-sqlite3   — npm package (Node 18/20)
 *   3. file-db          — pure filesystem fallback
 *
 * Hardening:
 *   - If a backend is "available" but fails to open (read-only fs, corrupt DB, locked file),
 *     we catch the failure and cascade to the next backend instead of crashing.
 *   - This prevents a single bad SQLite file from bricking the entire plugin.
 *
 * All callers use UnifiedDB from ./types.ts
 */
import { createNativeDB, isNativeAvailable } from "./native.js";
import { createNpmDB, isNpmAvailable } from "./npm.js";
import { createFileDB } from "./file.js";
export function createCompatDB(dbPath, config, logger) {
    // ── 1. Try node:sqlite ──
    if (isNativeAvailable()) {
        const db = createNativeDB(dbPath, config?.allowExtension ?? true);
        if (db) {
            logger?.info?.('[yaoyao-memory:db] Using node:sqlite (Node 22+)');
            return {
                db,
                backend: 'node-sqlite',
                supportsFTS5: true,
                supportsWAL: true,
                supportsExtensions: true,
            };
        }
        logger?.warn?.('[yaoyao-memory:db] node:sqlite available but failed to open DB, trying better-sqlite3');
    }
    // ── 2. Try better-sqlite3 ──
    if (isNpmAvailable()) {
        const db = createNpmDB(dbPath);
        if (db) {
            logger?.info?.('[yaoyao-memory:db] Using better-sqlite3 (npm)');
            return {
                db,
                backend: 'better-sqlite3',
                supportsFTS5: true,
                supportsWAL: true,
                supportsExtensions: false,
            };
        }
        logger?.warn?.('[yaoyao-memory:db] better-sqlite3 available but failed to open DB, falling back to file-db');
    }
    // ── 3. Pure filesystem fallback ──
    logger?.warn?.('[yaoyao-memory:db] No SQLite backend could open the database. Using file-db (read-only memory index).');
    return {
        db: createFileDB(dbPath),
        backend: 'file-db',
        supportsFTS5: false,
        supportsWAL: false,
        supportsExtensions: false,
    };
}
export function getDBCapability() {
    const node = isNativeAvailable();
    const npm = isNpmAvailable();
    const backend = node ? 'node-sqlite' : npm ? 'better-sqlite3' : 'unknown';
    return { backend, nodeSqliteAvailable: node, betterSqlite3Available: npm };
}
