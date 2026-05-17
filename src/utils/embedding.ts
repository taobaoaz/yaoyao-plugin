/**
 * Embedding Service — generates vector embeddings via OpenAI-compatible API.
 * Used to convert text to vectors for sqlite-vec similarity search.
 *
 * All tunables are configurable via EmbeddingConfig (with defaults).
 */

import { clampNum } from "./clamp.ts";
import { isTransientUpstreamError, isNonRetryError } from "./reflection-retry.ts";

export interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  /** Global request timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
  /** Timeout for recall-side embedding calls (overrides timeoutMs if set) */
  recallTimeoutMs?: number;
  /** Timeout for capture-side embedding calls (overrides timeoutMs if set) */
  captureTimeoutMs?: number;
  /** Retry count on network/timeout errors (default: 1) */
  retries?: number;
  /** Max input chars per text, truncates beyond this (default: 4000) */
  maxInputChars?: number;
  /** Backoff base in milliseconds (default: 1000) */
  backoffBaseMs?: number;
  /** Max batch size for embedBatch (default: 100, max 500) */
  batchSize?: number;
  /** Optional logger for timing metrics */
  logger?: { info?: (s: string) => void; debug?: (s: string) => void };
}

/** Provider → default embedding model mapping (overridable via config.providerModels) */
const DEFAULT_EMBED_MODELS: Record<string, string> = {
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

export function detectEmbedModel(provider: string, customMap?: Record<string, string>): string {
  const p = provider.toLowerCase().trim();
  if (customMap && customMap[p]) return customMap[p];
  return DEFAULT_EMBED_MODELS[p] || "";
}

/** SSRF protection: block internal / link-local / private IP ranges */
const FORBIDDEN_HOSTS = [
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
  "169.254", "192.168", "10.", "fc00", "fe80",
];

function isForbidden172(host: string): boolean {
  // 172.16.0.0/12 is private, but 172.0-15 and 172.32-255 are public
  if (!host.startsWith("172.")) return false;
  const second = parseInt(host.split(".")[1], 10);
  return second >= 16 && second <= 31;
}

function isForbiddenHost(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    return FORBIDDEN_HOSTS.some(h => host === h || host.startsWith(h)) || isForbidden172(host);
  } catch {
    return true; // malformed URL is also forbidden
  }
}

export function createEmbeddingService(config: EmbeddingConfig) {
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

  /** Fetch with AbortSignal timeout */
  async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
    const timeout = init.timeoutMs ?? timeoutMs;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Retry wrapper: retries on network/timeout errors and HTTP 5xx (not 4xx). */
  async function fetchWithRetry(url: string, init: RequestInit & { timeoutMs?: number }, _retries = retries): Promise<Response> {
    for (let attempt = 0; attempt <= _retries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, init);
        if (!res.ok && res.status >= 500) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res;
      } catch (err: unknown) {
        const isLast = attempt === _retries;
        if (isLast) throw err;
        // Brain-style retry classification: never retry auth/quota/policy errors
        if (isNonRetryError(err)) {
          throw err;
        }
        // Retry on transient upstream failures (5xx, timeout, network)
        if ((err as Error).name === "AbortError" || isTransientUpstreamError(err) || (err as Error).message?.startsWith("HTTP 5")) {
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
  async function embed(text: string, overrideTimeoutMs?: number): Promise<Float32Array> {
    const t0 = performance.now();
    const path = baseUrl.endsWith("/v1") ? "" : "/v1";
    const url = `${baseUrl}${path}/embeddings`;
    const effectiveTimeout = overrideTimeoutMs ?? timeoutMs;
    try {
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

      const data = await res.json() as Record<string, unknown>;
      const embedding = (data.data as Array<{embedding: number[]}> | undefined)?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid embedding response");
      }

      const elapsed = Math.round(performance.now() - t0);
      config.logger?.info?.(`[embed] /embeddings ${elapsed}ms (${text.length} chars)`);
      return new Float32Array(embedding);
    } catch (err: unknown) {
      const elapsed = Math.round(performance.now() - t0);
      config.logger?.debug?.(`[embed] /embeddings failed after ${elapsed}ms`);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Embedding request timed out");
      }
      throw err;
    }
  }

  /**
   * Generate embeddings for multiple texts in a batch.
   * Automatically chunks large arrays to avoid OOM / timeout.
   */
  async function embedBatch(texts: string[], overrideTimeoutMs?: number): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
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

        const data = await res.json() as Record<string, unknown>;
        const dataArr = data.data as Array<{ embedding: number[] }> | undefined;
        if (!dataArr || !Array.isArray(dataArr)) {
          throw new Error("Invalid embedding batch response");
        }

        results.push(...dataArr.map((d: { embedding: number[] }) => new Float32Array(d.embedding)));
        const elapsed = Math.round(performance.now() - t0);
        config.logger?.info?.(`[embedBatch] /embeddings ${elapsed}ms (batch ${i / batchSize + 1}, ${chunk.length} texts)`);
      } catch (err: unknown) {
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

  return { embed, embedBatch, config, recallTimeoutMs: config.recallTimeoutMs, captureTimeoutMs: config.captureTimeoutMs, isAvailable: true };
}

export type EmbeddingService = ReturnType<typeof createEmbeddingService>;
