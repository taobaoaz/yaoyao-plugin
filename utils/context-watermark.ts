/**
 * Context Watermark — Tencent-style three-level compression triggers.
 *
 * Monitors context "water level" (size / window capacity) and triggers
 * progressive compression:
 *   L1 mild (60%)  → summarize tool results
 *   L2 aggressive (80%) → prune old task messages
 *   L3 emergency (95%) → drop to 60%
 *
 * Yaoyao uses character-length estimation (1 token ≈ 3.5 chars) since
 * no tokenizer is available in pure frontend.
 */

export interface WatermarkConfig {
  /** Context window size in tokens (default: 128000) */
  contextWindowTokens?: number;
  /** Mild compression trigger ratio (default: 0.6) */
  mildOffloadRatio?: number;
  /** Aggressive compression trigger ratio (default: 0.8) */
  aggressiveCompressRatio?: number;
  /** Emergency compression trigger ratio (default: 0.95) */
  emergencyCompressRatio?: number;
}

/** Approximate chars per token for mixed Chinese/English text */
const CHARS_PER_TOKEN = 3.5;

export type CompressLevel = "none" | "mild" | "aggressive" | "emergency";

/** Estimate token count from character length */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Compute compression level from current context size */
export function computeCompressLevel(
  currentTokens: number,
  config?: WatermarkConfig
): { level: CompressLevel; ratio: number; currentTokens: number; windowTokens: number } {
  const windowTokens = config?.contextWindowTokens ?? 128_000;
  const mildRatio = config?.mildOffloadRatio ?? 0.6;
  const aggressiveRatio = config?.aggressiveCompressRatio ?? 0.8;
  const emergencyRatio = config?.emergencyCompressRatio ?? 0.95;

  const ratio = currentTokens / windowTokens;

  let level: CompressLevel = "none";
  if (ratio >= emergencyRatio) level = "emergency";
  else if (ratio >= aggressiveRatio) level = "aggressive";
  else if (ratio >= mildRatio) level = "mild";

  return { level, ratio, currentTokens, windowTokens };
}

/** Estimate total context size from message array */
export function estimateContextSize(messages: Array<{ role?: string; content?: unknown }>): number {
  let totalChars = 0;
  for (const m of messages) {
    const content = m.content;
    if (typeof content === "string") {
      totalChars += content.length;
    } else if (content) {
      totalChars += JSON.stringify(content).length;
    }
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}
