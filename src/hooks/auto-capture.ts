/**
 * hooks/auto-capture.ts — Auto-capture orchestrator.
 */
import { clampNum } from "../utils/clamp.ts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore, YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";
import { getObj, getProp, getBool } from "../utils/config.ts";
import { appendSelfImprovementEntry } from "../utils/self-improvement.ts";
import { compressTexts } from "../utils/session-compressor.ts";
import type { AuditLog } from "../utils/audit-log.ts";
import { createWriteQueue } from "../utils/write-queue.ts";
import { evaluateWatermark } from "./capture-watermark.ts";
import { shouldCaptureTurn, trackSessionActivity } from "./capture-filter.ts";
import { extractContent } from "./capture-content.ts";
import {
  getCaptureConfig, buildCaptureContext, estimateConversation,
  shouldSkipContent, runAntiHallucination, buildMetaObj,
  checkDedup, writeDailyFile, indexToFTS5, handleMermaidOffload,
} from "./capture-pipeline.ts";

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

  const writeQueue = captureMode === "async"
    ? createWriteQueue(
        async (tasks: Array<{ userContent: string; asstContent: string; date: string; meta?: string }>) => {
          const rows: { rowId: number; text: string; meta?: string }[] = [];
          for (const task of tasks) {
            try {
              const rowId = db.indexTurn(task.userContent, task.asstContent, task.date, task.meta);
              if (rowId > 0 && embedding) rows.push({ rowId, text: `${task.userContent}\n${task.asstContent}`, meta: task.meta });
            } catch (e2: unknown) {
              api.logger.error?.(`[yaoyao-memory:capture] indexTurn failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
            }
          }
          if (rows.length > 0 && embedding) {
            try {
              const vectors = await embedding.embedBatch(rows.map(r => r.text));
              for (let i = 0; i < rows.length; i++) {
                if (vectors && vectors[i]) db.storeVector(rows[i].rowId, vectors[i]);
              }
            } catch (e2: unknown) {
              api.logger.debug?.(`[yaoyao-memory:capture] Batch vector store failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
            }
          }
        },
        api.logger,
        audit,
      )
    : null;

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
        catch { date = new Date().toISOString().slice(0, 10); }
      } else { date = new Date().toISOString().slice(0, 10); }
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

      const cctx = buildCaptureContext(messages, date, timestamp, capCfg.captureMaxLen);
      if (!cctx) return;
      cctx.sessionKey = sessionKey;

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

      if (checkDedup(db, (cctx.userContent + " " + cctx.indexableAsst).trim(), capCfg)) {
        api.logger.debug?.("[yaoyao-memory:capture] Duplicate"); return;
      }

      writeDailyFile(store, date, timestamp, cctx.userContent, cctx.asstContent, riskTag, corrCheck.isCorrection);
      indexToFTS5(db, cctx.userContent, cctx.indexableAsst, date, meta, watermark, writeQueue, api);

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
      } catch { /* ignore */ }
    }
  });

  const wq = writeQueue;
  return { drain: async () => wq?.drain() ?? Promise.resolve() };
}
