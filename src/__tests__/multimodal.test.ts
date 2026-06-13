import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { MultimodalStorage, sha256OfBytes, newMultimodalId } from "../features/multimodal/storage.ts";
import { MultimodalProcessor } from "../features/multimodal/processor.ts";
import { createMultimodalTool } from "../features/multimodal/tool.ts";
import type { MultimodalMemory } from "../features/multimodal/types.ts";

let tmpDir: string;
let store: MultimodalStorage;
let proc: MultimodalProcessor;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-mm-"));
  store = new MultimodalStorage(tmpDir);
  proc = new MultimodalProcessor(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<MultimodalMemory> = {}): MultimodalMemory {
  const now = Date.now();
  return {
    id: "mm_test1",
    type: "image",
    description: "test image",
    tags: ["a", "b"],
    mimeType: "image/png",
    sizeBytes: 100,
    sourceType: "url",
    sourceRef: "https://example.com/x.png",
    sha256: "deadbeef",
    metadata: {},
    linkedMemoryIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("multimodal/storage", () => {
  it("upsert + get roundtrip", () => {
    const e = makeEntry();
    store.upsert(e);
    const got = store.get(e.id);
    assert.deepStrictEqual(got, e);
  });

  it("upsert twice updates in place", () => {
    const e = makeEntry();
    store.upsert(e);
    const e2 = { ...e, description: "v2" };
    store.upsert(e2);
    const got = store.get(e.id);
    assert.strictEqual(got.description, "v2");
    assert.strictEqual(store.list().total, 1);
  });

  it("list filter by type", () => {
    store.upsert(makeEntry({ id: "a", type: "image" }));
    store.upsert(makeEntry({ id: "b", type: "audio" }));
    const r = store.list({ type: "audio" });
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.items[0].id, "b");
  });

  it("list filter by tags", () => {
    store.upsert(makeEntry({ id: "a", tags: ["k", "v"] }));
    store.upsert(makeEntry({ id: "b", tags: ["other"] }));
    const r = store.list({ tags: ["k"] });
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.items[0].id, "a");
  });

  it("list sort by createdAt desc", () => {
    const now = Date.now();
    store.upsert(makeEntry({ id: "a", createdAt: now - 1000, updatedAt: now - 1000 }));
    store.upsert(makeEntry({ id: "b", createdAt: now, updatedAt: now }));
    const r = store.list();
    assert.strictEqual(r.items[0].id, "b");
  });

  it("list pagination", () => {
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      store.upsert(makeEntry({ id: "mm_" + i, createdAt: base + i, updatedAt: base + i }));
    }
    const r1 = store.list({ limit: 2, offset: 0 });
    assert.strictEqual(r1.items.length, 2);
    assert.strictEqual(r1.total, 5);
    const r2 = store.list({ limit: 2, offset: 2 });
    assert.strictEqual(r2.items.length, 2);
  });

  it("linkMemory adds id once (idempotent)", () => {
    const e = makeEntry();
    store.upsert(e);
    assert.strictEqual(store.linkMemory(e.id, "mem-1"), true);
    assert.strictEqual(store.linkMemory(e.id, "mem-1"), true);
    assert.strictEqual(store.linkMemory(e.id, "mem-2"), true);
    const got = store.get(e.id);
    assert.deepStrictEqual(got.linkedMemoryIds, ["mem-1", "mem-2"]);
  });

  it("linkMemory returns false on missing id", () => {
    assert.strictEqual(store.linkMemory("nope", "mem-1"), false);
  });

  it("remove deletes index entry", () => {
    store.upsert(makeEntry({ id: "x" }));
    assert.strictEqual(store.remove("x", "png"), true);
    assert.strictEqual(store.get("x"), null);
    assert.strictEqual(store.list().total, 0);
  });

  it("remove returns false on missing id", () => {
    assert.strictEqual(store.remove("nope", "png"), false);
  });

  it("sha256OfBytes is deterministic + hex", () => {
    const h1 = sha256OfBytes(Buffer.from("hello"));
    const h2 = sha256OfBytes(Buffer.from("hello"));
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64);
    assert.match(h1, /^[a-f0-9]+$/);
  });

  it("newMultimodalId has expected prefix", () => {
    const id = newMultimodalId();
    assert.ok(id.startsWith("mm_"));
    assert.ok(id.length > 10);
  });

  it("saveContent writes binary to disk", () => {
    const r = store.saveContent("mm_a", "png", Buffer.from([1, 2, 3]));
    assert.strictEqual(r.sizeBytes, 3);
    assert.ok(fs.existsSync(r.contentPath));
    assert.match(r.contentPath, /content[\\/]mm_a\.png$/);
  });

  it("saveIndex is atomic (loadIndex returns written value)", () => {
    store.saveIndex([makeEntry({ id: "atom1" })]);
    const idx = store.loadIndex();
    assert.strictEqual(idx.length, 1);
    assert.strictEqual(idx[0].id, "atom1");
  });
});

describe("multimodal/processor", () => {
  it("save with sourceType=url", () => {
    const r = proc.save({
      type: "image",
      description: "logo",
      sourceType: "url",
      source: "https://example.com/logo.png",
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entry.type, "image");
    assert.strictEqual(r.entry.sourceRef, "https://example.com/logo.png");
    assert.strictEqual(r.entry.sizeBytes, "https://example.com/logo.png".length);
    assert.strictEqual(r.entry.sha256.length, 64);
  });

  it("save with sourceType=base64 writes binary to disk", () => {
    const data = Buffer.from("hello world");
    const r = proc.save({
      type: "image",
      description: "inline",
      sourceType: "base64",
      source: data.toString("base64"),
    });
    assert.strictEqual(r.ok, true);
    assert.ok(fs.existsSync(r.entry.sourceRef));
    assert.strictEqual(r.entry.sizeBytes, data.length);
    const back = fs.readFileSync(r.entry.sourceRef);
    assert.strictEqual(back.toString("utf-8"), "hello world");
  });

  it("save with sourceType=path (file exists)", () => {
    const file = path.join(tmpDir, "src.png");
    fs.writeFileSync(file, Buffer.from("PNGDATA"));
    const r = proc.save({
      type: "image",
      description: "from path",
      sourceType: "path",
      source: file,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entry.sizeBytes, 7);
  });

  it("save with sourceType=path (file missing) fails gracefully", () => {
    const r = proc.save({
      type: "image",
      description: "ghost",
      sourceType: "path",
      source: path.join(tmpDir, "nope.png"),
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /cannot access path/);
  });

  it("save rejects too-large base64", () => {
    const big = Buffer.alloc(2 * 1024 * 1024).toString("base64");
    const r = proc.save({
      type: "image",
      description: "too big",
      sourceType: "base64",
      source: big,
    }, 1);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /too large/);
  });

  it("save respects custom id", () => {
    const r = proc.save({
      type: "image",
      description: "custom",
      sourceType: "url",
      source: "https://e.com/a.png",
      id: "mm_myid",
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entry.id, "mm_myid");
  });

  it("save infers mime from type when not given", () => {
    const r = proc.save({ type: "video", description: "v", sourceType: "url", source: "https://e.com/v.mp4" });
    assert.strictEqual(r.entry.mimeType, "video/mp4");
  });

  it("save respects explicit mime override", () => {
    const r = proc.save({ type: "image", description: "i", sourceType: "url", source: "https://e.com/x", mimeType: "image/webp" });
    assert.strictEqual(r.entry.mimeType, "image/webp");
  });

  it("save attaches tags + metadata + extractedText", () => {
    const r = proc.save({
      type: "image", description: "d", sourceType: "url", source: "https://e.com/x",
      tags: ["t1"], metadata: { k: 1 }, extractedText: "ocr text",
    });
    assert.deepStrictEqual(r.entry.tags, ["t1"]);
    assert.deepStrictEqual(r.entry.metadata, { k: 1 });
    assert.strictEqual(r.entry.extractedText, "ocr text");
  });

  it("get returns null for missing", () => {
    assert.strictEqual(proc.get("nope"), null);
  });

  it("list returns paginated items + total", () => {
    for (let i = 0; i < 3; i++) {
      proc.save({ type: "image", description: "i" + i, sourceType: "url", source: "https://e.com/" + i });
    }
    const r = proc.list({ limit: 2 });
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.items.length, 2);
  });

  it("search by query (substring + score)", () => {
    proc.save({ type: "image", description: "cat photo", sourceType: "url", source: "https://e.com/1" });
    proc.save({ type: "image", description: "dog photo", sourceType: "url", source: "https://e.com/2" });
    proc.save({ type: "audio", description: "music", sourceType: "url", source: "https://e.com/3" });
    const r = proc.search("photo");
    assert.strictEqual(r.length, 2);
    assert.ok(r.every(x => typeof x.snippet === "string" && x.snippet.includes("photo")));
    assert.ok(r.every(x => x.score > 0));
  });

  it("search empty query returns []", () => {
    proc.save({ type: "image", description: "x", sourceType: "url", source: "https://e.com/1" });
    assert.deepStrictEqual(proc.search(""), []);
    assert.deepStrictEqual(proc.search("   "), []);
  });

  it("search multi-token scoring ranks best first", () => {
    proc.save({ type: "image", description: "red car", sourceType: "url", source: "https://e.com/1" });
    proc.save({ type: "image", description: "red bike", sourceType: "url", source: "https://e.com/2" });
    proc.save({ type: "image", description: "blue car", sourceType: "url", source: "https://e.com/3" });
    const r = proc.search("red car");
    assert.strictEqual(r[0].description, "red car");
    assert.strictEqual(r[0].score, 1);
  });

  it("search with type filter", () => {
    proc.save({ type: "image", description: "same", sourceType: "url", source: "https://e.com/1" });
    proc.save({ type: "audio", description: "same", sourceType: "url", source: "https://e.com/2" });
    const r = proc.search("same", { type: "audio" });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].type, "audio");
  });

  it("search respects limit", () => {
    for (let i = 0; i < 5; i++) {
      proc.save({ type: "image", description: "common " + i, sourceType: "url", source: "https://e.com/" + i });
    }
    const r = proc.search("common", { limit: 2 });
    assert.strictEqual(r.length, 2);
  });

  it("link connects mm entry to memory id", () => {
    const r = proc.save({ type: "image", description: "d", sourceType: "url", source: "https://e.com/x" });
    assert.strictEqual(proc.link(r.entry.id, "mem-42"), true);
    const got = proc.get(r.entry.id);
    assert.ok(got.linkedMemoryIds.includes("mem-42"));
  });

  it("link returns false on missing mm id", () => {
    assert.strictEqual(proc.link("nope", "mem-1"), false);
  });

  it("delete removes entry and binary", () => {
    const r = proc.save({ type: "image", description: "d", sourceType: "base64", source: Buffer.from("x").toString("base64") });
    assert.ok(fs.existsSync(r.entry.sourceRef));
    assert.strictEqual(proc.delete(r.entry.id), true);
    assert.strictEqual(proc.get(r.entry.id), null);
    assert.strictEqual(fs.existsSync(r.entry.sourceRef), false);
  });

  it("delete returns false for missing", () => {
    assert.strictEqual(proc.delete("nope"), false);
  });

  it("formatEntry returns readable text", () => {
    const r = proc.save({ type: "image", description: "logo", sourceType: "url", source: "https://e.com/logo.png", tags: ["brand"] });
    const s = proc.formatEntry(r.entry);
    assert.match(s, /\[image\]/);
    assert.match(s, /logo/);
    assert.match(s, /brand/);
    assert.match(s, /SHA-256/);
  });

  it("formatEntry includes snippet when provided", () => {
    const r = proc.save({ type: "image", description: "abc", sourceType: "url", source: "https://e.com/x" });
    const s = proc.formatEntry(r.entry, "...abc...");
    assert.match(s, /片段:/);
  });

  it("formatEntry includes extractedText", () => {
    const r = proc.save({ type: "image", description: "x", sourceType: "url", source: "https://e.com/y", extractedText: "extracted OCR content" });
    const s = proc.formatEntry(r.entry);
    assert.match(s, /extracted OCR content/);
  });
});

describe("multimodal/tool", () => {
  const make = (cfg: { storageDir?: string; maxFileSizeMb?: number } = {}) =>
    createMultimodalTool({ storageDir: tmpDir, maxFileSizeMb: 50, ...cfg });

  const exec = async (tool: ReturnType<typeof make>, params: Record<string, unknown>) => {
    const r = await tool.execute("ctx", params);
    return (r as { content: Array<{ type: string; text: string }> }).content[0].text;
  };

  it("default config returns valid tool registration", () => {
    const t = createMultimodalTool({});
    assert.strictEqual(t.id, "memory_multimodal");
    assert.strictEqual(t.name, "memory_multimodal");
    assert.match(t.description, /多模态记忆/);
    assert.deepStrictEqual(t.parameters.required, ["action"]);
  });

  it("save action writes a record", async () => {
    const t = make();
    const out = await exec(t, {
      action: "save", type: "image", description: "hello",
      sourceType: "url", source: "https://e.com/x.png",
      tags: ["t1"], mimeType: "image/png",
    });
    assert.match(out, /已保存/);
    assert.match(out, /hello/);
  });

  it("save rejects invalid type", async () => {
    const t = make();
    const out = await exec(t, {
      action: "save", type: "doc", description: "x",
      sourceType: "url", source: "https://e.com/x",
    });
    assert.match(out, /type 必须/);
  });

  it("save rejects missing description", async () => {
    const t = make();
    const out = await exec(t, {
      action: "save", type: "image", description: "",
      sourceType: "url", source: "https://e.com/x",
    });
    assert.match(out, /description 不能为空/);
  });

  it("save rejects invalid sourceType", async () => {
    const t = make();
    const out = await exec(t, {
      action: "save", type: "image", description: "x",
      sourceType: "ftp", source: "ftp://e.com/x",
    });
    assert.match(out, /sourceType 必须/);
  });

  it("save rejects missing source", async () => {
    const t = make();
    const out = await exec(t, {
      action: "save", type: "image", description: "x",
      sourceType: "url", source: "",
    });
    assert.match(out, /source 不能为空/);
  });

  it("get returns entry by id", async () => {
    const t = make();
    const saveOut = await exec(t, {
      action: "save", type: "image", description: "x",
      sourceType: "url", source: "https://e.com/x",
    });
    const id = saveOut.match(/mm_[a-f0-9]+/)![0];
    const out = await exec(t, { action: "get", id });
    assert.match(out, /\[image\]/);
    assert.match(out, new RegExp(id));
  });

  it("get rejects missing id", async () => {
    const t = make();
    const out = await exec(t, { action: "get", id: "" });
    assert.match(out, /id 必填/);
  });

  it("get returns not-found", async () => {
    const t = make();
    const out = await exec(t, { action: "get", id: "mm_missing" });
    assert.match(out, /未找到/);
  });

  it("list returns formatted entries", async () => {
    const t = make();
    await exec(t, { action: "save", type: "image", description: "a", sourceType: "url", source: "https://e.com/a" });
    await exec(t, { action: "save", type: "audio", description: "b", sourceType: "url", source: "https://e.com/b" });
    const out = await exec(t, { action: "list" });
    assert.match(out, /共 2 条/);
  });

  it("list with type filter", async () => {
    const t = make();
    await exec(t, { action: "save", type: "image", description: "a", sourceType: "url", source: "https://e.com/a" });
    await exec(t, { action: "save", type: "audio", description: "b", sourceType: "url", source: "https://e.com/b" });
    const out = await exec(t, { action: "list", type: "image" });
    assert.match(out, /共 1 条/);
  });

  it("list with tags filter", async () => {
    const t = make();
    await exec(t, { action: "save", type: "image", description: "a", sourceType: "url", source: "https://e.com/a", tags: ["red"] });
    await exec(t, { action: "save", type: "image", description: "b", sourceType: "url", source: "https://e.com/b", tags: ["blue"] });
    const out = await exec(t, { action: "list", tags: ["red"] });
    assert.match(out, /共 1 条/);
  });

  it("list empty", async () => {
    const t = make();
    const out = await exec(t, { action: "list" });
    assert.match(out, /0 条/);
  });

  it("search finds matching entries", async () => {
    const t = make();
    await exec(t, { action: "save", type: "image", description: "red apple", sourceType: "url", source: "https://e.com/a" });
    await exec(t, { action: "save", type: "image", description: "green pear", sourceType: "url", source: "https://e.com/b" });
    const out = await exec(t, { action: "search", description: "apple" });
    assert.match(out, /apple/);
    assert.match(out, /1 条/);
  });

  it("search no match", async () => {
    const t = make();
    await exec(t, { action: "save", type: "image", description: "red apple", sourceType: "url", source: "https://e.com/a" });
    const out = await exec(t, { action: "search", description: "banana" });
    assert.match(out, /没有匹配/);
  });

  it("search requires description", async () => {
    const t = make();
    const out = await exec(t, { action: "search" });
    assert.match(out, /必填/);
  });

  it("link connects mm to memory", async () => {
    const t = make();
    const saveOut = await exec(t, { action: "save", type: "image", description: "x", sourceType: "url", source: "https://e.com/x" });
    const id = saveOut.match(/mm_[a-f0-9]+/)![0];
    const out = await exec(t, { action: "link", id, memoryId: "mem-7" });
    assert.match(out, /已关联/);
  });

  it("link rejects missing fields", async () => {
    const t = make();
    const out = await exec(t, { action: "link", id: "", memoryId: "" });
    assert.match(out, /都必填/);
  });

  it("link fails on unknown id", async () => {
    const t = make();
    const out = await exec(t, { action: "link", id: "mm_nope", memoryId: "mem-7" });
    assert.match(out, /关联失败/);
  });

  it("delete removes entry", async () => {
    const t = make();
    const saveOut = await exec(t, { action: "save", type: "image", description: "x", sourceType: "url", source: "https://e.com/x" });
    const id = saveOut.match(/mm_[a-f0-9]+/)![0];
    const out = await exec(t, { action: "delete", id });
    assert.match(out, /已删除/);
    const getOut = await exec(t, { action: "get", id });
    assert.match(getOut, /未找到/);
  });

  it("delete fails on unknown id", async () => {
    const t = make();
    const out = await exec(t, { action: "delete", id: "mm_nope" });
    assert.match(out, /删除失败/);
  });

  it("invalid action is rejected", async () => {
    const t = make();
    const out = await exec(t, { action: "wat" });
    assert.match(out, /无效 action/);
  });

  it("search accepts 'query' as alias for 'description'", async () => {
    const t = make();
    await exec(t, { action: "save", type: "image", description: "rainbow", sourceType: "url", source: "https://e.com/x" });
    const out = await exec(t, { action: "search", query: "rainbow" });
    assert.match(out, /rainbow/);
  });
});
