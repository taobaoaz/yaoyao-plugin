import { cn, en, JOY_MARKERS, SAD_MARKERS, ANGRY_MARKERS, SURPRISE_MARKERS, NEGATION_PREFIXES } from "./lexicon.js";
export function detectSentiment(text) {
    if (!text || text.length < 2) {
        return {
            positive: 0, negative: 0, label: "neutral",
            confidence: 0.5, emoji: "😐",
            emotions: { joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            topEmotions: [],
        };
    }
    const lower = text.toLowerCase();
    const emotionScores = {
        joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0,
    };
    // Chinese emotion matching (2+ char substrings)
    for (let i = 0; i < text.length - 1; i++) {
        const twoChar = text.slice(i, i + 2);
        const threeChar = i < text.length - 2 ? text.slice(i, i + 3) : "";
        const prevChar = i > 0 ? text[i - 1] : "";
        const isNegated = NEGATION_PREFIXES.includes(prevChar);
        for (const emotion of Object.keys(cn)) {
            let score = 0;
            if (threeChar && cn[emotion].has(threeChar))
                score = 3;
            else if (twoChar && cn[emotion].has(twoChar))
                score = 2;
            if (score > 0) {
                if (isNegated && emotion === "joy")
                    emotionScores.sadness += score;
                else if (isNegated)
                    emotionScores[emotion] += score * 0.5;
                else
                    emotionScores[emotion] += score;
            }
        }
    }
    // English emotion matching
    for (const w of lower.split(/[\s\p{P}]+/u).filter(w => w.length > 1)) {
        for (const emotion of Object.keys(en)) {
            if (en[emotion].has(w))
                emotionScores[emotion] += 1;
        }
    }
    // Emoji markers
    const iterateText = () => {
        try {
            return Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text), s => s.segment);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:sentiment] Intl.Segmenter failed: ${msg}`);
            return Array.from(text);
        }
    };
    for (const em of iterateText()) {
        if (JOY_MARKERS.has(em))
            emotionScores.joy += 2;
        else if (SAD_MARKERS.has(em))
            emotionScores.sadness += 2;
        else if (ANGRY_MARKERS.has(em))
            emotionScores.anger += 2;
        else if (SURPRISE_MARKERS.has(em))
            emotionScores.surprise += 2;
    }
    // Aggregate to positive/negative
    const positiveScore = emotionScores.joy + emotionScores.surprise;
    const negativeScore = emotionScores.sadness + emotionScores.anger + emotionScores.fear + emotionScores.disgust;
    const total = positiveScore + negativeScore;
    if (total === 0) {
        return {
            positive: 0.5, negative: 0.5, label: "neutral",
            confidence: 0.5, emoji: "😐",
            emotions: { joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            topEmotions: [],
        };
    }
    const positive = positiveScore / total;
    const negative = negativeScore / total;
    const diff = positive - negative;
    const confidence = Math.min(1, total / 10 + 0.3);
    let label;
    let emoji;
    if (diff > 0.15) {
        label = "positive";
        emoji = positive > 0.8 ? "🥰" : positive > 0.6 ? "😊" : "🙂";
    }
    else if (diff < -0.15) {
        label = "negative";
        emoji = negative > 0.8 ? "😢" : negative > 0.6 ? "😟" : "😕";
    }
    else {
        label = "neutral";
        emoji = "😐";
    }
    const maxScore = Math.max(...Object.values(emotionScores));
    const topEmotions = Object.entries(emotionScores)
        .filter(([_, s]) => s > 0 && s >= maxScore * 0.5)
        .sort(([_, a], [__, b]) => b - a)
        .slice(0, 2)
        .map(([name]) => name);
    return { positive, negative, label, confidence, emoji, emotions: emotionScores, topEmotions };
}
export function summarizeMood(texts) {
    if (texts.length === 0)
        return "暂无数据";
    const results = texts.map(t => detectSentiment(t));
    const posCount = results.filter(r => r.label === "positive").length;
    const negCount = results.filter(r => r.label === "negative").length;
    const emotionCounts = {};
    for (const r of results) {
        for (const e of r.topEmotions)
            emotionCounts[e] = (emotionCounts[e] || 0) + 1;
    }
    const topEmotion = Object.entries(emotionCounts)
        .sort(([_, a], [__, b]) => b - a).slice(0, 3);
    const posRatio = posCount / texts.length;
    const negRatio = negCount / texts.length;
    let summary = "";
    if (posRatio > 0.6)
        summary = "😊 整体心情不错";
    else if (negRatio > 0.6)
        summary = "😢 最近似乎有些烦恼";
    else if (posRatio > negRatio)
        summary = "🙂 总体偏积极";
    else if (negRatio > posRatio)
        summary = "😟 最近有点低落";
    else
        summary = "😐 情绪平稳";
    if (topEmotion.length > 0)
        summary += ` | 主要情绪: ${topEmotion.map(([e, c]) => `${e}(${c}次)`).join(", ")}`;
    return summary;
}
