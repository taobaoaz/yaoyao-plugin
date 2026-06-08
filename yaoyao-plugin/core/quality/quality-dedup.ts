/**
 * core/quality/quality-dedup.ts — Dedup report formatting.
 */
import type { DuplicatePair } from './quality.ts';

export function formatDedupReport(duplicates: DuplicatePair[]): string {
  if (!Array.isArray(duplicates))
    throw new TypeError('formatDedupReport: duplicates must be an array');
  if (duplicates.length === 0) {
    return '✅ 抽样检测未发现重复条目（相似度阈值 0.8）';
  }

  const lines: string[] = [
    `🔍 检测到 ${duplicates.length} 组疑似重复`,
    `（基于 snippet 前100字符的 Jaccard 相似度 > 0.8）`,
    '',
  ];

  for (let k = 0; k < Math.min(duplicates.length, 20); k++) {
    const d = duplicates[k];
    lines.push(
      `**${k + 1}. 相似度: ${d.similarity}**`,
      `  A: [${d.a.filename}] ${d.a.snippet.slice(0, 80)}...`,
      `  B: [${d.b.filename}] ${d.b.snippet.slice(0, 80)}...`,
      '',
    );
  }

  if (duplicates.length > 20) {
    lines.push(`...以及 ${duplicates.length - 20} 组更多重复`);
  }

  lines.push('💡 如需删除重复项，请使用 memory_forget 手动处理');

  return lines.join('\n');
}
