/**
 * Embedding Service — generates vector embeddings via OpenAI-compatible API.
 * Used to convert text to vectors for sqlite-vec similarity search.
 *
 * All tunables are configurable via EmbeddingConfig (with defaults).
 */
import { clampNum } from "./clamp.js";
import { isTransientUpstreamError, isNonRetryError } from "./reflection-retry.js";
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
/** SSRF protection: block internal / link-local / private IP ranges */
const FORBIDDEN_HOSTS = [
    "localhost", "127.0.0.1", "0.0.0.0", "::1",
    "169.254", "192.168", "10.", "fc00", "fe80",
];
function isForbidden172(host) {
    // 172.16.0.0/12 is private, but 172.0-15 and 172.32-255 are public
    if (!host.startsWith("172."))
        return false;
    const second = parseInt(host.split(".")[1], 10);
    return second >= 16 && second <= 31;
}
function isForbiddenHost(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        return FORBIDDEN_HOSTS.some(h => host === h || host.startsWith(h)) || isForbidden172(host);
    }
    catch {
        return true; // malformed URL is also forbidden
    }
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
        _inflight++;
    }
    function release() {
        _inflight--;
        const next = _queue.shift();
        if (next)
            next();
    }
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
                // Brain-style retry classification: never retry auth/quota/policy errors
                if (isNonRetryError(err)) {
                    throw err;
                }
                // Retry on transient upstream failures (5xx, timeout, network)
                if (err.name === "AbortError" || isTransientUpstreamError(err) || err.message?.startsWith("HTTP 5")) {
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
            });
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
                    });
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
