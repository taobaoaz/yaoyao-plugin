/**
 * storage/fts-utils.ts — FTS5 query utilities.
 */
/** Normalize FTS5 rank (negative = better) to a [0,1] score */
export function rankToScore(rank) {
    const r = Number(rank);
    if (!Number.isFinite(r))
        return 0.3;
    if (r < 0)
        return Math.min(1, Math.max(0.1, -r / 15));
    return 0.3;
}
/** Sanitize query for FTS5 MATCH syntax. */
export function sanitizeFTSQuery(query) {
    let s = query
        .replace(/["^`()~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    if (!s)
        return '';
    s = s.replace(/(^|\s)\*+(?=\s|$)/g, '$1').replace(/\*{2,}/g, '*');
    return s.trim();
}
