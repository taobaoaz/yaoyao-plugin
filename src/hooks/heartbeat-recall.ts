/**
 * hooks/heartbeat-recall.ts — Heartbeat prompt contribution hook.
 *
 * Injects relevant memory context into heartbeat runs via
 * heartbeat_prompt_contribution hook (OpenClaw 2026.5.12+).
 *
 * Uses accumulated session keywords to search for relevant memories
 * and appends them as context to the heartbeat prompt.
 */

import type { OpenClawPluginApi, PluginHeartbeatPromptContributionEvent, PluginHeartbeatPromptContributionResult } from "openclaw/plugin-sdk/plugin-entry";
import type { Storage } from "../storage/bridge.ts";
import type { EmbeddingService } from "../utils/embedding.ts";
import { getAccumulatedKeywords } from "./recall-session.ts";
import { parseMemoryCall, buildSearchQuery } from "../utils/memory-call.ts";
import { executeMemoryCall } from "../core/search/memory-call-search.ts";

export interface HeartbeatRecallConfig {
  enabled?: boolean;
  maxResults?: number;
  minScore?: number;
  maxContextChars?: number;
}

/**
 * Register heartbeat_prompt_contribution hook.
 * Injects memory context into heartbeat runs based on session keywords.
 */
export function registerHeartbeatRecallHook(
  api: OpenClawPluginApi,
  storage: Storage,
  embedding: EmbeddingService | null,
  config: HeartbeatRecallConfig,
): void {
  if (!config.enabled) {
    api.logger.info("[yaoyao-memory] Heartbeat recall hook disabled");
    return;
  }

  api.on("heartbeat_prompt_contribution", async (event: PluginHeartbeatPromptContributionEvent, _ctx: unknown): Promise<PluginHeartbeatPromptContributionResult | void> => {
    const sessionKey = event.sessionKey;
    if (!sessionKey) return;

    // Get accumulated keywords for this session
    const keywords = getAccumulatedKeywords(sessionKey);
    if (!keywords || keywords.length === 0) return;

    // Build query from keywords
    const query = keywords.join(" ");
    const memoryCall = parseMemoryCall(query);
    memoryCall.maxResults = config.maxResults ?? 3;
    memoryCall.minScore = config.minScore ?? 0.4;

    // Search for relevant memories
    const results = await executeMemoryCall(memoryCall, {
      storage,
      embedding,
    });

    if (results.length === 0) return;

    // Format results as context string
    const maxChars = config.maxContextChars ?? 800;
    let context = "📋 相关记忆:\n";
    let charCount = context.length;

    for (const r of results) {
      const entry = `• ${r.filename}: ${r.snippet}\n`;
      if (charCount + entry.length > maxChars) break;
      context += entry;
      charCount += entry.length;
    }

    // Return as appendContext (injected into heartbeat prompt)
    return { appendContext: context };
  });

  api.logger.info("[yaoyao-memory] Heartbeat recall hook registered");
}
