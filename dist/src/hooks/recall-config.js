export function getRecallConfig(config) {
    const r = config.recall || {};
    return {
        cacheTTL: r.cacheTTL ?? 30000,
        maxCacheSize: r.maxCacheSize ?? 50,
        halfLife: r.halfLife ?? 30,
        jaccardBase: r.jaccardBase ?? 0.75,
        jaccardMin: r.jaccardMin ?? 0.5,
        maxSessions: r.maxSessions ?? 1000,
        maxContextKeywords: r.maxContextKeywords ?? 20,
        maxResults: r.maxResults ?? 3,
        decayMode: r.decayMode ?? "weibull",
        position: r.position ?? "append",
        timeoutMs: r.timeoutMs ?? 800,
        excludeRecentMS: r.excludeRecentMS ?? 0,
        minResults: r.minResults ?? 0,
        maxChars: r.maxChars ?? 1200,
        scoreThreshold: r.minScore ?? 0.5,
    };
}
