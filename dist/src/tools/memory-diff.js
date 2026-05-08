/**
 * memory_diff — compare topic changes between two time periods.
 * No LLM — pure keyword frequency diff.
 */
import { withErrorHandling } from "./common.js";

const CHINESE_STOP = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
  "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "什么",
  "怎么", "因为", "所以", "但是", "可以", "这个", "那个", "一个", "我们",
  "他们", "它们", "已经", "还是", "如果", "虽然", "而且", "或者",
  "然后", "之后", "之前", "现在", "时候", "知道", "觉得",
  "就是", "不是", "可能", "应该", "需要", "能够",
  "让", "把", "被", "从", "对", "与", "以", "为", "于", "向", "比", "跟",
]);
const ENGLISH_STOP = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "shall", "not",
  "no", "nor", "so", "if", "then", "than", "that", "this", "these",
  "those", "it", "its", "i", "you", "he", "she", "we", "they",
  "me", "him", "her", "us", "them", "my", "your", "his", "our",
  "their", "what", "which", "who", "whom", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "some", "any",
  "about", "into", "over", "after", "before", "between", "under", "above",
  "up", "down", "out", "off", "just", "also", "very", "too", "really",
]);

function isStopWord(word) {
  if (word.length <= 1) return true;
  const lower = word.toLowerCase();
  return ENGLISH_STOP.has(lower) || CHINESE_STOP.has(word);
}

function extractTokens(text) {
  const tokens = [];
  const englishWords = text.match(/[a-zA-Z]{2,}/g) || [];
  for (const w of englishWords) {
    if (!isStopWord(w.toLowerCase())) tokens.push(w.toLowerCase());
  }
  const chineseSegments = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of chineseSegments) {
    for (let i = 0; i < seg.length - 1; i++) {
      const bigram = seg.slice(i, i + 2);
      if (!isStopWord(bigram)) tokens.push(bigram);
    }
  }
  return tokens;
}

function tokenSet(results) {
  const allText = results.map(r => r.snippet || "").join(" ");
  const tokens = extractTokens(allText);
  return new Set(tokens);
}

function tokenFreq(results) {
  const allText = results.map(r => r.snippet || "").join(" ");
  const tokens = extractTokens(allText);
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}

function parseDate(val, fallback) {
  if (!val) return fallback;
  const match = String(val).match(/^(\d+)d$/);
  if (match) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(match[1], 10));
    return d.toISOString().slice(0, 10);
  }
  return String(val);
}

export function createDiffTool(db) {
  return {
    name: "memory_diff",
    label: "Memory Diff",
    description:
      "🔄 比较两个时间段的话题变化。计算新增、消失、持续话题。支持相对日期（如 7d 表示 7 天前）。",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "起始日期或相对天数（如 '7d'），默认 14 天前",
        },
        to: {
          type: "string",
          description: "结束日期（默认今天）",
        },
        format: {
          type: "string",
          enum: ["text", "json"],
          description: "输出格式（默认 text）",
        },
      },
    },
    execute: withErrorHandling(async (_id, params) => {
      const today = new Date().toISOString().slice(0, 10);
      const from = parseDate(params.from, (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10); })());
      const to = parseDate(params.to, today);
      const format = String(params.format || "text");

      // Get broad results and split into two halves by midpoint date
      let allRows;
      try {
        allRows = db.queryMeta({ dateFrom: from, dateTo: to, limit: 1000 });
      } catch {
        allRows = [];
      }
      const inRange = allRows.map(r => ({
        date: r.date,
        snippet: `${r.user_text || ""} ${r.asst_text || ""}`.trim(),
      }));
      if (inRange.length < 2) {
        return { content: [{ type: "text", text: `在 ${from} ~ ${to} 范围内记录不足（${inRange.length} 条），无法对比。` }] };
      }

      // Split at midpoint
      const dates = [...new Set(inRange.map(r => r.date))].sort();
      const midIdx = Math.floor(dates.length / 2);
      const midDate = dates[midIdx];
      const early = inRange.filter(r => r.date < midDate);
      const late = inRange.filter(r => r.date >= midDate);

      const earlyFreq = tokenFreq(early);
      const lateFreq = tokenFreq(late);
      const earlyKeys = new Set(earlyFreq.keys());
      const lateKeys = new Set(lateFreq.keys());

      // Diff
      const added = [...lateKeys].filter(k => !earlyKeys.has(k)).sort((a, b) => (lateFreq.get(b) || 0) - (lateFreq.get(a) || 0)).slice(0, 20);
      const removed = [...earlyKeys].filter(k => !lateKeys.has(k)).sort((a, b) => (earlyFreq.get(b) || 0) - (earlyFreq.get(a) || 0)).slice(0, 20);
      const persisted = [...earlyKeys].filter(k => lateKeys.has(k)).sort((a, b) => ((earlyFreq.get(a) || 0) + (lateFreq.get(a) || 0)) - ((earlyFreq.get(b) || 0) + (lateFreq.get(b) || 0))).reverse().slice(0, 20);

      if (format === "json") {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ from, to, midDate, earlyPeriod: { dates: dates.slice(0, midIdx), count: early.length }, latePeriod: { dates: dates.slice(midIdx), count: late.length }, added: added.map(k => [k, lateFreq.get(k)]), removed: removed.map(k => [k, earlyFreq.get(k)]), persisted: persisted.map(k => [k, { early: earlyFreq.get(k), late: lateFreq.get(k) }]) }, null, 2),
          }],
        };
      }

      const lines = [
        "# 🔄 记忆话题对比",
        "",
        `**前期**: ${dates[0]} ~ ${midDate}（${early.length} 条）`,
        `**后期**: ${midDate} ~ ${dates[dates.length - 1]}（${late.length} 条）`,
        "",
        `## 🆕 新增话题（${added.length}）`,
        added.length > 0 ? added.map(k => `- \`${k}\`（${lateFreq.get(k)} 次）`).join("\n") : "（无）",
        "",
        `## 📉 消失话题（${removed.length}）`,
        removed.length > 0 ? removed.map(k => `- \`${k}\`（${earlyFreq.get(k)} 次）`).join("\n") : "（无）",
        "",
        `## ➡️ 持续话题（${persisted.length}）`,
        persisted.length > 0 ? persisted.map(k => `- \`${k}\`（前期 ${earlyFreq.get(k)} → 后期 ${lateFreq.get(k)}）`).join("\n") : "（无）",
        "",
        "---",
        "*基于关键词频率对比*",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }),
  };
}
