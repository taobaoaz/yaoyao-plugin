/**
 * Memory Upgrader — Simple enrichment (zero-dependency, from Brain v1.1.0)
 *
 * Extracts L0/L1/L2 summaries from raw memory text without LLM.
 * L0 = first sentence or first 100 chars (search index key)
 * L1 = structured bullet summary
 * L2 = full text preserved
 */

export interface EnrichedSummary {
  l0_abstract: string;
  l1_overview: string;
  l2_content: string;
}

/**
 * Extract first sentence (up to first terminator: . ! ? 。 ！ ？ or newline).
 * Falls back to first 100 chars.
 */
export function extractFirstSentence(text: string): string {
  const match = text.match(/^[^.!?。！？\n]+[.!?。！？]?/);
  if (match) {
    return match[0].slice(0, 100).trim();
  }
  return text.slice(0, 100).trim();
}

/**
 * Simple enrichment: first sentence → L0, bullet → L1, full → L2.
 */
export function simpleEnrich(text: string): EnrichedSummary {
  const l0 = extractFirstSentence(text);
  const l1 = `- ${l0}`;
  return {
    l0_abstract: l0,
    l1_overview: l1,
    l2_content: text,
  };
}

/**
 * Enrich memory metadata with L0/L1/L2 if not already present.
 * Mutates the metadata object in place.
 */
export function enrichMetadata(
  meta: Record<string, unknown>,
  text: string,
): Record<string, unknown> {
  if (meta.l0_abstract) return meta; // already enriched
  const enriched = simpleEnrich(text);
  meta.l0_abstract = enriched.l0_abstract;
  meta.l1_overview = enriched.l1_overview;
  meta.l2_content = enriched.l2_content;
  return meta;
}
