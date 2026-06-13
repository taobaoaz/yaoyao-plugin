/**
 * Tests for cloud-adapter.ts — shell argument sanitizer.
 *
 * Run: node --experimental-strip-types --test src/__tests__/cloud-adapter.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { escShellArg } from "../utils/cloud-adapter.ts";

describe("escShellArg", () => {
  it("leaves safe strings unchanged", () => {
    assert.strictEqual(escShellArg("hello"), "hello");
    assert.strictEqual(escShellArg("user123"), "user123");
  });

  it("doubles double quotes", () => {
    assert.strictEqual(escShellArg('say "hi"'), 'say ""hi""');
  });

  it("strips shell metacharacters", () => {
    assert.strictEqual(escShellArg("a&b|c"), "abc");
    assert.strictEqual(escShellArg("a^b$c"), "abc");
    assert.strictEqual(escShellArg("a%b`c"), "abc");
    assert.strictEqual(escShellArg("a;b"), "ab");
  });

  it("handles empty string", () => {
    assert.strictEqual(escShellArg(""), "");
  });

  it("combines quotes and metacharacters", () => {
    assert.strictEqual(escShellArg('"evil&cmd"'), '""evilcmd""');
  });
});
