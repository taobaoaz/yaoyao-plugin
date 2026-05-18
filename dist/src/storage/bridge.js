/**
 * storage/bridge.ts — Thin storage facade.
 *
 * Single entry point that delegates to:
 *   - fts.ts          (FTS5 indexing & search)
 *   - vector-store.ts (vector search)
 *   - hybrid.ts       (RRF / weighted fusion)
 *   - schema.ts       (table definitions)
 *
 * Previously utils/db-bridge.ts was a 629-line monolith.
 * Now each engine lives in its own <200-line file.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getProp } from "../utils/config.js";
import { clampNum } from "../utils/clamp.js";
import { createCompatDB } from "../platform/db/compat.js";
import { ensureSchema } from "./schema.js";
import { createFtsEngine } from "./fts.js";
import { createVectorStore } from "./vector-store.js";
import { createHybridSearch } from "./hybrid.js";
export { createCompatDB } from "../platform/db/compat.js";
/** Compute a normalized score from FTS5 rank (negative = better) */
function computeScore(rank) {
    const r = Number(rank);
    if (!Number.isFinite(r))
        return 0.3;
    if (r < 0)
        return Math.min(1, Math.max(0.1, -r / 15));
    return 0.3;
}
// ── WAL setup (extracted from db-bridge.ts) ──
function setupWAL(db, dbPath, dbBackend, log) {
    if (dbBackend.backend === "file-db")
        return;
    try {
        db.exec("PRAGMA journal_mode = WAL");
        const mode = db.prepare("PRAGMA journal_mode").get();
        const walEnabled = String(mode?.journal_mode) === "wal" || String(mode) === "wal";
        if (!walEnabled) {
            log("WAL mode not supported by filesystem, continuing with default journal mode");
        }
    }
    catch (e) {
        if (e.message?.includes("disk I/O")) {
            log("Stale WAL files detected, cleaning up");
            try {
                db.close();
            }
            catch { /* ignore */ }
            db = null; // won't be used, re-created after
            for (const ext of ["-wal", "-shm"]) {
                try {
                    fs.unlinkSync(dbPath + ext);
                }
                catch { /* ignore */ }
            }
            // Re-connect
            const newBackend = createCompatDB(dbPath, { allowExtension: true }, loggerRef);
            Object.assign(db, newBackend.db); // swap ref
            try {
                newBackend.db.exec("PRAGMA journal_mode = WAL");
            }
            catch {
                log("WAL recovery failed");
            }
        }
        else {
            log(`WAL setup failed: ${e.message}`);
        }
    }
    try {
        db.exec("PRAGMA busy_timeout = 5000");
    }
    catch { /* ignore */ }
    try {
        db.exec("PRAGMA cache_size = -65536");
    }
    catch { /* ignore */ }
}
// Mutable logger ref for WAL recovery callback
let loggerRef;
export function createStorage(config, logger) {
    const baseDir = path.resolve(config.memoryDir || path.join(os.homedir(), ".openclaw", "workspace", "memory"));
    if (/[\x00-\x1f]/.test(baseDir))
        throw new TypeError("memoryDir contains invalid control characters");
    loggerRef = logger;
    const dbPath = path.join(baseDir, ".yaoyao.db");
    const log = (msg) => logger?.debug?.(`[yaoyao:storage] ${msg}`);
    // Config
    const snippetMaxLen = clampNum(getProp(config, "snippetMaxLen", 500), 500, 100, 5000);
    const searchMaxLimit = clampNum(getProp(config, "searchMaxLimit", 100), 100, 10, 1000);
    const likeFallbackScore = clampNum(getProp(config, "likeFallbackScore", 0.5), 0.5, 0.1, 1);
    // State
    let db = null;
    let initFailed = false;
    let dbBackend = null;
    // Engines (lazily initialized)
    let fts = null;
    let vector = null;
    let hybrid = null;
    // WAL checkpoint timer
    let walCheckTimer = null;
    function ensureDB() {
        if (!db && !initFailed)
            init();
        if (!db)
            throw new Error("Database failed to initialize");
        return db;
    }
    /** Initialize database — create tables, engines */
    function init() {
        try {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
            dbBackend = createCompatDB(dbPath, { allowExtension: true }, logger);
            db = dbBackend.db;
            // WAL setup
            setupWAL(db, dbPath, dbBackend, log);
            // WAL passive checkpoint timer
            walCheckTimer = setInterval(() => {
                try {
                    db?.exec("PRAGMA wal_checkpoint(PASSIVE)");
                }
                catch { /* ignore */ }
            }, 60 * 60 * 1000);
            walCheckTimer.unref();
            // Create tables
            ensureSchema(db);
            // Initialize engines
            fts = createFtsEngine({ snippetMaxLen, searchMaxLimit, likeFallbackScore });
            vector = createVectorStore(config, logger);
            vector.init(db);
            hybrid = createHybridSearch();
            const dbType = dbBackend.backend;
            const vecName = vector.name;
            log(`Storage initialized: ${dbPath} (db=${dbType}, vec=${vecName})`);
            return true;
        }
        catch (err) {
            logger?.error?.(`[yaoyao:storage] Init failed: ${err.message}`);
            initFailed = true;
            return false;
        }
    }
    // ── Public API (mirrors DBBridge interface for backward compat) ──
    return {
        init,
        indexTurn(userText, asstText, date, meta) {
            return fts.indexTurn(ensureDB(), userText, asstText, date, meta);
        },
        search(query, limit = 10) {
            return fts.search(ensureDB(), query, limit);
        },
        searchAll(limit = 10) {
            return fts.searchAll(ensureDB(), limit);
        },
        vectorSearch(embedding, limit = 10) {
            return vector.search(embedding, limit);
        },
        hybridSearch(query, embedding, limit = 10) {
            const ftsResults = this.search(query, limit);
            if (!embedding || ftsResults.length === 0) {
                return ftsResults.map(r => ({ ...r, vectorScore: 0, hybridScore: (r.score ?? 0) * 0.6 }));
            }
            const vecResults = this.vectorSearch(embedding, limit);
            return hybrid.weighted(ftsResults, vecResults, limit);
        },
        rrfHybridSearch(query, embedding, limit = 10, k = 60) {
            const overfetchLimit = limit * 2;
            const ftsResults = this.search(query, overfetchLimit);
            if (!embedding || ftsResults.length === 0) {
                return ftsResults.slice(0, limit).map(r => ({ ...r, vectorScore: 0, hybridScore: r.score }));
            }
            const vecResults = this.vectorSearch(embedding, overfetchLimit);
            return hybrid.rrf(ftsResults, vecResults, limit);
        },
        storeVector(metaId, embedding) {
            return vector.store(metaId, embedding);
        },
        deleteByDate(date) {
            const d = ensureDB();
            const count = fts.deleteByDate(d, date);
            if (count > 0) {
                fts.scheduleRebuild(d);
                vector.deleteOrphans();
            }
            return count;
        },
        deleteByKeyword(keyword) {
            const d = ensureDB();
            const count = fts.deleteByKeyword(d, keyword);
            if (count > 0) {
                fts.scheduleRebuild(d);
                vector.deleteOrphans();
            }
            return count;
        },
        getLatestMemory(limit = 1) {
            return fts.searchAll(ensureDB(), limit);
        },
        getStats() {
            try {
                const d = ensureDB();
                const totalCount = d.prepare("SELECT COUNT(*) as c FROM memory_meta").get();
                const total = totalCount?.c ?? 0;
                const datesRaw = d.prepare("SELECT date, COUNT(*) as c FROM memory_meta GROUP BY date ORDER BY date DESC LIMIT 10").all();
                let vecCount = 0;
                let dims = 0;
                try {
                    vecCount = vector?.count() ?? 0;
                    dims = vector?.dimensions() ?? 0;
                }
                catch { /* ignore */ }
                return {
                    totalMemories: total,
                    datesSummary: datesRaw.map(r => ({ date: r.date, count: r.c })),
                    ftsEnabled: true,
                    vecEnabled: vector?.isAvailable ?? false,
                    totalVectors: vecCount,
                    dimensions: dims,
                };
            }
            catch {
                return { totalMemories: 0, datesSummary: [], ftsEnabled: false, vecEnabled: false, totalVectors: 0, dimensions: 0 };
            }
        },
        getLocalDate(tz) {
            try {
                return new Date().toLocaleDateString("sv-SE", { timeZone: tz || "Asia/Shanghai" });
            }
            catch {
                return new Date().toISOString().slice(0, 10);
            }
        },
        close() {
            if (walCheckTimer) {
                clearInterval(walCheckTimer);
                walCheckTimer = null;
            }
            vector?.close();
            if (db) {
                try {
                    db.close();
                }
                catch { /* ignore */ }
                db = null;
            }
            fts = null;
            hybrid = null;
            initFailed = false;
        },
        /** Backward-compat: direct raw DB access for tools that need it. */
        getRawDb() {
            return ensureDB();
        },
        /** Get all tags from memory_tags table */
        getAllTags() {
            try {
                const rows = ensureDB().prepare("SELECT tag, memory_id FROM memory_tags").all();
                return rows;
            }
            catch {
                return [];
            }
        },
        /** Get all meta entries */
        getAllMeta() {
            try {
                const rows = ensureDB().prepare("SELECT id, date FROM memory_meta").all();
                return rows.map(r => ({ id: r.id, filename: r.date ? `${r.date}.md` : `${r.id}.md` }));
            }
            catch {
                return [];
            }
        },
        /** Config key-value store */
        getConfig(key, defaultValue) {
            try {
                const d = ensureDB();
                const row = d.prepare("SELECT value FROM memory_config WHERE key = ?").get(key);
                return row ? row.value : (defaultValue ?? null);
            }
            catch {
                return defaultValue ?? null;
            }
        },
        setConfig(key, value) {
            try {
                ensureDB().prepare("INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)").run(key, value);
            }
            catch { /* best effort */ }
        },
        updateMetadata(id, metadata) {
            try {
                ensureDB().prepare("UPDATE memory_meta SET meta = ? WHERE id = ?").run(metadata, id);
            }
            catch { /* best effort */ }
        },
        incrementAccessCount(id) {
            try {
                const d = ensureDB();
                const row = d.prepare("SELECT access_count, tier, importance FROM memory_meta WHERE id = ?").get(id);
                if (!row)
                    return;
                const newCount = (row.access_count || 0) + 1;
                let newTier = row.tier || "active";
                if (newCount >= 10 && (row.importance || 0) >= 0.8)
                    newTier = "core";
                else if (newCount >= 3)
                    newTier = "working";
                d.prepare("UPDATE memory_meta SET access_count = ?, tier = ? WHERE id = ?")
                    .run(newCount, newTier, id);
            }
            catch { /* best effort */ }
        },
        /** Backward-compat alias */
        dbPath,
    };
}
