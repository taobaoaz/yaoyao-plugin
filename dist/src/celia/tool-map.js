/**
 * celia/tool-map.ts — yaoyao ↔ celia tool delegation mapping.
 *
 * v1.9.1: Defines which yaoyao tools overlap with celia (same-purpose data
 * operations) and how their argument schemas translate. When celia owns the
 * memory slot, these overlapping tools delegate to celia so there is a single
 * source of truth (no double-write / divergent data).
 *
 * Convention:
 *   - `map`: transforms yaoyao params → celia tool arguments.
 *   - `unmap`: normalizes celia's MCP result text back into yaoyao's tool
 *     result shape (content array). Identity by default since celia already
 *     returns MCP content blocks.
 *
 * celia tool list & schemas are from celia-memory-architecture §4.1/§14.
 * yaoyao tenant/user/session defaults come from celia §13.1 config.
 */
/** Default identity context injected into every celia call (§13.1). */
const DEFAULT_TENANT = "default";
const DEFAULT_USER = "tools-openclaw-user";
/** Shared sessionId extractor: yaoyao tools don't carry it, so synthesize one. */
function synthesizeSessionId(p) {
    return p.sessionId || p.session_id || `yaoyao-${Date.now()}`;
}
/** yaoyao tools spell "limit" variously; pick whichever is present. */
function pickLimit(p, dflt) {
    const v = p.topK ?? p.maxResults ?? p.limit ?? p.top_k ?? p.max_results;
    return typeof v === "number" ? v : dflt;
}
/** yaoyao search query field name varies; normalize to a string. */
function pickQuery(p) {
    return p.query ?? p.keyword ?? p.q ?? "";
}
/**
 * The delegation map. Keyed by yaoyao tool name.
 * Only *overlapping* tools belong here — celia-unique tools are proxied
 * separately (see proxy-tools.ts), and yaoyao-unique tools never delegate.
 */
export const CELIA_DELEGATION_MAP = {
    // memory_save({content}) → celia memory_store({text})
    // yaoyao uses `content`; celia uses `text`.
    memory_save: {
        celiaTool: "memory_store",
        map: (p) => ({ text: p.content ?? p.text ?? "" }),
    },
    // memory_forget({query?, date?}) → celia memory_forget({query?})
    // celia forgets by query or id; yaoyao's `date` has no direct celia equivalent,
    // so only `query` is forwarded (date-based forget falls back to yaoyao).
    memory_forget: {
        celiaTool: "memory_forget",
        map: (p) => ({
            query: p.query ?? "",
        }),
    },
    // memory_search({query, maxResults}) → celia memory_record_search (L2 atomic facts)
    memory_search: {
        celiaTool: "memory_record_search",
        map: (p) => ({
            query: pickQuery(p),
            top_k: pickLimit(p, 5),
            is_procedural: false,
            time_hint: true,
            tenant_id: DEFAULT_TENANT,
            user_id: DEFAULT_USER,
            sessionId: synthesizeSessionId(p),
        }),
    },
    // memory_search_multi → same celia target (multi-signal fused at celia side)
    memory_search_multi: {
        celiaTool: "memory_record_search",
        map: (p) => ({
            query: pickQuery(p),
            top_k: pickLimit(p, 5),
            is_procedural: false,
            time_hint: true,
            tenant_id: DEFAULT_TENANT,
            user_id: DEFAULT_USER,
            sessionId: synthesizeSessionId(p),
        }),
    },
    // memory_search_enhanced → same
    memory_search_enhanced: {
        celiaTool: "memory_record_search",
        map: (p) => ({
            query: pickQuery(p),
            top_k: pickLimit(p, 5),
            is_procedural: false,
            time_hint: true,
            tenant_id: DEFAULT_TENANT,
            user_id: DEFAULT_USER,
            sessionId: synthesizeSessionId(p),
        }),
    },
    // memory_get({id}) → celia has no direct by-id tool; route via list filter.
    // Falls back to yaoyao's own store (handled by wrapper fallback).
    // Not in map → wrapper treats as non-delegatable.
    // memory_list({categories?}) → celia memory_list
    memory_list: {
        celiaTool: "memory_list",
        map: (p) => ({
            categories: p.categories ?? [],
        }),
    },
    // NOTE: memory_atomic_fact is intentionally NOT delegated. It is an
    // action-based tool (extract/query/summarize/list) with a `handler`
    // shape rather than `execute`, and its extract logic is yaoyao-native.
    // celia's L2 facts are reachable via the search_* delegations above.
};
/** Does a yaoyao tool have a celia delegation mapping? */
export function isDelegatable(yaoyaoToolName) {
    return yaoyaoToolName in CELIA_DELEGATION_MAP;
}
/** Get the mapping for a tool, or null. */
export function getMapping(yaoyaoToolName) {
    return CELIA_DELEGATION_MAP[yaoyaoToolName] ?? null;
}
