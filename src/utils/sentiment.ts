/**
 * Sentiment Analyzer — lightweight Chinese/English sentiment detection.
 *
 * Uses keyword-based lexicon for fast, zero-dependency classification.
 * Tracks emotional trend of conversations for the "memory mood" feature.
 */

export interface SentimentResult {
  /** Positive score (0-1) */
  positive: number;
  /** Negative score (0-1) */
  negative: number;
  /** Dominant sentiment label */
  label: 'positive' | 'negative' | 'neutral';
  /** Confidence (0-1) */
  confidence: number;
  /** Emoji representation */
  emoji: string;
}

// Chinese sentiment lexicons
const POSITIVE_WORDS_CN = new Set([
  '开心', '高兴', '快乐', '喜欢', '爱', '好', '棒', '赞', '优秀', '厉害',
  '感谢', '谢谢', '感动', '温暖', '幸福', '美好', '成功', '顺利', '加油',
  '满意', '舒服', '轻松', '期待', '希望', '进步', '成长', '收获', '丰富',
  '自豪', '骄傲', '满足', '惊喜', '爽', '酷', '绝了', '完美', '无敌',
  '超级', '非常', '太棒', '真好', '不错', '漂亮', '靠谱',
  '恭喜', '祝贺', '好运', '幸运',
]);

const NEGATIVE_WORDS_CN = new Set([
  '难过', '伤心', '痛苦', '生气', '愤怒', '烦', '讨厌', '恨', '差', '烂',
  '糟糕', '失败', '失望', '郁闷', '焦虑', '紧张', '害怕', '担心', '累',
  '疲惫', '辛苦', '麻烦', '困难', '复杂', '头疼', '崩溃', '无语', '无奈',
  '遗憾', '可惜', '抱歉', '对不起', '危险', '错误', '问题', '严重',
  '恶心', '难受', '不爽', '没劲', '无聊', '坑', '惨', '废', '垃圾',
  '扯淡', '离谱', '过分', '受不了', '忍不了',
]);

const POSITIVE_WORDS_EN = new Set([
  'happy', 'great', 'awesome', 'amazing', 'wonderful', 'excellent', 'love',
  'like', 'good', 'best', 'perfect', 'beautiful', 'fantastic', 'brilliant',
  'thank', 'thanks', 'grateful', 'glad', 'joy', 'excited', 'welcome',
  'success', 'win', 'smooth', 'nice', 'cool', 'fun', 'wow', 'superb',
]);

const NEGATIVE_WORDS_EN = new Set([
  'sad', 'angry', 'bad', 'terrible', 'awful', 'horrible', 'hate', 'worst',
  'sorry', 'fail', 'lost', 'broken', 'wrong', 'difficult', 'hard', 'pain',
  'upset', 'disappointed', 'frustrated', 'annoyed', 'stressed', 'tired',
  'boring', 'ugly', 'stupid', 'useless', 'dumb', 'waste', 'poor',
]);

/** Detect sentiment from text */
export function detectSentiment(text: string): SentimentResult {
  if (!text || text.length < 2) {
    return { positive: 0, negative: 0, label: 'neutral', confidence: 1, emoji: '😐' };
  }

  const lower = text.toLowerCase();
  let posScore = 0;
  let negScore = 0;

  // Chinese word matching (2+ char substrings)
  for (let i = 0; i < text.length - 1; i++) {
    const twoChar = text.slice(i, i + 2);
    const threeChar = i < text.length - 2 ? text.slice(i, i + 3) : '';

    if (threeChar && POSITIVE_WORDS_CN.has(threeChar)) posScore += 2;
    else if (twoChar && POSITIVE_WORDS_CN.has(twoChar)) posScore += 1.5;

    if (threeChar && NEGATIVE_WORDS_CN.has(threeChar)) negScore += 2;
    else if (twoChar && NEGATIVE_WORDS_CN.has(twoChar)) negScore += 1.5;
  }

  // English word matching
  const words = lower.split(/[\s\p{P}]+/u).filter(w => w.length > 1);
  for (const w of words) {
    if (POSITIVE_WORDS_EN.has(w)) posScore += 1;
    if (NEGATIVE_WORDS_EN.has(w)) negScore += 1;
  }

  const total = posScore + negScore;
  if (total === 0) {
    return { positive: 0.5, negative: 0.5, label: 'neutral', confidence: 0.5, emoji: '😐' };
  }

  const positive = posScore / total;
  const negative = negScore / total;
  const diff = positive - negative
  const confidence = Math.min(1, total / 10 + 0.3);

  let label: 'positive' | 'negative' | 'neutral';
  let emoji: string;

  if (diff > 0.15) {
    label = 'positive';
    emoji = positive > 0.8 ? '🥰' : positive > 0.6 ? '😊' : '🙂';
  } else if (diff < -0.15) {
    label = 'negative';
    emoji = negative > 0.8 ? '😢' : negative > 0.6 ? '😟' : '😕';
  } else {
    label = 'neutral';
    emoji = '😐';
  }

  return { positive, negative, label, confidence, emoji };
}

/** Get a mood summary string for a collection of texts */
export function summarizeMood(texts: string[]): string {
  if (texts.length === 0) return '暂无数据';

  const results = texts.map(t => detectSentiment(t));
  const posCount = results.filter(r => r.label === 'positive').length;
  const negCount = results.filter(r => r.label === 'negative').length;
  const total = results.length;

  const posRatio = posCount / total;
  const negRatio = negCount / total;

  if (posRatio > 0.6) return '😊 整体心情不错';
  if (negRatio > 0.6) return '😢 最近似乎有些烦恼';
  if (posRatio > negRatio) return '🙂 总体偏积极';
  if (negRatio > posRatio) return '😟 最近有点低落';

  return '😐 情绪平稳';
}
