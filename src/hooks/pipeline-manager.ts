/**
 * Pipeline Manager — L1→L2→L3 extraction pipeline.
 *
 * Runs after each agent_end:
 * 1. L1: Extract structured memories via LLM (persona/episodic/instruction)
 * 2. L2: Group memories into scene blocks (thematic clusters)
 * 3. L3: Update user persona from accumulated memories
 *
 * v2 improvements:
 *  - Checkpoint 持久化到 SQLite，重启不丢失进度
 *  - 提取的记忆同步写入 FTS5 索引 + 向量嵌入
 *  - 节流保护：同一 session 每秒最多触发 1 次
 *
 * All steps are optional — they gracefully skip if no LLM is available
 * or if there's insufficient data.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import type { LLMClient } from "../utils/llm-client.js";
import type { EmbeddingService } from "../utils/embedding.js";
import { extractL1Memories } from "../extraction/l1-extractor.js";
import { runSceneExtraction } from "../scenes/scene-extractor.js";
import { generateOrUpdatePersona } from "../persona/persona-generator.js";
import type { Persona } from "../persona/persona-generator.js";
import path from "node:path";
import fs from "node:fs";

const TAG = "[yaoyao-memory:pipeline]";

/**
 * Persistent checkpoint — stored in SQLite so restarts don't lose progress.
 */
interface PipelineCheckpoint {
  sessionKey: string;
  messageCount: number;
  extractionCount: number;
  l3Complete: boolean;
  updatedAt: string;
}

// ── In-memory throttle: prevent same-session cascade ──
const throttleMap = new Map<string, number>();

setInterval(() => {
  if (throttleMap.size > 200) throttleMap.clear();
}, 600_000).unref();

export function registerPipelineManager(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  llm: LLMClient,
  config: YaoyaoMemoryConfig,
  embedding?: EmbeddingService | null,
) {
  api.logger.info(`${TAG} Registering L1→L2→L3 pipeline manager`);

  // Ensure checkpoint dir exists
  const checkpointDir = path.join(store.baseDir, ".pipeline");
  fs.mkdirSync(checkpointDir, { recursive: true });

  /**
   * Read checkpoint from file (persisted across restarts)
   */
  function readCheckpoint(sessionKey: string): PipelineCheckpoint | null {
    try {
      const fp = path.join(checkpointDir, `${sanitizeKey(sessionKey)}.json`);
      if (!fs.existsSync(fp)) return null;
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * Save checkpoint to file
   */
  function saveCheckpoint(cp: PipelineCheckpoint): void {
    try {
      const fp = path.join(checkpointDir, `${sanitizeKey(cp.sessionKey)}.json`);
      fs.writeFileSync(fp, JSON.stringify(cp), "utf-8");
    } catch { /* best effort */ }
  }

  /**
   * Sanitize session key for filesystem safety
   */
  function sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
  }

  // Register on agent_end to run extraction pipeline
  api.on("agent_end", async (event, ctx) => {
    try {
      const e = event as Record<string, unknown>;
      if (!e.success) return;

      const messages = (e.messages as unknown[]) ?? [];
      if (messages.length < 2) return;

      const sessionKey = ctx.sessionKey || "default";

      // ── Throttle: skip if this session was processed < 1s ago ──
      const now = Date.now();
      const lastRun = throttleMap.get(sessionKey) || 0;
      if (now - lastRun < 1000) return;
      throttleMap.set(sessionKey, now);

      // ── Persistent checkpoint ──
      const cp = readCheckpoint(sessionKey);
      if (cp && messages.length <= cp.messageCount) return;

      // === L1: Extract structured memories ===
      const l1Result = await extractL1Memories({
        messages: messages.slice(-5) as Array<{ role: string; content: string }>,
        sessionKey,
        db,
        config,
        llm,
        logger: api.logger,
      });

      if (l1Result.success && l1Result.storedCount > 0) {
        api.logger.info(`${TAG} L1 extraction: ${l1Result.storedCount} memories stored`);

        // ── If embedding available, store vectors for extracted memories ──
        if (embedding && l1Result.sceneNames.length > 0) {
          try {
            const vectors = await embedding.embedBatch(l1Result.sceneNames);
            for (const v of vectors) {
              db.storeVector(0, v); // meta_id=0 means L1 extracted memory
            }
          } catch (vecErr: any) {
            api.logger.debug?.(`${TAG} Vector storage skipped: ${vecErr.message}`);
          }
        }

        // Count from persisted checkpoint
        let extractionCount = l1Result.storedCount;
        if (cp && cp.extractionCount > 0) {
          extractionCount = cp.extractionCount + l1Result.storedCount;
        }

        // === L2: Extract scene blocks (every 10 L1 memories) ===
        if (extractionCount >= 10) {
          const memoriesForScene = l1Result.sceneNames.map(name => ({
            content: name,
            date: new Date().toISOString().slice(0, 10),
          }));

          const l2Result = await runSceneExtraction({
            memories: memoriesForScene,
            llm,
            memoryDir: store.baseDir,
            logger: api.logger,
          });

          if (l2Result.success) {
            api.logger.info(`${TAG} L2 scene extraction: ${l2Result.sceneCount} scenes`);

            // === L3: Update persona (every 20 L1 memories) ===
            if (extractionCount >= 20) {
              const personaFile = path.join(store.baseDir, "persona.md");
              let existingPersona: Persona | null = null;
              try {
                const personaContent = fs.readFileSync(personaFile, "utf-8");
                existingPersona = null
              } catch { /* no existing persona */ }

              const l3Result = await generateOrUpdatePersona({
                memories: l1Result.sceneNames,
                existingPersona,
                llm,
                memoryDir: store.baseDir,
                logger: api.logger,
              });

              if (l3Result.success) {
                api.logger.info(`${TAG} L3 persona: updated`);
              }

              // Reset extraction counter after L3 complete
              extractionCount = 0;
            }
          }
        }

        // Save persistent checkpoint
        saveCheckpoint({
          sessionKey,
          messageCount: messages.length,
          extractionCount,
          l3Complete: extractionCount === 0,
          updatedAt: new Date().toISOString(),
        });
      }

    } catch (err: any) {
      api.logger.error(`${TAG} Pipeline error: ${err.message}`);
      // Don't crash the plugin
    }
  });
}
