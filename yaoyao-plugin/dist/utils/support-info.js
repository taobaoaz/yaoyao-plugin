/**
 * Support Info V2 — 上下文化证据统计
 * 从 Brain (memory-lancedb-pro) 学习：按上下文记录支持/矛盾证据
 * 零外部依赖，纯本地
 */
/** Predefined context vocabulary for support slices */
export const SUPPORT_CONTEXT_VOCABULARY = [
    'general',
    'morning',
    'afternoon',
    'evening',
    'night',
    'weekday',
    'weekend',
    'work',
    'leisure',
    'summer',
    'winter',
    'travel',
];
/** Max number of context slices per memory to prevent metadata bloat */
export const MAX_SUPPORT_SLICES = 8;
/**
 * Normalize a raw context label to a canonical context.
 * Maps common variants (e.g. "晚上" → "evening") and falls back to "general".
 */
export function normalizeContext(raw) {
    if (!raw || !raw.trim())
        return 'general';
    const lower = raw.trim().toLowerCase();
    // Direct vocabulary match
    if (SUPPORT_CONTEXT_VOCABULARY.includes(lower)) {
        return lower;
    }
    // Common Chinese/English mappings
    const aliases = {
        早上: 'morning',
        上午: 'morning',
        早晨: 'morning',
        下午: 'afternoon',
        傍晚: 'evening',
        晚上: 'evening',
        深夜: 'night',
        夜晚: 'night',
        凌晨: 'night',
        工作日: 'weekday',
        平时: 'weekday',
        周末: 'weekend',
        假日: 'weekend',
        休息日: 'weekend',
        工作: 'work',
        上班: 'work',
        办公: 'work',
        休闲: 'leisure',
        放松: 'leisure',
        休息: 'leisure',
        夏天: 'summer',
        夏季: 'summer',
        冬天: 'winter',
        冬季: 'winter',
        旅行: 'travel',
        出差: 'travel',
        旅游: 'travel',
    };
    return aliases[lower] || lower; // keep as custom context if not mapped
}
/**
 * Parse support_info from metadata JSON. Handles V1 (flat) → V2 (sliced) migration.
 */
export function parseSupportInfo(raw) {
    const defaultV2 = {
        global_strength: 0.5,
        total_observations: 0,
        slices: [],
    };
    if (!raw || typeof raw !== 'object')
        return defaultV2;
    const obj = raw;
    // V2 format: has slices array
    if (Array.isArray(obj.slices)) {
        return {
            global_strength: typeof obj.global_strength === 'number' ? obj.global_strength : 0.5,
            total_observations: typeof obj.total_observations === 'number' ? obj.total_observations : 0,
            slices: obj.slices
                .filter((s) => s && typeof s.context === 'string')
                .map((s) => ({
                context: String(s.context),
                confirmations: typeof s.confirmations === 'number' && s.confirmations >= 0 ? s.confirmations : 0,
                contradictions: typeof s.contradictions === 'number' && s.contradictions >= 0 ? s.contradictions : 0,
                strength: typeof s.strength === 'number' && s.strength >= 0 && s.strength <= 1 ? s.strength : 0.5,
                last_observed_at: typeof s.last_observed_at === 'number' ? s.last_observed_at : Date.now(),
            })),
        };
    }
    // V1 format: flat { confirmations, contradictions, strength }
    const conf = typeof obj.confirmations === 'number' ? obj.confirmations : 0;
    const contra = typeof obj.contradictions === 'number' ? obj.contradictions : 0;
    const total = conf + contra;
    if (total === 0)
        return defaultV2;
    return {
        global_strength: total > 0 ? conf / total : 0.5,
        total_observations: total,
        slices: [
            {
                context: 'general',
                confirmations: conf,
                contradictions: contra,
                strength: total > 0 ? conf / total : 0.5,
                last_observed_at: Date.now(),
            },
        ],
    };
}
/**
 * Update support stats for a specific context.
 * Returns a new SupportInfoV2 with the updated slice.
 */
export function updateSupportStats(existing, contextLabel, event) {
    const ctx = normalizeContext(contextLabel);
    const base = { ...existing, slices: [...existing.slices.map((s) => ({ ...s }))] };
    // Find or create the context slice
    let slice = base.slices.find((s) => s.context === ctx);
    if (!slice) {
        slice = {
            context: ctx,
            confirmations: 0,
            contradictions: 0,
            strength: 0.5,
            last_observed_at: Date.now(),
        };
        base.slices.push(slice);
    }
    // Update slice
    if (event === 'support')
        slice.confirmations++;
    else
        slice.contradictions++;
    const sliceTotal = slice.confirmations + slice.contradictions;
    slice.strength = sliceTotal > 0 ? slice.confirmations / sliceTotal : 0.5;
    slice.last_observed_at = Date.now();
    // Cap slices (keep most recently observed, but preserve dropped evidence).
    let slices = base.slices;
    let droppedConf = 0, droppedContra = 0;
    if (slices.length > MAX_SUPPORT_SLICES) {
        slices = slices.sort((a, b) => b.last_observed_at - a.last_observed_at);
        const dropped = slices.slice(MAX_SUPPORT_SLICES);
        for (const d of dropped) {
            droppedConf += d.confirmations;
            droppedContra += d.contradictions;
        }
        slices = slices.slice(0, MAX_SUPPORT_SLICES);
    }
    // Recompute global strength including evidence from dropped slices
    let totalConf = droppedConf, totalContra = droppedContra;
    for (const s of slices) {
        totalConf += s.confirmations;
        totalContra += s.contradictions;
    }
    const totalObs = totalConf + totalContra;
    const global_strength = totalObs > 0 ? totalConf / totalObs : 0.5;
    return { global_strength, total_observations: totalObs, slices };
}
