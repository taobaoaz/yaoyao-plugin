/**
 * Embedding Service — generates vector embeddings via OpenAI-compatible API.
 * Used to convert text to vectors for sqlite-vec similarity search.
 */

export interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}

export function createEmbeddingService(config: EmbeddingConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  /** Fetch with AbortSignal timeout (15s default) */
  async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
    const timeout = init.timeoutMs ?? 15_000;
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
  async function fetchWithRetry(url: string, init: RequestInit & { timeoutMs?: number }, retries = 1): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetchWithTimeout(url, init);
      } catch (err) {
        const isLast = attempt === retries;
        if (isLast) throw err;
        // Only retry on network errors/timeouts, not 4xx (which throw from embed/embedBatch)
        if (err instanceof DOMException && err.name === "AbortError") {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // backoff: 1s, 2s
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
    const url = `${baseUrl}/embeddings`;
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        input: text.slice(0, 8000), // Trim to avoid token limit
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
    const url = `${baseUrl}/embeddings`;
    const inputs = texts.map(t => t.slice(0, 8000));
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
