/**
 * hooks/capture-watermark.ts — Context watermark monitor.
 *
 * Monitors context window usage and computes compression level.
 * Extracted from auto-capture.ts for modularity.
 */
import { computeCompressLevel, estimateContextSize } from '../utils/context-watermark.ts';
import { getProp } from '../utils/config.ts';
import { clampNum } from '../utils/clamp.ts';
import type { YaoyaoMemoryConfig } from '../utils/memory-store.ts';

export interface WatermarkState {
  level: 'none' | 'mild' | 'aggressive' | 'emergency';
  ratio: number;
  currentTokens: number;
  windowTokens: number;
  /** Should L1 extraction be skipped? */
  skipL1: boolean;
  /** Should FTS5 indexing be skipped? */
  skipFTS5: boolean;
}

/**
 * Evaluate the current context watermark and return compression decisions.
 */
export function evaluateWatermark(
  messages: Array<Record<string, unknown>>,
  config: YaoyaoMemoryConfig,
): WatermarkState {
  const mildRatio = clampNum(getProp(config, 'capture.mildOffloadRatio', 0.6), 0.6, 0.3, 0.7);
  const aggressiveRatio = clampNum(
    getProp(config, 'capture.aggressiveCompressRatio', 0.8),
    0.8,
    0.5,
    0.95,
  );
  const emergencyRatio = clampNum(
    getProp(config, 'capture.emergencyCompressRatio', 0.95),
    0.95,
    0.8,
    0.99,
  );
  const windowTokens = clampNum(
    getProp(config, 'capture.contextWindowTokens', 128_000),
    128_000,
    32_000,
    256_000,
  );

  const currentTokens = estimateContextSize(messages);
  const { level, ratio } = computeCompressLevel(currentTokens, {
    contextWindowTokens: windowTokens,
    mildOffloadRatio: mildRatio,
    aggressiveCompressRatio: aggressiveRatio,
    emergencyCompressRatio: emergencyRatio,
  });

  const skipL1 = level === 'aggressive' || level === 'emergency';
  const skipFTS5 = level === 'emergency';

  return { level, ratio, currentTokens, windowTokens, skipL1, skipFTS5 };
}
