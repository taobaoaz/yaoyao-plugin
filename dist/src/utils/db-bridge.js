/**
 * SQLite database layer — FTS5 + sqlite-vec vector search.
 *
 * Uses native Node 22 node:sqlite for zero-dependency SQLite access,
 * plus sqlite-vec extension (from openclaw workspace) for vector search.
 *
 * Stores both FTS5 index and vector embeddings in a single .yaoyao.db file.
 */
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
    const log = (msg) => logger?.debug?.(`[yaoyao-memory:db] ${msg}`);
    let db = null;
    let initFailed = false;
    let vecEnabled = false;

    // ── Node < 22 fallback: no-op DB stub ──
    let DatabaseSync;
    try {
        DatabaseSync = _require("node:sqlite").DatabaseSync;
    } catch {
        DatabaseSync = null;
        log("node:sqlite not available, using no-op stub");
    }
    let refCount = 0;
    const MAX_REFS = 1000;
    /** Initialize database — create tables if not exist. vecDimensions configures vector table size. */
    function init(vecDimensions = 1024) {
        // ── No-op stub when node:sqlite is unavailable ──
        if (!DatabaseSync) {
            log("init: node:sqlite unavailable, creating no-op stub");
            db = {
                exec: () => {},
                prepare: () => ({
                    all: () => [],
                    get: () => null,
                    run: () => ({ changes: 0, lastInsertRowid: 0 }),
                }),
                close: () => {},
            };
            return true;
        }
        try {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
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
            // ── Large WAL file cleanup ──
            try {
                const walStat = fs.statSync(dbPath + "-wal");
                if (walStat.size > 10 * 1024 * 1024) {
                    log(`Large WAL file detected (${(walStat.size / 1024 / 1024).toFixed(1)} MB), running checkpoint`);
                    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
                }
            } catch {
                // WAL file doesn't exist, that's fine
            }
            // ── Indexes for faster queries ──
            db.exec("CREATE INDEX IF NOT EXISTS idx_memory_meta_date ON memory_meta(date)");
            db.exec("CREATE INDEX IF NOT EXISTS idx_memory_meta_created ON memory_meta(created_at)");
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
                "created_at TEXT DEFAULT (datetime('now')), " +
                "source_session TEXT DEFAULT ''" +
                ")");
            // Add source_session column if missing (upgrade path)
            try {
                db.exec("ALTER TABLE memory_meta ADD COLUMN source_session TEXT DEFAULT ''");
            }
            catch { /* column already exists */ }
            // Config table for user-customizable settings
            db.exec("CREATE TABLE IF NOT EXISTS memory_config (" +
                "key TEXT PRIMARY KEY, " +
                "value TEXT NOT NULL, " +
                "updated_at TEXT DEFAULT (datetime('now'))" +
                ")");
            // Vector search table (sqlite-vec)
            vecEnabled = false;
            try {
                const sqliteVec = _require("sqlite-vec");
                db.enableLoadExtension(true);
                sqliteVec.load(db);
                vecEnabled = true;
                db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(" +
                    `embedding float[${vecDimensions}]` +
                    ")");
                db.exec("CREATE TABLE IF NOT EXISTS memory_vec_meta (" +
                    "id INTEGER PRIMARY KEY, " +
                    "meta_id INTEGER, " +
                    "model TEXT, " +
                    "dimensions INTEGER DEFAULT 1024, " +
                    "created_at TEXT DEFAULT (datetime('now'))" +
                    ")");
                log("sqlite-vec loaded successfully");
            }
            catch (e) {
                log(`sqlite-vec not available: ${e.message}`);
                vecEnabled = false;
            }
            log(`DB initialized: ${dbPath} (vec=${vecEnabled})`);
            // ── FTS5 integrity check ──
            try {
                const metaCount = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get()?.c || 0;
                const ftsCount = db.prepare("SELECT COUNT(*) as c FROM memory_fts").get()?.c || 0;
                if (metaCount > 0 && Math.abs(metaCount - ftsCount) > Math.max(10, metaCount * 0.1)) {
                    log(`FTS5 integrity: meta=${metaCount}, fts=${ftsCount}, rebuilding...`);
                    db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
                    log("FTS5 rebuild complete");
                }
            } catch (e) {
                log(`FTS5 integrity check failed: ${e.message}`);
            }
            return true;
        }
        catch (err) {
            logger?.error?.(`[yaoyao-memory:db] Init failed: ${err.message}`);
            initFailed = true;
            return false;
        }
    }
    /** Ensure DB is initialized with retry */
    function ensureDB() {
        if (!db && !initFailed) {
            init();
        }
        if (!db) {
            // Retry once (could be a transient issue like file lock)
            initFailed = false;
            init();
        }
        if (!db) {
            throw new Error("Database failed to initialize after retry");
        }
        refCount++;
        if (refCount > MAX_REFS) {
            log(`Warning: DB ref count ${refCount} exceeds ${MAX_REFS}, possible leak`);
        }
        return db;
    }
    /** Index a conversation turn in FTS5. Returns the row id (>0) or -1 on failure. */
    function indexTurn(userText, asstText, date, sourceSession = "") {
        try {
            const d = ensureDB();
            // Dedup: skip if same date + same user_text prefix already exists
            const existing = d.prepare(
                "SELECT id FROM memory_meta WHERE date = ? AND substr(user_text, 1, 100) = ? LIMIT 1"
            ).get(date, userText.slice(0, 100));
            if (existing) return existing.id;
            const stmt = d.prepare("INSERT INTO memory_meta (date, user_text, asst_text, source_session) VALUES (?, ?, ?, ?)");
            const result = stmt.run(date, userText.slice(0, 2000), asstText.slice(0, 2000), sourceSession);
            const rowId = Number(result.lastInsertRowid);
            const stmt2 = d.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
            stmt2.run(rowId, date, userText.slice(0, 2000), asstText.slice(0, 2000));
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
        // Empty query: return empty string so search returns no results
        if (!query || !query.trim()) return "";
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
            return ""; // return empty string instead of fallback "memory";
        return s;
    }
    /** FTS5 full-text search + LIKE fallback for Chinese (FTS5 unicode61 tokenizer doesn't segment CJK) */
    function search(query, limit = 10) {
        try {
            const d = ensureDB();
            const safeQuery = sanitizeFTSQuery(query);
            // Empty sanitized query → return no results (don't fallback to "memory")
            if (!safeQuery) return [];
            // Try FTS5 first
            const stmt = d.prepare("SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
                "FROM memory_fts WHERE memory_fts MATCH ? " +
                "ORDER BY rank LIMIT ?");
            const rows = stmt.all(safeQuery, Math.min(Math.max(limit, 1), 100));
            // FTS5 returns results, use them
            if (rows.length > 0) {
                return rows.map(row => {
                    const snippet = (row.snippet || "").slice(0, 500);
                    const isImportant = snippet.includes("<b>[important]</b>") || snippet.includes("[important]");
                    return {
                        filename: row.date ? `${row.date}.md` : "memory.db",
                        snippet,
                        score: isImportant ? computeScore(row.rank) * 1.3 : computeScore(row.rank),
                        date: row.date || "",
                    };
                });
            }
            // ── FTS5 returned nothing → try LIKE fallback for CJK text ──
            // FTS5 unicode61 tokenizer treats each Chinese character as a separate token,
            // so multi-character words like "天气" or "今天" fail to match.
            // LIKE is character-based and handles CJK correctly.
            // ── 优化6: LIKE fallback date filter only for large datasets (> 1000 rows) ──
            let totalRows = 0;
            try {
                totalRows = d.prepare("SELECT COUNT(*) as c FROM memory_meta").get()?.c || 0;
            } catch { /* ignore */ }
            const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
            const likeQuery = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
            let likeRows;
            if (totalRows > 1000) {
                // Large dataset: use 30-day window for performance
                try {
                    const likeStmtDated = d.prepare("SELECT id, date, user_text, asst_text FROM memory_meta " +
                        "WHERE date >= ? AND (user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\') " +
                        "ORDER BY id DESC LIMIT ?");
                    likeRows = likeStmtDated.all(thirtyDaysAgo, likeQuery, likeQuery, Math.min(Math.max(limit, 1), 100));
                } catch {
                    likeRows = null;
                }
            }
            // Small dataset or dated query failed: no date filter
            if (!likeRows || likeRows.length === 0) {
                const likeStmt = d.prepare("SELECT id, date, user_text, asst_text FROM memory_meta " +
                    "WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\' " +
                    "ORDER BY id DESC LIMIT ?");
                likeRows = likeStmt.all(likeQuery, likeQuery, Math.min(Math.max(limit, 1), 100));
            }
            if (likeRows.length > 0) {
                log(`FTS5 miss → LIKE fallback found ${likeRows.length} results for "${query.slice(0, 30)}"`);
                return likeRows.map(row => {
                    const text = `${row.user_text || ""} ${row.asst_text || ""}`.trim();
                    const isImportant = text.includes("[important]");
                    return {
                        filename: row.date ? `${row.date}.md` : "memory.db",
                        snippet: text.slice(0, 500),
                        score: isImportant ? 0.7 : 0.5,
                        date: row.date || "",
                    };
                });
            }
            // ── Bigram fallback for CJK: split query into 2-char substrings ──
            // e.g. "天气很好" → ["天气", "很好"]
            const cjkPattern = /[\u4e00-\u9fff]/;
            if (cjkPattern.test(query) && query.length >= 2) {
                const bigrams = [];
                for (let i = 0; i + 1 < query.length; i++) {
                    const pair = query.slice(i, i + 2);
                    if (cjkPattern.test(pair.charAt(0)) && cjkPattern.test(pair.charAt(1))) {
                        bigrams.push(pair);
                    }
                }
                if (bigrams.length > 0) {
                    // Query all records matching ANY bigram, then filter for ALL bigrams present
                    const effectiveLimit = Math.min(Math.max(limit * 5, 50), 200);
                    const placeholders = bigrams.map(() => '(user_text LIKE ? ESCAPE "\\"  OR asst_text LIKE ? ESCAPE "\\")').join(" AND ");
                    const bigramParams = bigrams.flatMap(bg => {
                        const likeBg = `%${bg.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
                        return [likeBg, likeBg];
                    });
                    const bigramStmt = d.prepare(
                        `SELECT id, date, user_text, asst_text FROM memory_meta WHERE ${placeholders} ORDER BY id DESC LIMIT ?`
                    );
                    const bigramRows = bigramStmt.all(...bigramParams, effectiveLimit);
                    if (bigramRows.length > 0) {
                        log(`Bigram fallback found ${bigramRows.length} results for bigrams [${bigrams.join(", ")}]`);
                        // Deduplicate by id
                        const seenIds = new Set();
                        const uniqueRows = [];
                        for (const row of bigramRows) {
                            if (!seenIds.has(row.id)) {
                                seenIds.add(row.id);
                                uniqueRows.push(row);
                            }
                        }
                        // Score by match ratio and sort
                        const scored = [];
                        for (const row of uniqueRows) {
                            const text = `${row.user_text || ""} ${row.asst_text || ""}`;
                            let matchCount = 0;
                            for (const bg of bigrams) {
                                if (text.includes(bg)) matchCount++;
                            }
                            if (matchCount > 0) {
                                scored.push({
                                    row,
                                    score: matchCount / bigrams.length,
                                });
                            }
                        }
                        scored.sort((a, b) => b.score - a.score);
                        // Secondary dedup by snippet prefix
                        const seenPrefix = new Set();
                        const finalRows = [];
                        for (const s of scored) {
                            const prefix = `${s.row.user_text || ""} ${s.row.asst_text || ""}`.trim().slice(0, 50);
                            if (!seenPrefix.has(prefix)) {
                                seenPrefix.add(prefix);
                                finalRows.push(s.row);
                            }
                        }
                        return finalRows.slice(0, Math.min(Math.max(limit, 1), 100)).map(row => ({
                            filename: row.date ? `${row.date}.md` : "memory.db",
                            snippet: `${row.user_text || ""} ${row.asst_text || ""}`.trim().slice(0, 500),
                            score: 0.4,
                            date: row.date || "",
                        }));
                    }
                }
            }
            // Empty across the board
            return [];
        }
        catch (err) {
            log(`search error: ${err.message}`);
            return [];
        }
    }
    /** Vector similarity search via sqlite-vec — graceful degradation when vec unavailable */
    function vectorSearch(embedding, limit = 10) {
        if (!vecEnabled) return []; // graceful: no sqlite-vec
        try {
            const d = ensureDB();
            const jsonArr = "[" + Array.from(embedding).join(",") + "]";
            const stmt = d.prepare("SELECT v.rowid, m.date, m.user_text, m.asst_text, v.distance " +
                "FROM memory_vec v " +
                "JOIN memory_meta m ON v.rowid = m.id " +
                "WHERE v.embedding MATCH ? AND k = ?");
            const rows = stmt.all(jsonArr, Math.min(Math.max(limit, 1), 100));
            return rows.map(row => {
                // vec0 uses L2 distance. Convert to cosine similarity
                // For normalized vectors: cosine ~ 1 - (L2^2 / 2)
                const rawDist = row.distance || 0;
                const cosineSim = 1 - rawDist / 2;
                const snippet = `${row.user_text || ""} ${row.asst_text || ""}`.trim();
                return {
                    filename: row.date ? `${row.date}.md` : "memory.db",
                    snippet: snippet.slice(0, 500),
                    score: Math.max(0, cosineSim),
                    date: row.date || "",
                    vectorScore: Math.max(0, cosineSim),
                    hybridScore: Math.max(0, cosineSim),
                };
            });
        }
        catch (err) {
            log(`vectorSearch error: ${err.message}`);
            return []; // graceful: return empty on error
        }
    }
    /** Hybrid search: FTS5 + vector weighted combination — degrades to pure FTS5 when vec unavailable */
    function hybridSearch(query, embedding, limit = 10) {
        const ftsResults = search(query, limit);
        if (!vecEnabled || !embedding) {
            // Pure FTS5 mode — apply importance boost and return
            return ftsResults.map(r => ({
                ...r,
                vectorScore: 0,
                hybridScore: r.score * 0.6,
            }));
        }
        if (ftsResults.length === 0 && !embedding) {
            return [];
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
            // Backfill date from memory_meta if missing
            if (!r.date && r.filename) {
                try {
                    const dateMatch = r.filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
                    if (dateMatch) r.date = dateMatch[1];
                } catch { /* best effort */ }
            }
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
    /** Store a vector embedding for a memory record */
    function storeVector(metaId, embedding) {
        if (metaId <= 0)
            return false; // reject orphan vectors
        try {
            const d = ensureDB();
            const jsonArr = "[" + Array.from(embedding).join(",") + "]";
            // Wrap DELETE + INSERT in a transaction
            d.exec("BEGIN");
            try {
                d.prepare("DELETE FROM memory_vec WHERE rowid = ?").run(metaId);
                d.prepare("INSERT INTO memory_vec(rowid, embedding) VALUES(?, ?)").run(metaId, jsonArr);
                d.exec("COMMIT");
            } catch (txErr) {
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
    /** Delete memory entries from FTS5 and meta tables by date.
     *  Must delete from FTS5 first (using rowid = memory_meta.id), then meta.
     *  rebuild alone does NOT work for standalone FTS5 tables (no content= sync).
     */
    function deleteByDate(date) {
        try {
            const d = ensureDB();
            // 1. Find rowids to delete from FTS5
            const rows = d.prepare("SELECT id FROM memory_meta WHERE date = ?").all(date);
            // 2. Delete from FTS5 by rowid (FTS5 rowid = memory_meta.id)
            if (rows.length > 0) {
                const ids = rows.map(r => r.id);
                const placeholders = ids.map(() => '?').join(',');
                d.prepare(`DELETE FROM memory_fts WHERE rowid IN (${placeholders})`).run(...ids);
            }
            // 3. Delete from meta
            const metaResult = d.prepare("DELETE FROM memory_meta WHERE date = ?").run(date);
            const deleted = metaResult.changes ?? 0;
            // Clean up orphan vectors
            try { d.exec("DELETE FROM memory_vec WHERE rowid NOT IN (SELECT id FROM memory_meta)"); } catch { /* best effort */ }
            log(`deleteByDate: ${deleted} entries removed for ${date} (fts cleared: ${rows.length})`);
            return deleted;
        }
        catch (err) {
            log(`deleteByDate error: ${err.message}`);
            return 0;
        }
    }
    /** Delete memory entries matching a like pattern from user_text or asst_text.
     *  Must delete from FTS5 first (using rowid = memory_meta.id), then meta.
     */
    function deleteByKeyword(keyword) {
        try {
            const d = ensureDB();
            const pattern = `%${keyword.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
            // 1. Find rowids to delete from FTS5
            const rows = d.prepare(
                "SELECT id FROM memory_meta WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\'"
            ).all(pattern, pattern);
            // 2. Delete from FTS5 by rowid
            if (rows.length > 0) {
                const ids = rows.map(r => r.id);
                const placeholders = ids.map(() => '?').join(',');
                d.prepare(`DELETE FROM memory_fts WHERE rowid IN (${placeholders})`).run(...ids);
            }
            // 3. Delete from meta
            const result = d.prepare(
                "DELETE FROM memory_meta WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\'"
            ).run(pattern, pattern);
            const deleted = result.changes ?? 0;
            // Clean up orphan vectors
            try { d.exec("DELETE FROM memory_vec WHERE rowid NOT IN (SELECT id FROM memory_meta)"); } catch { /* best effort */ }
            log(`deleteByKeyword: ${deleted} entries removed for "${keyword}" (fts cleared: ${rows.length})`);
            return deleted;
        }
        catch (err) {
            log(`deleteByKeyword error: ${err.message}`);
            return 0;
        }
    }
    /** Query memory_meta directly with date range filter.
     *  Returns full rows (id, date, user_text, asst_text, source_session, created_at).
     *  This is the proper way for tools to bulk-read memories — not db.search().
     */
    function queryMeta(opts = {}) {
      try {
        const d = ensureDB();
        const dateFrom = opts.dateFrom || '';
        const dateTo = opts.dateTo || '';
        const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000);
        const offset = Math.max(Number(opts.offset) || 0, 0);
        let sql = 'SELECT id, date, user_text, asst_text, source_session, created_at FROM memory_meta';
        const conditions = [];
        const params = [];
        if (dateFrom) { conditions.push('date >= ?'); params.push(dateFrom); }
        if (dateTo) { conditions.push('date <= ?'); params.push(dateTo); }
        if (conditions.length > 0) {
          sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY date DESC, id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        return d.prepare(sql).all(...params);
      } catch (err) {
        log(`queryMeta error: ${err.message}`);
        return [];
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
                dimensions = 1024;
            }
            catch {
                // vec table may not exist
            }
            return {
                totalMemories: total,
                datesSummary: datesRaw.map(r => ({ date: r.date, count: r.c })),
                ftsEnabled: true,
                vecEnabled: vecEnabled,
                totalVectors: vecCount,
                dimensions,
            };
        }
        catch (err) {
            log(`getStats error: ${err.message}`);
            return { totalMemories: 0, datesSummary: [], ftsEnabled: false, vecEnabled: false, totalVectors: 0, dimensions: 0 };
        }
    }
    /** Get config value from memory_config table */
    function getConfig(key, defaultVal) {
        try {
            const d = ensureDB();
            const row = d.prepare("SELECT value FROM memory_config WHERE key = ?").get(key);
            return row ? row.value : defaultVal;
        }
        catch {
            return defaultVal;
        }
    }

    /** Set config value in memory_config table */
    function setConfig(key, value) {
        try {
            const d = ensureDB();
            d.prepare("INSERT OR REPLACE INTO memory_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, String(value));
            return true;
        }
        catch {
            return false;
        }
    }

    /** Get local date string for a given timezone */
    function getLocalDate(tz) {
        try {
            return new Date().toLocaleDateString('sv-SE', { timeZone: tz || 'Asia/Shanghai' });
        }
        catch {
            return new Date().toISOString().slice(0, 10);
        }
    }

    /** Get all tags from memory_meta (currently returns empty — no tags column) */
    function getAllTags() {
        // memory_meta table has no tags column. Return empty for graceful degradation.
        return [];
    }

    /** Get all meta entries with id and filename (derived from date) */
    function getAllMeta() {
        try {
            const d = ensureDB();
            const rows = d.prepare("SELECT id, date FROM memory_meta").all();
            return rows.map(r => ({ id: r.id, filename: r.date ? r.date + ".md" : r.id + ".md" }));
        } catch {
            return [];
        }
    }

    /** Close database connection */
    function close() {
        if (db) {
            try {
                // Checkpoint WAL to ensure data is flushed to main DB
                db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
            } catch { /* best effort */ }
            try {
                db.close();
            } catch { /* ignore */ }
            db = null;
            refCount = 0;
        }
    }
    /** Expose the raw DatabaseSync instance for tools that need direct SQL access (e.g., memory-tag). */
    function getRawDb() {
        return ensureDB();
    }
    return { init, indexTurn, search, vectorSearch, hybridSearch, storeVector, deleteByDate, deleteByKeyword, queryMeta, getStats, close, dbPath, getConfig, setConfig, getLocalDate, getRawDb, getAllTags, getAllMeta };
}
