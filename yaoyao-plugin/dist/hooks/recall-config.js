export function getRecallConfig(config) {
    const r = (config.recall || {});
    return {
        cacheTTL: r.cacheTTL ?? 30000,
        maxCacheSize: r.maxCacheSize ?? 50,
        halfLife: r.halfLife ?? 30,
        jaccardBase: r.jaccardBase ?? 0.75,
        jaccardMin: r.jaccardMin ?? 0.5,
        maxSessions: r.maxSessions ?? 1000,
        maxContextKeywords: r.maxContextKeywords ?? 20,
        maxResults: r.maxResults ?? 3,
        decayMode: r.decayMode ?? 'weibull',
        position: r.position ?? 'append',
        timeoutMs: r.timeoutMs ?? 800,
        excludeRecentMS: r.excludeRecentMS ?? 0,
        minResults: r.minResults ?? 0,
        maxChars: r.maxChars ?? 1200,
        scoreThreshold: r.minScore ?? 0.5,
        queryPrefix: r.queryPrefix ?? '',
        perAgentOverrides: (r.perAgentOverrides ?? {}),
        enableRecallFilter: r.enableRecallFilter ?? false,
        recallFilterBaseUrl: r.recallFilterBaseUrl ?? '',
        recallFilterApiKey: r.recallFilterApiKey ?? '',
        recallFilterModel: r.recallFilterModel ?? '',
        recallFilterTimeoutMs: r.recallFilterTimeoutMs ?? 30000,
        recallFilterRetries: r.recallFilterRetries ?? 1,
        recallFilterCandidateLimit: r.recallFilterCandidateLimit ?? 30,
        recallFilterMaxItemChars: r.recallFilterMaxItemChars ?? 500,
        recallFilterFailOpen: r.recallFilterFailOpen ?? true,
        maxContextChars: r.maxContextChars ?? 1200,
        enableIntentDriven: r.enableIntentDriven ?? false,
        enableMmr: r.enableMmr ?? false,
        mmrLambda: r.mmrLambda ?? 0.7,
    };
}
/**
 * Merge per-agent overrides into base config.
 * Returns a new config object (does not mutate input).
 */
export function applyAgentOverrides(base, agentId) {
    if (!agentId || !base.perAgentOverrides)
        return base;
    const overrides = base.perAgentOverrides[agentId];
    if (!overrides)
        return base;
    return {
        ...base,
        maxResults: overrides.maxResults ?? base.maxResults,
        scoreThreshold: overrides.minScore ?? base.scoreThreshold,
        halfLife: overrides.halfLife ?? base.halfLife,
        decayMode: overrides.decayMode ?? base.decayMode,
        position: overrides.position ?? base.position,
        maxChars: overrides.maxChars ?? base.maxChars,
        timeoutMs: overrides.timeoutMs ?? base.timeoutMs,
        queryPrefix: overrides.queryPrefix ?? base.queryPrefix,
        enableRecallFilter: overrides.enableRecallFilter ?? base.enableRecallFilter,
        jaccardBase: overrides.jaccardBase ?? base.jaccardBase,
        jaccardMin: overrides.jaccardMin ?? base.jaccardMin,
    };
}
