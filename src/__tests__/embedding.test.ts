/**
 * Tests for embedding.ts — mock HTTP, verify retry, chunking, truncation.
 *
 * Run: node --test src/__tests__/embedding.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createEmbeddingService, detectEmbedModel } from "../utils/embedding.ts";

let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; init: RequestInit | undefined }>;
let fetchResults: Array<{ status: number; body: any }>;
let fetchIdx: number;

function setupFetch(results: Array<{ status: number; body: any }>) {
  fetchCalls = [];
  fetchResults = results;
  fetchIdx = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    const res = fetchResults[fetchIdx++] ?? fetchResults[fetchResults.length - 1];
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    } as Response;
  };
}

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe("detectEmbedModel", () => {
  it("maps known providers", () => {
    assert.strictEqual(detectEmbedModel("openai"), "text-embedding-3-small");
    assert.strictEqual(detectEmbedModel("siliconflow"), "BAAI/bge-m3");
    assert.strictEqual(detectEmbedModel("azure"), "text-embedding-3-small");
  });

  it("returns empty for unknown provider", () => {
    assert.strictEqual(detectEmbedModel("unknown"), "");
  });

  it("uses custom map override", () => {
    assert.strictEqual(detectEmbedModel("openai", { openai: "custom-model" }), "custom-model");
  });

  it("is case-insensitive", () => {
    assert.strictEqual(detectEmbedModel("OpenAI"), "text-embedding-3-small");
    assert.strictEqual(detectEmbedModel("  OPENAI  "), "text-embedding-3-small");
  });
});

describe("createEmbeddingService", () => {
  it("embeds single text", async () => {
    setupFetch([{ status: 200, body: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] } }]);
    const svc = createEmbeddingService({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "m",
      dimensions: 4,
    });
    const vec = await svc.embed("hello");
    assert.strictEqual(vec.length, 4);
    assert.strictEqual(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes("/embeddings"));
    const hdrs = fetchCalls[0].init?.headers as Record<string, string>;
    assert.strictEqual(hdrs["Authorization"], "Bearer test-key");
  });

  it("splits batch into chunks", async () => {
    setupFetch([
      { status: 200, body: { data: [{ embedding: [0.1] }, { embedding: [0.2] }] } },
      { status: 200, body: { data: [{ embedding: [0.3] }] } },
    ]);
    const svc = createEmbeddingService({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      dimensions: 1,
      batchSize: 2,
    });
    const vecs = await svc.embedBatch(["a", "b", "c"]);
    assert.strictEqual(vecs.length, 3);
    assert.strictEqual(fetchCalls.length, 2);
    const body0 = JSON.parse(fetchCalls[0].init?.body as string);
    assert.deepStrictEqual(body0.input, ["a", "b"]);
    const body1 = JSON.parse(fetchCalls[1].init?.body as string);
    assert.deepStrictEqual(body1.input, ["c"]);
  });

  it("retries on server error then succeeds", async () => {
    setupFetch([
      { status: 500, body: { error: "boom" } },
      { status: 200, body: { data: [{ embedding: [0.5] }] } },
    ]);
    const svc = createEmbeddingService({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      dimensions: 1,
      retries: 1,
    });
    const vec = await svc.embed("hello");
    assert.strictEqual(vec[0], 0.5);
    assert.strictEqual(fetchCalls.length, 2);
  });

  it("truncates text beyond maxInputChars", async () => {
    setupFetch([{ status: 200, body: { data: [{ embedding: [0.1] }] } }]);
    const svc = createEmbeddingService({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      dimensions: 1,
      maxInputChars: 600,
    });
    const longText = "x".repeat(1000);
    await svc.embed(longText);
    const body = JSON.parse(fetchCalls[0].init?.body as string);
    assert.strictEqual(body.input.length, 600);
  });

  it("uses /v1 prefix when baseUrl lacks it", async () => {
    setupFetch([{ status: 200, body: { data: [{ embedding: [0.1] }] } }]);
    const svc = createEmbeddingService({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      dimensions: 1,
    });
    await svc.embed("x");
    assert.ok(fetchCalls[0].url.includes("/v1/embeddings"));
  });

  it("omits /v1 when baseUrl already ends with /v1", async () => {
    setupFetch([{ status: 200, body: { data: [{ embedding: [0.1] }] } }]);
    const svc = createEmbeddingService({
      apiKey: "k",
      baseUrl: "https://api.openai.com/v1",
      model: "m",
      dimensions: 1,
    });
    await svc.embed("x");
    assert.ok(fetchCalls[0].url.endsWith("/v1/embeddings"));
    assert.ok(!fetchCalls[0].url.includes("/v1/v1"));
  });

  it("throws on persistent failure", async () => {
    setupFetch([{ status: 500, body: { error: "boom" } }]);
    const svc = createEmbeddingService({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      dimensions: 1,
      retries: 0,
    });
    await assert.rejects(() => svc.embed("x"), /HTTP 500/);
  });

  it("throws on malformed response", async () => {
    setupFetch([{ status: 200, body: { data: [] } }]);
    const svc = createEmbeddingService({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      dimensions: 1,
      retries: 0,
    });
    await assert.rejects(() => svc.embed("x"), /Invalid embedding response/);
  });
});
