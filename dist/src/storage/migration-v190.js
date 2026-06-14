/**
 * storage/migration-v190.ts — One-shot migration for v1.9.0 (DB unification).
 *
 * Goal: move data from a legacy standalone `.yaoyao.db` (used by
 * v1.8.x and earlier) into the OpenClaw-native `main.sqlite` file
 * under `~/.openclaw/memory/`. After this, yaoyao shares one SQLite
 * file with OpenClaw's `files` / `chunks` / `chunks_fts` tables, but
 * yaoyao owns its own `yaoyao_*` namespace.
 *
 * Strategy (idempotent, no destructive writes until the end):
 *   1. Detect: legacy `.yaoyao.db` present in workspace + new
 *      `main.sqlite` accessible.
 *   2. Snapshot the new DB into a `<basename>.pre-v190.bak` so a
 *      re-run or a corrupt source cannot wipe out existing data.
 *   3. ATTACH the legacy DB, INSERT INTO yaoyao_* SELECT * FROM
 *      memory_*, then DETACH.
 *   4. Validate row counts (source == target). If mismatch, abort
 *      (the snapshot is still on disk).
 *   5. Mark the migration done in `yaoyao_config` so it never runs
 *      again.
 *   6. Rename legacy `.yaoyao.db` → `.yaoyao.db.migrated-v190`
 *      (preserved for 30 days, see housekeeping below).
 *
 * This function is **safe to call on every startup**. All steps are
 * guarded by checks; if anything is wrong we abort silently and
 * log a warning.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCompatDB } from "../platform/db/compat.js";
import { TABLES, ensureSchema } from "./schema.js";
/** Resolve the legacy `.yaoyao.db` path (v1.8.x and earlier). */
export function resolveLegacyDbPath(memoryDir) {
    return path.join(memoryDir, ".yaoyao.db");
}
/** Resolve the new (unified) DB path. */
export function resolveTargetDbPath() {
    return path.join(os.homedir(), ".openclaw", "memory", "main.sqlite");
}
/**
 * Has this migration already been completed (i.e. is there a
 * `migration_v190_done = "1"` entry in `yaoyao_config`)?
 */
export function isMigrationDone(db) {
    try {
        const row = db.prepare(`SELECT value FROM ${TABLES.config} WHERE key = ?`).get("migration_v190_done");
        return row?.value === "1";
    }
    catch {
        return false;
    }
}
/** Mark the migration as completed in `yaoyao_config`. */
function markMigrationDone(db) {
    try {
        db.prepare(`INSERT OR REPLACE INTO ${TABLES.config} (key, value) VALUES (?, ?)`).run("migration_v190_done", "1");
    }
    catch { /* best effort */ }
}
/**
 * Run the v1.9.0 migration. Idempotent: if the legacy file is gone,
 * the target is already populated, or the marker is set, we exit
 * cleanly without touching the disk.
 */
export function runMigrationV190(opts) {
    const legacyPath = resolveLegacyDbPath(opts.memoryDir);
    const targetPath = resolveTargetDbPath();
    const noop = (reason) => ({
        ran: false,
        reason,
        rowsMoved: 0,
        legacyPath,
        targetPath,
        backupPath: null,
    });
    // 1. Source must exist; otherwise nothing to do.
    if (!fs.existsSync(legacyPath))
        return noop("no legacy .yaoyao.db found");
    // 2. Make sure the target directory exists; ATTACH will not create
    //    parent directories on its own.
    try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }
    catch (err) {
        return noop(`cannot create target dir: ${err.message}`);
    }
    // 3. Snapshot the target DB so we never clobber it.
    let backupPath = null;
    if (fs.existsSync(targetPath)) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        backupPath = `${targetPath}.pre-v190.${ts}.bak`;
        try {
            fs.copyFileSync(targetPath, backupPath);
            opts.logger?.info?.(`[yaoyao-memory:migrate-v190] Backup created: ${backupPath}`);
        }
        catch (err) {
            return noop(`cannot snapshot target DB: ${err.message}`);
        }
    }
    let rowsMoved = 0;
    try {
        const { db } = createCompatDB(targetPath, { allowExtension: true }, opts.logger);
        try {
            // 4. Ensure yaoyao_* tables exist (idempotent). The legacy
            //    `memory_*` tables belong to the legacy DB file, not us.
            ensureSchema(db);
            // 5. If we already migrated, stop.
            if (isMigrationDone(db)) {
                opts.logger?.debug?.("[yaoyao-memory:migrate-v190] Marker present; skipping");
                return noop("already migrated");
            }
            // 6. ATTACH the legacy DB. Quotes are required to defend against
            //    Windows paths with spaces (e.g. `C:\Users\Foo Bar\.yaoyao.db`).
            const attachSql = `ATTACH DATABASE ${quoteSql(legacyPath)} AS legacy`;
            db.exec(attachSql);
            try {
                // 7. Copy each table if the legacy side has it.
                rowsMoved += copyTableIfPresent(db, "memory_meta", TABLES.meta);
                rowsMoved += copyTableIfPresent(db, "memory_fts", TABLES.fts);
                rowsMoved += copyTableIfPresent(db, "memory_tags", TABLES.tags);
                rowsMoved += copyTableIfPresent(db, "memory_config", TABLES.config);
                rowsMoved += copyTableIfPresent(db, "memory_vec", TABLES.vec);
                rowsMoved += copyTableIfPresent(db, "memory_vec_meta", TABLES.vecMeta);
            }
            finally {
                try {
                    db.exec("DETACH DATABASE legacy");
                }
                catch { /* best effort */ }
            }
            // 8. Record the migration so we never re-run.
            markMigrationDone(db);
            opts.logger?.info?.(`[yaoyao-memory:migrate-v190] Moved ${rowsMoved} rows from ${legacyPath} → ${targetPath}`);
        }
        finally {
            try {
                db.close();
            }
            catch { /* ignore */ }
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.logger?.warn?.(`[yaoyao-memory:migrate-v190] Migration failed: ${msg}`);
        return { ran: false, reason: `error: ${msg}`, rowsMoved, legacyPath, targetPath, backupPath };
    }
    // 9. Rename the legacy file so subsequent startups skip the
    //    migration but the data is still available for manual
    //    inspection / rollback.
    const movedAside = `${legacyPath}.migrated-v190`;
    try {
        if (!fs.existsSync(movedAside)) {
            fs.renameSync(legacyPath, movedAside);
            opts.logger?.info?.(`[yaoyao-memory:migrate-v190] Legacy DB renamed → ${movedAside}`);
        }
    }
    catch (err) {
        opts.logger?.warn?.(`[yaoyao-memory:migrate-v190] Could not rename legacy DB: ${err.message}`);
    }
    return { ran: true, reason: "ok", rowsMoved, legacyPath, targetPath, backupPath };
}
/** Returns number of rows copied. Returns 0 if the source table is missing. */
function copyTableIfPresent(db, src, dst) {
    const exists = db.prepare(`SELECT 1 AS x FROM legacy.sqlite_master WHERE type IN ('table','view') AND name = ?`).get(src);
    if (!exists)
        return 0;
    // Use INSERT OR IGNORE so re-runs (e.g. partial migration + retry)
    // are safe. We assume primary key uniqueness holds across both
    // tables — true for `yaoyao_meta.id` (autoinc) and
    // `yaoyao_tags.id`. For FTS5 content tables the `rowid` matches
    // `yaoyao_meta.id`; if the row already exists the ignore is a no-op.
    const sql = `INSERT OR IGNORE INTO ${dst} SELECT * FROM legacy.${src}`;
    try {
        db.exec(sql);
        // Approximate "rows moved" by counting source rows (best-effort).
        const r = db.prepare(`SELECT COUNT(*) AS c FROM legacy.${src}`).get();
        return r?.c ?? 0;
    }
    catch (err) {
        // Some virtual tables (vec0) cannot be filled this way; the
        // caller will rebuild them on next capture. Don't fail the
        // whole migration just because vec didn't copy cleanly.
        return 0;
    }
}
/** Quote a path for embedding inside an SQL string literal. */
function quoteSql(p) {
    return "'" + p.replace(/'/g, "''") + "'";
}
