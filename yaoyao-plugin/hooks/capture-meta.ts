/**
 * hooks/capture-meta.ts — Metadata building + dedup for capture pipeline.
 *
 * Extracted from capture-pipeline.ts to keep it under 200 lines.
 * This module handles the heavy imports: temporal, verify, identity,
 * upgrader, L1 extraction, chunker, memory-types.
 */

import { clampNum } from '../utils/clamp.ts';
import { classifyTemporal, inferExpiry } from '../utils/temporal-classifier.ts';
import { detectSpeculative, detectCorrection } from '../core/verify/verify.ts';
import { extractIdentityCandidates } from '../utils/identity-addressing.ts';
import { enrichMetadata } from '../core/upgrader/index.ts';
import { extractFacts, type L1Logger } from '../utils/l1-extractor.ts';
import { classifyMemoryType, type MemoryTag } from '../core/memory-types.ts';
import type { YaoyaoMemoryConfig } from '../utils/memory-store.ts';
import type { DBBridge } from '../utils/db-bridge.ts';
import { isDuplicateOfRecent } from '../utils/batch-dedup.ts';
import type { CaptureConfig } from './capture-pipeline.ts';

export interface AntiHallucinationResult {
  riskTag: string;
  specCheck: ReturnType<typeof detectSpeculative>;
  corrCheck: ReturnType<typeof detectCorrection>;
}

export function runAntiHallucination(
  userContent: string,
  asstContent: string,
  verifyActive: boolean,
): AntiHallucinationResult {
  let riskTag = '';
  let specCheck: ReturnType<typeof detectSpeculative> = {
    isSpeculative: false,
    markers: [],
    confidence: 'high',
  };
  let corrCheck: ReturnType<typeof detectCorrection> = { isCorrection: false, markers: [] };
  if (verifyActive) {
    try {
      specCheck = detectSpeculative(asstContent);
      corrCheck = detectCorrection(userContent);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:capture] Meta parse failed: ${msg}`);
    }
  }
  if (specCheck.isSpeculative) riskTag = ` [⚠️ 推测性: ${specCheck.markers.join(', ')}]`;
  if (corrCheck.isCorrection) riskTag += ` [🚫 用户纠正]`;
  return { riskTag, specCheck, corrCheck };
}

export async function buildMetaObj(
  userContent: string,
  asstContent: string,
  scopeManager: import('../utils/scope-manager.ts').SimpleScopeManager | undefined,
  agentId: string | undefined,
  specCheck: ReturnType<typeof detectSpeculative>,
  corrCheck: ReturnType<typeof detectCorrection>,
  enableL1: boolean,
  skipL1: boolean,
  brainMode: 'lite' | 'full',
  llmClient: import('../utils/llm-client.ts').LLMClient | null,
  logger: L1Logger,
  maxMemories: number,
  config: YaoyaoMemoryConfig,
): Promise<{ metaObj: Record<string, unknown>; meta: string | undefined; memoryTag?: MemoryTag }> {
  const temporalType = classifyTemporal(userContent + ' ' + asstContent);
  const expiryAt =
    temporalType === 'dynamic' ? inferExpiry(userContent + ' ' + asstContent) : undefined;
  const memoryTag = classifyMemoryType(userContent, asstContent);
  const metaObj: Record<string, unknown> = { temporal: temporalType, memoryType: memoryTag.type };

  if (scopeManager) metaObj.scope = scopeManager.getDefaultScope(agentId);
  const identities = extractIdentityCandidates(userContent + ' ' + asstContent);
  if (identities.length > 0) metaObj.identities = identities;
  if (expiryAt) metaObj.expiryAt = expiryAt;
  if (specCheck.isSpeculative) {
    metaObj.speculative = true;
    metaObj.confidence = specCheck.confidence;
  }
  if (corrCheck.isCorrection) {
    metaObj.correction = true;
  }
  if (memoryTag.tags.length > 0) {
    metaObj.tags = memoryTag.tags;
  }

  if (enableL1 && !skipL1) {
    try {
      const facts = await extractFacts(userContent, asstContent, { brainMode, llmClient, logger });
      if (facts.length > 0) metaObj.l1Facts = facts.slice(0, maxMemories);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:capture] Watermark eval failed: ${msg}`);
    }
  }

  enrichMetadata(metaObj, userContent + ' ' + asstContent);
  const meta = Object.keys(metaObj).length > 1 ? JSON.stringify(metaObj) : undefined;
  return { metaObj, meta, memoryTag };
}

export function checkDedup(db: DBBridge, texts: string, config: CaptureConfig): boolean {
  if (!config.enableDedup) return false;
  try {
    const recent = db.getLatestMemory(config.dedupLookback);
    return isDuplicateOfRecent(texts, recent, config.dedupThreshold);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:capture] Anti-hallucination failed: ${msg}`);
    return false;
  }
}
