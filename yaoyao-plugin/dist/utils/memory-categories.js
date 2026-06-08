/**
 * Memory Categories — 6-category classification system (from Brain v1.1.0)
 * Zero external dependency.
 *
 * Categories:
 * - profile:     Identity-level facts (name, role, preferences)
 * - preferences: Explicit preferences (likes, dislikes)
 * - entities:    Named entities (people, places, things)
 * - events:      Time-bounded events (meetings, decisions)
 * - cases:       Problem-solving cases (bugs, fixes, patterns)
 * - patterns:    Recurring behavioral patterns
 */
export const MEMORY_CATEGORIES = [
    'profile',
    'preferences',
    'entities',
    'events',
    'cases',
    'patterns',
];
/** Categories that always merge (skip dedup entirely). */
export const ALWAYS_MERGE_CATEGORIES = new Set(['profile']);
/** Categories that support MERGE decision from dedup. */
export const MERGE_SUPPORTED_CATEGORIES = new Set([
    'preferences',
    'entities',
    'patterns',
]);
/** Categories whose facts can be replaced over time without deleting history. */
export const TEMPORAL_VERSIONED_CATEGORIES = new Set(['preferences', 'entities']);
/** Categories that are append-only (CREATE or SKIP only, no MERGE). */
export const APPEND_ONLY_CATEGORIES = new Set(['events', 'cases']);
/** Validate and normalize a category string. */
export function normalizeCategory(raw) {
    const lower = raw.toLowerCase().trim();
    if (MEMORY_CATEGORIES.includes(lower)) {
        return lower;
    }
    return null;
}
/**
 * Map legacy 5-category (preference/fact/decision/entity/other/reflection)
 * to new 6-category system.
 */
export function legacyToNewCategory(old, text) {
    switch (old.toLowerCase()) {
        case 'preference':
            return 'preferences';
        case 'entity':
            return 'entities';
        case 'decision':
            return text && text.length > 80 ? 'cases' : 'events';
        case 'reflection':
            return 'patterns';
        case 'other':
        case 'fact':
        default:
            // Heuristic: short text → profile, long text → patterns
            if (text && text.length < 60)
                return 'profile';
            return 'patterns';
    }
}
