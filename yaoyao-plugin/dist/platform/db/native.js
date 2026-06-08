/**
 * platform/db/native.ts — Node 22+ built-in node:sqlite wrapper.
 *
 * Hardening:
 *   - Constructor wrapped in try/catch for read-only fs / corrupt DB
 *   - Returns null on failure so compat.ts can cascade to next backend
 */
import { createRequire } from 'node:module';
export function createNativeDB(dbPath, allowExtension = true) {
    try {
        const _require = createRequire(import.meta.url);
        const { DatabaseSync } = _require('node:sqlite');
        const rawDb = new DatabaseSync(dbPath, { allowExtension });
        return {
            exec(sql) {
                rawDb.exec(sql);
            },
            prepare(sql) {
                const stmt = rawDb.prepare(sql);
                return {
                    run(...args) {
                        const result = stmt.run(...args);
                        return { lastInsertRowid: result?.lastInsertRowid, changes: result?.changes };
                    },
                    all(...args) {
                        return stmt.all(...args);
                    },
                    get(...args) {
                        return stmt.get(...args);
                    },
                };
            },
            close() {
                rawDb.close();
            },
            enableLoadExtension(enabled) {
                rawDb.enableLoadExtension(enabled);
            },
            _raw: rawDb,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:db] Native DB init failed: ${msg}`);
        return null;
    }
}
export function isNativeAvailable() {
    try {
        const _require = createRequire(import.meta.url);
        _require('node:sqlite');
        return true;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:db] Native check failed: ${msg}`);
        return false;
    }
}
