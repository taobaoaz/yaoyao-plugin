import { createLLMClient } from "../../utils/llm-client.js";
export const llmFeature = {
    id: 'llm',
    name: 'LLM Client',
    dependencies: ['embedding'],
    configKey: 'llm.enabled',
    defaultEnabled: true,
    init(api, config, deps) {
        const embeddingResult = deps.get('embedding');
        const embedCfg = config.embedding;
        const result = createLLMClient(config, embeddingResult?.active ? embedCfg : null);
        if (!result.client) {
            return {
                active: false,
                service: null,
                message: 'LLM client inactive (configure llm.apiKey or embedding.apiKey to enable)',
            };
        }
        const sourceLabel = result.source === 'explicit' ? 'explicit llm config' : 'auto-detected from embedding config';
        return {
            active: true,
            service: result,
            message: `LLM client initialized (${sourceLabel}): ${result.client.config.model}`,
        };
    },
};
