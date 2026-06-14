/**
 * Regression test for hooks/recall-postprocess.ts
 *
 * The confidence gate used to call
 *   scoreConfidenceSupport(userText, userText)
 * which always returned score = 1.0 (self-similarity), so the
 * threshold check was dead code. The fix passes the actual
 * retrieved memory snippets as the candidate text.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { doPostProcess } from "../hooks/recall-postprocess.ts";
import { SimpleLRU } from "../utils/simple-lru.ts";
import { RetrievalStatsCollector } from "../utils/retrieval-stats.ts";
import type { SearchResult } from "../utils/db-bridge.ts";
import type { PostProcessConfig } from "../hooks/recall-postprocess.ts";

function makeConfig(overrides: Partial<PostProcessConfig> = {}): PostProcessConfig {
  return {
    cacheTTL: 30000,
    maxCacheSize: 50,
    halfLife: 30,
    jaccardBase: 0.75,
    jaccardMin: 0.5,
    maxSessions: 1000,
    maxContextKeywords: 20,
    maxResults: 3,
    decayMode: "weibull",
    position: "append",
    timeoutMs: 800,
    excludeRecentMS: 0,
    minResults: 0,
    maxChars: 1200,
    scoreThreshold: 0.5,
    queryPrefix: "",
    perAgentOverrides: {},
    enableRecallFilter: false,
    recallFilterBaseUrl: "",
    recallFilterApiKey: "",
    recallFilterModel: "",
    recallFilterTimeoutMs: 30000,
    recallFilterRetries: 1,
    recallFilterCandidateLimit: 30,
    recallFilterMaxItemChars: 500,
    recallFilterFailOpen: true,
    maxContextChars: 1200,
    enableIntentDriven: false,
    enableMmr: false,
    mmrLambda: 0.7,
    fadeMemAccessFactor: 0.3,
    rejectThreshold: 0.15,
    enableFourSignal: false,
    ...overrides,
  };
}

function makeResults(snippets: string[]): SearchResult[] {
  return snippets.map((s, i) => ({
    id: i + 1,
    filename: "memory-" + (i + 1) + ".md",
    snippet: s,
    score: 0.9 - i * 0.1,
    date: "2026-06-14",
    asst_text: s,
  }));
}

describe("doPostProcess — confidence gate uses retrieved memories", () => {
  const silentLogger = { debug: () => {}, error: () => {} };

  // v1.8.x: Repeat-query detection requires a query that passes the
  // confidence gate so the function reaches the recordRecentQuery call.
  // Use a query that mirrors the memory text almost exactly.
  function makeSupportedSetup(query: string) {
    const results = makeResults([
      `${query} — alpha detail line`,
      `${query} — beta detail line`,
      `${query} — gamma detail line`,
    ]);
    const cfg = makeConfig({ scoreThreshold: 0.2, maxResults: 3 });
    const cache = new SimpleLRU<string, SearchResult[]>({ maxSize: 50 });
    const stats = new RetrievalStatsCollector();
    return { results, cfg, cache, stats };
  }

  it("rejects when retrieved memories do not support the query (regression: scoreConfidenceSupport(userText, userText) gave 1.0)", async () => {
    const results = makeResults([
      "yesterday we tuned the postgres connection pool",
      "the database migration ran without errors",
      "index rebuild completed in 12 minutes",
    ]);
    const cfg = makeConfig({ scoreThreshold: 0.5 });
    const cache = new SimpleLRU<string, SearchResult[]>({ maxSize: 50 });
    const stats = new RetrievalStatsCollector();

    const out = await doPostProcess(
      results,
      "fts",
      "what is the weather in Tokyo today",
      cfg,
      undefined,
      undefined,
      undefined,
      cache,
      stats,
      Date.now(),
      undefined,
      "session-x",
      silentLogger,
      undefined, // db
      [], // recentQueries
    );

    assert.strictEqual(out, undefined, "should reject unrelated memories via confidence gate");
  });

  it("mutates the caller-supplied recentQueries array (regression: array was local, repeat detection was dead code)", async () => {
    const { results, cfg, cache, stats } = makeSupportedSetup("we tuned the postgres connection pool yesterday");
    const recentQueries: Array<{ query: string; maxResults: number; minScore: number; hitCount: number }> = [];

    const out1 = await doPostProcess(
      results, "fts", "we tuned the postgres connection pool yesterday",
      cfg, undefined, undefined, undefined,
      cache, stats, Date.now(), undefined, "session-y", silentLogger,
      undefined, recentQueries,
    );
    assert.ok(out1, "first call should return a hook result when memories support the query");
    assert.strictEqual(recentQueries.length, 1, "recentQueries must be mutated to record the first query");
    assert.strictEqual(recentQueries[0].query, "we tuned the postgres connection pool yesterday");

    // Second identical call: the array still holds the first query, so
    // checkRepeatQuery inside doPostProcess will surface a repeat note.
    const out2 = await doPostProcess(
      results, "fts", "we tuned the postgres connection pool yesterday",
      cfg, undefined, undefined, undefined,
      cache, stats, Date.now(), undefined, "session-y", silentLogger,
      undefined, recentQueries,
    );
    assert.ok(out2, "second call should still return a hook result");
    assert.strictEqual(recentQueries.length, 1, "dedup keeps the array at length 1 on repeat");
  });

  it("keeps repeat detection isolated between unrelated queries", async () => {
    const { results, cfg, cache, stats } = makeSupportedSetup("we tuned the postgres connection pool yesterday");
    const recentQueries: Array<{ query: string; maxResults: number; minScore: number; hitCount: number }> = [];

    await doPostProcess(
      results, "fts", "we tuned the postgres connection pool yesterday",
      cfg, undefined, undefined, undefined,
      cache, stats, Date.now(), undefined, "session-z", silentLogger,
      undefined, recentQueries,
    );
    assert.strictEqual(recentQueries.length, 1);

    // Different query with different maxResults — should be a fresh entry,
    // not flagged as a repeat of the first.
    const cfg2 = makeConfig({ scoreThreshold: 0.2, maxResults: 2 });
    await doPostProcess(
      results, "fts", "we tuned the postgres connection pool yesterday",
      cfg2, undefined, undefined, undefined,
      cache, stats, Date.now(), undefined, "session-z", silentLogger,
      undefined, recentQueries,
    );
    assert.strictEqual(recentQueries.length, 2, "different maxResults should add a fresh entry");
  });
});
