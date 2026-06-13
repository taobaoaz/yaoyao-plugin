export function formatTrendsReport(trends, period, fileCount, tokenCount, topN) {
    if (!Array.isArray(trends))
        throw new TypeError("formatTrendsReport: trends must be an array");
    if (typeof period !== "string")
        period = "all";
    const periodLabel = period === "all" ? "全部时间" : `近 ${period}`;
    const lines = [
        `# 📊 记忆话题趋势分析`,
        ``,
        `**分析周期**: ${periodLabel}（${fileCount} 天记录，共 ${tokenCount} 个关键词）`,
        ``,
        `## 热门话题 Top ${topN}`,
        ``,
        `| 排名 | 话题 | 出现次数 | 趋势 | 方向 |`,
        `|:---:|:----:|:-------:|:----:|:----:|`,
    ];
    for (let i = 0; i < trends.length; i++) {
        const t = trends[i];
        lines.push(`| ${i + 1} | \`${t.word}\` | ${t.count} | ${t.emoji} | ${t.direction}（前期:${t.earlyCount} → 后期:${t.lateCount}） |`);
    }
    const rising = trends.filter(t => t.emoji === "📈" || t.emoji === "↗️" || t.emoji === "🆕");
    const falling = trends.filter(t => t.emoji === "📉" || t.emoji === "↘️");
    const stable = trends.filter(t => t.emoji === "➡️");
    lines.push(``, `## 📋 趋势摘要`, ``);
    if (rising.length > 0) {
        lines.push(`**🔥 上升话题**: ${rising.map(t => `${t.word}（${t.count}）`).join("、")}`);
    }
    if (falling.length > 0) {
        lines.push(`**🧊 下降话题**: ${falling.map(t => `${t.word}（${t.count}）`).join("、")}`);
    }
    if (stable.length > 0) {
        lines.push(`**➡️ 稳定话题**: ${stable.map(t => `${t.word}（${t.count}）`).join("、")}`);
    }
    lines.push(``, `---`, `*数据基于词频统计自动生成，不含 LLM 分析*`);
    return lines.join("\n");
}
