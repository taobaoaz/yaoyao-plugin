/**
 * hooks/auto-capture.ts — Auto-capture orchestrator.
 *
 * Delegates all work to sub-modules:
 *   - capture-coexist.ts   — coexist detection + bridge
 *   - capture-flush.ts     — L0/L1/L2 flush strategy
 *   - capture-event.ts     — agent_end event processing
 *
 * v1.7.2: Split to comply with 200-line limit.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import type { MemoryStore, YaoyaoMemoryConfig } from '../utils/memory-store.ts';
import type { DBBridge } from '../utils/db-bridge.ts';
import type { AuditLog } from '../utils/audit-log.ts';
import { DedupEngine } from '../utils/dedup-engine.ts';
import { createWriteQueue } from '../utils/write-queue.ts';
import { clampNum } from '../utils/clamp.ts';
import { createCaptureDebouncer, type CaptureDebouncer } from '../utils/capture-debouncer.ts';
import { createPersistHandlers } from './persist-handlers.ts';
import { createCoexistContext } from './capture-coexist.ts';
import { createFlushHandler } from './capture-flush.ts';
import { processCaptureEvent, type CaptureEventResult } from './capture-event.ts';

export { extractContent, safeStringify } from './capture-content.ts';

export function registerCaptureHook(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  verifyActive = true,
  scopeManager?: import('../utils/scope-manager.ts').SimpleScopeManager,
  llmClient?: import('../utils/llm-client.ts').LLMClient | null,
  audit?: AuditLog,
  embedding?: import('../utils/embedding.ts').EmbeddingService | null,
): { drain: () => Promise<void> } {
  const captureMode = (config.capture?.mode as string) || 'async';

  // Coexist detection + bridge
  const { skipLocalIndexing, forwardCapture, clawBridge, logSuffix } = createCoexistContext(config);
  api.logger.info?.(
    `[yaoyao-memory] auto-capture mode=${captureMode}${embedding ? ' + vector' : ''}${logSuffix}`,
  );

  // Persistence layers
  const persist = createPersistHandlers(api, db, store, embedding);

  // L1+L2 async queue (disabled when coexist skips local indexing)
  const writeQueue =
    captureMode === 'async' && !skipLocalIndexing
      ? createWriteQueue(persist.flushBatch, api.logger, audit)
      : null;

  // Three-stage dedup: L1 hash → L2 vector → L3 text
  const dedupEngine = new DedupEngine({ enabled: true, vectorThreshold: 0.8, textLookback: 10 });

  // Debouncer: merges rapid captures for same session
  const debounceMs = clampNum((config.capture?.debounceMs as number) ?? 3000, 3000, 500, 30000);
  const captureDebouncer: CaptureDebouncer = createCaptureDebouncer(
    { debounceMs, maxDelayMs: 10000, maxQueueSize: 50 },
    createFlushHandler(persist, writeQueue, clawBridge, forwardCapture, api) as any,
  );

  // Hook: fired on every agent turn end
  api.on('agent_end', async (event: unknown, ctx: unknown) => {
    const agentId = (api as unknown as Record<string, unknown>).agentId as string | undefined;
    const result = await processCaptureEvent(
      event,
      ctx,
      config,
      api,
      store,
      verifyActive,
      scopeManager,
      agentId,
      llmClient ?? null,
      audit,
      dedupEngine,
      db,
      embedding ?? null,
      skipLocalIndexing,
    );
    if (result && result.shouldCapture) {
      captureDebouncer.push({
        sessionKey: result.sessionKey,
        userContent: result.userContent,
        asstContent: result.indexableAsst,
        date: result.date,
        timestamp: result.timestamp,
        meta: result.meta,
        entry: result.entry,
      });
      api.logger.debug?.('[yaoyao-memory:capture] Captured to ' + result.date);
    }
  });

  return {
    drain: async () => {
      captureDebouncer.flushNow();
      if (writeQueue) await writeQueue.drain();
    },
  };
}
