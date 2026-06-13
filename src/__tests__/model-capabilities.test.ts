/**
 * model-capabilities.test.ts — Unit tests for src/utils/model-capabilities.ts
 *
 * Covers: exact match, pattern match, unknown fallback, cache IO,
 * model resolution, and a small integration test simulating the
 * multimodal gated block in src/tools/index.ts.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  classifyModel,
  isMultimodalCapable,
  resolveCurrentModel,
  recordAndClassify,
  loadCache,
  saveCache,
  listCached,
  invalidateModel,
  clearCache,
  type ModelCapabilities,
} from "../utils/model-capabilities.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-mc-"));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

/* ── classifyModel: exact-match table ─────────────────────── */

describe("classifyModel — exact match", () => {
  it("recognises gpt-4o as image+audio multimodal", () => {
    const c = classifyModel("gpt-4o");
    assert.equal(c.source, "static");
    assert.equal(c.image, true);
    assert.equal(c.audio, true);
    assert.equal(c.video, false);
    assert.ok(c.note?.includes("GPT-4o"));
  });

  it("recognises gpt-4o-mini", () => {
    const c = classifyModel("gpt-4o-mini");
    assert.equal(c.image, true);
    assert.equal(c.audio, true);
  });

  it("recognises gpt-5 family", () => {
    const c = classifyModel("gpt-5");
    assert.equal(c.image, true);
    assert.equal(c.audio, true);
  });

  it("treats gpt-3.5-turbo as text-only", () => {
    const c = classifyModel("gpt-3.5-turbo");
    assert.equal(c.source, "static");
    assert.equal(c.image, false);
    assert.equal(c.audio, false);
    assert.equal(c.video, false);
    assert.ok(c.note?.toLowerCase().includes("text-only"));
  });

  it("treats gpt-4 base as text-only", () => {
    const c = classifyModel("gpt-4");
    assert.equal(c.image, false);
    assert.ok(c.note?.toLowerCase().includes("text-only"));
  });

  it("recognises claude-3-opus as image-only", () => {
    const c = classifyModel("claude-3-opus");
    assert.equal(c.image, true);
    assert.equal(c.audio, false);
    assert.equal(c.video, false);
    assert.ok(c.note?.includes("Anthropic"));
  });

  it("recognises claude-3-5-sonnet", () => {
    const c = classifyModel("claude-3-5-sonnet");
    assert.equal(c.image, true);
  });

  it("recognises claude-sonnet-4", () => {
    const c = classifyModel("claude-sonnet-4");
    assert.equal(c.image, true);
  });

  it("recognises claude-opus-4", () => {
    const c = classifyModel("claude-opus-4");
    assert.equal(c.image, true);
  });

  it("recognises gemini-1.5-pro with full image+audio+video", () => {
    const c = classifyModel("gemini-1.5-pro");
    assert.equal(c.image, true);
    assert.equal(c.audio, true);
    assert.equal(c.video, true);
  });

  it("recognises gemini-2.5-flash full multimodal", () => {
    const c = classifyModel("gemini-2.5-flash");
    assert.equal(c.image, true);
    assert.equal(c.audio, true);
    assert.equal(c.video, true);
  });

  it("recognises qwen-vl-max", () => {
    const c = classifyModel("qwen-vl-max");
    assert.equal(c.image, true);
  });

  it("recognises glm-4v-plus", () => {
    const c = classifyModel("glm-4v-plus");
    assert.equal(c.image, true);
  });

  it("recognises llama-3.2-90b-vision", () => {
    const c = classifyModel("llama-3.2-90b-vision");
    assert.equal(c.image, true);
  });

  it("treats deepseek-chat as text-only", () => {
    const c = classifyModel("deepseek-chat");
    assert.equal(c.image, false);
    assert.ok(c.note?.toLowerCase().includes("text-only"));
  });

  it("treats deepseek-reasoner as text-only", () => {
    const c = classifyModel("deepseek-reasoner");
    assert.equal(c.image, false);
  });

  it("exact match is case-insensitive (lowercased internally)", () => {
    const c = classifyModel("GPT-4O");
    assert.equal(c.source, "static");
    assert.equal(c.image, true);
  });

  it("exact match trims whitespace", () => {
    const c = classifyModel("  gpt-4o  ");
    assert.equal(c.source, "static");
    assert.equal(c.image, true);
  });
});

/* ── classifyModel: pattern-match fallback ─────────────────── */

describe("classifyModel — pattern match", () => {
  it("matches gpt-4o-2024-08-06 dated variant", () => {
    const c = classifyModel("gpt-4o-2024-08-06");
    assert.equal(c.source, "static");
    assert.equal(c.image, true);
  });

  it("matches gpt-4-turbo-2024-04-09", () => {
    const c = classifyModel("gpt-4-turbo-2024-04-09");
    assert.equal(c.image, true);
  });

  it("matches claude-3-7-sonnet-20250219", () => {
    const c = classifyModel("claude-3-7-sonnet-20250219");
    assert.equal(c.image, true);
  });

  it("matches qwen2.5-vl-72b-instruct", () => {
    const c = classifyModel("qwen2.5-vl-72b-instruct");
    assert.equal(c.image, true);
  });

  it("matches llama-3.2-11b-vision-instruct", () => {
    const c = classifyModel("llama-3.2-11b-vision-instruct");
    assert.equal(c.image, true);
  });

  it("matches o1-preview-2024-09-12", () => {
    const c = classifyModel("o1-preview-2024-09-12");
    assert.equal(c.image, true);
  });

  it("matches o3-mini variant", () => {
    const c = classifyModel("o3-mini");
    assert.equal(c.image, true);
  });

  it("matches generic llava variant", () => {
    const c = classifyModel("llava-13b");
    assert.equal(c.image, true);
  });

  it("matches internvl variant", () => {
    const c = classifyModel("internvl-chat-v1.5");
    assert.equal(c.image, true);
  });
});

/* ── classifyModel: conservative unknown fallback ──────────── */

describe("classifyModel — unknown fallback", () => {
  it("returns source=unknown + all-false for an unknown model", () => {
    const c = classifyModel("some-random-model-xyz");
    assert.equal(c.source, "unknown");
    assert.equal(c.image, false);
    assert.equal(c.audio, false);
    assert.equal(c.video, false);
    assert.ok(c.note?.includes("some-random-model-xyz"));
  });

  it("returns source=unknown + note='no model' for empty string", () => {
    const c = classifyModel("");
    assert.equal(c.source, "unknown");
    assert.equal(c.image, false);
    assert.equal(c.note, "no model");
  });

  it("handles undefined input gracefully", () => {
    const c = classifyModel(undefined as unknown as string);
    assert.equal(c.source, "unknown");
    assert.equal(c.image, false);
  });

  it("handles null input gracefully", () => {
    const c = classifyModel(null as unknown as string);
    assert.equal(c.source, "unknown");
  });
});

/* ── isMultimodalCapable ───────────────────────────────────── */

describe("isMultimodalCapable", () => {
  it("true when image is true", () => {
    assert.equal(isMultimodalCapable({ image: true, audio: false, video: false, source: "static", detectedAt: 0 }), true);
  });

  it("true when audio is true", () => {
    assert.equal(isMultimodalCapable({ image: false, audio: true, video: false, source: "static", detectedAt: 0 }), true);
  });

  it("true when video is true", () => {
    assert.equal(isMultimodalCapable({ image: false, audio: false, video: true, source: "static", detectedAt: 0 }), true);
  });

  it("false when all modalities are false", () => {
    assert.equal(isMultimodalCapable({ image: false, audio: false, video: false, source: "static", detectedAt: 0 }), false);
  });
});

/* ── resolveCurrentModel ───────────────────────────────────── */

describe("resolveCurrentModel", () => {
  it("returns empty when config is undefined", () => {
    assert.equal(resolveCurrentModel(undefined), "");
  });

  it("returns empty when config is empty", () => {
    assert.equal(resolveCurrentModel({}), "");
  });

  it("prefers config.llm.model", () => {
    assert.equal(
      resolveCurrentModel({ llm: { model: "gpt-4o" }, embedding: { model: "text-embedding-3-small" } }),
      "gpt-4o"
    );
  });

  it("falls back to config.embedding.model when llm.model missing", () => {
    assert.equal(
      resolveCurrentModel({ embedding: { model: "text-embedding-3-small" } }),
      "text-embedding-3-small"
    );
  });

  it("trims whitespace from the model string", () => {
    assert.equal(resolveCurrentModel({ llm: { model: "  gpt-4o  " } }), "gpt-4o");
  });

  it("treats empty llm.model as missing and falls through to embedding", () => {
    assert.equal(
      resolveCurrentModel({ llm: { model: "" }, embedding: { model: "gemini-1.5-pro" } }),
      "gemini-1.5-pro"
    );
  });

  it("returns empty when both llm.model and embedding.model are missing", () => {
    assert.equal(resolveCurrentModel({ llm: {}, embedding: {} }), "");
  });
});

/* ── recordAndClassify: cache lifecycle ────────────────────── */

describe("recordAndClassify — cache lifecycle", () => {
  it("returns source=static on first call and writes to cache", () => {
    const c = recordAndClassify(tmpDir, "gpt-4o");
    assert.equal(c.source, "static");
    assert.equal(c.image, true);
    assert.ok(c.detectedAt > 0);

    const cache = loadCache(tmpDir);
    assert.ok(cache["gpt-4o"]);
    assert.equal(cache["gpt-4o"].image, true);
  });

  it("returns source=cache on second call without re-classifying", () => {
    const first = recordAndClassify(tmpDir, "claude-3-5-sonnet");
    assert.equal(first.source, "static");
    const second = recordAndClassify(tmpDir, "claude-3-5-sonnet");
    assert.equal(second.source, "cache");
    assert.equal(second.image, first.image);
  });

  it("does not write to cache when model is empty", () => {
    const c = recordAndClassify(tmpDir, "");
    assert.equal(c.source, "unknown");
    assert.equal(c.note, "no model");
    const cache = loadCache(tmpDir);
    assert.deepEqual(cache, {});
  });

  it("preserves multiple distinct models in the same cache", () => {
    recordAndClassify(tmpDir, "gpt-4o");
    recordAndClassify(tmpDir, "deepseek-chat");
    recordAndClassify(tmpDir, "gemini-2.5-pro");
    const cache = loadCache(tmpDir);
    assert.equal(Object.keys(cache).length, 3);
    assert.equal(cache["gpt-4o"].image, true);
    assert.equal(cache["deepseek-chat"].image, false);
    assert.equal(cache["gemini-2.5-pro"].video, true);
  });

  it("handles unknown models by recording them (source=unknown)", () => {
    const c = recordAndClassify(tmpDir, "weird-model-9000");
    assert.equal(c.source, "unknown");
    const cache = loadCache(tmpDir);
    assert.ok(cache["weird-model-9000"]);
    assert.equal(cache["weird-model-9000"].source, "unknown");
  });

  it("second lookup of an unknown model returns source=cache (still image=false)", () => {
    recordAndClassify(tmpDir, "weird-model-9000");
    const c = recordAndClassify(tmpDir, "weird-model-9000");
    assert.equal(c.source, "cache");
    assert.equal(c.image, false);
  });
});

/* ── loadCache / saveCache IO ──────────────────────────────── */

describe("loadCache / saveCache — IO integrity", () => {
  it("loadCache returns {} when the cache file does not exist", () => {
    assert.deepEqual(loadCache(tmpDir), {});
  });

  it("saveCache + loadCache roundtrips", () => {
    const cache = {
      "gpt-4o": { image: true, audio: true, video: false, source: "static" as const, detectedAt: 12345, note: "test" },
    };
    saveCache(tmpDir, cache);
    const got = loadCache(tmpDir);
    assert.deepEqual(got, cache);
  });

  it("creates the base directory if it does not exist", () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    saveCache(nested, { "x": { image: false, audio: false, video: false, source: "unknown" as const, detectedAt: 1 } });
    assert.ok(fs.existsSync(path.join(nested, "model-capabilities.json")));
  });

  it("loadCache gracefully recovers from corrupted JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "model-capabilities.json"), "{ this is not valid json", "utf-8");
    const got = loadCache(tmpDir);
    assert.deepEqual(got, {});
  });

  it("loadCache gracefully recovers from non-object JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "model-capabilities.json"), "42", "utf-8");
    const got = loadCache(tmpDir);
    assert.deepEqual(got, {});
  });

  it("listCached returns a snapshot of the cache", () => {
    recordAndClassify(tmpDir, "gpt-4o");
    recordAndClassify(tmpDir, "gemini-1.5-pro");
    const snapshot = listCached(tmpDir);
    assert.equal(Object.keys(snapshot).length, 2);
  });
});

/* ── invalidateModel / clearCache ──────────────────────────── */

describe("invalidateModel / clearCache", () => {
  it("invalidateModel removes a specific entry and returns true", () => {
    recordAndClassify(tmpDir, "gpt-4o");
    recordAndClassify(tmpDir, "deepseek-chat");
    const ok = invalidateModel(tmpDir, "gpt-4o");
    assert.equal(ok, true);
    const cache = loadCache(tmpDir);
    assert.ok(!cache["gpt-4o"]);
    assert.ok(cache["deepseek-chat"]);
  });

  it("invalidateModel returns false when the model is not in the cache", () => {
    const ok = invalidateModel(tmpDir, "never-cached-model");
    assert.equal(ok, false);
  });

  it("after invalidation, the next recordAndClassify re-records as static", () => {
    recordAndClassify(tmpDir, "gpt-4o");
    invalidateModel(tmpDir, "gpt-4o");
    const c = recordAndClassify(tmpDir, "gpt-4o");
    assert.equal(c.source, "static");
  });

  it("clearCache removes everything", () => {
    recordAndClassify(tmpDir, "gpt-4o");
    recordAndClassify(tmpDir, "claude-3-opus");
    recordAndClassify(tmpDir, "gemini-2.5-pro");
    clearCache(tmpDir);
    const cache = loadCache(tmpDir);
    assert.deepEqual(cache, {});
  });
});

/* ── Integration: gating logic used by tools/index.ts ──────── */

describe("integration — multimodal gating decision", () => {
  it("gpt-4o with enabled config: isMultimodalCapable === true", () => {
    const model = resolveCurrentModel({ llm: { model: "gpt-4o" } });
    const caps = recordAndClassify(tmpDir, model);
    assert.equal(isMultimodalCapable(caps), true);
  });

  it("deepseek-chat with enabled config: isMultimodalCapable === false", () => {
    const model = resolveCurrentModel({ llm: { model: "deepseek-chat" } });
    const caps = recordAndClassify(tmpDir, model);
    assert.equal(isMultimodalCapable(caps), false);
  });

  it("unknown model: gating rejects by default (conservative)", () => {
    const model = resolveCurrentModel({ llm: { model: "totally-fake-model-zzz" } });
    const caps = recordAndClassify(tmpDir, model);
    assert.equal(caps.source, "unknown");
    assert.equal(isMultimodalCapable(caps), false);
  });

  it("switching from text-only model to multimodal model: cache invalidation works", () => {
    let caps = recordAndClassify(tmpDir, "deepseek-chat");
    assert.equal(isMultimodalCapable(caps), false);
    invalidateModel(tmpDir, "deepseek-chat");
    caps = recordAndClassify(tmpDir, "gpt-4o");
    assert.equal(isMultimodalCapable(caps), true);
    assert.equal(caps.source, "static");
  });
});
