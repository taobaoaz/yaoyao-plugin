/**
 * core/trends/trends.ts — Pure trend analysis algorithms, zero platform awareness.
 */
// ── Stop word lists ──
import { CHINESE_STOP, ENGLISH_STOP } from "./trends-stopwords.js";
import { formatTrendsReport } from "./trends-formatter.js";
export { formatTrendsReport };
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
    if (typeof text !== 'string')
        throw new TypeError('extractTokens: text must be a string');
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
        throw new TypeError('countFrequencies: tokens must be an array');
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
    return d.toLocaleDateString('sv-SE');
}
/** Compute trend direction from early vs late frequency counts */
export function computeTrends(allFreq, earlyFreq, lateFreq, topN) {
    if (!(allFreq instanceof Map))
        throw new TypeError('computeTrends: allFreq must be a Map');
    if (!(earlyFreq instanceof Map))
        throw new TypeError('computeTrends: earlyFreq must be a Map');
    if (!(lateFreq instanceof Map))
        throw new TypeError('computeTrends: lateFreq must be a Map');
    if (!Number.isFinite(topN) || topN < 1)
        topN = 10;
    const sorted = [...allFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
    return sorted.map(([word, count]) => {
        const early = earlyFreq.get(word) || 0;
        const late = lateFreq.get(word) || 0;
        let emoji;
        let direction;
        if (early === 0 && late > 0) {
            emoji = '🆕';
            direction = '新增话题';
        }
        else if (late === 0 && early > 0) {
            emoji = '📉';
            direction = '已消失';
        }
        else if (late > early * 1.5) {
            emoji = '📈';
            direction = '快速上升';
        }
        else if (late > early * 1.2) {
            emoji = '↗️';
            direction = '缓慢上升';
        }
        else if (early > late * 1.5) {
            emoji = '📉';
            direction = '快速下降';
        }
        else if (early > late * 1.2) {
            emoji = '↘️';
            direction = '缓慢下降';
        }
        else {
            emoji = '➡️';
            direction = '基本稳定';
        }
        return { word, count, emoji, direction, earlyCount: early, lateCount: late };
    });
}
