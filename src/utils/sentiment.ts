/**
 * Sentiment Analyzer v3 — Chinese/English sentiment detection with Ekman 6 basic emotions.
 *
 * Extends v2's positive/negative/neutral classification with fine-grained
 * emotion categories. Zero external dependencies.
 *
 * Ekman 6 basic emotions:
 * - joy      喜悦    — positive valence, high arousal
 * - sadness  悲伤    — negative valence, low arousal
 * - anger    愤怒    — negative valence, high arousal
 * - fear     恐惧    — negative valence, high arousal
 * - surprise  惊讶    — neutral valence, high arousal
 * - disgust   厌恶    — negative valence, medium arousal
 */

// ──────────────────────────── Types ────────────────────────────

export type EmotionLabel = "joy" | "sadness" | "anger" | "fear" | "surprise" | "disgust";

export interface SentimentResult {
  /** Positive score (0-1) — backward compatible */
  positive: number;
  /** Negative score (0-1) — backward compatible */
  negative: number;
  /** Dominant sentiment label — backward compatible */
  label: "positive" | "negative" | "neutral";
  /** Confidence (0-1) — backward compatible */
  confidence: number;
  /** Emoji representation — backward compatible */
  emoji: string;
  /** Ekman 6 basic emotion scores (v3新增) — 0 if no emotion words matched */
  emotions: Record<EmotionLabel, number>;
  /** Which emotions are dominant (score > 0.25 and above avg) */
  topEmotions: EmotionLabel[];
}

// ──────────────────────────── Lexicons ────────────────────────────

type EmotionLexicon = Record<EmotionLabel, Set<string>>;
type BilingualLexicon = { cn: EmotionLexicon; en: EmotionLexicon };

const cn: EmotionLexicon = {
  joy: new Set([
    "开心", "高兴", "快乐", "开心", "幸福", "美好", "满意",
    "舒服", "轻松", "惊喜", "爽", "酷", "完美", "无敌",
    "超级", "太棒", "真好", "不错", "漂亮", "靠谱",
    "恭喜", "祝贺", "好运", "幸运", "期待", "希望",
    "进步", "成长", "收获", "丰富", "爽了",
  ]),
  sadness: new Set([
    "难过", "伤心", "痛苦", "悲伤", "凄凉", "心碎", "伤心",
    "失落", "空虚", "沮丧", "抑郁", "苦闷", "伤感", "愁",
    "心酸", "哀伤", "痛心", "揪心", "绝望", "哭了", "流泪",
    "崩溃",
  ]),
  anger: new Set([
    "生气", "愤怒", "烦", "讨厌", "恨", "恼火", "暴躁",
    "怒", "气死", "忍不了", "受不了", "疯了", "抓狂",
    "烦死了", "懒得", "烦人", "不满", "不爽",
  ]),
  fear: new Set([
    "害怕", "担心", "紧张", "焦虑", "恐惧", "恐慌", "不安",
    "心惊", "忐忑", "畏惧", "惧怕", "胆怯", "心惊肉跳",
    "后怕", "吓人", "吓死", "可怕", "恐怖",
  ]),
  surprise: new Set([
    "惊讶", "震惊", "意外", "吃惊", "诧异", "惊叹", "目瞪口呆",
    "竟然", "居然", "没想到", "天哪", "天啊", "我去",
    "哇", "咦", "哈", "唉？", "咦？", "什么",
    "不可思议", "难以置信",
  ]),
  disgust: new Set([
    "恶心", "难受", "没劲", "无聊", "坑", "惨", "废", "垃圾",
    "扯淡", "离谱", "过分", "烂", "差", "糟", "糟糕",
    "烦人", "无味", "俗气", "庸俗", "乏味", "腻", "厌倦",
    "失望", "遗憾", "可惜",
  ]),
};

const en: EmotionLexicon = {
  joy: new Set([
    "happy", "joy", "joyful", "glad", "delighted", "pleased",
    "excited", "thrilled", "elated", "ecstatic", "euphoric",
    "wonderful", "fantastic", "amazing", "great", "awesome",
    "excellent", "brilliant", "superb", "perfect", "beautiful",
    "nice", "good", "best",
    "love", "like", "enjoy", "adore", "cherish",
    "thank", "thanks", "grateful", "appreciate",
    "success", "win", "triumph", "achievement", "proud",
    "fun", "cool", "wow", "yay", "woohoo",
    "hope", "looking forward",
  ]),
  sadness: new Set([
    "sad", "sadness", "unhappy", "miserable", "depressed",
    "heartbroken", "devastated", "grief", "sorrow", "gloomy",
    "melancholy", "dismal", "bleak", "hopeless", "despair",
    "lonely", "alone", "isolated", "abandoned", "forsaken",
    "cry", "tears", "weep", "sobbing",
    "lost", "broken", "empty", "hurt", "painful",
  ]),
  anger: new Set([
    "angry", "anger", "furious", "enraged", "livid", "irate",
    "annoyed", "irritated", "frustrated", "exasperated",
    "mad", "outraged", "infuriated", "incensed",
    "hate", "loathe", "despise", "detest", "abhor",
    "hostile", "aggressive", "fierce",
  ]),
  fear: new Set([
    "fear", "afraid", "scared", "frightened", "terrified",
    "horrified", "panicked", "alarmed", "anxious", "worried",
    "nervous", "apprehensive", "uneasy", "dread", "dreadful",
    "startled", "shocked", "spooked", "creeped",
    "timid", "cowardly", "hesitant",
  ]),
  surprise: new Set([
    "surprise", "surprised", "amazed", "astonished", "astounded",
    "shocked", "stunned", "flabbergasted", "dumbfounded",
    "unexpected", "unanticipated", "sudden", "abrupt",
    "remarkable", "extraordinary", "incredible", "unbelievable",
    "wow", "whoa", "oh", "aha",
  ]),
  disgust: new Set([
    "disgust", "disgusted", "disgusting", "repulsed", "revolting",
    "nauseated", "sick", "sickened", "gross", "grossed",
    "awful", "terrible", "horrible", "dreadful",
    "boring", "dull", "tedious", "mundane", "stale",
    "poor", "lousy", "pathetic", "miserable",
    "waste", "useless", "stupid", "dumb",
  ]),
};

const JOY_MARKERS = new Set([
  "哈哈", "呵呵", "嘻嘻", "hhh", "haha", "lol", "lmao",
  "😊", "😃", "😄", "🤣", "🥰", "😍", "🎉", "🥳",
]);
const SAD_MARKERS = new Set(["😢", "😭", "😥", "😰", "🥺", "😞", "😔"]);
const ANGRY_MARKERS = new Set(["😠", "😡", "🤬", "💢"]);
const SURPRISE_MARKERS = new Set(["😱", "😮", "😲", "🤯", "😳", "😨"]);

// ──────────────────────────── Main Functions ────────────────────────────

/** Detect sentiment from text */
export function detectSentiment(text: string): SentimentResult {
  if (!text || text.length < 2) {
    return {
      positive: 0, negative: 0, label: "neutral",
      confidence: 0.5, emoji: "😐",
      emotions: { joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
      topEmotions: [],
    };
  }

  const lower = text.toLowerCase();
  const emotionScores: Record<EmotionLabel, number> = {
    joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0,
  };

  // ── Chinese emotion matching (2+ char substrings) ──
  for (let i = 0; i < text.length - 1; i++) {
    const twoChar = text.slice(i, i + 2);
    const threeChar = i < text.length - 2 ? text.slice(i, i + 3) : "";

    for (const emotion of Object.keys(cn) as EmotionLabel[]) {
      if (threeChar && cn[emotion].has(threeChar)) emotionScores[emotion] += 3;
      else if (twoChar && cn[emotion].has(twoChar)) emotionScores[emotion] += 2;
    }
  }

  // ── English emotion matching ──
  const words = lower.split(/[\s\p{P}]+/u).filter(w => w.length > 1);
  for (const w of words) {
    for (const emotion of Object.keys(en) as EmotionLabel[]) {
      if (en[emotion].has(w)) emotionScores[emotion] += 1;
    }
  }

  // ── Emoji markers ──
  for (const em of text) {
    if (JOY_MARKERS.has(em)) emotionScores.joy += 2;
    else if (SAD_MARKERS.has(em)) emotionScores.sadness += 2;
    else if (ANGRY_MARKERS.has(em)) emotionScores.anger += 2;
    else if (SURPRISE_MARKERS.has(em)) emotionScores.surprise += 2;
  }

  // ── Aggregate to positive/negative ──
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

  // ── Determine dominant label and emoji ──
  let label: "positive" | "negative" | "neutral";
  let emoji: string;

  if (diff > 0.15) {
    label = "positive";
    emoji = positive > 0.8 ? "🥰" : positive > 0.6 ? "😊" : "🙂";
  } else if (diff < -0.15) {
    label = "negative";
    emoji = negative > 0.8 ? "😢" : negative > 0.6 ? "😟" : "😕";
  } else {
    label = "neutral";
    emoji = "😐";
  }

  // ── Determine top emotions ──
  const maxScore = Math.max(...Object.values(emotionScores));
  const topEmotions = (Object.entries(emotionScores) as [EmotionLabel, number][])
    .filter(([_, score]) => score > 0 && score >= maxScore * 0.5)
    .sort(([_, a], [__, b]) => b - a)
    .slice(0, 2)
    .map(([name]) => name);

  return {
    positive, negative, label, confidence, emoji,
    emotions: emotionScores,
    topEmotions,
  };
}

/** Get a mood summary string for a collection of texts */
export function summarizeMood(texts: string[]): string {
  if (texts.length === 0) return "暂无数据";

  const results = texts.map(t => detectSentiment(t));
  const posCount = results.filter(r => r.label === "positive").length;
  const negCount = results.filter(r => r.label === "negative").length;
  const total = texts.length;

  // Also aggregate top emotions
  const emotionCounts: Record<string, number> = {};
  for (const r of results) {
    for (const e of r.topEmotions) {
      emotionCounts[e] = (emotionCounts[e] || 0) + 1;
    }
  }
  const topEmotion = Object.entries(emotionCounts)
    .sort(([_, a], [__, b]) => b - a)
    .slice(0, 3);

  const posRatio = posCount / total;
  const negRatio = negCount / total;

  let summary = "";
  if (posRatio > 0.6) {
    summary = "😊 整体心情不错";
  } else if (negRatio > 0.6) {
    summary = "😢 最近似乎有些烦恼";
  } else if (posRatio > negRatio) {
    summary = "🙂 总体偏积极";
  } else if (negRatio > posRatio) {
    summary = "😟 最近有点低落";
  } else {
    summary = "😐 情绪平稳";
  }

  if (topEmotion.length > 0) {
    summary += ` | 主要情绪: ${topEmotion.map(([e, c]) => `${e}(${c}次)`).join(", ")}`;
  }

  return summary;
}
