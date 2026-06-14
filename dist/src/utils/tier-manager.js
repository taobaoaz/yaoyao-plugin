/**
 * Tier Manager — Three-tier memory promotion/demotion (from Brain v1.1.0)
 * Zero external dependency, adapted for yaoyao's pure-local decay.
 *
 * Tiers:
 * - Core (decay floor 0.9): Identity-level facts, almost never forgotten
 * - Working (decay floor 0.7): Active context, ages out without reinforcement
 * - Peripheral (decay floor 0.5): Low-priority or aging memories
 */
/**
 * v1.9.0 — Adaptive TTL by MemoryType (factual / episodic /
 * procedural / emotional / etc). Each memory type gets its own
 * half-life in days; the cleaner uses this when it scores decay
 * instead of the single-tier default. The map is exported so
 * tests and other modules can introspect it.
 */
export const TTL_DAYS_BY_MEMORY_TYPE = Object.freeze({
    fact: 180, // objective facts decay slowly
    preference: 60, // user likes/dislikes drift; reset on re-confirmation
    event: 30, // specific dated events lose value fast
    entity: 180, // named entities (people, tools) are durable
    goal: 90, // goals/targets usually valid for a quarter
    relationship: 90, // relationships evolve but not daily
    behavior: 90, // habit patterns are stable
    general: 90, // catch-all default
});
/** Public read-only list of every supported memory type. */
export const SUPPORTED_MEMORY_TYPES = Object.freeze(Object.keys(TTL_DAYS_BY_MEMORY_TYPE));
/** Return the TTL (in days) for a given memory type. Unknown types
 *  fall back to the general default. */
export function getTtlDaysByType(memoryType) {
    if (!memoryType)
        return TTL_DAYS_BY_MEMORY_TYPE.general;
    const v = TTL_DAYS_BY_MEMORY_TYPE[memoryType];
    return typeof v === "number" ? v : TTL_DAYS_BY_MEMORY_TYPE.general;
}
export const DEFAULT_TIER_CONFIG = {
    coreAccessThreshold: 10,
    coreDecayThreshold: 0.7,
    coreImportanceThreshold: 0.8,
    peripheralDecayThreshold: 0.15,
    peripheralAgeDays: 60,
    workingAccessThreshold: 3,
    workingDecayThreshold: 0.4,
};
export function evaluateTier(memory, cfg = DEFAULT_TIER_CONFIG, now = Date.now()) {
    const ageDays = (now - memory.createdAt) / 86400000;
    // Promotion checks (high decay + high access + high importance)
    if (memory.tier === "peripheral") {
        if (memory.accessCount >= cfg.workingAccessThreshold &&
            memory.decayScore >= cfg.workingDecayThreshold) {
            return {
                memoryId: memory.id,
                fromTier: "peripheral",
                toTier: "working",
                reason: `access=${memory.accessCount}, decay=${memory.decayScore.toFixed(2)}`,
            };
        }
    }
    if (memory.tier === "working") {
        if (memory.accessCount >= cfg.coreAccessThreshold &&
            memory.decayScore >= cfg.coreDecayThreshold &&
            memory.importance >= cfg.coreImportanceThreshold) {
            return {
                memoryId: memory.id,
                fromTier: "working",
                toTier: "core",
                reason: `access=${memory.accessCount}, decay=${memory.decayScore.toFixed(2)}, importance=${memory.importance}`,
            };
        }
    }
    // Demotion checks (low decay or old age)
    if (memory.tier === "core") {
        if (memory.decayScore < cfg.coreDecayThreshold ||
            (ageDays > cfg.peripheralAgeDays && memory.accessCount < cfg.coreAccessThreshold / 2)) {
            return {
                memoryId: memory.id,
                fromTier: "core",
                toTier: "working",
                reason: `decay=${memory.decayScore.toFixed(2)} or age=${ageDays.toFixed(0)}d`,
            };
        }
    }
    if (memory.tier === "working") {
        if (memory.decayScore < cfg.peripheralDecayThreshold ||
            (ageDays > cfg.peripheralAgeDays && memory.accessCount < cfg.workingAccessThreshold)) {
            return {
                memoryId: memory.id,
                fromTier: "working",
                toTier: "peripheral",
                reason: `decay=${memory.decayScore.toFixed(2)} or age=${ageDays.toFixed(0)}d`,
            };
        }
    }
    return null;
}
export function evaluateAllTiers(memories, cfg = DEFAULT_TIER_CONFIG, now = Date.now()) {
    return memories
        .map((m) => evaluateTier(m, cfg, now))
        .filter((t) => t !== null);
}
