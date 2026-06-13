/**
 * hooks/capture-meta.ts — Metadata building + dedup for capture pipeline.
 *
 * Extracted from capture-pipeline.ts to keep it under 200 lines.
 * This module handles the heavy imports: temporal, verify, identity,
 * upgrader, L1 extraction, chunker, memory-types.
 *
 * v1.8.0: Added source (channel/device), deviceInteractions, skillSource metadata.
 */

import { clampNum } from "../utils/clamp.ts";
import { classifyTemporal, inferExpiry } from "../utils/temporal-classifier.ts";
import { detectSpeculative, detectCorrection } from "../core/verify/verify.ts";
import { extractIdentityCandidates } from "../utils/identity-addressing.ts";
import { enrichMetadata } from "../core/upgrader/index.ts";
import { extractFacts, type L1Logger } from "../utils/l1-extractor.ts";
import { classifyMemoryType, type MemoryTag } from "../core/memory-types.ts";
import { computeValueFactors, computeMemoryValue, type MemoryValueFactors } from "../core/value/memory-value.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";
import { isDuplicateOfRecent } from "../utils/batch-dedup.ts";
import type { CaptureConfig } from "./capture-pipeline.ts";
import type { ChannelInfo } from "../utils/channel-detector.ts";
import type { DeviceInteraction } from "./capture-content.ts";

export interface AntiHallucinationResult {
  riskTag: string;
  specCheck: ReturnType<typeof detectSpeculative>;
  corrCheck: ReturnType<typeof detectCorrection>;
}

export function runAntiHallucination(userContent: string, asstContent: string, verifyActive: boolean): AntiHallucinationResult {
  let riskTag = "";
  let specCheck: ReturnType<typeof detectSpeculative> = { isSpeculative: false, markers: [], confidence: "high" };
  let corrCheck: ReturnType<typeof detectCorrection> = { isCorrection: false, markers: [] };
  if (verifyActive) {
    try {
      specCheck = detectSpeculative(asstContent);
      corrCheck = detectCorrection(userContent);
    } catch { /* best-effort */ }
  }
  if (specCheck.isSpeculative) riskTag = ` [⚠️ 推测性: ${specCheck.markers.join(", ")}]`;
  if (corrCheck.isCorrection) riskTag += ` [🚫 用户纠正]`;
  return { riskTag, specCheck, corrCheck };
}

export interface BuildMetaExtras {
  channelInfo?: ChannelInfo;
  deviceInteractions?: DeviceInteraction[];
  skillSource?: { name: string; category: string };
}

export async function buildMetaObj(
  userContent: string,
  asstContent: string,
  scopeManager: import("../utils/scope-manager.ts").SimpleScopeManager | undefined,
  agentId: string | undefined,
  specCheck: ReturnType<typeof detectSpeculative>,
  corrCheck: ReturnType<typeof detectCorrection>,
  enableL1: boolean,
  skipL1: boolean,
  brainMode: "lite" | "full",
  llmClient: import("../utils/llm-client.ts").LLMClient | null,
  logger: L1Logger,
  maxMemories: number,
  config: YaoyaoMemoryConfig,
  extras?: BuildMetaExtras,
): Promise<{ metaObj: Record<string, unknown>; meta: string | undefined; memoryTag?: MemoryTag }> {
  // v1.8.0: If device interactions include time-sensitive tools, force dynamic temporal
  const hasTimeSensitive = extras?.deviceInteractions?.some(i =>
    ["create_calendar_event", "search_calendar_event", "create_alarm", "modify_alarm", "delete_alarm"].includes(i.tool)
  ) ?? false;

  const combinedText = userContent + " " + asstContent;
  let temporalType = classifyTemporal(combinedText);
  if (hasTimeSensitive && temporalType !== "dynamic") {
    temporalType = "dynamic";
  }

  const expiryAt = temporalType === "dynamic"
    ? (hasTimeSensitive ? _shortExpiry() : inferExpiry(combinedText))
    : undefined;
  const memoryTag = classifyMemoryType(userContent, asstContent);

  // v1.8.2: Seven-factor memory value function (replaces single importance)
  // Paper: "Learning What to Remember" (arXiv:2606.12945) — V(m) = Σ wᵢfᵢ(m)
  const valueFactors = computeValueFactors(userContent, asstContent, {
    speculative: specCheck.isSpeculative,
    correction: corrCheck.isCorrection,
    memoryType: memoryTag.type,
  });
  const memoryValue = computeMemoryValue(valueFactors);

  const metaObj: Record<string, unknown> = {
    temporal: temporalType,
    memoryType: memoryTag.type,
    importance: memoryValue,
    valueFactors,
  };

  if (scopeManager) metaObj.scope = scopeManager.getDefaultScope(agentId);
  const identities = extractIdentityCandidates(combinedText);
  if (identities.length > 0) metaObj.identities = identities;
  if (expiryAt) metaObj.expiryAt = expiryAt;
  if (specCheck.isSpeculative) { metaObj.speculative = true; metaObj.confidence = specCheck.confidence; }
  if (corrCheck.isCorrection) { metaObj.correction = true; }
  if (memoryTag.tags.length > 0) { metaObj.tags = memoryTag.tags; }

  // v1.8.0: Channel/device source metadata
  if (extras?.channelInfo) {
    const ci = extras.channelInfo;
    const sourceObj: Record<string, unknown> = {};
    if (ci.channel !== "unknown") sourceObj.channel = ci.channel;
    if (ci.deviceType !== "unknown") sourceObj.deviceType = ci.deviceType;
    if (Object.keys(sourceObj).length > 0) metaObj.source = sourceObj;
  }

  // v1.8.0: Device interactions (tool calls)
  if (extras?.deviceInteractions && extras.deviceInteractions.length > 0) {
    metaObj.deviceInteractions = extras.deviceInteractions.slice(0, 10);
  }

  // v1.8.0: Skill source
  if (extras?.skillSource) {
    metaObj.skillSource = extras.skillSource;
  }

  if (enableL1 && !skipL1) {
    try {
      const facts = await extractFacts(userContent, asstContent, { brainMode, llmClient, logger });
      if (facts.length > 0) metaObj.l1Facts = facts.slice(0, maxMemories);
    } catch { /* best effort */ }
  }

  enrichMetadata(metaObj, combinedText);
  const meta = Object.keys(metaObj).length > 1 ? JSON.stringify(metaObj) : undefined;
  return { metaObj, meta, memoryTag };
}

/** Shortened expiry for time-sensitive device interactions (2 hours) */
function _shortExpiry(): string {
  const dt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return dt.toISOString();
}

export function checkDedup(db: DBBridge, texts: string, config: CaptureConfig): boolean {
  if (!config.enableDedup) return false;
  try {
    const recent = db.getLatestMemory(config.dedupLookback);
    return isDuplicateOfRecent(texts, recent, config.dedupThreshold);
  } catch { return false; }
}