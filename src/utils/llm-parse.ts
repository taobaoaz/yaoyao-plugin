/**
 * Shared utility — LLM JSON response parser.
 *
 * Three modules (L1 extractor, L2 scene, L3 persona) all do the exact same:
 * 1. Trim response
 * 2. Strip ```json ``` fences
 * 3. JSON.parse
 *
 * Consolidate here to avoid copy-paste drift.
 */

/**
 * Parse an LLM JSON response, stripping optional markdown code fences.
 * Returns null if parsing fails.
 */
export function parseJSONResponse<T>(response: string): T | null {
  try {
    let clean = response.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "");
    }
    return JSON.parse(clean) as T;
  } catch {
    // Try extracting first JSON array/object via regex as fallback
    const arrayMatch = response.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]) as T; } catch { return null; }
    }
    const objMatch = response.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) as T; } catch { return null; }
    }
    return null;
  }
}

/**
 * Format an ISO date string into YYYY-MM-DD for display.
 * Guaranteed to work in Node.js without Intl locale data.
 */
export function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toISOString().slice(0, 10);
  } catch {
    return "unknown";
  }
}
