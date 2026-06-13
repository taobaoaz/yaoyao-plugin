/**
 * Embedding feature — optional vector embedding service.
 *
 * Creates an EmbeddingService when embedding.enabled=true and apiKey is present.
 */
import type { OpenClawPluginApi } from "../../openclaw-sdk/plugin-entry.ts";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import type { OptionalFeature, FeatureResult } from "../types.ts";
import { createEmbeddingService, detectEmbedModel } from "../../utils/embedding.ts";
import type { EmbeddingConfig } from "../../utils/embedding.ts";
import { maskSensitive } from "../../utils/mask-config.ts";
import { scanEmbeddingSources } from "../../utils/env-scan.ts";
import type { EmbeddingSource } from "../../utils/env-scan.ts";

export const embeddingFeature: OptionalFeature<ReturnType<typeof createEmbeddingService>> = {
  id: "embedding",
  name: "Embedding Service",
  dependencies: [],
  configKey: "embedding.enabled",
  defaultEnabled: false,

  init(api, config) {
    const embedCfg = config.embedding as (EmbeddingConfig & Record<string, unknown>) | undefined;

    // ── Explicitly disabled ──
    if (embedCfg?.enabled === false) {
      return {
        active: false,
        service: null,
        message: "Embedding service disabled (embedding.enabled=false)",
      };
    }

    // ── Explicitly enabled with full config ──
    if (embedCfg?.enabled === true && embedCfg?.apiKey) {
      return initEmbeddingService(api, embedCfg);
    }

    // ── Auto-detect: not explicitly configured, scan environment ──
    const sources = scanEmbeddingSources();
    const firstAuth = sources.find((s: EmbeddingSource) => s.hasAuth);

    if (firstAuth) {
      api.logger.info?.(`[yaoyao-memory:embedding] Auto-detected source: ${firstAuth.label}`);
      api.logger.info?.(`[yaoyao-memory:embedding] To override, set embedding.enabled=true and configure apiKey/baseUrl/model explicitly.`);
      const autoCfg = {
        ...firstAuth.suggestedConfig,
        enabled: true,
      } as unknown as EmbeddingConfig & Record<string, unknown>;
      return initEmbeddingService(api, autoCfg);
    }

    // ── Nothing found ──
    return {
      active: false,
      service: null,
      message: "Embedding service disabled (set embedding.enabled=true + apiKey, or set env var OPENAI_API_KEY / DEEPSEEK_API_KEY / KIMI_API_KEY to auto-detect)",
    };
  },
};

function initEmbeddingService(
  api: OpenClawPluginApi,
  embedCfg: (EmbeddingConfig & Record<string, unknown>),
): FeatureResult<ReturnType<typeof createEmbeddingService>> {
  const provider = String(embedCfg.provider || "openai").toLowerCase().trim();
  const customMap = (embedCfg.providerModels || {}) as Record<string, string>;

  const service = createEmbeddingService({
    apiKey: embedCfg.apiKey as string,
    baseUrl: (embedCfg.baseUrl as string) || "",
    model: (embedCfg.model as string) || detectEmbedModel(provider, customMap),
    dimensions: (embedCfg.dimensions as number) ?? 1024,
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
}
