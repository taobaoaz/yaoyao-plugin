export function buildRecallContext(results, maxChars = 1200) {
    let body = "💡 相关记忆:";
    let used = 0;
    for (const r of results) {
        const line = `\n- ${r.date || ""}: ${r.snippet}`;
        if (used + line.length > maxChars)
            break;
        body += line;
        used += line.length;
    }
    return used > 0 ? body : "";
}
export function buildHookResult(context, position) {
    return position === "prepend" ? { prepend: context } : { append: context };
}
export function makeSimpleTrace(query, mode, startMs, inputCount, outputCount) {
    const totalMs = Date.now() - startMs;
    return {
        query,
        mode: mode,
        startedAt: startMs,
        stages: [{ name: "recall", inputCount, outputCount, droppedIds: [], scoreRange: null, durationMs: totalMs }],
        finalCount: outputCount,
        totalMs,
    };
}
