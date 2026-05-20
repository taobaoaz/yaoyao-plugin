/**
 * core/quality/quality.ts — Pure quality assessment algorithms.
 */

/** Compute Jaccard similarity on first N chars using bigrams */
export function jaccardSnippet(a: string, b: string, chars: number = 100): number {
  if (typeof a !== "string" || typeof b !== "string") throw new TypeError("jaccardSnippet: a and b must be strings");
  if (!Number.isFinite(chars) || chars < 1) chars = 100;
  const snippetA = a.slice(0, chars);
  const snippetB = b.slice(0, chars);

  function getBigrams(text: string): Set<string> {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      set.add(text.slice(i, i + 2));
    }
    return set;
  }

  const setA = getBigrams(snippetA);
  const setB = getBigrams(snippetB);
  const intersect = new Set<string>([...setA].filter((x) => setB.has(x)));
  const union = new Set<string>([...setA, ...setB]);
  return union.size > 0 ? intersect.size / union.size : 0;
}

export interface SearchResultLike {
  filename: string;
  snippet: string;
}

export interface DuplicatePair {
  a: SearchResultLike;
  b: SearchResultLike;
  similarity: number;
}

/** Find duplicate pairs with similarity > threshold */
export function findDuplicates(results: SearchResultLike[], threshold: number = 0.8): DuplicatePair[] {
  if (!Array.isArray(results)) throw new TypeError("findDuplicates: results must be an array");
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) threshold = 0.8;
  const duplicates: DuplicatePair[] = [];
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const sim = jaccardSnippet(results[i].snippet, results[j].snippet);
      if (sim > threshold) {
        duplicates.push({ a: results[i], b: results[j], similarity: parseFloat(sim.toFixed(3)) });
      }
    }
  }
  return duplicates;
}

export interface DateStats {
  totalDays: number;
  dateCoverage: number;
  avgPerDay: number;
  recent7Count: number;
  recent30Count: number;
}

export function computeDateStats(
  dailyFiles: Array<: unknown { filename: string }>,
  totalMemories: number
): DateStats {
  if (!Array.isArray(dailyFiles)) throw new TypeError("computeDateStats: dailyFiles must be an array");
  if (!Number.isFinite(totalMemories) || totalMemories < 0) totalMemories = 0;
  const dates = dailyFiles
    .map((f) => f.filename.replace(/\.md$/i, ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  let totalDays = 0;
  let dateCoverage = 0;

  if (dates.length > 0) {
    const first = new Date(dates[0] + "T00:00:00");
    const last = new Date(dates[dates.length - 1] + "T00:00:00");
    totalDays = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / 86400000) + 1);
    dateCoverage = parseFloat(((dates.length / totalDays) * 100).toFixed(1));
  }

  const avgPerDay = dates.length > 0 ? parseFloat((totalMemories / dates.length).toFixed(1)) : 0;

  let recent7Count = 0;
  let recent30Count = 0;
  const now = new Date();
  const msDay = 86400000;
  for (const d of dates) {
    const diffDays = (now.getTime() - new Date(d + "T00:00:00").getTime()) / msDay;
    if (diffDays >= 0) {
      if (diffDays <= 7) recent7Count++;
      if (diffDays <= 30) recent30Count++;
    }
  }

  return { totalDays, dateCoverage, avgPerDay, recent7Count, recent30Count };
}

export interface QualityRecommendations {
  recs: string[];
}

export function generateRecommendations(
  dateCoverage: number,
  totalDays: number,
  duplicationRatio: number,
  dbSizeKB: number,
  memoryDirSizeKB: number,
  recent7Count: number,
  dailyFilesCount: number
): string[] {
  if (!Number.isFinite(dateCoverage)) dateCoverage = 0;
  if (!Number.isFinite(totalDays)) totalDays = 0;
  if (!Number.isFinite(duplicationRatio)) duplicationRatio = 0;
  if (!Number.isFinite(dbSizeKB)) dbSizeKB = 0;
  if (!Number.isFinite(memoryDirSizeKB)) memoryDirSizeKB = 0;
  if (!Number.isFinite(recent7Count)) recent7Count = 0;
  if (!Number.isFinite(dailyFilesCount)) dailyFilesCount = 0;
  const recs: string[] = [];
  if (dateCoverage < 50 && totalDays > 7) {
    recs.push("• 日期覆盖率偏低，建议增加记忆保存频率");
  }
  if (duplicationRatio > 20) {
    recs.push("• 重复度较高，建议运行 memory_quality(action:dedup) 检测具体重复项");
  }
  if (dbSizeKB > 0 && memoryDirSizeKB > 0 && dbSizeKB > memoryDirSizeKB * 0.5) {
    recs.push("• 数据库文件相对较大，建议运行 memory_optimize 清理无用索引");
  }
  if (recent7Count === 0 && dailyFilesCount > 0) {
    recs.push("• 最近 7 天无新记忆，建议检查 auto-capture 是否正常运行");
  }
  return recs;
}

import { formatQualityReport } from "./quality-report.ts";
import { formatDedupReport } from "./quality-dedup.ts";

export { formatQualityReport, formatDedupReport };
