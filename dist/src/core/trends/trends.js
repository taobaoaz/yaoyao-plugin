/**
 * core/trends/trends.ts — Pure trend analysis algorithms, zero platform awareness.
 */
// ── Stop word lists ──
const CHINESE_STOP = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "什么",
    "怎么", "因为", "所以", "但是", "可以", "这个", "那个", "一个", "我们",
    "他们", "它们", "已经", "还是", "如果", "虽然", "而且", "或者", "因为",
    "所以", "然后", "之后", "之前", "现在", "时候", "知道", "觉得", "但是",
    "还是", "就是", "不是", "没有", "可以", "可能", "应该", "需要", "能够",
    "让", "把", "被", "从", "对", "与", "以", "为", "于", "向", "比", "跟",
    "这", "那", "哪", "什", "么", "怎", "为", "因", "所", "但", "虽", "而",
    "且", "或", "者", "如", "果", "不", "会", "很", "太", "非", "常", "真",
    "过", "将", "才", "刚", "还", "又", "再", "只", "仅", "共", "两", "几",
    "哪", "把", "被", "从", "对", "跟", "与", "以", "于", "向", "比",
]);
const ENGLISH_STOP = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "shall", "not",
    "no", "nor", "so", "if", "then", "than", "that", "this", "these",
    "those", "it", "its", "it's", "i", "you", "he", "she", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
    "their", "what", "which", "who", "whom", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "some", "any",
    "about", "into", "over", "after", "before", "between", "under", "above",
    "up", "down", "out", "off", "just", "also", "very", "too", "really",
    "get", "got", "go", "went", "gone", "come", "came", "make", "made",
    "take", "took", "know", "knew", "think", "thought", "want", "need",
    "like", "well", "yes", "no", "ok", "okay", "am", "re", "ve", "ll",
    "got", "doesn", "don", "didn", "isn", "aren", "wasn", "weren", "hasn",
    "haven", "hadn", "won", "wouldn", "couldn", "shouldn", "mightn", "mustn",
    "let", "us", "thing", "things", "way", "going", "really", "actually",
    "basically", "probably", "maybe", "perhaps",
]);
export function isStopWord(word) {
    if (word.length <= 1)
        return true;
    const lower = word.toLowerCase();
    if (ENGLISH_STOP.has(lower))
        return true;
    if (CHINESE_STOP.has(word))
        return true;
    return false;
}
/** Extract meaningful tokens from text — English words + Chinese bigrams */
export function extractTokens(text) {
    if (typeof text !== "string")
        throw new TypeError("extractTokens: text must be a string");
    const tokens = [];
    const englishWords = text.match(/[a-zA-Z]{2,}/g) || [];
    for (const w of englishWords) {
        const lower = w.toLowerCase();
        if (!isStopWord(lower))
            tokens.push(lower);
    }
    const chineseSegments = text.match(/[\u4e00-\u9fff]+/g) || [];
    for (const seg of chineseSegments) {
        for (let i = 0; i < seg.length - 1; i++) {
            const bigram = seg.slice(i, i + 2);
            if (!isStopWord(bigram))
                tokens.push(bigram);
        }
    }
    return tokens;
}
/** Count word frequencies */
export function countFrequencies(tokens) {
    if (!Array.isArray(tokens))
        throw new TypeError("countFrequencies: tokens must be an array");
    const freq = new Map();
    for (const t of tokens) {
        freq.set(t, (freq.get(t) || 0) + 1);
    }
    return freq;
}
/** Get date string N days ago */
export function daysAgo(days) {
    if (!Number.isFinite(days) || days < 0)
        days = 0;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toLocaleDateString("sv-SE");
}
/** Compute trend direction from early vs late frequency counts */
export function computeTrends(allFreq, earlyFreq, lateFreq, topN) {
    if (!(allFreq instanceof Map))
        throw new TypeError("computeTrends: allFreq must be a Map");
    if (!(earlyFreq instanceof Map))
        throw new TypeError("computeTrends: earlyFreq must be a Map");
    if (!(lateFreq instanceof Map))
        throw new TypeError("computeTrends: lateFreq must be a Map");
    if (!Number.isFinite(topN) || topN < 1)
        topN = 10;
    const sorted = [...allFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
    return sorted.map(([word, count]) => {
        const early = earlyFreq.get(word) || 0;
        const late = lateFreq.get(word) || 0;
        let emoji;
        let direction;
        if (early === 0 && late > 0) {
            emoji = "🆕";
            direction = "新增话题";
        }
        else if (late === 0 && early > 0) {
            emoji = "📉";
            direction = "已消失";
        }
        else if (late > early * 1.5) {
            emoji = "📈";
            direction = "快速上升";
        }
        else if (late > early * 1.2) {
            emoji = "↗️";
            direction = "缓慢上升";
        }
        else if (early > late * 1.5) {
            emoji = "📉";
            direction = "快速下降";
        }
        else if (early > late * 1.2) {
            emoji = "↘️";
            direction = "缓慢下降";
        }
        else {
            emoji = "➡️";
            direction = "基本稳定";
        }
        return { word, count, emoji, direction, earlyCount: early, lateCount: late };
    });
}
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
