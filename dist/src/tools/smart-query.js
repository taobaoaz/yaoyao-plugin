/**
 * smart_query — multi-strategy search preprocessing.
 * No LLM — uses stopword removal, bigram splitting, and simple synonym expansion.
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
]);

// Simple synonym rules for broad search
const SYNONYMS = {
  "天气": ["天气", "温度", "下雨", "晴天"],
  "工作": ["工作", "项目", "任务", "开发"],
  "问题": ["问题", "错误", "bug", "异常", "报错"],
  "学习": ["学习", "研究", "教程", "课程"],
  "健康": ["健康", "运动", "锻炼", "身体"],
  "项目": ["项目", "工程", "代码", "开发"],
  "错误": ["错误", "问题", "bug", "异常"],
  "计划": ["计划", "安排", "待办", "任务"],
};

function isStopWord(word) {
  if (word.length <= 1) return true;
  return ENGLISH_STOP.has(word.toLowerCase()) || CHINESE_STOP.has(word);
}

function makeFuzzy(query) {
  // Remove stopwords and split into bigrams
  const parts = [];
  const englishWords = query.match(/[a-zA-Z]{2,}/g) || [];
  for (const w of englishWords) {
    if (!isStopWord(w)) parts.push(w);
  }
  const chineseSegments = query.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of chineseSegments) {
    for (let i = 0; i < seg.length - 1; i++) {
      const bigram = seg.slice(i, i + 2);
      if (!isStopWord(bigram)) parts.push(bigram);
    }
    if (seg.length === 1 && !isStopWord(seg)) parts.push(seg);
  }
  return parts.join(" ");
}

function makeBroad(query) {
  // Simple synonym expansion
  const expanded = new Set();
  const englishWords = query.match(/[a-zA-Z]{2,}/g) || [];
  for (const w of englishWords) {
    if (!isStopWord(w)) expanded.add(w.toLowerCase());
  }
  const chineseSegments = query.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of chineseSegments) {
    for (let i = 0; i < seg.length - 1; i++) {
      const bigram = seg.slice(i, i + 2);
      if (SYNONYMS[bigram]) {
        for (const s of SYNONYMS[bigram]) expanded.add(s);
      } else if (!isStopWord(bigram)) {
        expanded.add(bigram);
      }
    }
  }
  // Also add original query terms
  if (!isStopWord(query)) expanded.add(query);
  return [...expanded].join(" ");
}

export function createSmartQueryTool(db) {
  return {
    name: "smart_query",
    label: "Smart Query",
    description:
      "🔎 智能搜索查询 — 多策略搜索预处理。支持 exact/fuzzy/broad/auto 策略，auto 会依次尝试直到找到结果。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "原始搜索查询",
        },
        strategy: {
          type: "string",
          enum: ["auto", "exact", "fuzzy", "broad"],
          description: "搜索策略：exact=精确, fuzzy=模糊（去停用词+bigram）, broad=扩展（同义词）, auto=自动（默认）",
        },
        maxResults: {
          type: "number",
          description: "最大结果数（默认 10）",
          default: 10,
        },
      },
      required: ["query"],
    },
    execute: withErrorHandling(async (_id, params) => {
      const query = String(params.query ?? "").trim();
      const strategy = String(params.strategy || "auto");
      const maxResults = Math.min(Math.max(Number(params.maxResults) || 10, 1), 50);

      if (!query) {
        return { content: [{ type: "text", text: "请输入搜索查询。" }] };
      }

      const doSearch = (q) => {
        try { return db.search(q, maxResults); } catch { return []; }
      };

      let results = [];
      let usedStrategy = strategy;
      let usedQuery = query;

      if (strategy === "exact") {
        results = doSearch(query);
        usedQuery = query;
      } else if (strategy === "fuzzy") {
        usedQuery = makeFuzzy(query);
        results = doSearch(usedQuery);
      } else if (strategy === "broad") {
        usedQuery = makeBroad(query);
        results = doSearch(usedQuery);
      } else {
        // auto: try exact → fuzzy → broad
        results = doSearch(query);
        usedStrategy = "exact";
        usedQuery = query;
        if (results.length === 0) {
          usedQuery = makeFuzzy(query);
          results = doSearch(usedQuery);
          usedStrategy = "fuzzy";
        }
        if (results.length === 0) {
          usedQuery = makeBroad(query);
          results = doSearch(usedQuery);
          usedStrategy = "broad";
        }
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: `未找到结果。已尝试策略: ${usedStrategy}，查询: "${usedQuery}"` }] };
      }

      const lines = [
        `🔎 搜索结果（策略: ${usedStrategy}，查询: "${usedQuery}"）`,
        "",
        `找到 ${results.length} 条结果：`,
        "",
      ];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const snippet = (r.snippet || "").replace(/<\/?b>/g, "").slice(0, 150);
        lines.push(`${i + 1}. 【${r.date}】(得分: ${r.score?.toFixed(3) ?? "N/A"}) ${snippet}`);
        lines.push("");
      }
      lines.push("---");
      lines.push(`原始查询: "${query}" | 使用策略: ${usedStrategy} | 实际查询: "${usedQuery}"`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }),
  };
}
