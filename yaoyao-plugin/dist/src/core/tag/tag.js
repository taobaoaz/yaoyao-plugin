/**
 * core/tag/tag.ts — Pure tag logic, zero platform awareness.
 */
export function ensureTagTable(db) {
    if (!db)
        throw new TypeError("ensureTagTable: db is required");
    db.exec("CREATE TABLE IF NOT EXISTS memory_tags (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
        "memory_id INTEGER NOT NULL, " +
        "tag TEXT NOT NULL COLLATE NOCASE, " +
        "created_at TEXT DEFAULT (datetime('now'))" +
        ")");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tags_memory ON memory_tags(memory_id)");
}
export function addTag(db, memoryId, tag) {
    if (!db)
        throw new TypeError("addTag: db is required");
    if (!Number.isFinite(memoryId))
        throw new TypeError("addTag: memoryId must be a number");
    if (typeof tag !== "string" || !tag.trim())
        throw new TypeError("addTag: tag must be a non-empty string");
    const stmt = db.prepare("INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)");
    stmt.run(memoryId, tag.trim().toLowerCase());
}
export function removeTag(db, memoryId, tag) {
    if (!db)
        throw new TypeError("removeTag: db is required");
    if (!Number.isFinite(memoryId))
        throw new TypeError("removeTag: memoryId must be a number");
    if (typeof tag !== "string" || !tag.trim())
        throw new TypeError("removeTag: tag must be a non-empty string");
    const stmt = db.prepare("DELETE FROM memory_tags WHERE memory_id = ? AND tag = ? COLLATE NOCASE");
    const result = stmt.run(memoryId, tag.trim().toLowerCase());
    return Number(result.changes ?? 0);
}
export function searchByTag(db, tag, limit) {
    if (!db)
        throw new TypeError("searchByTag: db is required");
    if (typeof tag !== "string" || !tag.trim())
        throw new TypeError("searchByTag: tag must be a non-empty string");
    if (!Number.isFinite(limit) || limit < 1)
        limit = 10;
    const stmt = db.prepare("SELECT m.rowid as memory_id, t.tag, m.user_text, m.asst_text, m.date " +
        "FROM memory_tags t " +
        "JOIN memory_meta m ON t.memory_id = m.rowid " +
        "WHERE t.tag = ? COLLATE NOCASE " +
        "ORDER BY m.date DESC LIMIT ?");
    const rows = stmt.all(tag.trim().toLowerCase(), limit);
    return rows.map((r) => ({
        memory_id: Number(r.memory_id),
        tag: String(r.tag),
        user_text: String(r.user_text || ""),
        asst_text: String(r.asst_text || ""),
        date: String(r.date || ""),
    }));
}
export function getPopularTags(db, limit) {
    if (!db)
        throw new TypeError("getPopularTags: db is required");
    if (!Number.isFinite(limit) || limit < 1)
        limit = 20;
    const stmt = db.prepare("SELECT tag, COUNT(*) as count FROM memory_tags GROUP BY tag ORDER BY count DESC LIMIT ?");
    const rows = stmt.all(limit);
    return rows.map((r) => ({
        tag: String(r.tag),
        count: Number(r.count),
    }));
}
export function getTagsForMemory(db, memoryId) {
    if (!db)
        throw new TypeError("getTagsForMemory: db is required");
    if (!Number.isFinite(memoryId))
        throw new TypeError("getTagsForMemory: memoryId must be a number");
    const stmt = db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ?");
    const rows = stmt.all(memoryId);
    return rows.map((r) => String(r.tag));
}
export function deleteTagsForMemory(db, memoryId) {
    if (!db)
        throw new TypeError("deleteTagsForMemory: db is required");
    if (!Number.isFinite(memoryId))
        throw new TypeError("deleteTagsForMemory: memoryId must be a number");
    const stmt = db.prepare("DELETE FROM memory_tags WHERE memory_id = ?");
    const result = stmt.run(memoryId);
    return Number(result.changes ?? 0);
}
export function getTotalTagCount(db) {
    if (!db)
        throw new TypeError("getTotalTagCount: db is required");
    const row = db.prepare("SELECT COUNT(*) as c FROM memory_tags").get();
    return Number(row?.c ?? 0);
}
// ── Tool-level helpers (used by features/tag/tool.ts) ──
export function addTagsToQuery(db, query, tags, limit) {
    if (!db)
        throw new TypeError("addTagsToQuery: db is required");
    if (!Array.isArray(tags))
        throw new TypeError("addTagsToQuery: tags must be an array");
    const searchSql = query.trim()
        ? "SELECT rowid as memory_id, user_text, asst_text, date FROM memory_meta WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\' LIMIT ?"
        : "SELECT rowid as memory_id, user_text, asst_text, date FROM memory_meta LIMIT ?";
    const searchStmt = db.prepare(searchSql);
    const safeQuery = query.trim().replace(/\//g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rows = query.trim()
        ? searchStmt.all(`%${safeQuery}%`, `%${safeQuery}%`, limit)
        : searchStmt.all(limit);
    let matched = 0;
    let added = 0;
    for (const r of rows) {
        const memoryId = Number(r.memory_id);
        matched++;
        for (const tag of tags) {
            try {
                addTag(db, memoryId, tag);
                added++;
            }
            catch { /* tag may already exist */ }
        }
    }
    return { matched, added };
}
export function removeTags(db, tags) {
    if (!db)
        throw new TypeError("removeTags: db is required");
    if (!Array.isArray(tags))
        throw new TypeError("removeTags: tags must be an array");
    let total = 0;
    const stmt = db.prepare("DELETE FROM memory_tags WHERE tag = ? COLLATE NOCASE");
    for (const tag of tags) {
        const result = stmt.run(tag.trim().toLowerCase());
        total += Number(result.changes ?? 0);
    }
    return total;
}
export function removeAllTags(db) {
    if (!db)
        throw new TypeError("removeAllTags: db is required");
    const result = db.prepare("DELETE FROM memory_tags").run();
    return Number(result.changes ?? 0);
}
export function cleanOrphanTags(db) {
    if (!db)
        throw new TypeError("cleanOrphanTags: db is required");
    const result = db.prepare("DELETE FROM memory_tags WHERE memory_id NOT IN (SELECT rowid FROM memory_meta)").run();
    return Number(result.changes ?? 0);
}
export function searchByTagWithQuery(db, tag, query, limit) {
    if (!db)
        throw new TypeError("searchByTagWithQuery: db is required");
    if (typeof tag !== "string" || !tag.trim())
        throw new TypeError("searchByTagWithQuery: tag must be a non-empty string");
    if (!Number.isFinite(limit) || limit < 1)
        limit = 10;
    const trimmedTag = tag.trim().toLowerCase();
    const trimmedQuery = query.trim();
    const sql = trimmedQuery
        ? "SELECT m.rowid as memory_id, t.tag, m.user_text, m.asst_text, m.date FROM memory_tags t JOIN memory_meta m ON t.memory_id = m.rowid WHERE t.tag = ? COLLATE NOCASE AND (m.user_text LIKE ? ESCAPE '\\' OR m.asst_text LIKE ? ESCAPE '\\') ORDER BY m.date DESC LIMIT ?"
        : "SELECT m.rowid as memory_id, t.tag, m.user_text, m.asst_text, m.date FROM memory_tags t JOIN memory_meta m ON t.memory_id = m.rowid WHERE t.tag = ? COLLATE NOCASE ORDER BY m.date DESC LIMIT ?";
    const stmt = db.prepare(sql);
    const safeQuery = trimmedQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rows = trimmedQuery
        ? stmt.all(trimmedTag, `%${safeQuery}%`, `%${safeQuery}%`, limit)
        : stmt.all(trimmedTag, limit);
    return rows.map((r) => ({
        memory_id: Number(r.memory_id),
        tag: String(r.tag),
        user_text: String(r.user_text || ""),
        asst_text: String(r.asst_text || ""),
        date: String(r.date || ""),
    }));
}
