/**
 * LLM feature — optional LLM client for L1/L2/L3 pipeline.
 *
 * Priority:
 *   1. Explicit `llm.apiKey` → use llm section directly
 *   2. Auto-detect from embedding config (if embedding feature active)
 *   3. Nothing → inactive
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.js";
import type { OptionalFeature, FeatureResult } from "../types.js";
import { createLLMClient, type CreateLLMClientResult } from "../../utils/llm-client.js";

export const llmFeature: OptionalFeature<CreateLLMClientResult> = {
  id: "llm",
  name: "LLM Client",
  dependencies: ["embedding"],
  configKey: "llm.enabled",
  defaultEnabled: true,

  init(api, config, deps) {
    const embeddingResult = deps.get("embedding");
    const embedCfg = config.embedding as Record<string, unknown> | undefined;

    const result = createLLMClient(
      config as Record<string, unknown>,
      embeddingResult?.active ? embedCfg : null
    );

    if (!result.client) {
      return {
        active: false,
        service: null,
        message: "LLM client inactive (configure llm.apiKey or embedding.apiKey to enable)",
      };
    }

    const sourceLabel = result.source === "explicit" ? "explicit llm config" : "auto-detected from embedding config";
    return {
      active: true,
      service: result,
      message: `LLM client initialized (${sourceLabel}): ${result.client.config.model}`,
    };
  },
};
