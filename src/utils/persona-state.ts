/**
 * PersonaStateMachine v2 — AI 状态计算模块
 *
 * 继承 v1 的核心原则（mood/energy/trust 是计算字段，不是感受）
 * 在此基础上增强：
 * - 历史追踪：保留趋势分析能力
 * - 置信度衰减：长时间无交互时逐渐降低置信度
 * - 自适应能量：基于消息长度、交互频率、时段计算真实 energy
 * - 平滑信任：指数移动平均取代原始比率
 * - 滚动情绪窗口：sentimentBuffer 真正投入使用
 *
 * ⚠️ 完全独立模块，所有 try-catch 兜底，失败不影响主流程。
 */

import fs from "node:fs";
import path from "node:path";
import { detectSentiment } from "./sentiment.js";

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

const STATE_FILENAME = ".persona-state.json";
const PROFILE_FILENAME = ".persona-interaction-profile.json";
const CURRENT_VERSION = 2;
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

    // Compute mood from rolling sentiment window
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

  getGuidance(): {
    tone: "warm" | "neutral" | "gentle";
    verbosity: "concise" | "balanced" | "thorough";
    autonomy: "high" | "normal" | "low";
  } {
    const state = this.getState();
    const tone = state.mood === "positive" ? "warm"
      : state.mood === "negative" ? "gentle"
      : "neutral";
    const verbosity = state.energy === "high" ? "concise"
      : state.energy === "low" ? "thorough"
      : "balanced";
    const autonomy = state.trust === "high" ? "high"
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

    return parts.length > 0 ? parts.join("；") : "";
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
      if (data.version !== CURRENT_VERSION) throw new Error("Version mismatch");
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
