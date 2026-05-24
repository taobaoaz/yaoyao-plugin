/**
 * hooks/recall-filter.ts — Model-based secondary recall filter.
 *
 * Calls an external LLM to score relevance of candidate memories.
 * Extracted from auto-recall.ts to keep the orchestrator lean.
 */

import type { SearchResult } from "../utils/db-bridge.ts";
import type { RecallThresholds } from "./recall-config.ts";
import { globalFetch } from "../utils/fetch-helpers.ts";

export async function runRecallFilter(
  candidates: SearchResult[],
  query: string,
  cfg: RecallThresholds,
): Promise<SearchResult[]> {
  if (!cfg.enableRecallFilter || !cfg.recallFilterModel || !cfg.recallFilterBaseUrl) {
    return candidates;
  }
  if (candidates.length === 0) return candidates;

  try {
    const items = candidates.map((c, i) => `[${i}] ${(c.snippet || "").slice(0, cfg.recallFilterMaxItemChars)}`).join("\n");
    const prompt = `Given this user query: "${query.slice(0, 200)}"

Evaluate each memory item below. Respond with indices of items that are RELEVANT and USEFUL.
If none are relevant, respond with "[]".

Items:\n${items}\n\nRelevant indices: [`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.recallFilterTimeoutMs);
    let response: Response;
    try {
      response = await globalFetch(cfg.recallFilterBaseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.recallFilterApiKey ? { Authorization: `Bearer ${cfg.recallFilterApiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.recallFilterModel,
          messages: [
            { role: "system", content: "You are a relevance filter. Only keep items directly answering the query. Return indices as comma-separated numbers inside brackets." },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 128,
        }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      if (cfg.recallFilterFailOpen) return candidates;
      return [];
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data?.choices?.[0]?.message?.content || "";
    const indices: number[] = [];
    const match = text.match(/\[(.*?)\]/);
    const raw = match ? match[1] : text;
    for (const part of raw.split(",")) {
      const idx = parseInt(part.trim(), 10);
      if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
        indices.push(idx);
      }
    }

    if (indices.length === 0 && cfg.recallFilterFailOpen) return candidates;
    return indices.map((i) => candidates[i]);
  } catch (err) {
    if (cfg.recallFilterFailOpen) return candidates;
    return [];
  }
}
