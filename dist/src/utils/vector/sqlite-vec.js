/**
 * SqliteVecBackend — default vector search using sqlite-vec extension.
 * Zero external dependencies beyond the sqlite-vec npm package.
 */
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
export class SqliteVecBackend {
    name = "sqlite-vec";
    isAvailable = false;
    db = null;
    config = {};
    logger;
    dimensions = 1024;
    snippetMaxLen = 500;
    searchMaxLimit = 100;
    supportsExtensions = false;
    init(db, config, logger) {
        this.db = db;
        this.config = config;
        this.logger = logger;
        this.dimensions = config.embedding?.dimensions ?? 1024;
        this.snippetMaxLen = Math.min(Math.max(config.snippetMaxLen ?? 500, 100), 2000);
        this.searchMaxLimit = Math.min(Math.max(config.searchMaxLimit ?? 100, 10), 1000);
        try {
            // Detect if SQLite supports extensions (Node 22 native sqlite)
            this.supportsExtensions = db.enableLoadExtension !== undefined;
        }
        catch {
            this.supportsExtensions = false;
        }
        if (!this.supportsExtensions) {
            logger?.warn?.("[yaoyao-memory:vec] SQLite extensions not supported — vector search disabled");
            this.isAvailable = false;
            return false;
        }
        try {
            const sqliteVec = _require("sqlite-vec");
            if (db.enableLoadExtension) {
                db.enableLoadExtension(true);
                sqliteVec.load(db._raw || db);
            }
            db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(" +
                `embedding float[${this.dimensions}]` +
                ")");
            db.exec("CREATE TABLE IF NOT EXISTS memory_vec_meta (" +
                "id INTEGER PRIMARY KEY, " +
                "meta_id INTEGER, " +
                "model TEXT, " +
                `dimensions INTEGER DEFAULT ${this.dimensions}, ` +
                "created_at TEXT DEFAULT (datetime('now'))" +
                ")");
            this.isAvailable = true;
            logger?.info?.("[yaoyao-memory:vec] sqlite-vec backend initialized");
            return true;
        }
        catch (e) {
            logger?.warn?.(`[yaoyao-memory:vec] sqlite-vec not available: ${e.message}`);
            this.isAvailable = false;
            return false;
        }
    }
    storeVector(metaId, embedding) {
        if (metaId <= 0 || !this.isAvailable || !this.db)
            return false;
        try {
            // Normalize to unit length for correct cosine similarity from L2 distance
            let norm = 0;
            for (let i = 0; i < embedding.length; i++) {
                norm += embedding[i] * embedding[i];
            }
            norm = Math.sqrt(norm);
            const normalized = norm === 0
                ? new Float32Array(embedding.length)
                : new Float32Array(embedding.map(v => v / norm));
            const jsonArr = "[" + Array.from(normalized).join(",") + "]";
            this.db.exec("BEGIN");
            try {
                this.db.prepare("DELETE FROM memory_vec WHERE rowid = ?").run(metaId);
                this.db.prepare("INSERT INTO memory_vec(rowid, embedding) VALUES(?, ?)").run(metaId, jsonArr);
                this.db.exec("COMMIT");
            }
            catch (txErr) {
                this.db.exec("ROLLBACK");
                throw txErr;
            }
            return true;
        }
        catch (err) {
            this.logger?.warn?.(`[yaoyao-memory:vec] storeVector error: ${err.message}`);
            return false;
        }
    }
    vectorSearch(embedding, limit = 10) {
        if (!this.isAvailable || !this.db)
            return [];
        try {
            const jsonArr = "[" + Array.from(embedding).join(",") + "]";
            const stmt = this.db.prepare("SELECT v.rowid, m.date, m.user_text, m.asst_text, v.distance " +
                "FROM memory_vec v " +
                "JOIN memory_meta m ON v.rowid = m.id " +
                "WHERE v.embedding MATCH ? AND k = ?");
            const rows = stmt.all(jsonArr, Math.min(Math.max(limit, 1), this.searchMaxLimit));
            return rows.map(row => {
                // vec0 uses L2 distance. For unit-normalized vectors: cosine ≈ 1 - (L2^2 / 2)
                const cosineSim = 1 - (row.distance || 0) / 2;
                const snippet = `${row.user_text || ""} ${row.asst_text || ""}`.trim();
                return {
                    id: row.rowid,
                    filename: row.date ? `${row.date}.md` : "memory.db",
                    snippet: snippet.slice(0, this.snippetMaxLen),
                    score: Math.max(0, cosineSim),
                    date: row.date || "",
                    asst_text: (row.asst_text || "").slice(0, this.snippetMaxLen),
                    vectorScore: Math.max(0, cosineSim),
                    hybridScore: Math.max(0, cosineSim),
                };
            });
        }
        catch (err) {
            this.logger?.warn?.(`[yaoyao-memory:vec] vectorSearch error: ${err.message}`);
            return [];
        }
    }
    /** Delete vectors whose rowid no longer exists in memory_meta */
    deleteOrphans() {
        if (!this.isAvailable || !this.db)
            return;
        try {
            this.db.exec("DELETE FROM memory_vec WHERE NOT EXISTS (SELECT 1 FROM memory_meta WHERE memory_meta.id = memory_vec.rowid)");
        }
        catch { /* best effort */ }
    }
    getVectorCount() {
        if (!this.isAvailable || !this.db)
            return 0;
        try {
            const row = this.db.prepare("SELECT COUNT(*) as c FROM memory_vec").get();
            return row?.c ?? 0;
        }
        catch {
            return 0;
        }
    }
    getDimensions() {
        if (!this.isAvailable || !this.db)
            return 0;
        try {
            const row = this.db.prepare("SELECT dimensions FROM memory_vec_meta LIMIT 1").get();
            return row?.dimensions ?? this.dimensions;
        }
        catch {
            return this.dimensions;
        }
    }
    close() {
        this.db = null;
        this.isAvailable = false;
    }
}
