/**
 * Auto-detect LLM model name based on provider base URL.
 * Returns a reasonable chat model if we know the provider.
 */
function detectModel(baseUrl) {
    const url = baseUrl.toLowerCase();
    if (url.includes("gitee"))
        return "Qwen3-8B";
    if (url.includes("deepseek"))
        return "deepseek-chat";
    if (url.includes("openai"))
        return "gpt-4o-mini";
    if (url.includes("siliconflow"))
        return "Qwen/Qwen2.5-7B-Instruct";
    if (url.includes("azure"))
        return "gpt-4o-mini";
    return "deepseek-chat"; // generic fallback
}
/** Create an LLM client from plugin config.
 *
 * Priority:
 * 1. Explicit `llm.apiKey` → use `llm` section directly
 * 2. Embedding fallback (if `embedding` section has apiKey) → auto-detect
 * 3. Nothing → return null
 */
export function createLLMClient(config, embeddingConfig) {
    const result = { client: null, source: null };
    if (!config || typeof config !== "object")
        return result;
    // Priority 1: explicit llm config
    const llmSection = (config.llm || {});
    const llmApiKey = String(llmSection.apiKey || "");
    if (llmApiKey) {
        const baseUrl = String(llmSection.baseUrl || "https://api.deepseek.com");
        const model = String(llmSection.model || detectModel(baseUrl));
        result.client = new LLMClient({ apiKey: llmApiKey, baseUrl, model });
        result.source = "explicit";
        return result;
    }
    // Priority 2: auto-detect from embedding config
    if (embeddingConfig && typeof embeddingConfig === "object") {
        const embeddingApiKey = String(embeddingConfig.apiKey || "");
        const embeddingEnabled = embeddingConfig.enabled !== false;
        if (embeddingApiKey && embeddingEnabled) {
            const baseUrl = String(embeddingConfig.baseUrl || "https://api.deepseek.com");
            const model = detectModel(baseUrl);
            result.client = new LLMClient({ apiKey: embeddingApiKey, baseUrl, model });
            result.source = "embedding-auto";
            return result;
        }
    }
    // Priority 3: no LLM available
    return result;
}
export class LLMClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async chat(messages, options) {
        let baseUrl = this.config.baseUrl.replace(/\/$/, "");
        // Handle baseUrl that already contains /v1 prefix (e.g. https://ai.gitee.com/v1)
        const path = baseUrl.endsWith("/v1") ? "" : "/v1";
        const url = `${baseUrl}${path}/chat/completions`;
        const body = {
            model: this.config.model,
            messages,
            temperature: options?.temperature ?? 0.3,
            max_tokens: options?.maxTokens ?? 4096,
        };
        if (options?.json) {
            body.response_format = { type: "json_object" };
        }
        // Add AbortController timeout to prevent hung requests
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => "unknown");
                throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
            }
            const data = await res.json();
            return {
                content: data.choices?.[0]?.message?.content || "",
                model: data.model || this.config.model,
                usage: data.usage || { prompt: 0, completion: 0, total: 0 },
            };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async extract(systemPrompt, userPrompt) {
        const res = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ], { json: true, temperature: 0.1 });
        return res.content;
    }
}
