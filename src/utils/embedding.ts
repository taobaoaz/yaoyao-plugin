/**
 * Embedding Service — generates vector embeddings via OpenAI-compatible API.
 * Used to convert text to vectors for sqlite-vec similarity search.
 *
 * All tunables are configurable via EmbeddingConfig (with defaults).
 */

import { clampNum } from "./clamp.js";

export interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  /** Request timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
  /** Retry count on network/timeout errors (default: 1) */
  retries?: number;
  /** Max input chars per text, truncates beyond this (default: 4000) */
  maxInputChars?: number;
  /** Backoff base in milliseconds (default: 1000) */
  backoffBaseMs?: number;
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

export function createEmbeddingService(config: EmbeddingConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  // Resolve tunables with defaults
  const timeoutMs = clampNum(config.timeoutMs, 15_000, 3_000, 120_000);
  const retries = clampNum(config.retries, 1, 0, 5);
  const maxInputChars = clampNum(config.maxInputChars, 4_000, 500, 32_000);
  const backoffBaseMs = clampNum(config.backoffBaseMs, 1_000, 100, 30_000);

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

  /** Retry wrapper: retries on network/timeout errors (not 4xx) */
  async function fetchWithRetry(url: string, init: RequestInit & { timeoutMs?: number }, _retries = retries): Promise<Response> {
    for (let attempt = 0; attempt <= _retries; attempt++) {
      try {
        return await fetchWithTimeout(url, init);
      } catch (err: any) {
        const isLast = attempt === _retries;
        if (isLast) throw err;
        // Retry on all network errors (timeout, ECONNREFUSED, ETIMEDOUT, system errors)
        if (err.name === "AbortError" || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.type === "system") {
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
  async function embed(text: string): Promise<Float32Array> {
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

    const data = await res.json() as any;
    const embedding = data?.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("Invalid embedding response");
    }

    return new Float32Array(embedding);
  }

  /**
   * Generate embeddings for multiple texts in a batch.
   */
  async function embedBatch(texts: string[]): Promise<Float32Array[]> {
    const path = baseUrl.endsWith("/v1") ? "" : "/v1";
    const url = `${baseUrl}${path}/embeddings`;
    const inputs = texts.map(t => t.slice(0, maxInputChars));
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        input: inputs,
        model: config.model,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`Embedding API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const dataArr = data?.data as Array<{ embedding: number[] }> | undefined;
    if (!dataArr || !Array.isArray(dataArr)) {
      throw new Error("Invalid embedding batch response");
    }

    return dataArr.map((d: { embedding: number[] }) => new Float32Array(d.embedding));
  }

  return { embed, embedBatch, config };
}

export type EmbeddingService = ReturnType<typeof createEmbeddingService>;
