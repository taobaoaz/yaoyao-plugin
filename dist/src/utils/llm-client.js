/**
 * LLM Client — lightweight OpenAI-compatible API caller.
 * Accepts raw plugin config and looks for llm/embedding fields.
 */
import { getObj } from "./config.js";
/**
 * Default provider → model mapping.
 * Exposed as a module-level constant so it can be overridden by user config.
 */
export const DEFAULT_PROVIDER_MODELS = {
    gitee: "Qwen3-8B",
    deepseek: "deepseek-chat",
    openai: "gpt-4o-mini",
    siliconflow: "Qwen/Qwen2.5-7B-Instruct",
    azure: "gpt-4o-mini",
    anthropic: "claude-3-5-sonnet-20241022",
    google: "gemini-1.5-flash",
    ollama: "llama3.1",
    groq: "llama-3.1-70b-versatile",
    mistral: "mistral-small-latest",
    fireworks: "accounts/fireworks/models/llama-v3p1-70b-instruct",
};
/**
 * Auto-detect LLM model name based on provider base URL.
 * Supports custom override via `providerModels` config.
 * Returns empty string if no match — caller must handle.
 */
function detectModel(baseUrl, customMap) {
    const url = baseUrl.toLowerCase();
    // 1. Custom map (user-configured) takes highest priority
    if (customMap) {
        for (const [provider, model] of Object.entries(customMap)) {
            if (url.includes(provider.toLowerCase()))
                return model;
        }
    }
    // 2. Default map
    for (const [provider, model] of Object.entries(DEFAULT_PROVIDER_MODELS)) {
        if (url.includes(provider.toLowerCase()))
            return model;
    }
    return ""; // no hardcoded fallback — caller handles
}
/** Create an LLM client from plugin config.
 *
 * Priority:
 * 1. Explicit `llm.apiKey` → use `llm` section directly
 * 2. Embedding fallback (if `embedding` section has apiKey) → auto-detect
 * 3. Nothing → return null
 */
/** SSRF protection: block internal / link-local / private IP ranges */
const FORBIDDEN_HOSTS = [
    "localhost", "127.0.0.1", "0.0.0.0", "::1",
    "169.254", "192.168", "10.", "172.", "fc00", "fe80",
];
function isForbiddenHost(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        return FORBIDDEN_HOSTS.some(h => host === h || host.startsWith(h));
    }
    catch {
        return true; // malformed URL is also forbidden
    }
}
export function createLLMClient(config, embeddingConfig) {
    const result = { client: null, source: null };
    if (!config || typeof config !== "object")
        return result;
    // User-configured provider → model override map (if any)
    const llmSection = getObj(config, "llm") || {};
    const providerModels = (llmSection.providerModels || {});
    // Priority 1: explicit llm config
    const llmApiKey = String(llmSection.apiKey || "");
    if (llmApiKey) {
        const baseUrl = String(llmSection.baseUrl || "").trim();
        if (!baseUrl) {
            // apiKey present but baseUrl missing — can't create a valid client
            return result;
        }
        if (isForbiddenHost(baseUrl)) {
            return result; // SSRF protection: reject internal/private URLs
        }
        const model = String(llmSection.model || detectModel(baseUrl, providerModels));
        if (!model) {
            // baseUrl valid but model unknown and not user-configured
            return result;
        }
        result.client = new LLMClient({ apiKey: llmApiKey, baseUrl, model });
        result.source = "explicit";
        return result;
    }
    // Priority 2: auto-detect from embedding config
    if (embeddingConfig && typeof embeddingConfig === "object") {
        const embeddingApiKey = String(embeddingConfig.apiKey || "");
        const embeddingEnabled = embeddingConfig.enabled !== false;
        if (embeddingApiKey && embeddingEnabled) {
            const baseUrl = String(embeddingConfig.baseUrl || "").trim();
            if (!baseUrl)
                return result;
            if (isForbiddenHost(baseUrl))
                return result;
            const model = detectModel(baseUrl, providerModels);
            if (!model)
                return result;
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
        };
        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }
        if (options?.maxTokens !== undefined) {
            body.max_tokens = options.maxTokens;
        }
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
                const text = await Promise.race([
                    res.text(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Response body read timed out")), 15000)),
                ]).catch(() => "unknown");
                throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
            }
            const data = await Promise.race([
                res.json(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Response body read timed out")), 15000)),
            ]);
            const firstChoice = data.choices?.[0];
            const message = firstChoice?.message;
            return {
                content: message?.content || "",
                model: data.model || this.config.model,
                usage: data.usage || { prompt: 0, completion: 0, total: 0 },
            };
        }
        catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                throw new Error("LLM request timed out after 30s");
            }
            throw err;
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
