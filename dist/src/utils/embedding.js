/**
 * Embedding Service — generates vector embeddings via OpenAI-compatible API.
 * Used to convert text to vectors for sqlite-vec similarity search.
 *
 * All tunables are configurable via EmbeddingConfig (with defaults).
 */
import { clampNum } from "./clamp.js";
/** Provider → default embedding model mapping (overridable via config.providerModels) */
const DEFAULT_EMBED_MODELS = {
    openai: "text-embedding-3-small",
    deepseek: "text-embedding",
    gitee: "text-embedding",
    siliconflow: "BAAI/bge-m3",
    azure: "text-embedding-3-small",
    ollama: "nomic-embed-text",
    anthropic: "claude-embed",
    google: "text-embedding-004",
    groq: "text-embedding",
    mistral: "mistral-embed",
    fireworks: "nomic-embed-text-v1.5",
};
export function detectEmbedModel(provider, customMap) {
    const p = provider.toLowerCase().trim();
    if (customMap && customMap[p])
        return customMap[p];
    return DEFAULT_EMBED_MODELS[p] || "";
}
export function createEmbeddingService(config) {
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    // Resolve tunables with defaults
    const timeoutMs = clampNum(config.timeoutMs, 15_000, 3_000, 120_000);
    const retries = clampNum(config.retries, 1, 0, 5);
    const maxInputChars = clampNum(config.maxInputChars, 4_000, 500, 32_000);
    const backoffBaseMs = clampNum(config.backoffBaseMs, 1_000, 100, 30_000);
    const batchSize = clampNum(config.batchSize, 100, 1, 500);
    /** Fetch with AbortSignal timeout */
    async function fetchWithTimeout(url, init) {
        const timeout = init.timeoutMs ?? timeoutMs;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeout);
        try {
            const res = await fetch(url, { ...init, signal: ac.signal });
            return res;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /** Retry wrapper: retries on network/timeout errors and HTTP 5xx (not 4xx). */
    async function fetchWithRetry(url, init, _retries = retries) {
        for (let attempt = 0; attempt <= _retries; attempt++) {
            try {
                const res = await fetchWithTimeout(url, init);
                if (!res.ok && res.status >= 500) {
                    throw new Error(`HTTP ${res.status}`);
                }
                return res;
            }
            catch (err) {
                const isLast = attempt === _retries;
                if (isLast)
                    throw err;
                // Retry on all network errors (timeout, ECONNREFUSED, ETIMEDOUT, system errors) and HTTP 5xx
                if (err.name === "AbortError" || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.type === "system" || err.message?.startsWith("HTTP 5")) {
                    await new Promise(r => setTimeout(r, backoffBaseMs * (attempt + 1))); // backoff
                    continue;
                }
                throw err;
            }
        }
        throw new Error("Unreachable");
    }
    /**
     * Generate an embedding vector for the given text.
     * Returns a Float32Array of `dimensions` floats.
     */
    async function embed(text) {
        // Handle baseUrl that already contains /v1 prefix (e.g. https://ai.gitee.com/v1)
        const path = baseUrl.endsWith("/v1") ? "" : "/v1";
        const url = `${baseUrl}${path}/embeddings`;
        const res = await fetchWithRetry(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                input: text.slice(0, maxInputChars),
                model: config.model,
            }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => "unknown");
            throw new Error(`Embedding API error ${res.status}: ${errText.slice(0, 200)}`);
        }
        const data = await res.json();
        const embedding = data?.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding)) {
            throw new Error("Invalid embedding response");
        }
        return new Float32Array(embedding);
    }
    /**
     * Generate embeddings for multiple texts in a batch.
     * Automatically chunks large arrays to avoid OOM / timeout.
     */
    async function embedBatch(texts) {
        const results = [];
        const path = baseUrl.endsWith("/v1") ? "" : "/v1";
        const url = `${baseUrl}${path}/embeddings`;
        for (let i = 0; i < texts.length; i += batchSize) {
            const chunk = texts.slice(i, i + batchSize).map(t => t.slice(0, maxInputChars));
            const res = await fetchWithRetry(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    input: chunk,
                    model: config.model,
                }),
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => "unknown");
                throw new Error(`Embedding API error ${res.status}: ${errText.slice(0, 200)}`);
            }
            const data = await res.json();
            const dataArr = data?.data;
            if (!dataArr || !Array.isArray(dataArr)) {
                throw new Error("Invalid embedding batch response");
            }
            results.push(...dataArr.map((d) => new Float32Array(d.embedding)));
        }
        return results;
    }
    return { embed, embedBatch, config };
}
