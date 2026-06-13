/**
 * hooks/recall-scoring.ts — Recall scoring utilities.
 *
 * Pure functions: time decay, diversity sampling (Jaccard + MMR),
 * length normalization, importance weighting, scope filtering.
 *
 * v1.8.0: Added MMR re-ranking (Maximal Marginal Relevance).
 */
import type { SearchResult } from "../storage/types.ts";

/** Jaccard similarity between two strings (word-based) */
export function jaccard(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Maximal Marginal Relevance (MMR) re-ranking.
 *
 * Balances relevance with diversity. Uses Jaccard similarity on snippet
 * text as the diversity metric (no vector embeddings needed at recall time).
 *
 * MMR = λ · score(q,d) - (1-λ) · max_j(Jaccard(d, d_j_selected))
 *
 * Local memory system uses λ=0.7 as default.
 * When λ=1.0, behaves like standard top-K (no diversity).
 * When λ=0.5, equal weight on relevance and diversity.
 */
export function applyMmrDiversity(
  results: SearchResult[],
  lambda: number = 0.7,
  topK: number | undefined = undefined,
): SearchResult[] {
  if (results.length <= 1) return results;
  const k = topK ?? results.length;

  const selected: SearchResult[] = [];
  const remaining = [...results];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      // Relevance to query = candidate score (already normalized from pipeline)
      const relevance = cand.score;

      // Diversity penalty: max Jaccard similarity to any selected item
      let maxSimToSelected = 0;
      if (selected.length > 0) {
        for (const sel of selected) {
          const sim = jaccard(cand.snippet, sel.snippet);
          if (sim > maxSimToSelected) maxSimToSelected = sim;
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;
      if (mmrScore > bestMmr) {
        bestMmr = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

/** Diversity sampling: keep results that differ from each other (original greedy method) */
export function applyDiversitySampling(
  results: SearchResult[],
  baseThreshold: number,
  minThreshold: number,
): SearchResult[] {
  if (results.length <= 1) return results;
  const out: SearchResult[] = [results[0]];
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    let maxSim = 0;
    for (const o of out) {
      const sim = jaccard(r.snippet, o.snippet);
      if (sim > maxSim) maxSim = sim;
    }
    const threshold = Math.max(minThreshold, baseThreshold - (out.length * 0.02));
    if (maxSim < threshold) out.push(r);
  }
  return out;
}

/** Apply time decay (weibull exponential or logistic) */
export function applyTimeDecay(
  results: SearchResult[],
  halfLifeDays: number,
  mode: "weibull" | "logistic",
): SearchResult[] {
  const now = Date.now();
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  return results.map((r) => {
    const ageMs = now - (r.timestamp || now);
    let decay: number;
    if (mode === "logistic") {
      const k = 10 / halfLifeMs;
      const t0 = halfLifeMs;
      decay = 1 / (1 + Math.exp(k * (ageMs - t0)));
    } else {
      const lambda = Math.log(2) / halfLifeMs;
      decay = Math.exp(-lambda * ageMs);
    }
    return { ...r, score: r.score * decay };
  });
}

/** Penalize very long snippets (prevents verbatim dumping) */
export function applyLengthNormalization(results: SearchResult[]): SearchResult[] {
  return results.map((r) => {
    const len = r.snippet?.length || 1;
    const norm = 1 + Math.log1p(len / 100);
    return { ...r, score: r.score / norm };
  });
}

/** Boost by importance weight (if available) */
export function applyImportanceWeighting(results: SearchResult[]): SearchResult[] {
  return results.map((r) => {
    const imp = r.importance ?? 0.5;
    return { ...r, score: r.score * (0.5 + imp) };
  });
}

/** Apply all scoring layers */
export function applyScoring(results: SearchResult[], _userMessage?: string): SearchResult[] {
  return applyImportanceWeighting(applyLengthNormalization(results));
}

/** Filter results by access scope */
export function filterByScope(
  results: SearchResult[],
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  agentId?: string,
): SearchResult[] {
  if (!scopeManager || !agentId) return results;
  const allowed = scopeManager.getScopes(agentId);
  return results.filter((r) => !r.scope || allowed.includes(r.scope));
}

/** Stopword set for query cleaning */
const STOPWORDS = new Set([
  "可以",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
  "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
  "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
  "those", "and", "or", "but", "if", "because", "when", "where", "how",
  "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
  "at", "by", "from", "as", "into", "not", "no", "yes",
]);

/** Filter stopwords from a word array */
export function filterStopwords(words: string[]): string[] {
  return words.filter((w) => !STOPWORDS.has(w) && w.length <= 50);
}
