/**
 * Tests for identity-addressing.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  extractIdentityCandidates,
  extractIdentityValues,
  classifyIdentityMemory,
} from "../utils/identity-addressing.ts";

describe("extractIdentityCandidates", () => {
  it("extracts Chinese name", () => {
    const candidates = extractIdentityCandidates("我叫张三");
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].kind, "name");
    assert.strictEqual(candidates[0].value, "张三");
  });

  it("extracts addressing preference", () => {
    const candidates = extractIdentityCandidates("以后你叫我老王");
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].kind, "addressing");
    assert.strictEqual(candidates[0].value, "老王");
  });

  it("extracts both name and addressing", () => {
    const candidates = extractIdentityCandidates("我叫张三，以后你叫我老张");
    assert.strictEqual(candidates.length, 2);
    assert.strictEqual(candidates[0].kind, "name");
    assert.strictEqual(candidates[0].value, "张三");
    assert.strictEqual(candidates[1].kind, "addressing");
    assert.strictEqual(candidates[1].value, "老张");
  });

  it("handles empty text", () => {
    const candidates = extractIdentityCandidates("");
    assert.strictEqual(candidates.length, 0);
  });
});

describe("extractIdentityValues", () => {
  it("extracts name", () => {
    const values = extractIdentityValues("My name is 'Alice'");
    assert.strictEqual(values.name, "Alice");
  });

  it("extracts addressing", () => {
    const values = extractIdentityValues("Please call me Bob");
    assert.strictEqual(values.addressing, "Bob");
  });
});

describe("classifyIdentityMemory", () => {
  it("detects name hint", () => {
    const result = classifyIdentityMemory("姓名：李四\n其他信息");
    assert.strictEqual(result.hasName, true);
    assert.strictEqual(result.name, "李四");
  });

  it("detects addressing hint", () => {
    const result = classifyIdentityMemory("称呼偏好：小李\n其他信息");
    assert.strictEqual(result.hasAddressing, true);
    assert.strictEqual(result.addressing, "小李");
  });

  it("returns false for unrelated text", () => {
    const result = classifyIdentityMemory("今天天气不错");
    assert.strictEqual(result.hasName, false);
    assert.strictEqual(result.hasAddressing, false);
  });
});
