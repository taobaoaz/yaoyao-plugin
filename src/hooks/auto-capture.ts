/**
 * auto-capture hook — captures conversation turns into daily memory files
 * and indexes them in FTS5 for future search.
 *
 * Uses api.on("agent_end", ...) to log each agent turn to the daily log.
 * Handles both string and structured content formats.
 *
 * v1.5.0+: Removed psychological state tracking (moved to yaoyao-soul).
 *          Plugin now purely captures and indexes, without implicit tagging.
 */
import { clampNum } from "../utils/clamp.ts";
import fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore, YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";
import { getObj, getProp, getBool } from "../utils/config.ts";
import { appendSelfImprovementEntry } from "../utils/self-improvement.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { isNoise } from "../utils/noise-filter.ts";
import { classifyTemporal, inferExpiry } from "../utils/temporal-classifier.ts";
import { detectSpeculative, detectCorrection } from "../core/verify/verify.ts";
import { extractIdentityCandidates } from "../utils/identity-addressing.ts";
import { compressTexts, estimateConversationValue } from "../utils/session-compressor.ts";
import { enrichMetadata } from "../utils/memory-upgrader.ts";
import { smartChunk } from "../utils/chunker.ts";
import { isDuplicateOfRecent } from "../utils/batch-dedup.ts";
import { isExcludedAgent } from "../utils/glob-match.ts";
import { extractFacts, type L1Logger } from "../utils/l1-extractor.ts";
import { maybeOffload } from "../utils/mermaid-canvas.ts";
import { isMMDBlock } from "../utils/mmd-filter.ts";
import { isTrivial } from "../utils/trivial-detector.ts";
import type { AuditLog } from "../utils/audit-log.ts";
import { recordSessionActivity, isSessionActive, pruneStaleSessions } from "../utils/session-activity.ts";
import { computeCompressLevel, estimateContextSize } from "../utils/context-watermark.ts";

/** Safely extract text content from a message, handling string/array/object formats */
export function extractContent(msg: unknown, maxLen?: number): string {
  if (!msg) return "";
  const content = (msg as Record<string, unknown>).content;
  const limit = maxLen && maxLen > 0 ? maxLen : 500;

  if (typeof content === "string") return content.slice(0, limit);

  if (Array.isArray(content)) {
    return content
      .map((part: Record<string, unknown>) => {
        if (part.type === "text") return String(part.text ?? "");
        return "";
      })
      .filter(s => s.length > 0)
      .join(" ")
      .slice(0, limit);
  }

  // Fallback: safe JSON stringify with depth limit
  try {
    return safeStringify(content, limit);
  } catch {
    return "[unparseable content]";
  }
}

/** Depth-limited JSON stringify to avoid OOM on deeply nested / massive objects */
export function safeStringify(obj: unknown, maxLen: number): string {
  const seen = new WeakSet<object>();
  function walk(val: unknown, depth: number): string {
    if (depth > 3) return "[...]";
    if (val === null) return "null";
    if (typeof val !== "object") return String(val);
    if (seen.has(val as object)) return "[Circular]";
    seen.add(val as object);
    if (Array.isArray(val)) {
      const items = val.slice(0, 10).map(v => walk(v, depth + 1));
      const tail = val.length > 10 ? `,...${val.length - 10} more` : "";
      return `[${items.join(",")}${tail}]`;
    }
    const entries = Object.entries(val as Record<string, unknown>).slice(0, 10);
    const tail = Object.keys(val as Record<string, unknown>).length > 10 ? ",...}" : "}";
    const pairs = entries.map(([k, v]) => `${k}:${walk(v, depth + 1)}`);
    return `{${pairs.join(",")}${tail}`;
  }
  return walk(obj, 0).slice(0, maxLen);
}

export function registerCaptureHook(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  verifyActive = true,
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  llmClient?: import("../utils/llm-client.ts").LLMClient | null,
  audit?: AuditLog,
) {
  api.logger.info("[yaoyao-memory] Registering agent_end hook (auto-capture + FTS5 index)");

  // Create session filter with configured blockLabels
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });

  api.on("agent_end", async (event, ctx) => {
    try {
      const e = event as Record<string, unknown>;
      if (!e.success) return;

      // Session filter: skip internal/system sessions
      const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
      if (!sessionFilter.shouldProcess(sessionKey)) {
        return;
      }

      // Tencent-style: skip capture for excluded agents (glob patterns)
      const excludeAgents = getProp(config, "capture.excludeAgents", []) as string[];
      const agentId = (api as Record<string, unknown>).agentId as string | undefined;
      if (agentId && excludeAgents.length > 0 && isExcludedAgent(agentId, excludeAgents)) {
        api.logger.debug?.(`[yaoyao-memory:capture] Skipped excluded agent: ${agentId}`);
        return;
      }

      // Tencent-style warmup mode: new session triggers capture at 1→2→4→8... rounds
      const enableWarmup = getBool(config, "capture.enableWarmup", false);
      const warmupRound = getProp(config, "capture.warmupRound", 1) as number;
      if (enableWarmup) {
        const roundCount = messages.filter((m: Record<string, unknown>) => m.role === "user").length;
        const nextTrigger = Math.pow(2, Math.floor(Math.log2(Math.max(1, roundCount))));
        if (roundCount !== nextTrigger && roundCount !== 1) {
          api.logger.debug?.(`[yaoyao-memory:capture] Warmup skip: round ${roundCount}, next trigger at ${nextTrigger}`);
          return;
        }
      }

      // Tencent-style: fixed-interval capture (every N user turns)
      const everyN = clampNum(getProp(config, "capture.everyNConversations", 0), 0, 0, 100);
      if (everyN > 0 && !enableWarmup) {
        const roundCount = messages.filter((m: Record<string, unknown>) => m.role === "user").length;
        if (roundCount % everyN !== 0) {
          api.logger.debug?.(`[yaoyao-memory:capture] Every-N skip: round ${roundCount}, trigger every ${everyN}`);
          return;
        }
      }

      // Tencent-style: exclude messages matching user-defined regex patterns
      const excludePatterns = (getProp(config, "capture.excludePatterns", []) as string[])
        .map(p => { try { return new RegExp(p, "i"); } catch { return null; } })
        .filter((r): r is RegExp => r !== null);
      if (excludePatterns.length > 0) {
        const fullText = messages.map((m: Record<string, unknown>) => (m.content || m.text || "")).join(" ");
        for (const pattern of excludePatterns) {
          if (pattern.test(fullText)) {
            api.logger.debug?.(`[yaoyao-memory:capture] Skipped excluded pattern: ${pattern.source}`);
            return;
          }
        }
      }

      // Tencent-style: track session activity for active-window decisions
      const activeWindowHours = clampNum(getProp(config, "capture.sessionActiveWindowHours", 24), 24, 1, 168);
      const sessionActivity = recordSessionActivity(sessionKey);
      const wasActive = isSessionActive(sessionKey, activeWindowHours);
      if (!wasActive && sessionActivity.turnCount > 1) {
        api.logger.debug?.(`[yaoyao-memory:capture] Session ${sessionKey} resumed after ${Math.round((Date.now() - sessionActivity.lastActiveMs) / 3600000)}h idle`);
      }
      // Prune old sessions periodically (every 50 turns)
      if (sessionActivity.turnCount % 50 === 0) {
        const pruned = pruneStaleSessions(activeWindowHours);
        if (pruned > 0) api.logger.debug?.(`[yaoyao-memory:capture] Pruned ${pruned} stale sessions`);
      }

      const lastUserMsg = [...messages].reverse().find((m: Record<string, unknown>) => (m as Record<string, unknown>).role === "user");
      const lastAsstMsg = [...messages].reverse().find((m: Record<string, unknown>) => (m as Record<string, unknown>).role === "assistant");

      if (!lastUserMsg) return;

      // Issue #16: Use timezone-aware date if config.tz is set
      let date: string;
      if (config.tz) {
        try {
          date = new Intl.DateTimeFormat("sv-SE", { timeZone: config.tz, year: "numeric", month: "2-digit", day: "2-digit" } as Intl.DateTimeFormatOptions).format(new Date());
        } catch {
          api.logger.warn?.(`[yaoyao-memory:capture] Invalid timezone "${config.tz}", falling back to UTC date`);
          date = new Date().toISOString().slice(0, 10);
        }
      } else {
        date = new Date().toISOString().slice(0, 10);
      }
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

      const captureCfg = getObj(config, "capture") || {};
      const captureMaxLen = clampNum(getProp(captureCfg, "maxContentLen", 500), 500, 50, 5000);
      const minContentLen = clampNum(getProp(captureCfg, "minContentLen", 3), 3, 0, 100);

      // Brain-style Session Compressor: if conversation is long, compress to high-signal turns
      let conversationTexts: string[] = [];
      for (const m of messages) {
        const role = (m as Record<string, unknown>).role;
        const text = extractContent(m, 200);
        if (text && (role === "user" || role === "assistant")) {
          conversationTexts.push(text);
        }
      }

      // Estimate if this conversation is worth capturing
      const convValue = estimateConversationValue(conversationTexts);
      if (convValue < 0.2 && conversationTexts.length > 4) {
        api.logger.debug?.("[yaoyao-memory:capture] Conversation value too low, skipping");
        return;
      }

      // Compress long conversations before extraction
      if (conversationTexts.length > 6) {
        const maxChars = captureMaxLen * 3;
        const compressed = compressTexts(conversationTexts, maxChars, { minTexts: 3, minScoreToKeep: 0.3 });
        api.logger.debug?.(`[yaoyao-memory:capture] Compressed ${conversationTexts.length} → ${compressed.texts.length} turns (dropped ${compressed.dropped})`);
      }

      const userContent = extractContent(lastUserMsg, captureMaxLen);
      const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, captureMaxLen) : "(no response)";

      // Tencent-style Mermaid Canvas: offload long tool logs to refs/
      const brainMode = (getProp(config, "brainMode", "lite") as "lite" | "full");
      const enableOffload = getBool(config, "capture.enableContextOffload", false);
      if (enableOffload) {
        const offloadThreshold = clampNum(getProp(config, "capture.offloadThreshold", 4000), 4000, 1000, 10000);
        const offloadResult = maybeOffload(store.baseDir, sessionKey, userContent + "\n" + asstContent, offloadThreshold);
        if (offloadResult.offloaded) {
          api.logger.debug?.(`[yaoyao-memory:capture] Context offloaded to ${offloadResult.refPath}`);
        }
      }

      // Tencent-style three-level context watermark monitoring
      const mildRatio = clampNum(getProp(config, "capture.mildOffloadRatio", 0.6), 0.6, 0.3, 0.7);
      const aggressiveRatio = clampNum(getProp(config, "capture.aggressiveCompressRatio", 0.8), 0.8, 0.5, 0.95);
      const emergencyRatio = clampNum(getProp(config, "capture.emergencyCompressRatio", 0.95), 0.95, 0.8, 0.99);
      const windowTokens = clampNum(getProp(config, "capture.contextWindowTokens", 128_000), 128_000, 32_000, 256_000);
      const currentTokens = estimateContextSize(messages);
      const { level, ratio } = computeCompressLevel(currentTokens, {
        contextWindowTokens: windowTokens,
        mildOffloadRatio: mildRatio,
        aggressiveCompressRatio: aggressiveRatio,
        emergencyCompressRatio: emergencyRatio,
      });
      if (level !== "none") {
        api.logger.info?.(`[yaoyao-memory:capture] Context watermark ${level} (${(ratio * 100).toFixed(1)}%, ${currentTokens}/${windowTokens} tokens)`);
      }

      // Watermark-driven compression actions
      let skipL1 = false;
      let skipFTS5 = false;
      if (level === "emergency") {
        // Emergency: only keep L0 log, skip all indexing and extraction to save tokens
        skipL1 = true;
        skipFTS5 = true;
        api.logger.warn?.("[yaoyao-memory:capture] Emergency watermark — skipping FTS5/L1 to save tokens");
      } else if (level === "aggressive") {
        // Aggressive: skip L1 extraction, keep FTS5
        skipL1 = true;
        api.logger.info?.("[yaoyao-memory:capture] Aggressive watermark — skipping L1 extraction");
      }
      // Mild: normal capture, but offload below will be triggered

      // Brain-style noise filter: skip greetings, refusals, meta-questions
      if (isNoise(userContent) && isNoise(asstContent)) {
        api.logger.debug?.("[yaoyao-memory:capture] Skipped noise turn");
        return;
      }

      // Tencent-style MMD block filter: exclude Mermaid Canvas / offload injected content
      if (isMMDBlock(userContent) || isMMDBlock(asstContent)) {
        api.logger.debug?.("[yaoyao-memory:capture] Skipped MMD block (offload intermediate)");
        return;
      }

      // Skip trivial entries
      const trivialCheck = isTrivial(userContent);
      if (trivialCheck.isTrivial) {
        audit?.write({
          component: "auto-capture",
          event: "skipped-trivial",
          summary: `消息被判定为低价值（${trivialCheck.reason}），未写入记忆`,
          details: {
            length: userContent.length,
            reason: trivialCheck.reason,
            confidence: trivialCheck.confidence,
            preview: userContent.slice(0, 50),
            sessionKey,
          },
        });
        return;
      }

      // Bug #12: Skip indexing if assistant content is empty or "(no response)"
      const indexableAsst = (!asstContent || asstContent === "(no response)")
        ? ""
        : asstContent;

      // Anti-hallucination: detect speculative AI output and user corrections
      // Isolated try/catch: verify failure must NOT block capture
      let specCheck: ReturnType<typeof detectSpeculative> = { isSpeculative: false, markers: [], confidence: "high" };
      let corrCheck: ReturnType<typeof detectCorrection> = { isCorrection: false, markers: [] };
      if (verifyActive) {
        try {
          specCheck = detectSpeculative(asstContent);
          corrCheck = detectCorrection(userContent);
        } catch (verifyErr: unknown) {
          api.logger.warn?.(`[yaoyao-memory:capture] Verify detection failed, falling back to no-tag capture: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`);
        }
      }

      // Build hallucination risk tag for the log
      let riskTag = "";
      if (specCheck.isSpeculative) {
        riskTag = ` [⚠️ 推测性: ${specCheck.markers.join(", ")}]`;
      }
      if (corrCheck.isCorrection) {
        riskTag += ` [🚫 用户纠正]`;
      }

      // Write to daily Markdown log (L0)
      const entry = `\n### ${timestamp}\n**User:** ${userContent}${corrCheck.isCorrection ? " [纠正]" : ""}\n**AI:** ${asstContent}${riskTag}\n`;

      // Temporal classification: static (permanent fact) vs dynamic (time-sensitive)
      const temporalType = classifyTemporal(userContent + " " + asstContent);
      const expiryAt = temporalType === "dynamic" ? inferExpiry(userContent + " " + asstContent) : undefined;

      // Risk metadata goes into the structured meta column — NOT into asst_text,
      // so FTS5 search space isn't polluted with "⚠️ 推测性" / "🚫 用户纠正" tokens.
      const metaObj: Record<string, unknown> = { temporal: temporalType };

      // Brain-style scope tagging: mark memory with agent scope for isolation
      if (scopeManager) {
        const agentId = (api as Record<string, unknown>).agentId as string | undefined;
        const scope = scopeManager.getDefaultScope(agentId);
        metaObj.scope = scope;
      }

      // Brain-style identity extraction: detect name / addressing preference
      const identityInfo = extractIdentityCandidates(userContent + " " + asstContent);
      if (identityInfo.length > 0) {
        metaObj.identities = identityInfo;
        api.logger.debug?.(`[yaoyao-memory:capture] Detected identity info: ${identityInfo.map(i => i.kind + '=' + i.value).join(', ')}`);
      }
      if (expiryAt) metaObj.expiryAt = expiryAt;
      if (specCheck.isSpeculative) {
        metaObj.speculative = specCheck.isSpeculative;
        metaObj.confidence = specCheck.confidence;
      }
      if (corrCheck.isCorrection) {
        metaObj.correction = corrCheck.isCorrection;
      }

      // Brain-style L1 extraction: atomic facts (lite = heuristic, full = LLM)
      const enableL1 = getBool(config, "capture.enableL1", false);
      if (enableL1 && !skipL1) {
        try {
          const facts = await extractFacts(userContent, asstContent, { brainMode, llmClient, logger: api.logger as L1Logger });
          if (facts.length > 0) {
            // Tencent-style: limit max memories per session
            const maxMemories = clampNum(getProp(config, "capture.maxMemoriesPerSession", 20), 20, 1, 100);
            const limited = facts.slice(0, maxMemories);
            metaObj.l1Facts = limited;
            if (facts.length > maxMemories) {
              api.logger.debug?.(`[yaoyao-memory:capture] L1 truncated ${facts.length} → ${maxMemories} facts (maxMemoriesPerSession)`);
            } else {
              api.logger.debug?.(`[yaoyao-memory:capture] L1 extracted ${facts.length} facts`);
            }
          }
        } catch { /* best effort */ }
      } else if (skipL1) {
        api.logger.debug?.("[yaoyao-memory:capture] L1 extraction skipped (watermark compression)");
      }

      const meta = Object.keys(metaObj).length > 1 ? JSON.stringify(metaObj) : undefined;

      // Brain-style memory enrichment: auto-generate L0/L1/L2 summaries
      enrichMetadata(metaObj, userContent + " " + asstContent);
      // Rationale: L0 (daily file) and L1 (FTS5 index) are independent systems.
      // Rolling back file writes introduces race conditions under concurrent agent_end hooks.
      // It's safer to let L0 succeed and L1 fail separately, than to corrupt L0 trying to undo it.
      // Brain-style batch dedup: skip if this turn is nearly identical to a recent memory
      const enableDedup = getBool(config, "capture.enableDedup", true);
      if (enableDedup) {
        const dedupThreshold = clampNum(getProp(config, "capture.dedupThreshold", 0.92), 0.92, 0.7, 0.99);
        const dedupLookback = clampNum(getProp(config, "capture.dedupLookback", 5), 5, 1, 20);
        try {
          const recent = db.getLatestMemory(dedupLookback);
          const combinedText = (userContent + " " + indexableAsst).trim();
          if (isDuplicateOfRecent(combinedText, recent, dedupThreshold)) {
            api.logger.debug?.("[yaoyao-memory:capture] Skipped duplicate turn (recent memory similarity >= threshold)");
            return;
          }
        } catch { /* best-effort dedup, ignore errors */ }
      }

      // Brain-style chunking: split long assistant replies for better retrieval precision
      const CHUNK_THRESHOLD = 4000;
      if (!skipFTS5) {
        if (indexableAsst.length > CHUNK_THRESHOLD) {
          const chunkResult = smartChunk(indexableAsst, CHUNK_THRESHOLD);
          api.logger.debug?.(`[yaoyao-memory:capture] Chunked long reply into ${chunkResult.chunkCount} pieces`);
          for (let i = 0; i < chunkResult.chunks.length; i++) {
            const chunkMeta = { ...metaObj, chunkIndex: i + 1, totalChunks: chunkResult.chunkCount };
            const chunkMetaStr = Object.keys(chunkMeta).length > 1 ? JSON.stringify(chunkMeta) : undefined;
            try {
              db.indexTurn(userContent, chunkResult.chunks[i], date, chunkMetaStr);
            } catch (chunkErr: unknown) {
              api.logger.error(`[yaoyao-memory:capture] Chunk ${i + 1}/${chunkResult.chunkCount} index failed: ${chunkErr instanceof Error ? chunkErr.message : String(chunkErr)}`);
            }
          }
        } else {
          db.indexTurn(userContent, indexableAsst, date, meta);
        }
      } else {
        api.logger.warn?.("[yaoyao-memory:capture] FTS5 indexing skipped (emergency watermark)");
      }

      // NOTE: Implicit observation tagging removed in v1.5.0.
      // If you want silent pattern extraction, install yaoyao-soul alongside this plugin.

      api.logger.debug?.("[yaoyao-memory:capture] Captured turn to " + date);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      api.logger.error(`[yaoyao-memory:capture] Error: ${errMsg}`);
      // Brain-style self-improvement: log capture errors for later analysis
      try {
        const baseDir = (config as any).dataDir || ".";
        appendSelfImprovementEntry({
          baseDir,
          type: "error",
          summary: `Auto-capture failed: ${errMsg.slice(0, 100)}`,
          details: err instanceof Error ? err.stack || errMsg : errMsg,
          area: "capture",
          source: "yaoyao-memory/auto-capture",
        }).catch(() => { /* ignore secondary errors */ });
      } catch { /* ignore */ }
    }
  });
}
