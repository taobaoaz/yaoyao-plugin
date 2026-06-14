/**
 * core/boot/md-sync.ts — Bootstrap-time .md → SQLite FTS5 sync.
 *
 * Problem: yaoyao has dual storage (L0 .md files + L1 SQLite FTS5).
 * Auto-capture writes both on every turn, but if the SQLite db is ever
 * rebuilt / migrated / lost, the existing .md files are invisible to search.
 *
 * Solution: on startup (background, non-blocking), scan .md files and
 * index any turns that are missing from SQLite.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const TURN_RE = /^###\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*\n\*\*User:\*\*\s*(.+?)\n\*\*AI:\*\*\s*(.+?)(?:\n|$)/gm;
/** Parse turns from a daily markdown file. */
export function parseMdTurns(content) {
    const turns = [];
    let m;
    // Reset lastIndex in case the same regex instance is reused
    TURN_RE.lastIndex = 0;
    while ((m = TURN_RE.exec(content)) !== null) {
        const [_, dt, userText, asstText] = m;
        const date = dt.slice(0, 10);
        const time = dt.slice(11, 19);
        turns.push({ date, time, userText: userText.trim(), asstText: asstText.trim() });
    }
    return turns;
}
/** Check whether a turn (by date + userText hash) already exists in SQLite. */
function existsInDb(db, date, userPrefix) {
    try {
        const rawDb = db.getRawDb();
        const prefix = userPrefix.slice(0, 60);
        const stmt = rawDb.prepare("SELECT 1 FROM yaoyao_meta WHERE date = ? AND user_text LIKE ? LIMIT 1");
        const row = stmt.get(date, `${prefix}%`);
        return row !== undefined;
    }
    catch {
        return false;
    }
}
/** Index a single parsed turn into SQLite (idempotent best-effort). */
function indexTurn(db, turn) {
    try {
        return db.indexTurn(turn.userText, turn.asstText, turn.date);
    }
    catch {
        return -1;
    }
}
/**
 * Sync all .md files in a directory into SQLite FTS5.
 *
 * Strategy:
 *   1. Skip if SQLite already has records (assume dual-write was consistent).
 *   2. If SQLite is empty → bulk-import all turns from every .md file.
 *   3. If SQLite has some records → import only turns whose (date, user prefix)
 *      don't already exist (lightweight check, no full-text scan).
 */
export function syncMarkdownToFTS(memoryDir, db, logger) {
    const stats = { imported: 0, skipped: 0, errors: 0 };
    try {
        if (!existsSync(memoryDir))
            return stats;
        // Decide strategy based on existing SQLite record count
        let dbRecordCount = 0;
        let dbReadFailed = false;
        try {
            const rawDb = db.getRawDb();
            const countRow = rawDb.prepare("SELECT COUNT(*) as c FROM yaoyao_meta").get();
            dbRecordCount = countRow?.c ?? 0;
        }
        catch (err) {
            // If we can't read the db, DON'T silently fall through to bulk-import.
            // That path would re-import every .md file we have, which is a silent
            // data hazard if the DB is locked or corrupt. Abort and let the user
            // investigate instead.
            dbReadFailed = true;
            logger?.warn?.(`[yaoyao-memory:md-sync] Could not read DB row count: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (dbReadFailed) {
            logger?.warn?.("[yaoyao-memory:md-sync] DB read failed — aborting sync to avoid silent bulk-import. " +
                ".md files remain source of truth; SQLite may be locked or corrupt.");
            stats.errors++;
            return stats;
        }
        const isBulkImport = dbRecordCount === 0;
        if (isBulkImport) {
            logger?.info?.("[yaoyao-memory:md-sync] SQLite empty → bulk-importing all .md files");
        }
        else {
            logger?.debug?.("[yaoyao-memory:md-sync] SQLite has records → selective import of missing turns");
        }
        const files = readdirSync(memoryDir).filter(f => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}/.test(f));
        if (files.length === 0) {
            logger?.debug?.("[yaoyao-memory:md-sync] No daily .md files found");
            return stats;
        }
        for (const file of files) {
            try {
                const content = readFileSync(join(memoryDir, file), "utf-8");
                const turns = parseMdTurns(content);
                if (turns.length === 0)
                    continue;
                for (const turn of turns) {
                    if (isBulkImport) {
                        const rowId = indexTurn(db, turn);
                        if (rowId > 0)
                            stats.imported++;
                        else
                            stats.errors++;
                    }
                    else {
                        // Selective: check existence by date + user prefix
                        if (existsInDb(db, turn.date, turn.userText)) {
                            stats.skipped++;
                        }
                        else {
                            const rowId = indexTurn(db, turn);
                            if (rowId > 0)
                                stats.imported++;
                            else
                                stats.errors++;
                        }
                    }
                }
            }
            catch (e) {
                logger?.warn?.(`[yaoyao-memory:md-sync] Failed to process ${file}: ${e instanceof Error ? e.message : String(e)}`);
                stats.errors++;
            }
        }
        if (stats.imported > 0) {
            logger?.info?.(`[yaoyao-memory:md-sync] Done: ${stats.imported} imported, ${stats.skipped} skipped, ${stats.errors} errors`);
        }
    }
    catch (e) {
        logger?.warn?.(`[yaoyao-memory:md-sync] Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return stats;
}
