import { describe, it } from "node:test";
import assert from "node:assert";
import { isMMDBlock } from "../utils/mmd-filter.ts";

describe("mmd-filter", () => {
  it("detects graph TD block", () => {
    const text = `graph TD\nA[Start] --> B{Decision}\nB -->|Yes| C[End]\nB -->|No| D[Retry]`;
    assert.strictEqual(isMMDBlock(text), true);
  });

  it("detects flowchart LR block", () => {
    assert.strictEqual(isMMDBlock("flowchart LR\nA --> B\nB --> C"), true);
  });

  it("detects sequenceDiagram", () => {
    assert.strictEqual(isMMDBlock("sequenceDiagram\nAlice->>Bob: Hello"), true);
  });

  it("detects %% mermaid directive", () => {
    assert.strictEqual(isMMDBlock("%% mermaid\ngraph TD\nA --> B"), true);
  });

  it("detects high edge density", () => {
    const text = "A --> B\nB --> C\nC --> D\nD --> E";
    assert.strictEqual(isMMDBlock(text), true);
  });

  it("rejects normal conversation", () => {
    assert.strictEqual(isMMDBlock("Hello, how are you today?"), false);
  });

  it("rejects short text", () => {
    assert.strictEqual(isMMDBlock("A --> B"), false);
  });

  it("rejects edge density below threshold", () => {
    assert.strictEqual(isMMDBlock("A --> B\nB --> C\nsome other text here"), false);
  });
});
