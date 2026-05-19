import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createRelation,
  addRelation,
  getRelatedMemories,
  initGraphStore,
} from "../core/graph/mutators.ts";

describe("graph relations", () => {
  it("creates a relation with clamped strength", () => {
    const r = createRelation("mem-1", "mem-2", "related", 1.5);
    assert.strictEqual(r.strength, 1);
    assert.strictEqual(r.sourceId, "mem-1");
    assert.strictEqual(r.targetId, "mem-2");
    assert.strictEqual(r.type, "related");
  });

  it("finds 1-hop related memories", () => {
    const store = initGraphStore();
    store.addRelation(createRelation("a", "b", "related", 0.8));
    store.addRelation(createRelation("b", "c", "related", 0.8));

    const related = getRelatedMemories("a", 1, 0.3);
    assert.ok(related.includes("b"));
    assert.ok(!related.includes("c")); // 2-hop, maxDepth=1
  });

  it("finds 2-hop related memories", () => {
    const store = initGraphStore();
    store.addRelation(createRelation("a", "b", "related", 0.8));
    store.addRelation(createRelation("b", "c", "related", 0.8));

    const related = getRelatedMemories("a", 2, 0.3);
    assert.ok(related.includes("b"));
    assert.ok(related.includes("c"));
  });

  it("filters by minimum strength", () => {
    const store = initGraphStore();
    store.addRelation(createRelation("a", "weak", "related", 0.2));
    store.addRelation(createRelation("a", "strong", "related", 0.9));

    const related = getRelatedMemories("a", 1, 0.5);
    assert.ok(related.includes("strong"));
    assert.ok(!related.includes("weak"));
  });
});
