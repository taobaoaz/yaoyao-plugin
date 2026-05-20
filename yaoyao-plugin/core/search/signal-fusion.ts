/**
 * core/search/signal-fusion.ts — Multi-signal fusion core algorithm.
 *
 * Fuses BM25 + FTS5 rank + vector similarity + entity boost via RRF.
 * Pure logic, no formatting.
 */
import type { SearchResult, EmbeddedSearchResult } from "../../utils/db-bridge.ts";
import { scoreBM25, buildBM25Index, type BM25Index } from "./bm25.ts";
import { reciprocalRankFusion, type RankedDoc } from "./rrf.ts";
import { extractEntities, computeEntityBoost } from "./entity-extractor.ts";

export interface MultiSignalResult {
  id: number | string;
  snippet: string;
  date: string;
  score: number;
  signals: { bm25?: number; fts?: number; vector?: number; entityBoost?: number };
  filename: string;
  source: "bm25" | "fts" | "vector" | "hybrid";
}

export interface MultiSignalConfig {
  bm25Weight?: number;
  ftsWeight?: number;
  vectorWeight?: number;
  entityBoostMax?: number;
  rrfK?: number;
  temporalHalfLifeDays?: number;
}

const DEFAULT_CONFIG: Required<MultiSignalConfig> = {
  bm25Weight: 0.20,
  ftsWeight: 0.20,
  vectorWeight: 0.30,
  entityBoostMax: 0.30,
  rrfK: 60,
  temporalHalfLifeDays: 30,
};

function buildBM25FromResults(results: SearchResult[]): BM25Index {
  return buildBM25Index(results.map(r => r.snippet), results.map(r => String(r.id ?? "")));
}

function scoreWithBM25(index: BM25Index, query: string): Map<string, number> {
  const scored = scoreBM25(index, query);
  const maxScore = scored.length > 0 ? Math.max(...scored.map(s => s.score)) : 1;
  const map = new Map<string, number>();
  for (const s of scored) map.set(s.id, maxScore > 0 ? s.score / maxScore : 0);
  return map;
}

function computeTemporalWeight(timestamp: number | undefined, halfLifeDays: number): number {
  if (halfLifeDays <= 0 || !timestamp) return 1;
  const ageMs = Date.now() - timestamp;
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  return ageMs <= 0 ? 1 : Math.exp(-ageMs * Math.LN2 / halfLifeMs);
}

export function multiSignalFusion(
  query: string,
  ftsResults: SearchResult[],
  vecResults: EmbeddedSearchResult[],
  allResults: SearchResult[],
  config: MultiSignalConfig =: void {},
): MultiSignalResult[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (allResults.length === 0) return [];

  const queryEntities = extractEntities(query);
  const bm25Index = buildBM25FromResults(allResults);
  const bm25Scores = scoreWithBM25(bm25Index, query);

  // Build per-signal ranked lists
  const bm25Ranked: RankedDoc[] = [];
  const ftsRanked: RankedDoc[] = [];
  const vecRanked: RankedDoc[] = [];
  const idToEntityBoost = new Map<string | number, number>();
  const idToSnippet = new Map<string | number, string>();

  for (const [id, score] of bm25Scores) {
    bm25Ranked.push({ id, doc: { originalScore: score, source: "bm25" }, originalScore: score });
  }
  for (const r of ftsResults) {
    const id = r.id ?? r.snippet;
    ftsRanked.push({ id, doc: { ...r, originalScore: r.score, source: "fts" }, originalScore: r.score });
    idToSnippet.set(id, r.snippet);
  }
  for (const r of vecResults) {
    const id = r.id ?? r.snippet;
    vecRanked.push({ id, doc: { ...r, originalScore: r.hybridScore, source: "vec" }, originalScore: r.vectorScore });
    idToSnippet.set(id, r.snippet);
  }

  // Entity boosts
  const allIds = new Set<string | number>();
  for (const r of allResults) {
    const id = r.id ?? r.snippet;
    allIds.add(id);
    idToSnippet.set(id, r.snippet);
  }
  for (const id of allIds) {
    const snippet = idToSnippet.get(id) || "";
    idToEntityBoost.set(id, Math.min(1, computeEntityBoost(queryEntities, extractEntities(snippet))));
  }

  // RRF fusion
  const lists: RankedDoc[][] = [];
  if (bm25Ranked.length > 0) lists.push(bm25Ranked);
  if (ftsRanked.length > 0) lists.push(ftsRanked);
  if (vecRanked.length > 0) lists.push(vecRanked);

  let fused: Array<{ id: string | number; rrfScore: number; doc: Record<string, unknown> }>;
  if (lists.length <= 1) {
    const source = lists[0]?.[0]?.doc?.source ?? "fts";
    const signalWeight = source === "bm25" ? cfg.bm25Weight : source === "fts" ? cfg.ftsWeight : cfg.vectorWeight;
    const dedup = new Map<string | number, { doc: Record<string, unknown>; score: number }>();
    for (const list of lists) {
      for (const item of list) {
        const existing = dedup.get(item.id);
        const score = (item.originalScore ?? 0) * signalWeight;
        if (!existing || score > existing.score) dedup.set(item.id, { doc: item.doc, score });
      }
    }
    fused = Array.from(dedup.entries()).map(([id, val]) => ({ id, rrfScore: val.score, doc: val.doc }));
  } else {
    fused = reciprocalRankFusion(lists, cfg.rrfK);
  }

  // Final scoring with entity boost + temporal decay
  const maxRrfScore = fused.length > 0 ? Math.max(...fused.map(f => f.rrfScore)) : 1;
  const results: MultiSignalResult[] = [];

  for (const f of fused) {
    const doc = f.doc;
    const id = f.id;
    const snippet = String(doc.snippet ?? idToSnippet.get(id) ?? "");
    const entityBoost = idToEntityBoost.get(id) ?? 0;
    const boostMultiplier = 1 + entityBoost * cfg.entityBoostMax;
    const timestamp = Number(doc.timestamp ?? 0) || undefined;
    const temporalWeight = computeTemporalWeight(timestamp, cfg.temporalHalfLifeDays);
    const normalizedRrf = maxRrfScore > 0 ? f.rrfScore / maxRrfScore : 0;
    const finalScore = Math.min(1, normalizedRrf * boostMultiplier * temporalWeight);

    const signals: MultiSignalResult["signals"] = {};
    const idStr = String(id);
    if (bm25Scores.has(idStr)) signals.bm25 = bm25Scores.get(idStr);
    if (doc.source === "fts") signals.fts = Number(doc.originalScore ?? 0);
    if (doc.source === "vec") signals.vector = Number(doc.originalScore ?? 0);
    if (entityBoost > 0) signals.entityBoost = entityBoost;

    let source: MultiSignalResult["source"] = "hybrid";
    if (lists.length === 1) {
      const s = lists[0]?.[0]?.doc?.source;
      source = s === "bm25" ? "bm25" : s === "vec" ? "vector" : "fts";
    }

    results.push({
      id, snippet, date: String(doc.date ?? ""),
      score: finalScore, signals,
      filename: String(doc.filename ?? ""),
      source,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
