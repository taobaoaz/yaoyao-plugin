/**
 * utils/reset-detector.ts — Detect scheduled memory reset risks in environment.
 *
 * Thin wrapper around reset-detector-scan.ts. Provides:
 *   - detectScheduledResetRisks() 扫描所有风险
 *   - formatResetRiskReport() 格式化报告
 */
export { detectScheduledResetRisks } from "./reset-detector-scan.js";
/** Format risks as readable report */
export function formatResetRiskReport(risks) {
    if (risks.length === 0) {
        return '✅ 未检测到定时重置记忆的风险';
    }
    const critical = risks.filter((r) => r.severity === 'critical');
    const warning = risks.filter((r) => r.severity === 'warning');
    const info = risks.filter((r) => r.severity === 'info');
    const lines = [
        `## ⚠️ 定时重置记忆风险检测报告`,
        '',
        `**严重**: ${critical.length} | **警告**: ${warning.length} | **提示**: ${info.length}`,
        '',
    ];
    for (const r of [...critical, ...warning, ...info]) {
        const icon = r.severity === 'critical' ? '🔴' : r.severity === 'warning' ? '🟡' : '🟢';
        lines.push(`${icon} **${r.source}** (${r.severity})`, `   ${r.description}`, `   💡 建议: ${r.mitigation}`, '');
    }
    return lines.join('\n');
}
