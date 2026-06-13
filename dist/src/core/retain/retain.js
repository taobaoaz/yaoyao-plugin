/**
 * core/retain/retain.ts — Pure retain algorithms, zero platform awareness.
 */
/** Detect at-risk memories based on recall history and importance */
export function detectAtRisk(memories, boostRecords, importantTags, thresholdDays = 7) {
    if (!Array.isArray(memories))
        throw new TypeError("detectAtRisk: memories must be an array");
    if (!Array.isArray(boostRecords))
        throw new TypeError("detectAtRisk: boostRecords must be an array");
    if (!Array.isArray(importantTags))
        throw new TypeError("detectAtRisk: importantTags must be an array");
    if (!Number.isFinite(thresholdDays) || thresholdDays < 1)
        thresholdDays = 7;
    const now = Date.now();
    const msDay = 86400000;
    const recallMap = new Map();
    for (const rec of boostRecords) {
        const key = rec.filename ? `${rec.keyword}::${rec.filename}` : rec.keyword;
        const existing = recallMap.get(key);
        if (!existing || rec.boostedAt > existing) {
            recallMap.set(key, rec.boostedAt);
        }
    }
    const atRisk = [];
    for (const mem of memories) {
        const key = mem.filename ? `${mem.keyword}::${mem.filename}` : mem.keyword;
        const lastRecalled = recallMap.get(key) || null;
        let daysSinceRecall = 9999;
        if (lastRecalled) {
            daysSinceRecall = Math.floor((now - new Date(lastRecalled).getTime()) / msDay);
        }
        const isImportant = importantTags.some((t) => t.keyword === mem.keyword || (t.filename && t.filename === mem.filename));
        if (daysSinceRecall > thresholdDays || (daysSinceRecall === 9999 && isImportant)) {
            atRisk.push({
                keyword: mem.keyword,
                filename: mem.filename,
                snippet: mem.snippet,
                lastRecalled,
                daysSinceRecall,
                isImportant,
            });
        }
    }
    atRisk.sort((a, b) => {
        if (a.isImportant !== b.isImportant)
            return a.isImportant ? -1 : 1;
        return b.daysSinceRecall - a.daysSinceRecall;
    });
    return atRisk;
}
export function formatRetainCheck(allMemoriesCount, boostRecordsCount, importantTagsCount, atRisk) {
    if (!Array.isArray(atRisk))
        throw new TypeError("formatRetainCheck: atRisk must be an array");
    const lines = [
        "🧠 **记忆增强/反遗忘检查报告**",
        "",
        `📊 总记忆条目: ${allMemoriesCount}`,
        `🔍 有强化记录的条目: ${boostRecordsCount}`,
        `⭐ 重要标签数: ${importantTagsCount}`,
        `⚠️ 遗忘风险条目: ${atRisk.length}`,
        "",
    ];
    if (atRisk.length > 0) {
        lines.push("**遗忘风险列表（超过 7 天未召回）:**");
        lines.push("");
        const maxShow = Math.min(atRisk.length, 20);
        for (let i = 0; i < maxShow; i++) {
            const m = atRisk[i];
            const icon = m.isImportant ? "⭐" : "⚠️";
            const daysStr = m.daysSinceRecall === 9999 ? "从未召回" : `${m.daysSinceRecall} 天`;
            lines.push(`${icon} **#${i + 1}** — ${daysStr} 未召回`, `   片段: ${m.snippet}`, `   文件: ${m.filename}`, m.isImportant ? "   💡 重要记忆，建议立即强化" : "", "");
        }
        if (atRisk.length > 20) {
            lines.push(`...以及 ${atRisk.length - 20} 条更多遗忘风险记忆`);
            lines.push("");
        }
        lines.push("💡 **建议**:");
        const importantAtRisk = atRisk.filter((m) => m.isImportant);
        if (importantAtRisk.length > 0) {
            lines.push(`   • 使用 \`memory_retain(action:boost, keyword: "${importantAtRisk[0].keyword}")\` 强化重要记忆`);
        }
        else if (atRisk.length > 0) {
            lines.push(`   • 先用 \`memory_retain(action:important, keyword: "xxx")\` 标记重要记忆`);
            lines.push(`   • 再用 \`memory_retain(action:boost, keyword: "${atRisk[0].keyword}")\` 强化`);
        }
    }
    else {
        lines.push("✅ **没有发现遗忘风险！** 所有记忆都在 7 天内被召回过。");
        lines.push("");
        lines.push("💡 定期使用 memory_retain(action:check) 可保持记忆新鲜度。");
    }
    return lines.filter(Boolean).join("\n");
}
export function formatBoostResult(keyword, filename, reason, boostedAt, matchedCount) {
    const lines = [
        "✅ **记忆强化成功**",
        "",
        `**关键词**: ${keyword}`,
        filename ? `**文件**: ${filename}` : null,
        reason ? `**原因**: ${reason}` : null,
        `**时间**: ${boostedAt}`,
        `**匹配的记忆条目**: ${matchedCount} 条`,
        "",
        "强化后的记忆将在 auto-recall 中获得更高权重。",
    ];
    return lines.filter(Boolean).join("\n");
}
export function formatImportantResult(keyword, filename, reason, taggedAt) {
    const lines = [
        "⭐ **重要记忆标记成功**",
        "",
        `**关键词**: ${keyword}`,
        filename ? `**文件**: ${filename}` : null,
        reason ? `**原因**: ${reason}` : null,
        `**标记时间**: ${taggedAt}`,
        "",
        "该记忆在 check 中将获得特别标注。",
        "建议随后使用 memory_retain(action:boost, keyword: ...) 强化.",
    ];
    return lines.filter(Boolean).join("\n");
}
