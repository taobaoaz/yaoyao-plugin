/**
 * Access Tracker — 访问计数强化衰减
 * 从 Brain (memory-lancedb-pro) 学习：频繁访问的记忆衰减更慢
 * 零外部依赖，纯本地
 */
// Access count itself decays with a 30-day half-life
const ACCESS_DECAY_HALF_LIFE_DAYS = 30;
const MIN_ACCESS_COUNT = 0;
const MAX_ACCESS_COUNT = 10_000;
function clampAccessCount(value) {
    if (!Number.isFinite(value))
        return MIN_ACCESS_COUNT;
    return Math.min(MAX_ACCESS_COUNT, Math.max(MIN_ACCESS_COUNT, Math.floor(value)));
}
/**
 * Parse access-related fields from a metadata JSON string.
 * Always returns a valid AccessMetadata.
 */
export function parseAccessMetadata(metadata) {
    if (metadata === undefined || metadata === "") {
        return { accessCount: 0, lastAccessedAt: 0 };
    }
    let parsed;
    try {
        parsed = JSON.parse(metadata);
    }
    catch {
        return { accessCount: 0, lastAccessedAt: 0 };
    }
    if (typeof parsed !== "object" || parsed === null) {
        return { accessCount: 0, lastAccessedAt: 0 };
    }
    const obj = parsed;
    const rawCount = typeof obj.accessCount === "number" ? obj.accessCount : 0;
    const rawLastAccessed = typeof obj.lastAccessedAt === "number" ? obj.lastAccessedAt : 0;
    return {
        accessCount: clampAccessCount(rawCount),
        lastAccessedAt: Number.isFinite(rawLastAccessed) && rawLastAccessed >= 0 ? rawLastAccessed : 0,
    };
}
/**
 * Merge an access-count increment into existing metadata JSON.
 * Preserves ALL existing fields.
 */
export function buildUpdatedMetadata(existingMetadata, accessDelta) {
    let existing = {};
    if (existingMetadata !== undefined && existingMetadata !== "") {
        try {
            const parsed = JSON.parse(existingMetadata);
            if (typeof parsed === "object" && parsed !== null) {
                existing = { ...parsed };
            }
        }
        catch {
            // malformed JSON — start fresh
        }
    }
    const prev = parseAccessMetadata(existingMetadata);
    const newCount = clampAccessCount(prev.accessCount + accessDelta);
    return JSON.stringify({
        ...existing,
        accessCount: newCount,
        lastAccessedAt: Date.now(),
    });
}
/**
 * Compute effective half-life based on access history.
 * Frequently accessed memories decay more slowly (longer effective half-life).
 *
 * @param baseHalfLife — Base half-life in days (e.g. 30)
 * @param accessCount — Raw access count
 * @param lastAccessedAt — Timestamp (ms) of last access
 * @param reinforcementFactor — Scaling factor (0 = disabled)
 * @param maxMultiplier — Hard cap
 */
export function computeEffectiveHalfLife(baseHalfLife, accessCount, lastAccessedAt, reinforcementFactor, maxMultiplier) {
    if (reinforcementFactor === 0 || accessCount <= 0) {
        return baseHalfLife;
    }
    const now = Date.now();
    const daysSinceLastAccess = Math.max(0, (now - lastAccessedAt) / (1000 * 60 * 60 * 24));
    // Access freshness decays exponentially with 30-day half-life
    const accessFreshness = Math.exp(-daysSinceLastAccess * (Math.LN2 / ACCESS_DECAY_HALF_LIFE_DAYS));
    // Effective access count after freshness decay
    const effectiveAccessCount = accessCount * accessFreshness;
    // Logarithmic extension for diminishing returns
    const extension = baseHalfLife * reinforcementFactor * Math.log1p(effectiveAccessCount);
    const result = baseHalfLife + extension;
    const cap = baseHalfLife * maxMultiplier;
    return Math.min(result, cap);
}
