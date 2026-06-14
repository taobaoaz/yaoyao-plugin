/**
 * Embedding Service — generates vector embeddings via OpenAI-compatible API.
 * Used to convert text to vectors for sqlite-vec similarity search.
 *
 * All tunables are configurable via EmbeddingConfig (with defaults).
 */
import { clampNum } from "./clamp.js";
import { isForbiddenHost } from "./ssrf-guard.js";
import { fetchWithRetry } from "./fetch-helpers.js";
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
    if (isForbiddenHost(baseUrl)) {
        throw new Error(`Embedding baseUrl "${baseUrl}" is forbidden (SSRF protection)`);
    }
    // Resolve tunables with defaults
    const timeoutMs = clampNum(config.timeoutMs, 15_000, 3_000, 120_000);
    const retries = clampNum(config.retries, 1, 0, 5);
    const maxInputChars = clampNum(config.maxInputChars, 4_000, 500, 32_000);
    const backoffBaseMs = clampNum(config.backoffBaseMs, 1_000, 100, 30_000);
    const batchSize = clampNum(config.batchSize, 100, 1, 500);
    // Concurrency limiter: max 2 inflight embedding requests to avoid upstream bombing
    let _inflight = 0;
    const _queue = [];
    async function acquire() {
        if (_inflight < 2) {
            _inflight++;
            return;
        }
        await new Promise((r) => _queue.push(r));
        // Slot transferred from releaser; do not increment again or count drifts.
    }
    function release() {
        const next = _queue.shift();
        if (next) {
            // Hand the slot to the next waiter; _inflight stays the same.
            next();
        }
        else {
            _inflight--;
        }
    }
    /**
     * Generate an embedding vector for the given text.
     * Returns a Float32Array of `dimensions` floats.
     */
    async function embed(text, overrideTimeoutMs) {
        await acquire();
        let t0 = 0;
        try {
            t0 = performance.now();
            const path = baseUrl.endsWith("/v1") ? "" : "/v1";
            const url = `${baseUrl}${path}/embeddings`;
            const effectiveTimeout = overrideTimeoutMs ?? timeoutMs;
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
                timeoutMs: effectiveTimeout,
            }, retries, backoffBaseMs, timeoutMs);
            if (!res.ok) {
                const errText = await res.text().catch(() => "unknown");
                throw new Error(`Embedding API error ${res.status}: ${errText.slice(0, 200)}`);
            }
            const data = await res.json();
            const embedding = data.data?.[0]?.embedding;
            if (!embedding || !Array.isArray(embedding)) {
                throw new Error("Invalid embedding response");
            }
            const elapsed = Math.round(performance.now() - t0);
            config.logger?.info?.(`[embed] /embeddings ${elapsed}ms (${text.length} chars)`);
            return new Float32Array(embedding);
        }
        catch (err) {
            const elapsed = Math.round(performance.now() - t0);
            config.logger?.debug?.(`[embed] /embeddings failed after ${elapsed}ms`);
            if (err instanceof Error && err.name === "AbortError") {
                throw new Error("Embedding request timed out");
            }
            throw err;
        }
        finally {
            release();
        }
    }
    /**
     * Generate embeddings for multiple texts in a batch.
     * Automatically chunks large arrays to avoid OOM / timeout.
     */
    async function embedBatch(texts, overrideTimeoutMs) {
        await acquire();
        try {
            const results = [];
            const path = baseUrl.endsWith("/v1") ? "" : "/v1";
            const url = `${baseUrl}${path}/embeddings`;
            const effectiveTimeout = overrideTimeoutMs ?? timeoutMs;
            for (let i = 0; i < texts.length; i += batchSize) {
                const t0 = performance.now();
                const chunk = texts.slice(i, i + batchSize).map(t => t.slice(0, maxInputChars));
                try {
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
                        timeoutMs: effectiveTimeout,
                    }, retries, backoffBaseMs, timeoutMs);
                    if (!res.ok) {
                        const errText = await res.text().catch(() => "unknown");
                        throw new Error(`Embedding API error ${res.status}: ${errText.slice(0, 200)}`);
                    }
                    const data = await res.json();
                    const dataArr = data.data;
                    if (!dataArr || !Array.isArray(dataArr)) {
                        throw new Error("Invalid embedding batch response");
                    }
                    results.push(...dataArr.map((d) => new Float32Array(d.embedding)));
                    const elapsed = Math.round(performance.now() - t0);
                    config.logger?.info?.(`[embedBatch] /embeddings ${elapsed}ms (batch ${i / batchSize + 1}, ${chunk.length} texts)`);
                }
                catch (err) {
                    const elapsed = Math.round(performance.now() - t0);
                    config.logger?.debug?.(`[embedBatch] /embeddings failed after ${elapsed}ms (batch ${i / batchSize + 1})`);
                    if (err instanceof Error && err.name === "AbortError") {
                        throw new Error("Embedding batch request timed out");
                    }
                    throw err;
                }
            }
            return results;
        }
        finally {
            release();
        }
    }
    return { embed, embedBatch, config, recallTimeoutMs: config.recallTimeoutMs, captureTimeoutMs: config.captureTimeoutMs, isAvailable: true };
}
