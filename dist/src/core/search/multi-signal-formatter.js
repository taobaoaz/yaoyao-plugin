const signalLabels = {
    bm25: "BM25", fts: "全文", vector: "语义", hybrid: "混合",
};
export function formatMultiSignalResults(results, query) {
    if (results.length === 0)
        return "没有找到相关记忆。";
    const lines = [
        `## 搜索结果（多信号融合）`,
        `查询: ${query}`,
        `信号: ${Object.keys(signalLabels).filter(k => results.some(r => r.signals[k] !== undefined)).join(" + ")}`,
        "",
    ];
    for (const r of results) {
        const signalParts = [];
        if (r.signals.bm25 !== undefined)
            signalParts.push(`BM25:${(r.signals.bm25 * 100).toFixed(0)}%`);
        if (r.signals.fts !== undefined)
            signalParts.push(`FT:`);
        if (r.signals.vector !== undefined)
            signalParts.push(`VEC:`);
        if (r.signals.entityBoost !== undefined)
            signalParts.push(`实体:×${(1 + r.signals.entityBoost * 0.3).toFixed(2)}`);
        const meta = [
            (r.score * 100).toFixed(0) + "%",
            r.date,
            r.filename || `id:${r.id}`,
            signalParts.join(" "),
        ].filter(Boolean).join(" · ");
        lines.push(`**${meta}**`);
        lines.push(`${r.snippet.slice(0, 300)}`);
        lines.push("");
    }
    lines.push(`---\n共 ${results.length} 条结果（多信号融合排序）`);
    return lines.join("\n");
}
