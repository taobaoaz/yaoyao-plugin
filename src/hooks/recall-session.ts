/**
 * hooks/recall-session.ts — Session context accumulation for recall.
 *
 * Tracks keywords per session for keyword-based memory expansion.
 * LRU eviction on total sessions to prevent unbounded memory growth.
 */

const MAX_SESSIONS = 100;
const _sessionContextKeywords = new Map<string, Set<string>>();
const _sessionKeywordOrder = new Map<string, string[]>();

/** Accumulate keywords from a message into a session's context. */
export function accumulateKeywords(sessionKey: string, text: string, maxKeywords: number): void {
  // LRU eviction
  if (_sessionContextKeywords.size >= MAX_SESSIONS && !_sessionContextKeywords.has(sessionKey)) {
    const firstKey = _sessionContextKeywords.keys().next().value as string;
    _sessionContextKeywords.delete(firstKey);
    _sessionKeywordOrder.delete(firstKey);
  }

  const words = text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter((w) => w.length >= 2);
  let set = _sessionContextKeywords.get(sessionKey);
  let order = _sessionKeywordOrder.get(sessionKey);
  if (!set) {
    set = new Set();
    order = [];
    _sessionContextKeywords.set(sessionKey, set);
    _sessionKeywordOrder.set(sessionKey, order);
  }
  for (const w of words) {
    if (!set.has(w)) {
      set.add(w);
      order!.push(w);
    }
  }
  while (order!.length > maxKeywords) {
    const removed = order!.shift()!;
    set.delete(removed);
  }
}

/** Reset accumulated keywords for a session (e.g. after /new or /reset). */
export function clearSessionKeywords(sessionKey: string): void {
  _sessionContextKeywords.delete(sessionKey);
  _sessionKeywordOrder.delete(sessionKey);
}

/** Get accumulated keywords for a session (ordered by recency). */
export function getAccumulatedKeywords(sessionKey: string): string[] {
  return _sessionKeywordOrder.get(sessionKey) || [];
}
