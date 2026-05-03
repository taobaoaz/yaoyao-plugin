/**
 * Pipeline Manager — L1→L2→L3 extraction pipeline.
 *
 * Runs after each agent_end:
 * 1. L1: Extract structured memories via LLM (persona/episodic/instruction)
 * 2. L2: Group memories into scene blocks (thematic clusters)
 * 3. L3: Update user persona from accumulated memories
 *
 * All steps are optional — they gracefully skip if no LLM is available
 * or if there's insufficient data.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import type { LLMClient } from "../utils/llm-client.js";
import { extractL1Memories } from "../extraction/l1-extractor.js";
import { runSceneExtraction } from "../scenes/scene-extractor.js";
import { generateOrUpdatePersona } from "../persona/persona-generator.js";
import type { Persona } from "../persona/persona-generator.js";
import path from "node:path";
import fs from "node:fs";

const TAG = "[yaoyao-memory:pipeline]";

/**
 * Track extraction state per session to avoid re-extracting the same data.
 */
const sessionCheckpoint = new Map<string, {
  lastMessageCount: number;
  l1Complete: boolean;
  l2Complete: boolean;
  l3Complete: boolean;
}>();

// ═══════════════════════════════════════════════════════
// Leak prevention: cap session checkpoint size
// ═══════════════════════════════════════════════════════
setInterval(() => {
  if (sessionCheckpoint.size > 100) {
    // Keep only the most recent 50 sessions
    const entries = [...sessionCheckpoint.entries()];
    sessionCheckpoint.clear();
    const keep = Math.min(entries.length, 50);
    for (const e of entries.slice(-keep)) {
      sessionCheckpoint.set(e[0], e[1]);
    }
  }
}, 300_000).unref();

export function registerPipelineManager(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  llm: LLMClient,
  config: YaoyaoMemoryConfig,
) {
  api.logger.info(`${TAG} Registering L1→L2→L3 pipeline manager`);

  // Checkpoint tracking file
  const checkpointDir = path.join(store.baseDir, ".pipeline");
  fs.mkdirSync(checkpointDir, { recursive: true });

  // Register on agent_end to run extraction pipeline
  api.on("agent_end", async (event, ctx) => {
    try {
      const e = event as Record<string, unknown>;
      if (!e.success) return;

      const messages = (e.messages as unknown[]) ?? [];
      if (messages.length < 2) return;

      const sessionKey = ctx.sessionKey || "default";
      const cp = sessionCheckpoint.get(sessionKey);

      // Only run if there are new messages since last checkpoint
      if (cp && messages.length <= cp.lastMessageCount) {
        return;
      }

      const userMessages = messages.filter((m: any) => m.role === "user");
      const asstMessages = messages.filter((m: any) => m.role === "assistant");

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

        // === L2: Extract scene blocks (every 10 L1 memories) ===
        const checkpointFile = path.join(checkpointDir, `${sessionKey}.json`);
        let extractionCount = 0;
        try {
          const ck = JSON.parse(fs.readFileSync(checkpointFile, "utf-8"));
          extractionCount = ck.l1Count || 0;
        } catch { /* first run */ }
        extractionCount += l1Result.storedCount;

        if (extractionCount >= 10) {
          // Fetch recent tagged memories from DB for scene extraction
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
                // Read existing persona
                const personaContent = fs.readFileSync(personaFile, "utf-8");
                // For now, just set a placeholder
                existingPersona = null;
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

              // Reset counter after L3
              extractionCount = 0;
            }
          }
        }

        // Save checkpoint
        fs.writeFileSync(checkpointFile, JSON.stringify({ l1Count: extractionCount }), "utf-8");
      }

      // Update session checkpoint
      sessionCheckpoint.set(sessionKey, {
        lastMessageCount: messages.length,
        l1Complete: l1Result.success,
        l2Complete: false,
        l3Complete: false,
      });

    } catch (err: any) {
      api.logger.error(`${TAG} Pipeline error: ${err.message}`);
    }
  });
}
