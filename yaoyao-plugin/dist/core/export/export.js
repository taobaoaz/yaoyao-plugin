/**
 * core/export/export.ts — Pure export logic, zero platform awareness.
 */
export function queryForExport(db, limit, dateFrom, dateTo, keyword) {
    if (!db)
        throw new TypeError('queryForExport: db is required');
    if (!Number.isFinite(limit) || limit < 1)
        limit = 100;
    let sql = 'SELECT date, user_text, asst_text FROM memory_meta WHERE 1=1';
    const args = [];
    if (dateFrom) {
        sql += ' AND date >= ?';
        args.push(dateFrom);
    }
    if (dateTo) {
        sql += ' AND date <= ?';
        args.push(dateTo);
    }
    if (keyword) {
        const safeKw = keyword.replace(/\//g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        sql += " AND (user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\')";
        args.push(`%${safeKw}%`, `%${safeKw}%`);
    }
    sql += ' ORDER BY date DESC LIMIT ?';
    args.push(limit);
    const rows = db.prepare(sql).all(...args);
    return rows.map((r) => ({
        date: String(r.date || ''),
        user_text: String(r.user_text || ''),
        asst_text: String(r.asst_text || ''),
    }));
}
export function formatJSONL(rows) {
    if (!Array.isArray(rows))
        throw new TypeError('formatJSONL: rows must be an array');
    return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
