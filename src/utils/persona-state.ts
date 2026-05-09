/**
 * PersonaStateMachine v3 — AI 观察记录模块 (去干预化)
 *
 * 变更日志 (v3):
 * - 删除 getGuidance() / getGuidanceText() — 不再替 AI 决定语气/篇幅/自主权
 * - mood/energy/trust 保留为只读观察数据，不用于实时干预
 * - 新增隐式标注接口：对话结束后自动标记 stress_signal / preference_pattern 等
 * - 角色层的情感判断应基于记忆上下文 + 角色定义，而非本模块的数学模型
 *
 * 职责边界：
 * - 本模块 = 对话特征的被动记录者
 * - 角色层 (SOUL.md + LLM) = 基于历史记忆主动理解用户的人
 */

import fs from "node:fs";
import path from "node:path";
import { detectSentiment } from "./sentiment.ts";

// ──────────────────────────── Types ────────────────────────────

export type MoodLabel = "positive" | "neutral" | "negative";
export type EnergyLabel = "high" | "medium" | "low";
export type TrustLabel = "high" | "medium" | "low";

export interface PersonaState {
  mood: MoodLabel;
  moodScore: number;
  energy: EnergyLabel;
  trust: TrustLabel;
  confidence: number;
  /** Mood trend: "rising" | "stable" | "falling" (delta over last N updates) */
  moodTrend: "rising" | "stable" | "falling";
  updatedAt: string;
  version: number;
}

export interface InteractionProfile {
  avgMessageLength: number;
  interactionCount: number;
  activePeriod: string;
  avgInterval: number;
}

export interface ImplicitTag {
  tag: string;
  value: string | number | boolean;
  confidence: number;
  source: string; // 触发文本片段
  date: string;
}

const STATE_FILENAME = ".persona-state.json";
const PROFILE_FILENAME = ".persona-interaction-profile.json";
const TAGS_FILENAME = ".implicit-tags.jsonl";
const CURRENT_VERSION = 3;
const WINDOW_SIZE = 30;
const CONFIDENCE_HIGH = 1.0;
const CONFIDENCE_LOW = 0.3;
const DECAY_1H = 0.85;
const DECAY_6H = 0.55;
const SMOOTH_FACTOR = 0.15;

// ──────────────────────────── Main Class ────────────────────────────

export class PersonaStateMachine {
  private baseDir: string;
  private cache: PersonaState | null = null;
  private lastUpdateTime: number = 0;
  private moodHistory: number[] = [];
  private stateHistory: PersonaState[] = [];
  private maxHistory: number = 10;
  private totalSuccess: number = 0;
  private totalFailure: number = 0;
  private messageLengths: number[] = [];
  private interactionTimestamps: number[] = [];

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.load();
    this.loadProfile();
  }

  // ── Public API ──

  /**
   * 获取当前观察状态（只读，不用于干预 AI 行为）
   * 仅供工具查询、仪表盘展示、周度摘要提炼使用
   */
  getState(): PersonaState {
    if (this.cache) {
      const decayed = this.applyConfidenceDecay(this.cache);
      if (decayed !== this.cache) {
        this.cache = decayed;
      }
      return this.cache;
    }
    this.cache = this.load();
    return this.cache;
  }

  /**
   * 记录一次对话交互的观察数据
   * 不再生成 guidance，只做数据沉淀
   */
  update(options: {
    textSample?: string;
    successCount?: number;
    failCount?: number;
    intensity?: number;
    messageLength?: number;
  }): PersonaState {
    const now = Date.now();
    this.lastUpdateTime = now;

    const sample = options.textSample || "";
    const success = options.successCount ?? 0;
    const fail = options.failCount ?? 0;
    const msgLen = options.messageLength ?? sample.length;

    // Accumulate profile data
    this.totalSuccess += success;
    this.totalFailure += fail;
    this.interactionTimestamps.push(now);
    if (msgLen > 0) this.messageLengths.push(msgLen);
    if (this.interactionTimestamps.length > 100) this.interactionTimestamps.shift();
    if (this.messageLengths.length > 100) this.messageLengths.shift();

    // Compute mood from rolling sentiment window (只记数据，不干预)
    const mood = this.computeMood(sample);

    // Compute energy from actual interaction data
    const intensity = options.intensity ?? this.computeIntensity();
    const energy = this.computeEnergy(intensity, msgLen);
    const hour = new Date().getHours();
    const adjustedEnergy = this.adjustEnergyForTimeOfDay(energy, hour);

    // Compute trust (exponential moving average)
    const trust = this.computeTrust(success, fail);

    // Detect mood trend
    const moodTrend = this.detectMoodTrend(mood.score);

    // Build state
    const state: PersonaState = {
      mood: mood.label,
      moodScore: mood.score,
      energy: adjustedEnergy,
      trust,
      moodTrend,
      confidence: mood.confidence,
      updatedAt: new Date().toISOString(),
      version: CURRENT_VERSION,
    };

    this.cache = state;
    this.moodHistory.push(mood.score);
    if (this.moodHistory.length > WINDOW_SIZE) this.moodHistory.shift();
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.maxHistory) this.stateHistory.shift();

    this.persist(state);
    this.persistProfile();

    return state;
  }

  /**
   * 提取本次对话的隐式标注并追加到 tags 文件
   * 这些标注不会被实时注入上下文，只供周度摘要 distill 时消费
   */
  extractImplicitTags(textSample: string): ImplicitTag[] {
    const tags: ImplicitTag[] = [];
    const date = new Date().toISOString().slice(0, 10);

    // 压力信号检测
    const stressIndicators = ["累", "烦", "压力", "加班", "不想", "受不了", "！！", "!!!", "焦虑", "崩溃"];
    const stressMatches = stressIndicators.filter(w => textSample.includes(w));
    if (stressMatches.length > 0) {
      tags.push({
        tag: "stress_signal",
        value: stressMatches.join(", "),
        confidence: Math.min(0.9, 0.5 + stressMatches.length * 0.1),
        source: textSample.slice(0, 80),
        date,
      });
    }

    // 决策回避检测
    if (/随便|都行|你定|无所谓|懒得|不想选/i.test(textSample)) {
      tags.push({
        tag: "preference_pattern",
        value: "decision_avoidance",
        confidence: 0.7,
        source: textSample.slice(0, 80),
        date,
      });
    }

    // 深夜交互标记
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 6) {
      tags.push({
        tag: "context",
        value: "late_night_interaction",
        confidence: 1.0,
        source: textSample.slice(0, 80),
        date,
      });
    }

    // 兴趣强度：提到同一个话题的重复词
    if (textSample.length > 50) {
      tags.push({
        tag: "engagement",
        value: textSample.length > 200 ? "deep" : "normal",
        confidence: 0.6,
        source: textSample.slice(0, 80),
        date,
      });
    }

    this.appendTags(tags);
    return tags;
  }

  /**
   * 读取所有隐式标注（供 distill 使用）
   */
  readImplicitTags(sinceDays: number = 7): ImplicitTag[] {
    const fp = path.join(this.baseDir, TAGS_FILENAME);
    if (!fs.existsSync(fp)) return [];

    const cutoff = Date.now() - sinceDays * 86400000;
    const lines = fs.readFileSync(fp, "utf-8").split("\n").filter(Boolean);
    const tags: ImplicitTag[] = [];

    for (const line of lines) {
      try {
        const tag = JSON.parse(line) as ImplicitTag;
        const tagDate = new Date(tag.date + "T00:00:00").getTime();
        if (tagDate >= cutoff) tags.push(tag);
      } catch { /* skip malformed */ }
    }

    return tags;
  }

  /** Predict next mood score based on recent history (simple linear extrapolation) */
  predictMood(): { score: number; confidence: number } | null {
    if (this.stateHistory.length < 3) return null;
    const recent = this.stateHistory.slice(-5);
    if (recent.length < 2) return null;

    const scores = recent.map(s => s.moodScore);
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
    const dataConfidence = Math.min(1, recent.length / 10);
    const confidence = Math.min(0.8, stabilityConfidence * 0.6 + dataConfidence * 0.4 + 0.2);

    return { score: predictedScore, confidence };
  }

  // ── Private: mood computation ──

  private computeMood(text: string): { label: MoodLabel; score: number; confidence: number } {
    if (!text || text.length < 2) {
      return this.cache
        ? { label: this.cache.mood, score: this.cache.moodScore, confidence: Math.max(CONFIDENCE_LOW, this.cache.confidence - 0.1) }
        : { label: "neutral", score: 0, confidence: 0.5 };
    }

    const sentiment = detectSentiment(text);
    const score = sentiment.positive - sentiment.negative;

    // Blend with rolling window and previous state
    let blendedScore = score;
    if (this.moodHistory.length > 0) {
      const avgHistory = this.moodHistory.reduce((a, b) => a + b, 0) / this.moodHistory.length;
      blendedScore = (score * 0.3) + (avgHistory * 0.7);
    }
    if (this.cache) {
      blendedScore = (blendedScore * 0.6) + (this.cache.moodScore * 0.4);
    }

    const blendedLabel: MoodLabel = blendedScore > 0.15 ? "positive"
      : blendedScore < -0.15 ? "negative"
      : "neutral";

    const confidence = Math.min(CONFIDENCE_HIGH, sentiment.confidence + 0.3 + (this.moodHistory.length / WINDOW_SIZE) * 0.2);
    return { label: blendedLabel, score: blendedScore, confidence };
  }

  // ── Private: energy computation ──

  private computeIntensity(): number {
    const now = Date.now();
    const recent = this.interactionTimestamps.filter(t => now - t < 300_000);
    if (recent.length < 2) return 0.3;
    const avgInterval = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
    return Math.max(0, Math.min(1, 1 - avgInterval / 60_000));
  }

  private computeEnergy(intensity: number, msgLen: number): EnergyLabel {
    const isShort = msgLen > 0 && msgLen < 20;
    const isLong = msgLen > 100;
    if (isShort && intensity > 0.6) return "low";
    if (isShort) return "high";
    if (isLong) return "low";
    if (intensity < 0.3) return "high";
    if (intensity > 0.6) return "low";
    return "medium";
  }

  private adjustEnergyForTimeOfDay(energy: EnergyLabel, hour: number): EnergyLabel {
    if (hour >= 0 && hour < 6) {
      if (energy === "high") return "medium";
      return "low";
    }
    if (hour >= 23 || hour < 7) {
      if (energy === "high") return "medium";
    }
    return energy;
  }

  // ── Private: trust with exponential smoothing ──

  private computeTrust(success: number, fail: number): TrustLabel {
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

  // ── Private: trend detection ──

  private detectMoodTrend(currentScore: number): "rising" | "stable" | "falling" {
    if (this.stateHistory.length < 2) return "stable";
    const recent = this.stateHistory.slice(-5);
    const scores = recent.map(s => s.moodScore);
    if (scores.length < 2) return "stable";
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const delta = currentScore - avg;
    if (delta > 0.1) return "rising";
    if (delta < -0.1) return "falling";
    return "stable";
  }

  // ── Private: confidence decay ──

  private applyConfidenceDecay(state: PersonaState): PersonaState {
    if (this.lastUpdateTime === 0) return state;
    const idleMs = Date.now() - this.lastUpdateTime;
    if (idleMs < 3_600_000) return state;

    let factor = 1;
    if (idleMs >= 21_600_000) {
      factor = DECAY_6H;
    } else if (idleMs >= 3_600_000) {
      factor = DECAY_1H;
    }
    if (factor >= 1) return state;

    const newConfidence = Math.max(CONFIDENCE_LOW, state.confidence * factor);
    if (newConfidence >= state.confidence) return state;

    return {
      ...state,
      confidence: newConfidence,
      mood: newConfidence < 0.35 ? "neutral" as const : state.mood,
      moodScore: newConfidence < 0.35 ? 0 : state.moodScore,
      moodTrend: newConfidence < 0.35 ? "stable" as const : state.moodTrend,
    };
  }

  // ── Persistence ──

  private statePath(): string { return path.join(this.baseDir, STATE_FILENAME); }
  private profilePath(): string { return path.join(this.baseDir, PROFILE_FILENAME); }

  private load(): PersonaState {
    try {
      const fp = this.statePath();
      if (!fs.existsSync(fp)) return this.defaultState();
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      if (data.version !== CURRENT_VERSION) {
        // v2 → v3 迁移：保留数据，版本号升级
        return { ...data, version: CURRENT_VERSION } as PersonaState;
      }
      this.lastUpdateTime = new Date(data.updatedAt).getTime() || 0;
      return data as PersonaState;
    } catch {
      return this.defaultState();
    }
  }

  private loadProfile(): void {
    try {
      const fp = this.profilePath();
      if (!fs.existsSync(fp)) return;
      const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as InteractionProfile & {
        totalSuccess?: number; totalFailure?: number;
        messageLengths?: number[]; interactionTimestamps?: number[];
        moodHistory?: number[]; stateHistory?: PersonaState[];
      };
      if (data.totalSuccess !== undefined) this.totalSuccess = data.totalSuccess;
      if (data.totalFailure !== undefined) this.totalFailure = data.totalFailure;
      if (data.messageLengths) this.messageLengths = data.messageLengths;
      if (data.interactionTimestamps) this.interactionTimestamps = data.interactionTimestamps;
      if (data.moodHistory) this.moodHistory = data.moodHistory;
      if (data.stateHistory) this.stateHistory = data.stateHistory;
    } catch { /* best effort */ }
  }

  private persist(state: PersonaState): void {
    try {
      const fp = this.statePath();
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
    } catch { /* best effort */ }
  }

  private persistProfile(): void {
    try {
      const profile: InteractionProfile & {
        totalSuccess: number; totalFailure: number;
        messageLengths: number[]; interactionTimestamps: number[];
        moodHistory: number[]; stateHistory: PersonaState[];
      } = {
        avgMessageLength: this.messageLengths.length > 0
          ? this.messageLengths.reduce((a, b) => a + b, 0) / this.messageLengths.length : 0,
        interactionCount: this.totalSuccess + this.totalFailure,
        activePeriod: this.detectActivePeriod(),
        avgInterval: this.computeAverageInterval(),
        totalSuccess: this.totalSuccess, totalFailure: this.totalFailure,
        messageLengths: this.messageLengths, interactionTimestamps: this.interactionTimestamps,
        moodHistory: this.moodHistory, stateHistory: this.stateHistory,
      };
      fs.writeFileSync(this.profilePath(), JSON.stringify(profile, null, 2), "utf-8");
    } catch { /* best effort */ }
  }

  private appendTags(tags: ImplicitTag[]): void {
    if (tags.length === 0) return;
    try {
      const fp = path.join(this.baseDir, TAGS_FILENAME);
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const lines = tags.map(t => JSON.stringify(t)).join("\n") + "\n";
      fs.appendFileSync(fp, lines, "utf-8");
    } catch { /* best effort */ }
  }

  private detectActivePeriod(): string {
    if (this.interactionTimestamps.length < 5) return "unknown";
    const hours = this.interactionTimestamps.map(t => new Date(t).getHours());
    const night = hours.filter(h => h >= 0 && h < 6).length;
    const evening = hours.filter(h => h >= 18 && h < 24).length;
    const daytime = hours.length - night - evening;
    if (night > daytime && night > evening) return "night";
    if (evening > daytime && evening > night) return "evening";
    if (daytime > night && daytime > evening) return "daytime";
    return "mixed";
  }

  private computeAverageInterval(): number {
    if (this.interactionTimestamps.length < 2) return 0;
    const sorted = [...this.interactionTimestamps].sort();
    let total = 0;
    for (let i = 1; i < sorted.length; i++) total += sorted[i] - sorted[i - 1];
    return total / (sorted.length - 1) / 60_000;
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
