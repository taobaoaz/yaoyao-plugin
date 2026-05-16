/**
 * Embedding feature — optional vector embedding service.
 *
 * Creates an EmbeddingService when embedding.enabled=true and apiKey is present.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import type { OptionalFeature, FeatureResult } from "../types.ts";
import { createEmbeddingService, detectEmbedModel } from "../../utils/embedding.ts";
import type { EmbeddingConfig } from "../../utils/embedding.ts";
import { maskSensitive } from "../../utils/mask-config.ts";

export const embeddingFeature: OptionalFeature<ReturnType<typeof createEmbeddingService>> = {
  id: "embedding",
  name: "Embedding Service",
  dependencies: [],
  configKey: "embedding.enabled",
  defaultEnabled: false,

  init(api, config) {
    const embedCfg = config.embedding as (EmbeddingConfig & Record<string, unknown>) | undefined;
    if (!embedCfg?.enabled || !embedCfg?.apiKey) {
      return {
        active: false,
        service: null,
        message: "Embedding service disabled (set embedding.enabled=true + apiKey to enable)",
      };
    }

    const provider = String(embedCfg.provider || "openai").toLowerCase().trim();
    const customMap = (embedCfg.providerModels || {}) as Record<string, string>;

    const service = createEmbeddingService({
      apiKey: embedCfg.apiKey,
      baseUrl: embedCfg.baseUrl || "",
      model: embedCfg.model || detectEmbedModel(provider, customMap),
      dimensions: embedCfg.dimensions ?? 1024,
      timeoutMs: Number(embedCfg.timeoutMs) || 15_000,
      retries: Number(embedCfg.retries) || 1,
      maxInputChars: Number(embedCfg.maxInputChars) || 4_000,
      backoffBaseMs: Number(embedCfg.backoffBaseMs) || 1_000,
      logger: api.logger,
    });

    api.logger.debug?.(
      `[yaoyao-memory:optional] Embedding config (masked): ${JSON.stringify(maskSensitive(service.config))}`
    );

    return {
      active: true,
      service,
      message: `Embedding service initialized: ${service.config.model}`,
    };
  },
};
