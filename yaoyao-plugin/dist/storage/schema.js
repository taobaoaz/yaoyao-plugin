/** All table creation SQLs, idempotent (IF NOT EXISTS). */
const SCHEMA_SQLS = [
    // FTS5 full-text search table
    `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    date, user_text, asst_text,
    tokenize='unicode61'
  )`,
    // Main metadata table
    `CREATE TABLE IF NOT EXISTS memory_meta (
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
    `CREATE TABLE IF NOT EXISTS memory_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL,
    memory_id INTEGER NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES memory_meta(id)
  )`,
    // Config key-value store
    `CREATE TABLE IF NOT EXISTS memory_config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];
/** Run all CREATE TABLE statements. Safe to call multiple times. */
export function ensureSchema(db) {
    db.exec('BEGIN TRANSACTION');
    try {
        for (const sql of SCHEMA_SQLS) {
            db.exec(sql);
        }
        db.exec('COMMIT');
    }
    catch (err) {
        try {
            db.exec('ROLLBACK');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory]  ignore : ${msg}`);
        }
        throw err;
    }
}
