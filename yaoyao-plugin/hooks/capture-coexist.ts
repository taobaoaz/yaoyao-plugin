/**
 * hooks/capture-coexist.ts — Coexistence detection + claw-bridge lazy init.
 *
 * Pure factory, returns read-only coexist context for capture.
 */

import { getCoexistState } from '../utils/coexistence.ts';
import { createClawBridge, type ClawBridge } from '../utils/claw-bridge.ts';
import type { YaoyaoMemoryConfig } from '../utils/memory-store.ts';

export interface CoexistContext {
  skipLocalIndexing: boolean;
  forwardCapture: boolean;
  clawBridge: ClawBridge | null;
  logSuffix: string;
}

/** Build coexist context for capture decisions. */
export function createCoexistContext(_config: YaoyaoMemoryConfig): CoexistContext {
  const coexist = getCoexistState();
  const skipLocalIndexing = coexist.flags.skipLocalIndexing;
  const forwardCapture = coexist.flags.forwardCaptureToClaw;
  const clawBridge: ClawBridge | null = forwardCapture ? (createClawBridge() ?? null) : null;

  const parts: string[] = [];
  if (skipLocalIndexing) parts.push('[coexist: L1/L2 skipped]');
  if (forwardCapture) parts.push('[coexist: forwarding to claw-core]');

  return { skipLocalIndexing, forwardCapture, clawBridge, logSuffix: parts.join('') };
}
