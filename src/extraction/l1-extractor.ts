/**
 * L1 Extractor — LLM-based structured memory extraction.
 *
 * Reads conversation messages from FTS5 indexed turns and uses the LLM
 * to extract structured memories (persona, episodic, instruction).
 * Results are stored in the .yaoyao.db FTS5 index with type annotations.
 */
import type { DBBridge } from "../utils/db-bridge.js";
import type { LLMClient } from "../utils/llm-client.js";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.js";
import { parseJSONResponse } from "../utils/llm-parse.js";
import { EXTRACT_MEMORIES_SYSTEM_PROMPT, formatExtractionPrompt } from "./prompts.js";

const TAG = "[yaoyao-memory:l1-extractor]";

export interface ExtractedMemory {
  content: string;
  type: "persona" | "episodic" | "instruction";
  priority: number;
}

export interface L1ExtractionResult {
  success: boolean;
  extractedCount: number;
  storedCount: number;
  metaRowIds: number[];
  sceneNames: string[];
  lastSceneName?: string;
}

/** Minimal config interface for extraction */
interface ExtractionConfig {
  recall?: YaoyaoMemoryConfig["recall"];
  capture?: YaoyaoMemoryConfig["capture"];
}

export async function extractL1Memories(params: {
  messages: Array<{ role: string; content: string }>;
  sessionKey: string;
  db: DBBridge | null;
  config: ExtractionConfig;
  llm: LLMClient | null;
  embedding?: { embed(text: string): Promise<Float32Array> } | null;
  logger?: { info: (s: string) => void; debug?: (s: string) => void; error: (s: string) => void };
}): Promise<L1ExtractionResult> {
  const { messages, db, llm, embedding, logger } = params;
  const log = logger || console;

  if (!llm) {
    log.debug?.(`${TAG} No LLM configured, skipping L1 extraction`);
    return { success: false, extractedCount: 0, storedCount: 0, metaRowIds: [], sceneNames: [] };
  }

  if (messages.length < 2) {
    log.debug?.(`${TAG} Not enough messages for extraction`);
    return { success: false, extractedCount: 0, storedCount: 0, metaRowIds: [], sceneNames: [] };
  }

  const formattedMessages = messages
    .slice(-10)
    .map(m => `[${m.role}]: ${m.content}`)
    .join("\n");

  const prompt = formatExtractionPrompt(formattedMessages);

  try {
    const response = await llm.extract(EXTRACT_MEMORIES_SYSTEM_PROMPT, prompt);

    const scenes = parseJSONResponse<Array<{
    scene_name?: string;
    memories?: Array<{ content: string; type: string; priority: number }>;
  }>>(response);
  if (!scenes || scenes.length === 0) {
      log.debug?.(`${TAG} No valid memories extracted`);
      return { success: true, extractedCount: 0, storedCount: 0, metaRowIds: [], sceneNames: [] };
    }

    const sceneNames: string[] = [];
    let totalExtracted = 0;
    let totalStored = 0;
    const metaRowIds: number[] = [];

    for (const scene of scenes) {
      if (scene.scene_name) {
        sceneNames.push(scene.scene_name);
      }
      if (!scene.memories || scene.memories.length === 0) continue;

      for (const mem of scene.memories) {
        if (!mem.content || mem.content.length < 5) continue;
        totalExtracted++;

        const typeTag = `[${(mem.type || "info")}]`;
        const priorityTag = `[priority:${mem.priority || 50}]`;
        const taggedContent = `${typeTag} ${priorityTag} ${mem.content}`;

        if (db) {
          const date = new Date().toISOString().slice(0, 10);
          const rowId = db.indexTurn(taggedContent, "", date);
          if (rowId > 0) {
            totalStored++;
            metaRowIds.push(rowId);
            // Best-effort vector storage (fire-and-forget)
            if (embedding && mem.content.length >= 10) {
              embedding.embed(mem.content).then(vec => {
                try { db.storeVector(rowId, vec); } catch { /* best effort */ }
              }).catch(() => { /* best effort */ });
            }
          }
        }
      }
    }

    const lastScene = scenes[scenes.length - 1]?.scene_name;
    log.info?.(`${TAG} Extracted ${totalExtracted} memories, stored ${totalStored}`);

    return {
      success: true,
      extractedCount: totalExtracted,
      storedCount: totalStored,
      metaRowIds,
      sceneNames,
      lastSceneName: lastScene,
    };
  } catch (err: any) {
    log.error?.(`${TAG} Extraction failed: ${err.message}`);
    return { success: false, extractedCount: 0, storedCount: 0, metaRowIds: [], sceneNames: [] };
  }
}
