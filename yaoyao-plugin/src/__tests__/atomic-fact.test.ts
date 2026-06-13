import { describe, it } from "node:test";
import assert from "node:assert";
import { extractAtomicFacts } from "../core/atomic/extract.ts";
import { saveFact, findFactsByEntity, getAllFacts } from "../core/atomic/store.ts";
import { queryFacts } from "../core/atomic/query.ts";

describe("atomic fact extraction", () => {
  it("extracts facts from simple sentences (regex mode)", () => {
    const result = extractAtomicFacts("I like coffee. I use VS Code.", "regex");
    assert.ok(result.facts.length > 0);
    assert.ok(result.entities.length > 0);
  });

  it("returns empty for meaningless text", () => {
    const result = extractAtomicFacts("uh huh ok", "regex");
    assert.strictEqual(result.facts.length, 0);
    assert.ok(result.discarded > 0);
  });

  it("saves and retrieves facts by entity", () => {
    const fact = {
      id: "test-1",
      subject: "user",
      predicate: "likes",
      object: "coffee",
      confidence: 0.9,
      source: "test",
      timestamp: Date.now(),
      tags: ["preference"],
    };
    saveFact(fact);

    const bySubject = findFactsByEntity("user");
    assert.ok(bySubject.length > 0);
    assert.strictEqual(bySubject[0].subject, "user");
  });

  it("queries facts by keywords", () => {
    const facts = getAllFacts();
    if (facts.length > 0) {
      const query = facts[0].subject;
      const results = queryFacts(query);
      assert.ok(results.length > 0);
    }
  });
});
