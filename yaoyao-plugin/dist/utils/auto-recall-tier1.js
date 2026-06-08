/**
 * Auto-Recall Tier 1 — 记忆注入治理
 * 从 Brain (memory-lancedb-pro) 学习：防止坏回忆反复注入
 * 纯本地，零外部依赖
 */
export const TIER1_BAD_RECALL_SUPPRESSION_THRESHOLD = 3;
export const TIER1_DEFAULT_BAD_RECALL_DECAY_MS = 86_400_000; // 24h
export const TIER1_DEFAULT_SUPPRESSION_DURATION_MS = 1_800_000; // 30min
/** Is this memory currently suppressed from auto-recall? */
export function isSuppressed(meta, nowMs) {
    const until = meta.suppressed_until_ms ?? 0;
    return until > 0 && nowMs < until;
}
/** Has the previous injection of this memory ever been confirmed? */
function isStaleInjection(meta) {
    return (typeof meta.last_injected_at === 'number' &&
        meta.last_injected_at > 0 &&
        (typeof meta.last_confirmed_use_at !== 'number' ||
            meta.last_confirmed_use_at < meta.last_injected_at));
}
/** Compute metadata patch after Tier 1 auto-recall injects a memory. */
export function computeTier1Patch(meta, opts) {
    const { injectedAt, badRecallDecayMs = TIER1_DEFAULT_BAD_RECALL_DECAY_MS, suppressionDurationMs = TIER1_DEFAULT_SUPPRESSION_DURATION_MS, minRepeated = 0, } = opts;
    const accessCount = meta.access_count ?? 0;
    const injectedCount = meta.injected_count ?? 0;
    const rawBadRecall = meta.bad_recall_count ?? 0;
    const turnLegacy = meta.suppressed_until_turn ?? 0;
    // Lazy heal: reset legacy pollution for never-touched memories
    let baseBadRecall = rawBadRecall;
    if (meta.suppressed_until_ms === undefined && (rawBadRecall > 0 || turnLegacy > 0)) {
        baseBadRecall = 0;
    }
    // Decay: if gap since last injection exceeds window, reset bad_recall_count
    const gapSinceLastInjection = typeof meta.last_injected_at === 'number' ? injectedAt - meta.last_injected_at : Infinity;
    const decayedBadRecall = badRecallDecayMs > 0 && gapSinceLastInjection > badRecallDecayMs ? 0 : baseBadRecall;
    const staleInjected = isStaleInjection(meta);
    const nextBadRecallCount = staleInjected ? decayedBadRecall + 1 : decayedBadRecall;
    const shouldSuppress = nextBadRecallCount >= TIER1_BAD_RECALL_SUPPRESSION_THRESHOLD && minRepeated > 0;
    return {
        access_count: accessCount + 1,
        last_accessed_at: injectedAt,
        injected_count: injectedCount + 1,
        last_injected_at: injectedAt,
        bad_recall_count: nextBadRecallCount,
        suppressed_until_ms: shouldSuppress
            ? Math.max(meta.suppressed_until_ms ?? 0, injectedAt + suppressionDurationMs)
            : (meta.suppressed_until_ms ?? 0),
        suppressed_until_turn: 0,
    };
}
