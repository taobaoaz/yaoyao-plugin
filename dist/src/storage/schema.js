/** Canonical table names used by yaoyao. Centralised so prefix changes
 *  are a single-source-of-truth edit. */
export const TABLES = {
    meta: "yaoyao_meta",
    fts: "yaoyao_fts",
    tags: "yaoyao_tags",
    config: "yaoyao_config",
    vec: "yaoyao_vec",
    vecMeta: "yaoyao_vec_meta",
};
/** All table creation SQLs, idempotent (IF NOT EXISTS). */
const SCHEMA_SQLS = [
    // FTS5 full-text search table
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${TABLES.fts} USING fts5(
    date, user_text, asst_text,
    tokenize='unicode61'
  )`,
    // Main metadata table
    `CREATE TABLE IF NOT EXISTS ${TABLES.meta} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    user_text TEXT,
    asst_text TEXT,
    meta TEXT,
    access_count INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'active',
    importance REAL DEFAULT 0.5,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
    // Tag junction table
    `CREATE TABLE IF NOT EXISTS ${TABLES.tags} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL,
    memory_id INTEGER NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES ${TABLES.meta}(id)
  )`,
    // Config key-value store
    `CREATE TABLE IF NOT EXISTS ${TABLES.config} (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];
/** Public read-only views, idempotent. These are the recommended way
 *  for other plugins/agents to query yaoyao data without depending on
 *  the internal table layout. */
const VIEW_SQLS = [
    // Flat memory view: every active (non-superseded) memory, with the
    // most useful columns surfaced. `superseded_by` is extracted from the
    // JSON `meta` column so external readers don't need to parse it.
    `CREATE VIEW IF NOT EXISTS yaoyao_memories AS
     SELECT id, date, user_text, asst_text, access_count, tier, importance,
            created_at,
            json_extract(meta, '$.superseded_by') AS superseded_by,
            json_extract(meta, '$.memory_type')  AS memory_type
     FROM ${TABLES.meta}
     WHERE json_extract(meta, '$.superseded_by') IS NULL`,
    // Memory × tag join, for external tag browsing.
    `CREATE VIEW IF NOT EXISTS yaoyao_tags_view AS
     SELECT m.id AS memory_id, m.date, t.tag
     FROM ${TABLES.tags} t
     JOIN ${TABLES.meta} m ON t.memory_id = m.id
     WHERE json_extract(m.meta, '$.superseded_by') IS NULL`,
    // Compact "is this memory alive?" view — count and date range.
    `CREATE VIEW IF NOT EXISTS yaoyao_overview AS
     SELECT COUNT(*)              AS total_memories,
            MIN(date)             AS earliest_date,
            MAX(date)             AS latest_date,
            SUM(access_count)     AS total_accesses,
            AVG(importance)       AS avg_importance
     FROM ${TABLES.meta}
     WHERE json_extract(meta, '$.superseded_by') IS NULL`,
];
/** Run all CREATE TABLE statements. Safe to call multiple times. */
export function ensureSchema(db) {
    db.exec("BEGIN TRANSACTION");
    try {
        for (const sql of SCHEMA_SQLS) {
            db.exec(sql);
        }
        for (const sql of VIEW_SQLS) {
            db.exec(sql);
        }
        db.exec("COMMIT");
    }
    catch (err) {
        try {
            db.exec("ROLLBACK");
        }
        catch { /* ignore */ }
        throw err;
    }
}
