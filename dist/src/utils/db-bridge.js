/**
 * SQLite database layer — FTS5 + sqlite-vec vector search.
 *
 * Uses native Node 22 node:sqlite + sqlite-vec npm package for vector search.
 *
 * Stores both FTS5 index and vector embeddings in a single .yaoyao.db file.
 */
import { getProp } from "./config.js";
import { clampNum } from "./clamp.js";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
const _require = createRequire(import.meta.url);
// ──────────────────────────── Helpers ────────────────────────────
/** Compute a normalized score from FTS5 rank (negative = better) */
function computeScore(rank) {
    if (rank < 0) {
        return Math.min(1, Math.max(0.1, -rank / 15));
    }
    return 0.3;
}
// ──────────────────────────── DB Bridge ────────────────────────────
export function createDB(config, logger) {
    const baseDir = config.memoryDir || path.join(os.homedir(), ".openclaw", "workspace", "memory");
    const dbPath = path.join(baseDir, ".yaoyao.db");
    let vecEnabled = false;
    // Configurable limits (not hardcoded)
    const snippetMaxLen = clampNum(getProp(config, "snippetMaxLen", 500), 500, 100, 5000);
    const searchMaxLimit = clampNum(getProp(config, "searchMaxLimit", 100), 100, 10, 1000);
    const likeFallbackScore = clampNum(getProp(config, "likeFallbackScore", 0.5), 0.5, 0.1, 1);
    const log = (msg) => logger?.debug?.(`[yaoyao-memory:db] ${msg}`);
    let db = null;
    let initFailed = false; // fail-fast guard: once init fails, skip retries
    /** Initialize database — create tables if not exist */
    function init() {
        try {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
            const { DatabaseSync } = _require("node:sqlite");
            db = new DatabaseSync(dbPath, { allowExtension: true });
            // Handle stale WAL/shm files from previous crash
            try {
                db.exec("PRAGMA journal_mode = WAL");
            }
            catch (e) {
                // disk I/O error → stale WAL files, clean up and retry
                if (e.message?.includes("disk I/O")) {
                    log("Stale WAL files detected, cleaning up");
                    try {
                        db.close();
                    }
                    catch { /* ignore */ }
                    db = null;
                    // Remove only WAL journal files that may be corrupt (not the main db)
                    for (const ext of ["-wal", "-shm"]) {
                        try {
                            fs.unlinkSync(dbPath + ext);
                        }
                        catch { /* ignore */ }
                    }
                    db = new DatabaseSync(dbPath, { allowExtension: true });
                    db.exec("PRAGMA journal_mode = WAL");
                }
                else {
                    throw e;
                }
            }
            db.exec("PRAGMA busy_timeout = 5000");
            db.exec("PRAGMA cache_size = -65536");
            // FTS5 table for full-text search
            db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
                "date, user_text, asst_text, " +
                "tokenize='unicode61'" +
                ")");
            // Metadata table for L1 memories
            db.exec("CREATE TABLE IF NOT EXISTS memory_meta (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "date TEXT NOT NULL, " +
                "user_text TEXT, " +
                "asst_text TEXT, " +
                "created_at TEXT DEFAULT (datetime('now'))" +
                ")");
            // Vector search table (sqlite-vec)
            vecEnabled = false;
            const dimensions = config.embedding?.dimensions ?? 1024;
            try {
                const sqliteVec = _require("sqlite-vec");
                db.enableLoadExtension(true);
                sqliteVec.load(db);
                vecEnabled = true;
                db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(" +
                    `embedding float[${dimensions}]` +
                    ")");
                db.exec("CREATE TABLE IF NOT EXISTS memory_vec_meta (" +
                    "id INTEGER PRIMARY KEY, " +
                    "meta_id INTEGER, " +
                    "model TEXT, " +
                    `dimensions INTEGER DEFAULT ${dimensions}, ` +
                    "created_at TEXT DEFAULT (datetime('now'))" +
                    ")");
                log("sqlite-vec loaded successfully");
            }
            catch (e) {
                log(`sqlite-vec not available: ${e.message}`);
                vecEnabled = false;
            }
            log(`DB initialized: ${dbPath} (vec=${vecEnabled})`);
            return true;
        }
        catch (err) {
            logger?.error?.(`[yaoyao-memory:db] Init failed: ${err.message}`);
            initFailed = true;
            return false;
        }
    }
    /** Ensure DB is initialized */
    function ensureDB() {
        if (!db && !initFailed) {
            init();
        }
        if (!db) {
            throw new Error("Database failed to initialize");
        }
        return db;
    }
    /** Index a conversation turn in FTS5. Returns the row id (>0) or -1 on failure. */
    function indexTurn(userText, asstText, date) {
        try {
            const d = ensureDB();
            const stmt = d.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
            const result = stmt.run(date, userText.slice(0, snippetMaxLen), asstText.slice(0, snippetMaxLen));
            const rowId = Number(result.lastInsertRowid);
            const stmt2 = d.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
            stmt2.run(rowId, date, userText.slice(0, snippetMaxLen), asstText.slice(0, snippetMaxLen));
            return rowId;
        }
        catch (err) {
            log(`indexTurn error: ${err.message}`);
            return -1;
        }
    }
    /** Sanitize query string for FTS5 MATCH syntax.
     * Removes characters that can cause FTS5 syntax errors while keeping search terms readable.
     */
    function sanitizeFTSQuery(query) {
        // FTS5 special chars that cause syntax errors if unescaped:
        //   "  - unmatched quote → syntax error
        //   *  - prefix operator in wrong position → syntax error
        //   ^  - anchor operator → syntax error on partial match
        //   `  - escape char → syntax error
        //   () - grouping → syntax error when unbalanced
        //   ~  - NEAR operator → requires number param, causes error
        // Remove all of them; keep + (AND sign) and - (exclusion) as they're safe standalone.
        const s = query
            .replace(/["*^`()~]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200);
        if (!s)
            return "";
        return s;
    }
    /** FTS5 full-text search + LIKE fallback for Chinese (FTS5 unicode61 tokenizer doesn't segment CJK) */
    function search(query, limit = 10) {
        try {
            const d = ensureDB();
            const safeQuery = sanitizeFTSQuery(query);
            // Empty query → skip FTS5 (which errors on empty MATCH) and go straight to LIKE
            if (!safeQuery) {
                return searchAll(limit);
            }
            // Try FTS5 first
            const stmt = d.prepare("SELECT date, user_text, asst_text, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
                "FROM memory_fts WHERE memory_fts MATCH ? " +
                "ORDER BY rank LIMIT ?");
            const rows = stmt.all(safeQuery, Math.min(Math.max(limit, 1), searchMaxLimit));
            // FTS5 returns results, use them
            if (rows.length > 0) {
                return rows.map(row => ({
                    filename: row.date ? `${row.date}.md` : "memory.db",
                    snippet: (row.snippet || "").slice(0, snippetMaxLen),
                    score: computeScore(row.rank),
                    date: row.date || "",
                    asst_text: (row.asst_text || "").slice(0, snippetMaxLen),
                }));
            }
            // ── FTS5 returned nothing → try LIKE fallback for CJK text ──
            // FTS5 unicode61 tokenizer treats each Chinese character as a separate token,
            // so multi-character words like "天气" or "今天" fail to match.
            // LIKE is character-based and handles CJK correctly.
            const likeQuery = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
            const likeStmt = d.prepare("SELECT id, date, user_text, asst_text FROM memory_meta " +
                "WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\' " +
                "ORDER BY id DESC LIMIT ?");
            const likeRows = likeStmt.all(likeQuery, likeQuery, Math.min(Math.max(limit, 1), searchMaxLimit));
            if (likeRows.length > 0) {
                log(`FTS5 miss → LIKE fallback found ${likeRows.length} results for "${query.slice(0, 30)}"`);
                return likeRows.map(row => ({
                    filename: row.date ? `${row.date}.md` : "memory.db",
                    snippet: `${row.user_text || ""} ${row.asst_text || ""}`.trim().slice(0, snippetMaxLen),
                    score: likeFallbackScore,
                    date: row.date || "",
                    asst_text: (row.asst_text || "").slice(0, snippetMaxLen),
                }));
            }
            // Empty across the board
            return [];
        }
        catch (err) {
            log(`search error: ${err.message}`);
            return [];
        }
    }
    /** Full-scan search (no FTS, no LIKE filtering — returns latest entries). Used when query is empty. */
    function searchAll(limit) {
        try {
            const d = ensureDB();
            const rows = d.prepare("SELECT date, user_text, asst_text FROM memory_meta ORDER BY id DESC LIMIT ?").all(Math.min(Math.max(limit, 1), searchMaxLimit));
            return rows.map(r => ({
                filename: r.date ? `${r.date}.md` : "memory.db",
                snippet: (r.user_text || r.asst_text || "").slice(0, snippetMaxLen),
                score: 1.0,
                date: r.date || "",
                asst_text: (r.asst_text || "").slice(0, snippetMaxLen),
            }));
        }
        catch {
            return [];
        }
    }
    /** Vector similarity search via sqlite-vec */
    function vectorSearch(embedding, limit = 10) {
        try {
            const d = ensureDB();
            const jsonArr = "[" + Array.from(embedding).join(",") + "]";
            const stmt = d.prepare("SELECT v.rowid, m.date, m.user_text, m.asst_text, v.distance " +
                "FROM memory_vec v " +
                "JOIN memory_meta m ON v.rowid = m.id " +
                "WHERE v.embedding MATCH ? AND k = ?");
            const rows = stmt.all(jsonArr, Math.min(Math.max(limit, 1), searchMaxLimit));
            return rows.map(row => {
                // vec0 uses L2 distance by default. Convert to cosine similarity:
                // For unit-normalized vectors: cosine ≈ 1 - (L2^2 / 2)
                // Using normalized L2-to-similarity mapping:
                const cosineSim = 1 - (row.distance || 0) / 2;
                const snippet = `${row.user_text || ""} ${row.asst_text || ""}`.trim();
                return {
                    filename: row.date ? `${row.date}.md` : "memory.db",
                    snippet: snippet.slice(0, snippetMaxLen),
                    score: Math.max(0, cosineSim),
                    date: row.date || "",
                    asst_text: (row.asst_text || "").slice(0, snippetMaxLen),
                    vectorScore: Math.max(0, cosineSim),
                    hybridScore: Math.max(0, cosineSim),
                };
            });
        }
        catch (err) {
            log(`vectorSearch error: ${err.message}`);
            return [];
        }
    }
    /** Hybrid search: FTS5 + vector weighted combination */
    function hybridSearch(query, embedding, limit = 10) {
        const ftsResults = search(query, limit);
        if (!embedding || ftsResults.length === 0) {
            return ftsResults.map(r => ({
                ...r,
                vectorScore: 0,
                hybridScore: r.score * 0.6,
            }));
        }
        const vecResults = vectorSearch(embedding, limit);
        const merged = new Map();
        for (const r of ftsResults) {
            merged.set(`${r.date}|${r.snippet}`, {
                ...r,
                vectorScore: 0,
                hybridScore: r.score * 0.6,
            });
        }
        for (const r of vecResults) {
            const key = `${r.date}|${r.snippet}`;
            if (merged.has(key)) {
                const existing = merged.get(key);
                existing.vectorScore = r.vectorScore;
                existing.hybridScore = (existing.score * 0.6) + (r.vectorScore * 0.4);
            }
            else {
                merged.set(key, {
                    ...r,
                    score: r.vectorScore * 0.4,
                    hybridScore: r.vectorScore * 0.4,
                });
            }
        }
        return [...merged.values()]
            .sort((a, b) => b.hybridScore - a.hybridScore)
            .slice(0, limit);
    }
    /** Store a vector embedding for a memory record. Normalizes to unit length before storage. */
    function storeVector(metaId, embedding) {
        if (metaId <= 0)
            return false; // reject orphan vectors
        try {
            const d = ensureDB();
            // Normalize to unit length for correct cosine similarity from L2 distance
            let norm = 0;
            for (let i = 0; i < embedding.length; i++) {
                norm += embedding[i] * embedding[i];
            }
            norm = Math.sqrt(norm);
            const normalized = norm === 0
                ? new Float32Array(embedding.length) // zero vector for all-zero embeddings
                : new Float32Array(embedding.map(v => v / norm));
            const jsonArr = "[" + Array.from(normalized).join(",") + "]";
            // Wrap DELETE + INSERT in a transaction
            d.exec("BEGIN");
            try {
                d.prepare("DELETE FROM memory_vec WHERE rowid = ?").run(metaId);
                d.prepare("INSERT INTO memory_vec(rowid, embedding) VALUES(?, ?)").run(metaId, jsonArr);
                d.exec("COMMIT");
            }
            catch (txErr) {
                d.exec("ROLLBACK");
                throw txErr;
            }
            return true;
        }
        catch (err) {
            log(`storeVector error: ${err.message}`);
            return false;
        }
    }
    let pendingRebuild = false;
    let rebuildTimer = null;
    function scheduleRebuild() {
        if (pendingRebuild)
            return;
        pendingRebuild = true;
        if (rebuildTimer)
            clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
            try {
                ensureDB().exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
            }
            catch { /* best effort */ }
            pendingRebuild = false;
            rebuildTimer = null;
        }, 500);
    }
    /** Delete memory entries from FTS5 and meta tables by date */
    function deleteByDate(date) {
        try {
            const d = ensureDB();
            const metaResult = d.prepare("DELETE FROM memory_meta WHERE date = ?").run(date);
            const deleted = Number(metaResult.changes ?? 0);
            // Defer FTS5 rebuild to batch multiple deletions
            scheduleRebuild();
            // Clean up orphan vectors
            try {
                d.exec("DELETE FROM memory_vec WHERE rowid NOT IN (SELECT id FROM memory_meta)");
            }
            catch { /* best effort */ }
            log(`deleteByDate: ${deleted} entries removed for ${date}`);
            return deleted;
        }
        catch (err) {
            log(`deleteByDate error: ${err.message}`);
            return 0;
        }
    }
    /** Delete memory entries matching a like pattern from user_text or asst_text */
    function deleteByKeyword(keyword) {
        try {
            const d = ensureDB();
            const pattern = `%${keyword.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
            const result = d.prepare("DELETE FROM memory_meta WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\'").run(pattern, pattern);
            const deleted = Number(result.changes ?? 0);
            if (deleted > 0) {
                scheduleRebuild();
                try {
                    d.exec("DELETE FROM memory_vec WHERE rowid NOT IN (SELECT id FROM memory_meta)");
                }
                catch { /* best effort */ }
            }
            log(`deleteByKeyword: ${deleted} entries removed for "${keyword}"`);
            return deleted;
        }
        catch (err) {
            log(`deleteByKeyword error: ${err.message}`);
            return 0;
        }
    }
    /** Get database stats */
    function getStats() {
        try {
            const d = ensureDB();
            const totalCount = d.prepare("SELECT COUNT(*) as c FROM memory_meta").get();
            const total = totalCount?.c ?? 0;
            const datesRaw = d.prepare("SELECT date, COUNT(*) as c FROM memory_meta GROUP BY date ORDER BY date DESC LIMIT 10").all();
            let vecCount = 0;
            let dimensions = 0;
            try {
                const vecRow = d.prepare("SELECT COUNT(*) as c FROM memory_vec").get();
                vecCount = vecRow?.c ?? 0;
                // Try to read actual dimensions from vec_meta; fallback to config or 0 (unknown)
                const actualDim = d.prepare("SELECT dimensions FROM memory_vec_meta LIMIT 1").get();
                dimensions = actualDim?.dimensions ?? config.embedding?.dimensions ?? 0;
            }
            catch {
                // vec table may not exist
            }
            return {
                totalMemories: total,
                datesSummary: datesRaw.map(r => ({ date: r.date, count: r.c })),
                ftsEnabled: true,
                vecEnabled,
                totalVectors: vecCount,
                dimensions,
            };
        }
        catch (err) {
            log(`getStats error: ${err.message}`);
            return { totalMemories: 0, datesSummary: [], ftsEnabled: false, vecEnabled: false, totalVectors: 0, dimensions: 0 };
        }
    }
    /** Get local date string for a given timezone */
    function getLocalDate(tz) {
        try {
            return new Date().toLocaleDateString("sv-SE", { timeZone: tz || "Asia/Shanghai" });
        }
        catch {
            return new Date().toISOString().slice(0, 10);
        }
    }
    /** Close database connection */
    function close() {
        if (db) {
            try {
                db.close();
            }
            catch { /* ignore */ }
            db = null;
        }
    }
    /** Get all tags from memory_tags table (created by memory_tag tool) */
    function getAllTags() {
        try {
            const d = ensureDB();
            const rows = d.prepare("SELECT tag, memory_id FROM memory_tags").all();
            return rows;
        }
        catch {
            return [];
        }
    }
    /** Get all meta entries with id and filename (derived from date) */
    function getAllMeta() {
        try {
            const d = ensureDB();
            const rows = d.prepare("SELECT id, date FROM memory_meta").all();
            return rows.map(r => ({ id: r.id, filename: r.date ? `${r.date}.md` : `${r.id}.md` }));
        }
        catch {
            return [];
        }
    }
    /** Expose the raw DatabaseSync instance for tools that need direct SQL access (e.g., memory-tag). */
    function getRawDb() {
        return ensureDB();
    }
    /** Get most recent memory entries by date (for fallback when no keywords). */
    function getLatestMemory(limit = 1) {
        return searchAll(limit);
    }
    /** Simple key-value config store (for import checkpoints, etc.) */
    function getConfig(key, defaultValue) {
        try {
            const d = ensureDB();
            const tableExists = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_config'").get();
            if (!tableExists) {
                d.exec("CREATE TABLE IF NOT EXISTS memory_config (key TEXT PRIMARY KEY, value TEXT)");
                return defaultValue ?? null;
            }
            const row = d.prepare("SELECT value FROM memory_config WHERE key = ?").get(key);
            return row ? row.value : (defaultValue ?? null);
        }
        catch {
            return defaultValue ?? null;
        }
    }
    function setConfig(key, value) {
        try {
            const d = ensureDB();
            d.exec("CREATE TABLE IF NOT EXISTS memory_config (key TEXT PRIMARY KEY, value TEXT)");
            d.prepare("INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)").run(key, value);
        }
        catch { /* best effort */ }
    }
    return { init, indexTurn, search, searchAll, vectorSearch, hybridSearch, storeVector, deleteByDate, deleteByKeyword, getLatestMemory, getStats, close, dbPath, getRawDb, getAllTags, getAllMeta, getLocalDate, getConfig, setConfig };
}
