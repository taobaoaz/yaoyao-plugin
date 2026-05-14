import { createEmbeddingService, detectEmbedModel } from "../../utils/embedding.js";
import { maskSensitive } from "../../utils/mask-config.js";
export const embeddingFeature = {
    id: "embedding",
    name: "Embedding Service",
    dependencies: [],
    configKey: "embedding.enabled",
    defaultEnabled: false,
    init(api, config) {
        const embedCfg = config.embedding;
        if (!embedCfg?.enabled || !embedCfg?.apiKey) {
            return {
                active: false,
                service: null,
                message: "Embedding service disabled (set embedding.enabled=true + apiKey to enable)",
            };
        }
        const provider = String(embedCfg.provider || "openai").toLowerCase().trim();
        const customMap = (embedCfg.providerModels || {});
        const service = createEmbeddingService({
            apiKey: embedCfg.apiKey,
            baseUrl: embedCfg.baseUrl || "",
            model: embedCfg.model || detectEmbedModel(provider, customMap),
            dimensions: embedCfg.dimensions ?? 1024,
            timeoutMs: Number(embedCfg.timeoutMs) || 15_000,
            retries: Number(embedCfg.retries) || 1,
            maxInputChars: Number(embedCfg.maxInputChars) || 4_000,
            backoffBaseMs: Number(embedCfg.backoffBaseMs) || 1_000,
        });
        api.logger.debug?.(`[yaoyao-memory:optional] Embedding config (masked): ${JSON.stringify(maskSensitive(service.config))}`);
        return {
            active: true,
            service,
            message: `Embedding service initialized: ${service.config.model}`,
        };
    },
};
