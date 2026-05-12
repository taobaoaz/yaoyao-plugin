/**
 * YaoyaoSoul — Unified psychological model module.
 *
 * Consolidates sentiment.ts (Trie-based), persona-state.js (state machine),
 * and mood tool into one efficient, zero-dependency module.
 *
 * Architecture:
 * - Trie-based sentiment matching (O(n) vs old O(n*m))
 * - In-memory state with EMA smoothing (no file I/O by default)
 * - Built-in mood summary via getMoodSummary()
 * - Guidance text generation (same interface as existing)
 * - L3 persona hints
 *
 * Ekman 6 basic emotions:
 * - joy      喜悦    — positive valence, high arousal
 * - sadness  悲伤    — negative valence, low arousal
 * - anger    愤怒    — negative valence, high arousal
 * - fear     恐惧    — negative valence, high arousal
 * - surprise  惊讶    — neutral valence, high arousal
 * - disgust   厌恶    — negative valence, medium arousal
 *
 * Target: ~20 KB compiled JS, ~0.5ms per call
 */

// ──────────────────────────── Types ────────────────────────────

export type EmotionLabel = "joy" | "sadness" | "anger" | "fear" | "surprise" | "disgust";
export type MoodLabel = "positive" | "negative" | "neutral";
export type EnergyLevel = "high" | "medium" | "low";
export type TrustLevel = "high" | "medium" | "low";
export type MoodTrend = "rising" | "falling" | "stable";

export interface SentimentResult {
  positive: number;
  negative: number;
  label: MoodLabel;
  confidence: number;
  emoji: string;
  emotions: Record<EmotionLabel, number>;
  topEmotions: EmotionLabel[];
}

export interface PersonaState {
  mood: MoodLabel;
  moodScore: number;
  energy: EnergyLevel;
  trust: TrustLevel;
  moodTrend: MoodTrend;
  confidence: number;
  updatedAt: string;
  version: number;
}

export interface GuidanceHints {
  tone: "warm" | "gentle" | "neutral";
  verbosity: "concise" | "thorough" | "balanced";
  autonomy: "high" | "low" | "normal";
}

export interface PersonaHints {
  prefersConcision?: boolean;
  depthLevel?: "deep" | "shallow" | null;
}

export interface UpdateOptions {
  textSample?: string;
  successCount?: number;
  failCount?: number;
  messageLength?: number;
  intensity?: number;
}

// ──────────────────────────── Constants ────────────────────────────

const CURRENT_VERSION = 2;
const SMOOTH_FACTOR = 0.15;
const CONFIDENCE_HIGH = 1.0;
const CONFIDENCE_LOW = 0.3;
const EMA_ALPHA = 0.3;
const NEGATION_PREFIXES = ["不", "没", "未", "别", "无", "莫"];

// ──────────────────────────── Trie ────────────────────────────

class EmotionTrieNode {
  children: Map<string, EmotionTrieNode>;
  emotion: EmotionLabel | null;
  score: number;

  constructor() {
    this.children = new Map();
    this.emotion = null;
    this.score = 0;
  }
}

// ──────────────────────────── Lexicons ────────────────────────────

type EmotionLexicon = Record<EmotionLabel, string[]>;

const CN_LEXICON: EmotionLexicon = {
  joy: [
    "开心", "高兴", "快乐", "幸福", "美好", "满意",
    "舒服", "轻松", "惊喜", "爽", "酷", "完美", "无敌",
    "超级", "太棒", "真好", "不错", "漂亮", "靠谱",
    "恭喜", "祝贺", "好运", "幸运", "期待", "希望",
    "进步", "成长", "收获", "丰富", "爽了",
  ],
  sadness: [
    "难过", "伤心", "痛苦", "悲伤", "凄凉", "心碎",
    "失落", "空虚", "沮丧", "抑郁", "苦闷", "伤感", "愁",
    "心酸", "哀伤", "痛心", "揪心", "绝望", "哭了", "流泪",
    "崩溃",
  ],
  anger: [
    "生气", "愤怒", "烦", "讨厌", "恨", "恼火", "暴躁",
    "怒", "气死", "忍不了", "受不了", "疯了", "抓狂",
    "烦死了", "懒得", "烦人", "不满", "不爽",
  ],
  fear: [
    "害怕", "担心", "紧张", "焦虑", "恐惧", "恐慌", "不安",
    "心惊", "忐忑", "畏惧", "惧怕", "胆怯", "心惊肉跳",
    "后怕", "吓人", "吓死", "可怕", "恐怖",
  ],
  surprise: [
    "惊讶", "震惊", "意外", "吃惊", "诧异", "惊叹", "目瞪口呆",
    "竟然", "居然", "没想到", "天哪", "天啊", "我去",
    "哇", "咦", "哈", "唉？", "咦？", "什么",
    "不可思议", "难以置信",
  ],
  disgust: [
    "恶心", "难受", "没劲", "无聊", "坑", "惨", "废", "垃圾",
    "扯淡", "离谱", "过分", "烂", "差", "糟", "糟糕",
    "烦人", "无味", "俗气", "庸俗", "乏味", "腻", "厌倦",
    "失望", "遗憾", "可惜",
  ],
};

const EN_LEXICON: EmotionLexicon = {
  joy: [
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
  ],
  sadness: [
    "sad", "sadness", "unhappy", "miserable", "depressed",
    "heartbroken", "devastated", "grief", "sorrow", "gloomy",
    "melancholy", "dismal", "bleak", "hopeless", "despair",
    "lonely", "alone", "isolated", "abandoned", "forsaken",
    "cry", "tears", "weep", "sobbing",
    "lost", "broken", "empty", "hurt", "painful",
  ],
  anger: [
    "angry", "anger", "furious", "enraged", "livid", "irate",
    "annoyed", "irritated", "frustrated", "exasperated",
    "mad", "outraged", "infuriated", "incensed",
    "hate", "loathe", "despise", "detest", "abhor",
    "hostile", "aggressive", "fierce",
  ],
  fear: [
    "fear", "afraid", "scared", "frightened", "terrified",
    "horrified", "panicked", "alarmed", "anxious", "worried",
    "nervous", "apprehensive", "uneasy", "dread", "dreadful",
    "startled", "shocked", "spooked", "creeped",
    "timid", "cowardly", "hesitant",
  ],
  surprise: [
    "surprise", "surprised", "amazed", "astonished", "astounded",
    "shocked", "stunned", "flabbergasted", "dumbfounded",
    "unexpected", "unanticipated", "sudden", "abrupt",
    "remarkable", "extraordinary", "incredible", "unbelievable",
    "wow", "whoa", "oh", "aha",
  ],
  disgust: [
    "disgust", "disgusted", "disgusting", "repulsed", "revolting",
    "nauseated", "sick", "sickened", "gross", "grossed",
    "awful", "terrible", "horrible", "dreadful",
    "boring", "dull", "tedious", "mundane", "stale",
    "poor", "lousy", "pathetic", "miserable",
    "waste", "useless", "stupid", "dumb",
  ],
};

// ──────────────────────────── Trie Builder ────────────────────────────

function buildEmotionTrie(): EmotionTrieNode {
  const root = new EmotionTrieNode();
  for (const [emotion, words] of Object.entries(CN_LEXICON) as [EmotionLabel, string[]][]) {
    for (const word of words) {
      let node = root;
      for (const ch of word) {
        if (!node.children.has(ch)) node.children.set(ch, new EmotionTrieNode());
        node = node.children.get(ch)!;
      }
      node.emotion = emotion;
      // Longer words = stronger signal
      node.score = word.length >= 3 ? 3 : 2;
    }
  }
  return root;
}

// Build English flat set for O(1) lookup
function buildENSet(): Record<EmotionLabel, Set<string>> {
  const result = {} as Record<EmotionLabel, Set<string>>;
  for (const [emotion, words] of Object.entries(EN_LEXICON) as [EmotionLabel, string[]][]) {
    result[emotion] = new Set(words);
  }
  return result;
}

// ── Module-level singletons (built once) ──
const cnTrie = buildEmotionTrie();
const enSet = buildENSet();

// Extended emoji/emoticon matching — supports multi-char sequences
const EMOJI_PATTERNS: { pattern: string; emotion: EmotionLabel; score: number }[] = [
  // Multi-char emoticons (first priority — check before single chars)
  { pattern: "哈哈", emotion: "joy", score: 3 },
  { pattern: "嘻嘻", emotion: "joy", score: 3 },
  { pattern: "hhh", emotion: "joy", score: 2 },
  { pattern: "haha", emotion: "joy", score: 2 },
  { pattern: "lol", emotion: "joy", score: 2 },
  { pattern: "lmao", emotion: "joy", score: 3 },
  // Single emoji chars (surrogate-safe)
  { pattern: "😊", emotion: "joy", score: 2 },
  { pattern: "😃", emotion: "joy", score: 2 },
  { pattern: "😄", emotion: "joy", score: 2 },
  { pattern: "🤣", emotion: "joy", score: 3 },
  { pattern: "🥰", emotion: "joy", score: 3 },
  { pattern: "😍", emotion: "joy", score: 3 },
  { pattern: "🎉", emotion: "joy", score: 2 },
  { pattern: "🥳", emotion: "joy", score: 3 },
  { pattern: "😢", emotion: "sadness", score: 3 },
  { pattern: "😭", emotion: "sadness", score: 3 },
  { pattern: "😥", emotion: "sadness", score: 2 },
  { pattern: "😰", emotion: "sadness", score: 2 },
  { pattern: "🥺", emotion: "sadness", score: 2 },
  { pattern: "😞", emotion: "sadness", score: 2 },
  { pattern: "😔", emotion: "sadness", score: 2 },
  { pattern: "😠", emotion: "anger", score: 3 },
  { pattern: "😡", emotion: "anger", score: 3 },
  { pattern: "🤬", emotion: "anger", score: 3 },
  { pattern: "💢", emotion: "anger", score: 2 },
  { pattern: "😱", emotion: "surprise", score: 3 },
  { pattern: "😮", emotion: "surprise", score: 2 },
  { pattern: "😲", emotion: "surprise", score: 2 },
  { pattern: "🤯", emotion: "surprise", score: 3 },
  { pattern: "😳", emotion: "surprise", score: 2 },
  { pattern: "😨", emotion: "surprise", score: 2 },
];

// Build sorted list: long patterns first (to match "哈哈" before potentially matching individual chars)
const sortedEmojiPatterns = [...EMOJI_PATTERNS].sort((a, b) => b.pattern.length - a.pattern.length);

// ──────────────────────────── Sentiment Engine ────────────────────────────

/**
 * Trie-based sentiment detection. O(n) single-pass instead of O(n*m) nested loops.
 */
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

  // ── Chinese emotion matching via Trie (O(n)) ──
  for (let i = 0; i < text.length; i++) {
    let node = cnTrie;
    let j = i;
    let bestIdx = i;
    let bestEmotion: EmotionLabel | null = null;
    let bestScore = 0;

    while (j < text.length && node.children.has(text[j])) {
      node = node.children.get(text[j])!;
      j++;
      if (node.emotion) {
        bestIdx = j;
        bestEmotion = node.emotion;
        bestScore = node.score;
      }
    }

    if (bestEmotion && bestScore > 0) {
      // Check negation: is prevChar a negation prefix?
      const prevChar = i > 0 ? text[i - 1] : "";
      const isNegated = NEGATION_PREFIXES.includes(prevChar);

      if (isNegated && bestEmotion === "joy") {
        // "不开心" → sadness instead of joy
        emotionScores.sadness += bestScore;
      } else if (isNegated) {
        emotionScores[bestEmotion] += bestScore * 0.5;
      } else {
        emotionScores[bestEmotion] += bestScore;
      }

      // Skip matched characters (optimization: don't re-scan within matched word)
      i = bestIdx - 1;
    }
  }

  // ── English emotion matching (flat Set lookup, O(1) per word) ──
  const words = lower.split(/[\s\p{P}]+/u).filter((w: string) => w.length > 1);
  for (const w of words) {
    for (const emotion of Object.keys(enSet) as EmotionLabel[]) {
      if (enSet[emotion].has(w)) emotionScores[emotion] += 1;
    }
  }

  // ── Emoji / emoticon markers (multi-char aware) ──
  // Quick scan: only check patterns whose first char appears in text
  const textSet = new Set(text);
  for (const { pattern, emotion, score } of sortedEmojiPatterns) {
    if (textSet.has(pattern[0]) && text.includes(pattern)) {
      emotionScores[emotion] += score;
    }
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

  let label: MoodLabel;
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

  // ── Top emotions ──
  const maxScore = Math.max(...Object.values(emotionScores));
  const topEmotions = (Object.entries(emotionScores) as [EmotionLabel, number][])
    .filter(([_, s]) => s > 0 && s >= maxScore * 0.5)
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

// ──────────────────────────── YaoyaoSoul Class ────────────────────────────

/**
 * Unified psychological state manager.
 *
 * Combines:
 * - Trie-based sentiment analysis
 * - Persona state machine (mood/energy/trust with EMA smoothing)
 * - Guidance text generation
 * - Mood summary (replaces mood tool)
 *
 * All state lives in memory by default. Call persistToDisk() to save.
 */
export class YaoyaoSoul {
  private baseDir: string;
  private cache: PersonaState | null = null;
  private lastUpdateTime: number = 0;

  // EMA-smoothed mood (single value, not array)
  private emaMoodScore: number = 0;
  private emaInitialized: boolean = false;

  // Last 3 scores for lightweight trend detection
  private lastScores: number[] = [];

  // Interaction profile (minimal)
  private totalSuccess: number = 0;
  private totalFailure: number = 0;
  private messageLengths: number[] = [];
  private lastInterval: number = 0; // ms since last interaction

  // L3 persona hints
  private userPrefersConcision: boolean | null = null;
  private userDepthLevel: "deep" | "shallow" | null = null;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  // ── Public API ──

  getState(): PersonaState {
    if (this.cache) {
      const decayed = this.applyConfidenceDecay(this.cache);
      if (decayed !== this.cache) {
        this.cache = decayed;
      }
      return this.cache;
    }
    this.cache = this.defaultState();
    return this.cache;
  }

  update(opts: UpdateOptions = {}): PersonaState {
    const now = Date.now();
    this.lastInterval = this.lastUpdateTime > 0 ? now - this.lastUpdateTime : 0;
    this.lastUpdateTime = now;

    const sample = opts.textSample || "";
    const success = opts.successCount ?? 0;
    const fail = opts.failCount ?? 0;
    const msgLen = opts.messageLength ?? sample.length;
    const intensity = opts.intensity ?? this.computeIntensity();

    // Accumulate profile
    this.totalSuccess += success;
    this.totalFailure += fail;
    if (msgLen > 0) this.messageLengths.push(msgLen);
    if (this.messageLengths.length > 100) this.messageLengths.shift();

    // Compute mood from sentiment + EMA smoothing
    const mood = this.computeMood(sample);

    // Compute energy
    const hour = new Date().getHours();
    let energy = this.computeEnergy(intensity, msgLen);
    energy = this.adjustEnergyForTimeOfDay(energy, hour);

    // Compute trust (EMA)
    const trust = this.computeTrust(success, fail);

    // Detect trend from last 3 scores
    this.lastScores.push(mood.score);
    if (this.lastScores.length > 5) this.lastScores.shift();
    const moodTrend = this.detectTrend();

    const state: PersonaState = {
      mood: mood.label,
      moodScore: mood.score,
      energy,
      trust,
      moodTrend,
      confidence: mood.confidence,
      updatedAt: new Date().toISOString(),
      version: CURRENT_VERSION,
    };

    this.cache = state;
    return state;
  }

  getGuidance(): GuidanceHints {
    const state = this.getState();
    const tone: GuidanceHints["tone"] = state.mood === "positive" ? "warm"
      : state.mood === "negative" ? "gentle"
      : "neutral";
    const verbosity: GuidanceHints["verbosity"] = state.energy === "high" ? "concise"
      : state.energy === "low" ? "thorough"
      : "balanced";
    const autonomy: GuidanceHints["autonomy"] = state.trust === "high" ? "high"
      : state.trust === "low" ? "low"
      : "normal";
    return { tone, verbosity, autonomy };
  }

  getGuidanceText(): string {
    const state = this.getState();
    const g = this.getGuidance();
    const parts: string[] = [];

    if (g.tone !== "neutral") {
      parts.push(`语气: ${g.tone === "warm" ? "温馨友好" : "柔和体贴"}`);
    }
    if (g.verbosity === "concise") {
      parts.push("回答: 精简高效");
    } else if (g.verbosity === "thorough") {
      parts.push("回答: 详细耐心");
    }
    if (state.moodTrend === "falling") {
      parts.push("注意情绪有下行趋势，保持支持性语调");
    } else if (state.moodTrend === "rising") {
      parts.push("情绪趋势向好，可适度扩展话题");
    }
    if (g.autonomy === "high" && state.confidence > 0.6) {
      parts.push("信任度较高，可主动推荐选项");
    }
    if (state.confidence < 0.4) {
      parts.push("置信度较低，优先确认而非推断");
    }

    // Persona hints
    if (this.userPrefersConcision === true) {
      parts.push("用户习惯简洁，优先提供结论");
    }
    if (this.userDepthLevel === "deep") {
      parts.push("用户偏好深度内容，可展开技术细节");
    } else if (this.userDepthLevel === "shallow") {
      parts.push("用户偏好轻量回复，避免冗余信息");
    }

    // Mood prediction
    const prediction = this.predictMood();
    if (prediction && prediction.confidence > 0.6) {
      const predLabel = prediction.score > 0.1 ? "偏积极"
        : prediction.score < -0.1 ? "偏消极"
        : "平稳";
      parts.push(`预测下一轮情绪${predLabel}，可提前适配语气`);
    }

    return parts.length > 0 ? parts.join("；") : "";
  }

  getMoodSummary(texts: string[]): string {
    return summarizeMood(texts);
  }

  /** Persist state to disk. Optional — state is purely in-memory by default. */
  persistToDisk(): void {
    const fs = require("node:fs");
    const path = require("node:path");
    const state = this.getState();
    const fp = path.join(this.baseDir, ".yaoyao-soul-state.json");
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, JSON.stringify({
        state,
        emaMoodScore: this.emaMoodScore,
        totalSuccess: this.totalSuccess,
        totalFailure: this.totalFailure,
        lastScores: this.lastScores,
        messageLengths: this.messageLengths,
        version: CURRENT_VERSION,
      }, null, 2), "utf-8");
    } catch { /* best effort */ }
  }

  /** Apply L3 persona hints */
  applyPersonaHints(hints: PersonaHints): void {
    if (hints.prefersConcision !== undefined) this.userPrefersConcision = hints.prefersConcision;
    if (hints.depthLevel !== undefined) this.userDepthLevel = hints.depthLevel;
  }

  // ── Private: Mood computation with EMA ──

  private computeMood(text: string): { label: MoodLabel; score: number; confidence: number } {
    if (!text || text.length < 2) {
      return this.cache
        ? { label: this.cache.mood, score: this.cache.moodScore, confidence: Math.max(CONFIDENCE_LOW, this.cache.confidence - 0.1) }
        : { label: "neutral", score: 0, confidence: 0.5 };
    }

    const sentiment = detectSentiment(text);
    const rawScore = sentiment.positive - sentiment.negative;

    // Exponential Moving Average
    if (!this.emaInitialized) {
      this.emaMoodScore = rawScore;
      this.emaInitialized = true;
    } else {
      this.emaMoodScore = EMA_ALPHA * rawScore + (1 - EMA_ALPHA) * this.emaMoodScore;
    }

    // Also blend with last known state if available
    let blendedScore = this.emaMoodScore;
    if (this.cache) {
      blendedScore = blendedScore * 0.6 + this.cache.moodScore * 0.4;
    }

    const blendedLabel: MoodLabel = blendedScore > 0.15 ? "positive"
      : blendedScore < -0.15 ? "negative"
      : "neutral";

    const confidence = Math.min(CONFIDENCE_HIGH, sentiment.confidence + 0.3);

    return { label: blendedLabel, score: blendedScore, confidence };
  }

  private computeIntensity(): number {
    if (this.lastInterval <= 0) return 0.3;
    // Shorter interval = higher intensity
    return Math.max(0, Math.min(1, 1 - this.lastInterval / 60_000));
  }

  private computeEnergy(intensity: number, msgLen: number): EnergyLevel {
    const isShort = msgLen > 0 && msgLen < 20;
    const isLong = msgLen > 100;
    const isVeryLong = msgLen > 300;

    // Long/deep messages indicate focused engagement → medium-low energy
    if (isVeryLong) return "low";
    if (isLong) return "medium";

    // Short messages: if very frequent (high intensity) = scrolling/low energy
    // If infrequent short = quick replies/high energy
    if (isShort && intensity > 0.7) return "low";
    if (isShort) return "high";

    // Medium-length messages: use intensity
    if (intensity > 0.7) return "low";
    if (intensity < 0.3) return "high";
    return "medium";
  }

  private adjustEnergyForTimeOfDay(energy: EnergyLevel, hour: number): EnergyLevel {
    if (hour >= 0 && hour < 6) {
      return energy === "high" ? "medium" : "low";
    }
    if (hour >= 23 || hour < 7) {
      if (energy === "high") return "medium";
    }
    return energy;
  }

  private computeTrust(success: number, fail: number): TrustLevel {
    if (success > 0 || fail > 0) {
      const batchRate = success / (success + fail);
      const currentRate = this.totalSuccess + this.totalFailure > 0
        ? this.totalSuccess / (this.totalSuccess + this.totalFailure)
        : 0.5;
      const smoothed = currentRate * (1 - SMOOTH_FACTOR) + batchRate * SMOOTH_FACTOR;
      const cappedRate = this.totalSuccess + this.totalFailure < 10
        ? Math.min(0.9, Math.max(0.1, smoothed))
        : smoothed;
      if (cappedRate > 0.8) return "high";
      if (cappedRate < 0.5) return "low";
      return "medium";
    }
    return this.cache?.trust ?? "medium";
  }

  /** Lightweight trend detection over last 3-5 points */
  private detectTrend(): MoodTrend {
    if (this.lastScores.length < 2) return "stable";
    const recent = this.lastScores.slice(-3);
    if (recent.length < 2) return "stable";
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const delta = recent[recent.length - 1] - recent[0];

    if (delta > 0.1) return "rising";
    if (delta < -0.1) return "falling";
    return "stable";
  }

  /** Predict next mood score based on simple linear slope */
  predictMood(): { score: number; confidence: number } | null {
    if (this.lastScores.length < 3) return null;
    const scores = this.lastScores.slice(-5);
    if (scores.length < 2) return null;

    let totalDelta = 0;
    for (let i = 1; i < scores.length; i++) {
      totalDelta += scores[i] - scores[i - 1];
    }
    const avgDelta = totalDelta / (scores.length - 1);
    const dampedDelta = avgDelta * 0.3;
    const predictedScore = Math.max(-1, Math.min(1, scores[scores.length - 1] + dampedDelta));

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
    const stabilityConfidence = Math.max(0, 1 - variance * 2);
    const dataConfidence = Math.min(1, scores.length / 10);
    const confidence = Math.min(0.8, stabilityConfidence * 0.6 + dataConfidence * 0.4 + 0.2);

    return { score: predictedScore, confidence };
  }

  // ── Private: helpers ──

  private applyConfidenceDecay(state: PersonaState): PersonaState {
    if (this.lastUpdateTime === 0) return state;
    const idleMs = Date.now() - this.lastUpdateTime;
    if (idleMs < 3_600_000) return state;

    // Cascading decay: each hour reduces confidence by a factor
    const idleHours = idleMs / 3_600_000;
    const hourlyDecay = 0.85; // per hour
    const factor = Math.pow(hourlyDecay, Math.min(idleHours, 24)); // cap at 24h

    const newConfidence = Math.max(CONFIDENCE_LOW, state.confidence * factor);
    if (newConfidence >= state.confidence) return state;

    return {
      ...state,
      confidence: newConfidence,
      mood: newConfidence < 0.35 ? "neutral" : state.mood,
      moodScore: newConfidence < 0.35 ? 0 : state.moodScore,
      moodTrend: newConfidence < 0.35 ? "stable" : state.moodTrend,
    };
  }

  private defaultState(): PersonaState {
    return {
      mood: "neutral", moodScore: 0, energy: "medium",
      trust: "medium", confidence: 0.5, moodTrend: "stable",
      updatedAt: new Date().toISOString(),
      version: CURRENT_VERSION,
    };
  }
}
