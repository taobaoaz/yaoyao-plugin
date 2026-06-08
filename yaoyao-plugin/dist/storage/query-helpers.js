export function getStats(db, vector) {
    try {
        const totalCount = db.prepare('SELECT COUNT(*) as c FROM memory_meta').get();
        const total = totalCount?.c ?? 0;
        const datesRaw = db
            .prepare('SELECT date, COUNT(*) as c FROM memory_meta GROUP BY date ORDER BY date DESC LIMIT 10')
            .all();
        let vecCount = 0;
        let dims = 0;
        try {
            vecCount = vector?.count() ?? 0;
            dims = vector?.dimensions() ?? 0;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:query] Vector stats failed: ${msg}`);
        }
        return {
            totalMemories: total,
            datesSummary: datesRaw.map((r) => ({ date: r.date, count: r.c })),
            ftsEnabled: true,
            vecEnabled: vector?.isAvailable ?? false,
            totalVectors: vecCount,
            dimensions: dims,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Get stats failed: ${msg}`);
        return {
            totalMemories: 0,
            datesSummary: [],
            ftsEnabled: false,
            vecEnabled: false,
            totalVectors: 0,
            dimensions: 0,
        };
    }
}
export function getAllTags(db) {
    try {
        const rows = db.prepare('SELECT tag, memory_id FROM memory_tags').all();
        return rows;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Get all tags failed: ${msg}`);
        return [];
    }
}
export function getAllMeta(db) {
    try {
        const rows = db.prepare('SELECT id, date FROM memory_meta').all();
        return rows.map((r) => ({ id: r.id, filename: r.date ? `${r.date}.md` : `${r.id}.md` }));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Get all meta failed: ${msg}`);
        return [];
    }
}
export function getConfig(db, key, defaultValue) {
    try {
        const row = db.prepare('SELECT value FROM memory_config WHERE key = ?').get(key);
        return row ? row.value : (defaultValue ?? null);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Get config failed: ${msg}`);
        return defaultValue ?? null;
    }
}
export function setConfig(db, key, value) {
    try {
        db.prepare('INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)').run(key, value);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Set config failed: ${msg}`);
    }
}
export function updateMetadata(db, id, metadata) {
    try {
        db.prepare('UPDATE memory_meta SET meta = ? WHERE id = ?').run(metadata, id);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Update metadata failed: ${msg}`);
    }
}
export function incrementAccessCount(db, id) {
    try {
        const row = db
            .prepare('SELECT access_count, tier, importance FROM memory_meta WHERE id = ?')
            .get(id);
        if (!row)
            return;
        const newCount = (row.access_count || 0) + 1;
        let newTier = row.tier || 'active';
        if (newCount >= 10 && (row.importance || 0) >= 0.8)
            newTier = 'core';
        else if (newCount >= 3)
            newTier = 'working';
        db.prepare('UPDATE memory_meta SET access_count = ?, tier = ? WHERE id = ?').run(newCount, newTier, id);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Increment access count failed: ${msg}`);
    }
}
export function getMemoryMeta(db, id) {
    try {
        const row = db.prepare('SELECT meta FROM memory_meta WHERE id = ?').get(id);
        return row?.meta ?? null;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Get memory meta failed: ${msg}`);
        return null;
    }
}
export function searchByMetaRelations(db, limit) {
    try {
        const rows = db
            .prepare('SELECT id, date, user_text, meta FROM memory_meta ' +
            "WHERE meta IS NOT NULL AND json_extract(meta, '$.relations') IS NOT NULL " +
            'ORDER BY id DESC LIMIT ?')
            .all(limit);
        return rows;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Search by meta relations failed: ${msg}`);
        return [];
    }
}
export function countTags(db) {
    try {
        const totalRow = db.prepare('SELECT COUNT(*) as c FROM memory_tags').get();
        const uniqueRow = db.prepare('SELECT COUNT(DISTINCT tag) as c FROM memory_tags').get();
        return { total: totalRow?.c ?? 0, unique: uniqueRow?.c ?? 0 };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Count tags failed: ${msg}`);
        return { total: 0, unique: 0 };
    }
}
export function getRecentRawMemories(db, limit) {
    try {
        const rows = db
            .prepare('SELECT id, user_text, asst_text, date FROM memory_meta ORDER BY date DESC, id DESC LIMIT ?')
            .all(limit);
        return rows;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Get recent memories failed: ${msg}`);
        return [];
    }
}
export function searchByLike(db, query, limit) {
    try {
        const pattern = `%${query}%`;
        const rows = db
            .prepare('SELECT id, user_text, asst_text, date FROM memory_meta ' +
            'WHERE user_text LIKE ? OR asst_text LIKE ? ORDER BY date DESC LIMIT ?')
            .all(pattern, pattern, limit);
        return rows;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Search by like failed: ${msg}`);
        return [];
    }
}
export function batchSetConfig(db, entries) {
    if (entries.length === 0)
        return;
    try {
        db.exec('BEGIN TRANSACTION');
        const stmt = db.prepare('INSERT OR REPLACE INTO memory_config (key, value) VALUES (?, ?)');
        for (const e of entries)
            stmt.run(e.key, e.value);
        db.exec('COMMIT');
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:query] Batch set config failed: ${msg}`);
    }
}
