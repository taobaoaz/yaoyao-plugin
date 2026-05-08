/**
 * memory_insights — extract patterns, decisions, sentiment trends from memories.
 * No LLM required — uses keyword frequency + sentiment scoring.
 */
import { withErrorHandling } from "./common.js";
import { detectSentiment } from "../utils/sentiment.js";

const CHINESE_STOP = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
  "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "什么",
  "怎么", "因为", "所以", "但是", "可以", "这个", "那个", "一个", "我们",
  "他们", "它们", "已经", "还是", "如果", "虽然", "而且", "或者",
  "然后", "之后", "之前", "现在", "时候", "知道", "觉得",
  "就是", "不是", "可能", "应该", "需要", "能够",
  "让", "把", "被", "从", "对", "与", "以", "为", "于", "向", "比", "跟",
  "很", "太", "非", "常", "真",
  "过", "将", "才", "刚", "还", "又", "再", "只", "仅",
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

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function createInsightsTool(db) {
  return {
    name: "memory_insights",
    label: "Memory Insights",
    description:
      "💡 从记忆中提取规律、模式、决策和情绪趋势。无需 LLM，纯统计分析。支持 patterns/decisions/sentiment_trend/summary 四种分析类型。",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["patterns", "decisions", "sentiment_trend", "summary"],
          description: "分析类型：patterns=高频词模式, decisions=决策提取, sentiment_trend=情绪趋势, summary=综合汇总",
        },
        days: {
          type: "number",
          description: "回溯天数（默认 30）",
          default: 30,
        },
        limit: {
          type: "number",
          description: "返回数量（默认 10）",
          default: 10,
        },
      },
    },
    execute: withErrorHandling(async (_id, params) => {
      const type = String(params.type || "summary");
      const days = Math.max(Number(params.days) || 30, 1);
      const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);
      const cutoff = daysAgo(days);
      const today = new Date().toISOString().slice(0, 10);

      // Use queryMeta for proper bulk data access (not FTS5 hack)
      let rows;
      try {
        rows = db.queryMeta({ dateFrom: cutoff, limit: 500 });
      } catch {
        rows = [];
      }
      // Map queryMeta rows to a compatible format for downstream handlers
      const filteredResults = rows.map(r => ({
        date: r.date,
        snippet: `${r.user_text || ""} ${r.asst_text || ""}`.trim(),
        _meta: r,
      }));
      if (filteredResults.length === 0) {
        return { content: [{ type: "text", text: `在近 ${days} 天内没有找到记忆记录。` }] };
      }

      if (type === "patterns") {
        return handlePatterns(filteredResults, limit);
      } else if (type === "decisions") {
        return handleDecisions(filteredResults, limit);
      } else if (type === "sentiment_trend") {
        return handleSentimentTrend(filteredResults, days);
      } else {
        return handleSummary(filteredResults, days, limit);
      }
    }),
  };
}

function handlePatterns(results, limit) {
  const allText = results.map(r => r.snippet || "").join(" ");
  const tokens = extractTokens(allText);
  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const lines = [
    "# 🔍 高频词模式分析",
    "",
    `在 ${results.length} 条记忆中发现 ${tokens.length} 个关键词`,
    "",
    "## Top 关键词",
    "",
  ];
  for (let i = 0; i < sorted.length; i++) {
    lines.push(`${i + 1}. \`${sorted[i][0]}\` — 出现 ${sorted[i][1]} 次`);
  }
  lines.push("", "---", "*纯词频统计，无 LLM 分析*");
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleDecisions(results, limit) {
  const decisionKeywords = /\[important\]|decision|决定|确认|敲定|最终|选择了|方案|选择.*作为|adopted|resolved|decided/i;
  const decisions = results.filter(r => decisionKeywords.test(r.snippet || "")).slice(0, limit);
  if (decisions.length === 0) {
    return { content: [{ type: "text", text: "未在近期记忆中发现明确的决策记录。" }] };
  }
  const lines = [
    "# 🎯 决策记录提取",
    "",
    `发现 ${decisions.length} 条可能的决策/重要记录`,
    "",
  ];
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    lines.push(`**${i + 1}.** 【${d.date}】${(d.snippet || "").slice(0, 200)}`);
    lines.push("");
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleSentimentTrend(results, days) {
  // Group by date and compute average sentiment per day
  const byDate = new Map();
  for (const r of results) {
    if (!r.date) continue;
    const sentiment = detectSentiment(r.snippet || "");
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(sentiment);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) {
    return { content: [{ type: "text", text: "无法计算情绪趋势——无有效日期数据。" }] };
  }
  const lines = [
    "# 📊 情绪趋势分析",
    "",
    `近 ${days} 天，覆盖 ${dates.length} 天`,
    "",
  ];
  for (const date of dates) {
    const sentiments = byDate.get(date);
    const avgScore = sentiments.reduce((s, x) => s + x.score, 0) / sentiments.length;
    const dominant = sentiments.reduce((a, b) => a.count > b.count ? a : b);
    const bar = avgScore > 0.3 ? "😊" : avgScore > -0.3 ? "😐" : "😟";
    lines.push(`${bar} ${date}: 均值 ${avgScore.toFixed(2)}，主导情绪 ${dominant.label}（${sentiments.length} 条）`);
  }
  const allScores = dates.map(d => byDate.get(d).reduce((s, x) => s + x.score, 0) / byDate.get(d).length);
  const overallAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  lines.push("", `**整体情绪均值**: ${overallAvg.toFixed(2)} ${overallAvg > 0.3 ? "😊 偏正面" : overallAvg > -0.3 ? "😐 中性" : "😟 偏负面"}`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleSummary(results, days, limit) {
  const allText = results.map(r => r.snippet || "").join(" ");
  const tokens = extractTokens(allText);
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const sentiments = results.map(r => detectSentiment(r.snippet || ""));
  const avgSentiment = sentiments.reduce((s, x) => s + x.score, 0) / Math.max(sentiments.length, 1);
  const sentimentLabel = avgSentiment > 0.3 ? "😊 偏正面" : avgSentiment > -0.3 ? "😐 中性" : "😟 偏负面";

  const decisionKeywords = /\[important\]|决定|确认|敲定|方案/i;
  const decisionCount = results.filter(r => decisionKeywords.test(r.snippet || "")).length;

  const lines = [
    "# 💡 记忆洞察汇总",
    "",
    `**时间范围**: 近 ${days} 天`,
    `**记忆条数**: ${results.length}`,
    `**关键词数**: ${tokens.length}`,
    "",
    "## 🔑 热门话题",
    topWords.map((w, i) => `${i + 1}. \`${w[0]}\`（${w[1]} 次）`).join("\n"),
    "",
    "## 📊 情绪概况",
    `整体情绪: ${sentimentLabel}（均值 ${avgSentiment.toFixed(2)}）`,
    "",
    "## 🎯 重要记录",
    decisionCount > 0 ? `发现 ${decisionCount} 条可能的决策/重要记录` : "未发现明确的决策记录",
    "",
    "---",
    "*综合分析（patterns + sentiment + decisions）*",
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
