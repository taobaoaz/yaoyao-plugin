/**
 * hooks/auto-capture.ts — Auto-capture orchestrator.
 *
 * v1.7.0:
 *   - capture-debouncer integration: rapid successive captures for same session
 *     get merged into one batch (3s quiet window)
 *   - writeDailyFile now async (goes through debouncer)
 *   - Async flus for all persistence layers (L0 .md, L1 FTS5, L2 vector)
 */
import { clampNum } from "../utils/clamp.ts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore, YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";
import { getProp, getBool } from "../utils/config.ts";
import { appendSelfImprovementEntry } from "../utils/self-improvement.ts";
import { compressTexts } from "../utils/session-compressor.ts";
import type { AuditLog } from "../utils/audit-log.ts";
import { createWriteQueue } from "../utils/write-queue.ts";
import { createCaptureDebouncer, type CaptureDebouncer } from "../utils/capture-debouncer.ts";
import { DedupEngine } from "../utils/dedup-engine.ts";
import {
  shouldCaptureTurn, trackSessionActivity,
  getCaptureConfig, buildCaptureContext, estimateConversation,
  shouldSkipContent, handleMermaidOffload,
  runAntiHallucination, buildMetaObj,
  evaluateWatermark,
  createPersistHandlers,
} from "./capture-barrel.ts";

export { extractContent, safeStringify } from "./capture-content.ts";

export function registerCaptureHook(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  verifyActive = true,
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  llmClient?: import("../utils/llm-client.ts").LLMClient | null,
  audit?: AuditLog,
  embedding?: import("../utils/embedding.ts").EmbeddingService | null,
) {
  const captureMode = (config.capture?.mode as string) || "async";
  api.logger.info?.(`[yaoyao-memory] auto-capture mode=${captureMode}${embedding ? " + vector" : ""}`);

  const persist = createPersistHandlers(api, db, store, embedding);

  // L1+L2 async batch write queue
  const writeQueue = captureMode === "async"
    ? createWriteQueue(persist.flushBatch, api.logger, audit)
    : null;

  // L0 markdown + L1+L2 debouncer: merges rapid captures for same session
  const debounceMs = clampNum(
    (config.capture?.debounceMs as number) ?? 3000,
    3000, 500, 30000,
  );
  // Three-stage dedup: L1 exact hash, L2 vector cosine, L3 text similarity
  const dedupEngine = new DedupEngine({ enabled: true, vectorThreshold: 0.80, textLookback: 10 });

  const captureDebouncer: CaptureDebouncer = createCaptureDebouncer(
    { debounceMs, maxDelayMs: 10000, maxQueueSize: 50 },
    async (batch) => {
      // Write L0 markdown files synchronously (safety net)
      for (const item of batch) {
        try {
          persist.writeDailyEntry(item.date, item.entry);
        } catch (e) {
          api.logger.error?.(`[yaoyao-memory:debouncer] L0 write failed: ${(e as Error).message}`);
        }
      }
      // Queue L1+L2 writes
      if (writeQueue) {
        for (const item of batch) {
          writeQueue.enqueue({
            date: item.date,
            timestamp: item.timestamp,
            userContent: item.userContent,
            asstContent: item.asstContent,
            meta: item.meta,
          });
        }
      } else {
        // Sync mode: write directly
        await persist.flushBatch(batch.map(item => ({
          userContent: item.userContent,
          asstContent: item.asstContent,
          date: item.date,
          meta: item.meta,
        })));
      }
    },
  );

  api.on("agent_end", async (event: unknown, ctx: unknown) => {
    try {
      const e = event as Record<string, unknown>;
      const messages = (e.messages ?? []) as Array<Record<string, unknown>>;
      if (!e.success) return;

      const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
      const agentId = (api as unknown as Record<string, unknown>).agentId as string | undefined;
      const capCfg = getCaptureConfig(config);

      const filterResult = shouldCaptureTurn({ sessionKey, messages, agentId }, config);
      if (!filterResult.shouldCapture) { api.logger.debug?.(`[yaoyao-memory:capture] ${filterResult.skipReason}`); return; }

      const activity = trackSessionActivity(sessionKey, config);
      if (activity.shouldLogResume) api.logger.debug?.(`[yaoyao-memory:capture] Session ${sessionKey} resumed`);

      let date: string;
      if (config.tz) {
        try { date = new Intl.DateTimeFormat("sv-SE", { timeZone: config.tz } as Intl.DateTimeFormatOptions).format(new Date()); }
        catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[yaoyao-memory:capture] Date parse failed: ${msg}`);
          date = new Date().toISOString().slice(0, 10);
        }
      } else { date = new Date().toISOString().slice(0, 10); }
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

      const cctx = buildCaptureContext(messages, date, timestamp, capCfg.captureMaxLen);
      if (!cctx) return;
      cctx.sessionKey = sessionKey;
      cctx.agentId = agentId;

      const { convValue, texts } = estimateConversation(messages, capCfg.captureMaxLen);
      if (convValue < 0.2 && texts.length > 4) { api.logger.debug?.("[yaoyao-memory:capture] Low conversation value"); return; }
      if (texts.length > 6) compressTexts(texts, capCfg.captureMaxLen * 3, { minTexts: 3, minScoreToKeep: 0.3 });

      const watermark = evaluateWatermark(messages, config);
      if (watermark.level !== "none") {
        api.logger.info?.(`[yaoyao-memory:capture] Watermark ${watermark.level} (${(watermark.ratio * 100).toFixed(1)}%)`);
        if (watermark.level === "emergency") api.logger.warn?.("[yaoyao-memory:capture] Emergency — skipping FTS5/L1");
      }

      const skipCheck = shouldSkipContent(cctx.userContent, cctx.asstContent);
      if (skipCheck.skip) {
        audit?.write({ component: "auto-capture", event: `skipped-${skipCheck.reason}`, summary: `Skipped: ${skipCheck.reason}`, details: { sessionKey } });
        return;
      }

      const { riskTag, specCheck, corrCheck } = runAntiHallucination(cctx.userContent, cctx.indexableAsst, verifyActive);
      handleMermaidOffload(store, sessionKey, cctx.userContent + "\n" + cctx.asstContent, capCfg.enableOffload, capCfg.offloadThreshold);

      const { meta } = await buildMetaObj(cctx.userContent, cctx.indexableAsst, scopeManager, agentId,
        specCheck, corrCheck, capCfg.enableL1, watermark.skipL1 || false,
        capCfg.brainMode, llmClient, api.logger, capCfg.maxMemoriesPerSession, config);

      const dedupResult = await dedupEngine.check(
        (cctx.userContent + " " + cctx.indexableAsst).trim(),
        db,
        embedding,
        agentId,
      );
      if (dedupResult.isDuplicate) {
        api.logger.debug?.(`[yaoyao-memory:capture] Duplicate (stage=${dedupResult.stage}, conf=${dedupResult.confidence.toFixed(3)}): ${dedupResult.reason}`);
        return;
      }

      // Build L0 markdown entry string
      const entry = `\n### ${timestamp}\n**User:** ${cctx.userContent}${corrCheck.isCorrection ? " [纠正]" : ""}\n**AI:** ${cctx.asstContent}${riskTag}\n`;

      // Push to debouncer instead of writing directly
      // If another capture for same session comes within debounceMs, they merge
      captureDebouncer.push({
        sessionKey,
        userContent: cctx.userContent,
        asstContent: cctx.indexableAsst,
        date,
        timestamp,
        meta,
        // Extra field used only by our debouncer flush handler
        entry,
      });

      api.logger.debug?.("[yaoyao-memory:capture] Captured to " + date);
    } catch (e2: unknown) {
      const errMsg = e2 instanceof Error ? e2.message : String(e2);
      api.logger.error?.(`[yaoyao-memory:capture] Error: ${errMsg}`);
      try {
        appendSelfImprovementEntry({
          baseDir: config.memoryDir || ".",
          type: "error",
          summary: `Capture failed: ${errMsg.slice(0, 100)}`,
          details: e2 instanceof Error ? e2.stack || errMsg : errMsg,
          area: "capture",
          source: "yaoyao-memory/auto-capture",
        }).catch(() => {});
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:capture] Persist failed: ${msg}`);
      }
    }
  });

  return {
    drain: async () => {
      captureDebouncer.flushNow();
      if (writeQueue) await writeQueue.drain();
    },
  };
}
