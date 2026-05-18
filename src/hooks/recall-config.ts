/**
 * hooks/recall-config.ts — Recall configuration types and extraction.
 *
 * Pure config reading from YaoyaoMemoryConfig. No other dependencies.
 */
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";

export interface RecallThresholds {
  cacheTTL: number;
  maxCacheSize: number;
  halfLife: number;
  jaccardBase: number;
  jaccardMin: number;
  maxSessions: number;
  maxContextKeywords: number;
  maxResults: number;
  decayMode: "weibull" | "logistic";
  /** Recall position: "append" = after system prompt (default), "prepend" = before user message (cache-friendly) */
  position: "append" | "prepend";
  /** Max recall time in ms before skipping injection without blocking */
  timeoutMs: number;
  /** Exclude memories created within this many ms ago (0 = disabled). Prevents circular recall. */
  excludeRecentMS: number;
  /** Minimum results required to inject recall context (0 = always inject) */
  minResults: number;
  /** Max characters of recalled context to inject */
  maxChars: number;
  /** Score threshold for confidence scoring */
  scoreThreshold: number;
}

export function getRecallConfig(config: YaoyaoMemoryConfig): RecallThresholds {
  const r = config.recall || {};
  return {
    cacheTTL: r.cacheTTL ?? 30000,
    maxCacheSize: r.maxCacheSize ?? 50,
    halfLife: r.halfLife ?? 30,
    jaccardBase: r.jaccardBase ?? 0.75,
    jaccardMin: r.jaccardMin ?? 0.5,
    maxSessions: r.maxSessions ?? 1000,
    maxContextKeywords: r.maxContextKeywords ?? 20,
    maxResults: r.maxResults ?? 3,
    decayMode: (r.decayMode as "weibull" | "logistic") ?? "weibull",
    position: (r.position as "append" | "prepend") ?? "append",
    timeoutMs: r.timeoutMs ?? 800,
    excludeRecentMS: r.excludeRecentMS ?? 0,
    minResults: r.minResults ?? 0,
    maxChars: r.maxChars ?? 1200,
    scoreThreshold: r.minScore ?? 0.5,
  };
}
