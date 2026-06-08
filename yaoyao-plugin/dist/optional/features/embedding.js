import { createEmbeddingService, detectEmbedModel } from "../../utils/embedding.js";
import { maskSensitive } from "../../utils/mask-config.js";
export const embeddingFeature = {
    id: 'embedding',
    name: 'Embedding Service',
    dependencies: [],
    configKey: 'embedding.enabled',
    defaultEnabled: false,
    init(api, config) {
        const embedCfg = config.embedding;
        // ── Explicitly disabled ──
        if (embedCfg?.enabled === false) {
            return {
                active: false,
                service: null,
                message: 'Embedding service disabled (embedding.enabled=false)',
            };
        }
        // ── Explicitly enabled with full config ──
        if (embedCfg?.enabled === true && embedCfg?.apiKey) {
            return initEmbeddingService(api, embedCfg);
        }
        // ── Auto-detect: not explicitly configured, scan environment ──
        const { scanEmbeddingSources } = require('../../utils/env-scan.ts');
        const sources = scanEmbeddingSources();
        const firstAuth = sources.find((s) => s.hasAuth);
        if (firstAuth) {
            api.logger.info?.(`[yaoyao-memory:embedding] Auto-detected source: ${firstAuth.label}`);
            api.logger.info?.(`[yaoyao-memory:embedding] To override, set embedding.enabled=true and configure apiKey/baseUrl/model explicitly.`);
            const autoCfg = {
                ...firstAuth.suggestedConfig,
                enabled: true,
            };
            return initEmbeddingService(api, autoCfg);
        }
        // ── Nothing found ──
        return {
            active: false,
            service: null,
            message: 'Embedding service disabled (set embedding.enabled=true + apiKey, or set env var OPENAI_API_KEY / DEEPSEEK_API_KEY / KIMI_API_KEY to auto-detect)',
        };
    },
};
function initEmbeddingService(api, embedCfg) {
    const provider = String(embedCfg.provider || 'openai')
        .toLowerCase()
        .trim();
    const customMap = (embedCfg.providerModels || {});
    const service = createEmbeddingService({
        apiKey: embedCfg.apiKey,
        baseUrl: embedCfg.baseUrl || '',
        model: embedCfg.model || detectEmbedModel(provider, customMap),
        dimensions: embedCfg.dimensions ?? 1024,
        timeoutMs: Number(embedCfg.timeoutMs) || 15_000,
        retries: Number(embedCfg.retries) || 1,
        maxInputChars: Number(embedCfg.maxInputChars) || 4_000,
        backoffBaseMs: Number(embedCfg.backoffBaseMs) || 1_000,
        logger: api.logger,
    });
    api.logger.debug?.(`[yaoyao-memory:optional] Embedding config (masked): ${JSON.stringify(maskSensitive(service.config))}`);
    return {
        active: true,
        service,
        message: `Embedding service initialized: ${service.config.model}`,
    };
}
