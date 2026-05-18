/**
 * hooks/capture-pipeline.ts — Capture pipeline steps.
 *
 * Extracted from auto-capture.ts: each step is a pure function
 * that takes a context and returns a result. The orchestrator
 * calls these in sequence.
 */
import { clampNum } from "../utils/clamp.ts";
import { getObj, getProp, getBool } from "../utils/config.ts";
import { isNoise } from "../core/filter/noise.ts";
import { classifyTemporal, inferExpiry } from "../utils/temporal-classifier.ts";
import { detectSpeculative, detectCorrection } from "../core/verify/verify.ts";
import { extractIdentityCandidates } from "../utils/identity-addressing.ts";
import { compressTexts, estimateConversationValue } from "../utils/session-compressor.ts";
import { enrichMetadata } from "../core/upgrader/index.ts";
import { smartChunk } from "../utils/chunker.ts";
import { isDuplicateOfRecent } from "../utils/batch-dedup.ts";
import { extractFacts, type L1Logger } from "../utils/l1-extractor.ts";
import { maybeOffload } from "../utils/mermaid-canvas.ts";
import { isMMDBlock } from "../utils/mmd-filter.ts";
import { isTrivial } from "../core/filter/trivial.ts";
import { extractContent } from "./capture-content.ts";
import { classifyMemoryType, type MemoryTag } from "../core/memory-types.ts";
import type { YaoyaoMemoryConfig, MemoryStore } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";
import type { AuditLog } from "../utils/audit-log.ts";

export interface CaptureContext {
  sessionKey: string;
  agentId?: string;
  lastUserMsg: Record<string, unknown>;
  lastAsstMsg?: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  date: string;
  timestamp: string;
  userContent: string;
  asstContent: string;
  indexableAsst: string;
}


export interface CaptureConfig {
  captureMaxLen: number;
  enableL1: boolean;
  enableDedup: boolean;
  dedupThreshold: number;
  dedupLookback: number;
  enableOffload: boolean;
  offloadThreshold: number;
  maxContentLen: number;
  brainMode: "lite" | "full";
  maxMemoriesPerSession: number;
}

export function getCaptureConfig(config: YaoyaoMemoryConfig): CaptureConfig {
  const captureCfg = getObj(config, "capture") || {};
  return {
    captureMaxLen: clampNum(getProp(captureCfg, "maxContentLen", 500), 500, 50, 5000),
    enableL1: getBool(config, "capture.enableL1", false),
    enableDedup: getBool(config, "capture.enableDedup", true),
    dedupThreshold: clampNum(getProp(config, "capture.dedupThreshold", 0.92), 0.92, 0.7, 0.99),
    dedupLookback: clampNum(getProp(config, "capture.dedupLookback", 5), 5, 1, 20),
    enableOffload: getBool(config, "capture.enableContextOffload", false),
    offloadThreshold: clampNum(getProp(config, "capture.offloadThreshold", 4000), 4000, 1000, 10000),
    maxContentLen: clampNum(getProp(captureCfg, "maxContentLen", 500), 500, 50, 5000),
    brainMode: getProp(config, "brainMode", "lite") as "lite" | "full",
    maxMemoriesPerSession: clampNum(getProp(config, "capture.maxMemoriesPerSession", 20), 20, 1, 100),
  };
}

export function buildCaptureContext(messages: Array<Record<string, unknown>>, date: string, timestamp: string, captureMaxLen: number): CaptureContext | null {
  const lastUserMsg = [...messages].reverse().find((m: Record<string, unknown>) => m.role === "user");
  const lastAsstMsg = [...messages].reverse().find((m: Record<string, unknown>) => m.role === "assistant");
  if (!lastUserMsg) return null;

  const userContent = extractContent(lastUserMsg, captureMaxLen);
  const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, captureMaxLen) : "(no response)";
  const indexableAsst = (!asstContent || asstContent === "(no response)") ? "" : asstContent;

  return { sessionKey: "", userContent, asstContent, indexableAsst, lastUserMsg, lastAsstMsg, messages, date, timestamp };
}

export function estimateConversation(messages: Array<Record<string, unknown>>, captureMaxLen: number): { convValue: number; texts: string[] } {
  const texts: string[] = [];
  for (const m of messages) {
    const role = m.role;
    const text = extractContent(m, 200);
    if (text && (role === "user" || role === "assistant")) texts.push(text);
  }
  const convValue = estimateConversationValue(texts);
  return { convValue, texts };
}

export function shouldSkipContent(userContent: string, asstContent: string): { skip: boolean; reason?: string } {
  if (isNoise(userContent) && isNoise(asstContent)) return { skip: true, reason: "noise" };
  if (isMMDBlock(userContent) || isMMDBlock(asstContent)) return { skip: true, reason: "MMD block" };
  const trivialCheck = isTrivial(userContent);
  if (trivialCheck.isTrivial) return { skip: true, reason: `trivial: ${trivialCheck.reason}` };
  return { skip: false };
}

export function runAntiHallucination(userContent: string, asstContent: string, verifyActive: boolean) {
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

export async function buildMetaObj(
  userContent: string,
  asstContent: string,
  scopeManager: any | undefined,
  agentId: string | undefined,
  specCheck: any,
  corrCheck: any,
  enableL1: boolean,
  skipL1: boolean,
  brainMode: "lite" | "full",
  llmClient: any | null,
  logger: any,
  maxMemories: number,
  config: YaoyaoMemoryConfig,
): Promise<{ metaObj: Record<string, unknown>; meta: string | undefined; memoryTag?: MemoryTag }> {
  const temporalType = classifyTemporal(userContent + " " + asstContent);
  const expiryAt = temporalType === "dynamic" ? inferExpiry(userContent + " " + asstContent) : undefined;
  const memoryTag = classifyMemoryType(userContent, asstContent);
  const metaObj: Record<string, unknown> = { temporal: temporalType, memoryType: memoryTag.type };

  if (scopeManager) metaObj.scope = scopeManager.getDefaultScope(agentId);
  const identities = extractIdentityCandidates(userContent + " " + asstContent);
  if (identities.length > 0) metaObj.identities = identities;
  if (expiryAt) metaObj.expiryAt = expiryAt;
  if (specCheck.isSpeculative) { metaObj.speculative = true; metaObj.confidence = specCheck.confidence; }
  if (corrCheck.isCorrection) { metaObj.correction = true; }
  if (memoryTag.tags.length > 0) { metaObj.tags = memoryTag.tags; }

  if (enableL1 && !skipL1) {
    try {
      const facts = await extractFacts(userContent, asstContent, { brainMode, llmClient, logger: logger as L1Logger });
      if (facts.length > 0) metaObj.l1Facts = facts.slice(0, maxMemories);
    } catch { /* best effort */ }
  }

  enrichMetadata(metaObj, userContent + " " + asstContent);
  const meta = Object.keys(metaObj).length > 1 ? JSON.stringify(metaObj) : undefined;
  return { metaObj, meta, memoryTag };
}

export function checkDedup(db: DBBridge, texts: string, config: CaptureConfig): boolean {
  if (!config.enableDedup) return false;
  try {
    const recent = db.getLatestMemory(config.dedupLookback);
    return isDuplicateOfRecent(texts, recent, config.dedupThreshold);
  } catch { return false; }
}

export function writeDailyFile(store: MemoryStore, date: string, timestamp: string, userContent: string, asstContent: string, riskTag: string, isCorrection: boolean): void {
  const entry = `\n### ${timestamp}\n**User:** ${userContent}${isCorrection ? " [纠正]" : ""}\n**AI:** ${asstContent}${riskTag}\n`;
  store.appendToDaily(date, entry);
}

export function indexToFTS5(
  db: DBBridge,
  userContent: string,
  indexableAsst: string,
  date: string,
  meta: string | undefined,
  watermark: { skipFTS5?: boolean },
  writeQueue: any,
  api: any,
): void {
  if (watermark.skipFTS5) return;

  const CHUNK_THRESHOLD = 4000;
  if (indexableAsst.length > CHUNK_THRESHOLD) {
    const chunkResult = smartChunk(indexableAsst, CHUNK_THRESHOLD);
    for (let i = 0; i < chunkResult.chunks.length; i++) {
      const chunkMeta = { ...JSON.parse(meta || "{}"), chunkIndex: i + 1, totalChunks: chunkResult.chunkCount };
      const chunkMetaStr = Object.keys(chunkMeta).length > 1 ? JSON.stringify(chunkMeta) : undefined;
      if (writeQueue) {
        writeQueue.enqueue({ date, userContent, asstContent: chunkResult.chunks[i], meta: chunkMetaStr });
      } else {
        db.indexTurn(userContent, chunkResult.chunks[i], date, chunkMetaStr);
      }
    }
  } else {
    if (writeQueue) {
      writeQueue.enqueue({ date, userContent, asstContent: indexableAsst, meta });
    } else {
      db.indexTurn(userContent, indexableAsst, date, meta);
    }
  }
}

export function handleMermaidOffload(store: MemoryStore, sk: string, text: string, enable: boolean, threshold: number): void {
  if (enable) maybeOffload(store.baseDir, sk, text, threshold);
}