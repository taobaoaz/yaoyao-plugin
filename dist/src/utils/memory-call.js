/**
 * utils/memory-call.ts — Structured MemoryCall query interface.
 *
 * Upgrades plain-string queries to structured calls with intent,
 * time range, and entity filters. Inspired by MemOS MemoryCall.
 *
 * Usage:
 *   const call = parseMemoryCall("上周关于部署的讨论");
 *   // → { query: "部署", intent: "factual", timeRange: { relative: "last_week" } }
 */
// ── Intent detection patterns ──
const INTENT_PATTERNS = {
    factual: [/什么|多少|哪里|谁|什么时候|为什么|如何|怎么|怎样|是什么|有哪些/i, /what|how many|where|who|when|why|how to/i],
    emotional: [/感觉|觉得|喜欢|讨厌|开心|难过|担心|希望|失望|满意|不满/i, /feel|like|love|hate|happy|sad|worried|hope/i],
    procedural: [/步骤|流程|怎么做|如何操作|教程|指南|第一步/i, /step|guide|tutorial|how do|procedure|process/i],
    exploratory: [/看看|了解一下|探索|发现|相关|连接|趋势/i, /explore|discover|related|connection|trend|overview/i],
};
// ── Time range detection ──
const RELATIVE_TIME_PATTERNS = [
    { pattern: /今天|today/i, value: "today" },
    { pattern: /昨天|yesterday/i, value: "yesterday" },
    { pattern: /上周|上星期|last week/i, value: "last_week" },
    { pattern: /上个月|last month/i, value: "last_month" },
    { pattern: /最近|recently|lately/i, value: "recent" },
];
// ── Public API ──
/**
 * Parse a natural language query into a structured MemoryCall.
 * Rule-based — zero LLM calls, zero external deps.
 */
export function parseMemoryCall(input) {
    if (!input || input.trim().length < 2)
        return { query: input || "" };
    const lower = input.toLowerCase();
    // Detect intent
    let intent;
    for (const [key, patterns] of Object.entries(INTENT_PATTERNS)) {
        if (patterns.some(p => p.test(input))) {
            intent = key;
            break;
        }
    }
    // Default: factual for questions, exploratory for open-ended
    if (!intent) {
        intent = /[?？]/.test(input) ? "factual" : "exploratory";
    }
    // Detect time range
    let timeRange;
    for (const { pattern, value } of RELATIVE_TIME_PATTERNS) {
        if (pattern.test(input)) {
            timeRange = { relative: value };
            break;
        }
    }
    // Extract participants (simple heuristic: quoted names or capitalized words after "和|with")
    const participants = [];
    const participantMatch = input.match(/(?:和|with|跟|与)\s*["']?([^"'，,。！?\n]{2,20})["']?/i);
    if (participantMatch)
        participants.push(participantMatch[1].trim());
    // Clean query: remove time phrases and intent markers to get core terms
    let query = input;
    for (const { pattern } of RELATIVE_TIME_PATTERNS) {
        query = query.replace(pattern, "");
    }
    query = query.replace(/[?？!！.,，。]/g, " ").replace(/\s+/g, " ").trim();
    return {
        query: query || input,
        intent,
        timeRange,
        participants: participants.length > 0 ? participants : undefined,
    };
}
/**
 * Convert a MemoryCall back to a search string for FTS5 / vector search.
 * Preserves intent and time filters for post-processing.
 */
export function buildSearchQuery(call) {
    let q = call.query;
    // Append participants for broader matching
    if (call.participants) {
        q += " " + call.participants.join(" ");
    }
    // Append topics
    if (call.topics) {
        q += " " + call.topics.join(" ");
    }
    return q.trim();
}
/**
 * Compute a date filter SQL clause from a MemoryCall timeRange.
 * Returns { clause: string, params: string[] } for parameterized queries.
 */
export function buildDateFilter(timeRange, tz = "Asia/Shanghai") {
    if (!timeRange)
        return null;
    const now = new Date();
    const fmt = (d) => d.toLocaleDateString("sv-SE", { timeZone: tz });
    if (timeRange.relative) {
        switch (timeRange.relative) {
            case "today": {
                const d = fmt(now);
                return { clause: "date = ?", params: [d] };
            }
            case "yesterday": {
                const d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                return { clause: "date = ?", params: [fmt(d)] };
            }
            case "last_week": {
                const end = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
                return { clause: "date >= ? AND date <= ?", params: [fmt(start), fmt(end)] };
            }
            case "last_month": {
                const end = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
                return { clause: "date >= ? AND date <= ?", params: [fmt(start), fmt(end)] };
            }
            case "recent": {
                const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return { clause: "date >= ?", params: [fmt(start)] };
            }
        }
    }
    if (timeRange.startDate && timeRange.endDate) {
        return { clause: "date >= ? AND date <= ?", params: [timeRange.startDate, timeRange.endDate] };
    }
    if (timeRange.startDate) {
        return { clause: "date >= ?", params: [timeRange.startDate] };
    }
    if (timeRange.endDate) {
        return { clause: "date <= ?", params: [timeRange.endDate] };
    }
    return null;
}
