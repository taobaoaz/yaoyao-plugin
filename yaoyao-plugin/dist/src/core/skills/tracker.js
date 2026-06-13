/**
 * core/skills/tracker.ts — Tool invocation tracking and pattern detection.
 */
// In-memory invocation log
const invocations = [];
const patterns = new Map();
function generateParamSignature(params) {
    const keys = Object.keys(params).sort();
    return keys.map((k) => `${k}=${typeof params[k]}`).join(",");
}
function generatePatternId(toolId, signature) {
    return `${toolId}::${signature}`;
}
export function recordInvocation(invocation) {
    invocations.push(invocation);
    // Update pattern
    const signature = generateParamSignature(invocation.params);
    const patternId = generatePatternId(invocation.toolId, signature);
    const existing = patterns.get(patternId);
    if (existing) {
        existing.frequency++;
        existing.avgDurationMs =
            (existing.avgDurationMs * (existing.frequency - 1) + invocation.durationMs) /
                existing.frequency;
        existing.lastSeen = invocation.timestamp;
        existing.confidence = Math.min(1, existing.frequency / 10);
    }
    else {
        patterns.set(patternId, {
            id: patternId,
            toolId: invocation.toolId,
            paramSignature: signature,
            frequency: 1,
            avgDurationMs: invocation.durationMs,
            lastSeen: invocation.timestamp,
            confidence: 0.1,
        });
    }
}
export function getInvocations(options) {
    let filtered = [...invocations];
    if (options?.toolId) {
        filtered = filtered.filter((i) => i.toolId === options.toolId);
    }
    if (options?.since) {
        filtered = filtered.filter((i) => i.timestamp >= options.since);
    }
    if (options?.limit) {
        filtered = filtered.slice(-options.limit);
    }
    return filtered;
}
export function getPatterns(minFrequency = 2) {
    return [...patterns.values()]
        .filter((p) => p.frequency >= minFrequency)
        .sort((a, b) => b.frequency - a.frequency);
}
export function getTopPatterns(limit = 5) {
    return getPatterns(2).slice(0, limit);
}
export function getToolStats(toolId) {
    const toolInvocations = invocations.filter((i) => i.toolId === toolId);
    if (toolInvocations.length === 0)
        return null;
    const totalDuration = toolInvocations.reduce((s, i) => s + i.durationMs, 0);
    return {
        count: toolInvocations.length,
        avgDurationMs: totalDuration / toolInvocations.length,
        lastUsed: Math.max(...toolInvocations.map((i) => i.timestamp)),
    };
}
