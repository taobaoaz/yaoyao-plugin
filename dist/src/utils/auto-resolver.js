import { TABLES } from "../storage/schema.js";
export const DECISION_WEIGHTS = {
    recency: 0.45,
    source: 0.30,
    access: 0.15,
    importance: 0.10,
};
export const SOURCE_WEIGHTS = {
    user: 1.0,
    agent: 0.6,
    tool: 0.3,
    unknown: 0.5,
};
const HALF_LIFE_DAYS = 30;
function clamp01(n) {
    if (!Number.isFinite(n))
        return 0;
    if (n < 0)
        return 0;
    if (n > 1)
        return 1;
    return n;
}
export function scoreCandidate(c, now = Date.now()) {
    const ageDays = Math.max(0, (now - parseDateMs(c.date)) / 86_400_000);
    const recency = 1 - clamp01(ageDays / HALF_LIFE_DAYS);
    const src = SOURCE_WEIGHTS[c.source] ?? SOURCE_WEIGHTS.unknown;
    const access = clamp01((c.accessCount ?? 0) / 10);
    const importance = clamp01(c.importance ?? 0);
    return (DECISION_WEIGHTS.recency * recency +
        DECISION_WEIGHTS.source * src +
        DECISION_WEIGHTS.access * access +
        DECISION_WEIGHTS.importance * importance);
}
export function pickWinner(a, b, now = Date.now()) {
    const sa = scoreCandidate(a, now);
    const sb = scoreCandidate(b, now);
    const gap = Math.abs(sa - sb);
    if (gap < 0.01) {
        const winner = a.id >= b.id ? a : b;
        const loser = winner === a ? b : a;
        return { winner, loser, scoreGap: gap, reason: "tie broken by recency of write" };
    }
    const winner = sa >= sb ? a : b;
    const loser = winner === a ? b : a;
    return { winner, loser, scoreGap: gap, reason: "higher recency+source score" };
}
function applyResolution(db, winner, loser, now = Date.now()) {
    const winnerMeta = (winner.meta ?? {});
    const loserMeta = (loser.meta ?? {});
    const supersededAt = Array.isArray(loserMeta.supersededAt)
        ? loserMeta.supersededAt
        : [];
    supersededAt.push(now);
    loserMeta.superseded_by = winner.id;
    loserMeta.supersededAt = supersededAt;
    const supersedes = Array.isArray(winnerMeta.supersedes)
        ? winnerMeta.supersedes
        : [];
    if (!supersedes.includes(loser.id))
        supersedes.push(loser.id);
    winnerMeta.supersedes = supersedes;
    db.exec("BEGIN");
    try {
        db.prepare(`UPDATE ${TABLES.meta} SET meta = ? WHERE id = ?`).run(JSON.stringify(loserMeta), loser.id);
        db.prepare(`UPDATE ${TABLES.meta} SET meta = ? WHERE id = ?`).run(JSON.stringify(winnerMeta), winner.id);
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
export function resolveConflictPairs(db, pairs, now = Date.now()) {
    const result = {
        consideredPairs: pairs.length,
        resolvedPairs: 0,
        skippedPairs: 0,
        actions: [],
    };
    if (pairs.length === 0)
        return result;
    const taken = new Set();
    const dedup = [];
    for (const [a, b] of pairs) {
        if (taken.has(a) || taken.has(b))
            continue;
        taken.add(a);
        taken.add(b);
        dedup.push([a, b]);
    }
    const rows = loadRows(db, dedup.flatMap(([a, b]) => [a, b]));
    for (const [a, b] of dedup) {
        const ra = rows.get(a);
        const rb = rows.get(b);
        if (!ra || !rb) {
            result.skippedPairs++;
            continue;
        }
        if (isSuperseded(ra) || isSuperseded(rb)) {
            result.skippedPairs++;
            continue;
        }
        const { winner, loser, scoreGap, reason } = pickWinner(ra, rb, now);
        try {
            applyResolution(db, winner, loser, now);
            result.resolvedPairs++;
            result.actions.push({ winnerId: winner.id, loserId: loser.id, scoreGap, reason });
        }
        catch {
            result.skippedPairs++;
        }
    }
    return result;
}
export function autoResolveAll(db, opts = {}) {
    const maxRows = opts.maxRows ?? 5000;
    const minScoreGap = opts.minScoreGap ?? 0.05;
    const rows = db.prepare(`SELECT id, date, user_text, meta, access_count, importance
     FROM ${TABLES.meta}
     WHERE json_extract(meta, '$.superseded_by') IS NULL
     ORDER BY date DESC, id DESC
     LIMIT ?`).all(maxRows);
    const buckets = new Map();
    for (const r of rows) {
        const t = (r.user_text ?? "").trim().slice(0, 30);
        if (t.length < 5)
            continue;
        const key = `${r.date}::${t}`;
        const arr = buckets.get(key);
        if (arr)
            arr.push(r.id);
        else
            buckets.set(key, [r.id]);
    }
    const pairs = [];
    for (const ids of buckets.values()) {
        if (ids.length < 2)
            continue;
        const head = ids[0];
        for (let i = 1; i < ids.length; i++)
            pairs.push([head, ids[i]]);
    }
    const base = resolveConflictPairs(db, pairs);
    base.actions = base.actions.filter(a => a.scoreGap >= minScoreGap);
    base.resolvedPairs = base.actions.length;
    base.skippedPairs = base.consideredPairs - base.resolvedPairs;
    return base;
}
function loadRows(db, ids) {
    if (ids.length === 0)
        return new Map();
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id, date, user_text, meta, access_count, importance
     FROM ${TABLES.meta} WHERE id IN (${placeholders})`).all(...ids);
    const out = new Map();
    for (const r of rows) {
        let metaObj = null;
        if (r.meta) {
            try {
                metaObj = JSON.parse(r.meta);
            }
            catch {
                metaObj = null;
            }
        }
        out.set(r.id, {
            id: r.id,
            date: r.date,
            source: inferSource(metaObj, r.user_text),
            importance: typeof r.importance === "number" ? r.importance : 0.5,
            accessCount: r.access_count ?? 0,
            meta: metaObj,
        });
    }
    return out;
}
function inferSource(meta, userText) {
    if (meta) {
        const s = meta.source;
        if (s === "user" || s === "agent" || s === "tool")
            return s;
    }
    if (userText && /^\s*(AI|Assistant)\s*[:：]/i.test(userText))
        return "agent";
    return "user";
}
function isSuperseded(row) {
    return !!(row.meta && row.meta.superseded_by);
}
function parseDateMs(date) {
    const t = Date.parse(date);
    return Number.isFinite(t) ? t : 0;
}
