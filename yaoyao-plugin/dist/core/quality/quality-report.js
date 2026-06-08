export function formatQualityReport(totalFiles, dailyFilesCount, totalMemories, memoryDirSizeKB, dbSizeKB, dateStats, duplicationRatio, recs) {
    if (!dateStats || typeof dateStats !== 'object')
        throw new TypeError('formatQualityReport: dateStats must be an object');
    if (!Array.isArray(recs))
        throw new TypeError('formatQualityReport: recs must be an array');
    const lines = [
        '🩺 **记忆质量评估报告**',
        '',
        `📁 **存储概览**`,
        `- 记忆文件总数: ${totalFiles}`,
        `- 每日日志文件: ${dailyFilesCount}`,
        `- FTS5 索引条目: ${totalMemories}`,
        `- 记忆目录大小: ${memoryDirSizeKB} KB`,
        `- 数据库文件大小: ${dbSizeKB} KB`,
        '',
        `📅 **日期覆盖**`,
        `- 有记忆的天数: ${dailyFilesCount}`,
        `- 覆盖天数范围: ${dateStats.totalDays} 天`,
        `- 日期覆盖率: ${dateStats.dateCoverage}%`,
        `- 平均每天条目: ${dateStats.avgPerDay}`,
        '',
        `🆕 **新鲜度**`,
        `- 最近 7 天有记忆: ${dateStats.recent7Count} 天`,
        `- 最近 30 天有记忆: ${dateStats.recent30Count} 天`,
        '',
        `🔁 **重复度 (抽样)**`,
        `- 疑似重复比例: ${duplicationRatio}%`,
    ];
    const integrityOK = totalMemories > 0 || dailyFilesCount === 0;
    lines.push(``, `🔧 **索引完整性**`, `- 状态: ${integrityOK ? '✅ 正常' : '⚠️ 可能有问题'}`);
    if (!integrityOK) {
        lines.push(`- 提示: 存在每日日志文件但 FTS5 索引为空，建议运行 memory_optimize`);
    }
    if (recs.length > 0) {
        lines.push(``, `💡 **建议**`);
        for (const r of recs) {
            lines.push(r);
        }
    }
    return lines.join('\n');
}
