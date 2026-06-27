/**
 * celia/db-reader.ts — read-only bridge into celia's SQLite store.
 *
 * v1.9.1: In read-only bridge mode (celiaBridge.mode="read-only"), this opens
 * celia's `celia_memory.db` WITHOUT spawning the server, and lets yaoyao's
 * unique analysis tools (graph / trends / quality) fold celia's data into
 * their results. celia's schema is from celia-memory-architecture §7.1.
 *
 * Strict read-only guarantees:
 *   - DB is opened with readOnly=true; no exec of writes.
 *   - Only SELECT queries are issued.
 *   - If the DB / table is missing or unreadable, every method returns []
 *     and logs once — never throws, never breaks the calling tool.
 *
 * Backend: tries node:sqlite (Node 22+) readOnly first, then better-sqlite3
 * readonly, then gives up gracefully. Independent of yaoyao's own DB backend
 * selection so it cannot affect the main store.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
/**
 * Read-only accessor for celia's database. Construct with the celia dbPath;
 * call open() before use (no-op if already open or unavailable).
 */
export class CeliaDbReader {
    dbPath;
    logger;
    db = null;
    warnedMissing = false;
    constructor(dbPath, logger = {}) {
        this.dbPath = dbPath;
        this.logger = logger;
    }
    /** Resolve the default celia db path if none given. */
    static resolvePath(explicit) {
        if (explicit && existsSync(explicit))
            return explicit;
        return join(homedir(), ".openclaw", "workspace", "memory", "celia_memory", "celia_memory.db");
    }
    /** Open the DB read-only. Returns false if unavailable (logged once). */
    open() {
        if (this.db)
            return true;
        const p = existsSync(this.dbPath) ? this.dbPath : "";
        if (!p) {
            if (!this.warnedMissing) {
                this.logger.debug?.(`[yaoyao:celia:db] celia db not found at ${this.dbPath}; read-only bridge inactive`);
                this.warnedMissing = true;
            }
            return false;
        }
        // 1. node:sqlite (Node 22+) readOnly
        try {
            const _require = createRequire(import.meta.url);
            const { DatabaseSync } = _require("node:sqlite");
            const raw = new DatabaseSync(p, { readOnly: true });
            this.db = {
                prepare: (sql) => raw.prepare(sql),
                close: () => raw.close(),
            };
            this.logger.debug?.("[yaoyao:celia:db] opened via node:sqlite (readOnly)");
            return true;
        }
        catch {
            // fall through
        }
        // 2. better-sqlite3 readonly
        try {
            const _require = createRequire(import.meta.url);
            const Database = _require("better-sqlite3");
            const raw = new Database(p, { readonly: true });
            this.db = {
                prepare: (sql) => raw.prepare(sql),
                close: () => raw.close(),
            };
            this.logger.debug?.("[yaoyao:celia:db] opened via better-sqlite3 (readonly)");
            return true;
        }
        catch (e) {
            if (!this.warnedMissing) {
                this.logger.warn?.(`[yaoyao:celia:db] cannot open celia db read-only: ${e.message}`);
                this.warnedMissing = true;
            }
            return false;
        }
    }
    /** Close the DB handle (idempotent). */
    close() {
        if (this.db) {
            try {
                this.db.close();
            }
            catch { /* ignore */ }
            this.db = null;
        }
    }
    /** Whether a celia table exists (used to probe availability per-table). */
    hasTable(name) {
        if (!this.db)
            return false;
        try {
            const row = this.db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
                .all(name);
            return row.length > 0;
        }
        catch {
            return false;
        }
    }
    /** Read L2 atomic facts matching a query (FTS5 if available, else LIKE). */
    readAtomicFacts(query, topK = 5) {
        if (!this.open() || !this.hasTable("mem_atomic"))
            return [];
        const like = `%${(query || "").trim()}%`;
        try {
            if (this.hasTable("mem_atomic_fts")) {
                return this.db.prepare("SELECT a.id, a.content, a.category, a.confidence, a.source, a.created_at_ms " +
                    "FROM mem_atomic_fts f JOIN mem_atomic a ON a.id = f.rowid " +
                    "WHERE f.content MATCH ? ORDER BY a.confidence DESC LIMIT ?").all(query, topK);
            }
            return this.db.prepare("SELECT id, content, category, confidence, source, created_at_ms " +
                "FROM mem_atomic WHERE content LIKE ? ORDER BY confidence DESC LIMIT ?").all(like, topK);
        }
        catch (e) {
            this.logger.debug?.(`[yaoyao:celia:db] readAtomicFacts failed: ${e.message}`);
            return [];
        }
    }
    /** Read raw conversations (L0) matching a query. */
    readConversations(query, topK = 5) {
        if (!this.open() || !this.hasTable("mem_conversation"))
            return [];
        const like = `%${(query || "").trim()}%`;
        try {
            return this.db.prepare("SELECT id, conversation_id, content, created_at_ms " +
                "FROM mem_conversation WHERE content LIKE ? ORDER BY created_at_ms DESC LIMIT ?").all(like, topK);
        }
        catch (e) {
            this.logger.debug?.(`[yaoyao:celia:db] readConversations failed: ${e.message}`);
            return [];
        }
    }
    /** Read L0 global user overview by tier. */
    readGlobalSummary(tier = "edge") {
        if (!this.open() || !this.hasTable("mem_global"))
            return [];
        try {
            return this.db.prepare("SELECT type, content, updated_at_ms FROM mem_global WHERE type = ? " +
                "ORDER BY updated_at_ms DESC LIMIT 1").all(tier);
        }
        catch (e) {
            this.logger.debug?.(`[yaoyao:celia:db] readGlobalSummary failed: ${e.message}`);
            return [];
        }
    }
    /** Read L1 scene index entries (path + summary). */
    readSceneIndex() {
        if (!this.open() || !this.hasTable("mem_l1_index"))
            return [];
        try {
            return this.db.prepare("SELECT path, summary FROM mem_l1_index ORDER BY updated_at_ms DESC").all();
        }
        catch (e) {
            this.logger.debug?.(`[yaoyao:celia:db] readSceneIndex failed: ${e.message}`);
            return [];
        }
    }
}
