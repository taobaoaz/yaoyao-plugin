/**
 * Session Activity Tracker — track per-session last-active timestamps
 * and determine if a session is still within the active window.
 *
 * Tencent-style: sessionActiveWindowHours determines if a session
 * is "live" vs "stale" for context grouping and L2 scheduling.
 */

export interface SessionActivity {
  /** Last activity timestamp (ms) */
  lastActiveMs: number;
  /** Number of turns in this session */
  turnCount: number;
  /** Session start timestamp */
  startedAtMs: number;
}

/** In-memory session activity map (sessionKey → activity) */
export const activityMap = new Map<string, SessionActivity>();

/** Record activity for a session */
export function recordSessionActivity(sessionKey: string): SessionActivity {
  const now = Date.now();
  const existing = activityMap.get(sessionKey);
  if (existing) {
    existing.lastActiveMs = now;
    existing.turnCount += 1;
    return existing;
  }
  const fresh: SessionActivity = { lastActiveMs: now, turnCount: 1, startedAtMs: now };
  activityMap.set(sessionKey, fresh);
  return fresh;
}

/** Check if session is still within active window (hours) */
export function isSessionActive(sessionKey: string, windowHours: number): boolean {
  const activity = activityMap.get(sessionKey);
  if (!activity) return false;
  const windowMs = windowHours * 60 * 60 * 1000;
  return Date.now() - activity.lastActiveMs <= windowMs;
}

/** Get session activity (or null if never seen) */
export function getSessionActivity(sessionKey: string): SessionActivity | null {
  return activityMap.get(sessionKey) || null;
}

/** Prune stale entries older than windowHours */
export function pruneStaleSessions(windowHours: number): number {
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  let pruned = 0;
  for (const [key, act] of activityMap) {
    if (act.lastActiveMs < cutoff) {
      activityMap.delete(key);
      pruned++;
    }
  }
  return pruned;
}

/** Hard limit prune — keep only maxEntries most recent */
export function pruneToMax(maxEntries: number): number {
  if (activityMap.size <= maxEntries) return 0;
  const entries = Array.from(activityMap.entries()).sort(
    (a, b) => b[1].lastActiveMs - a[1].lastActiveMs,
  );
  const toRemove = entries.slice(maxEntries);
  for (const [key] of toRemove) {
    activityMap.delete(key);
  }
  return toRemove.length;
}

/** Reset a session (e.g. after /new or /reset) */
export function resetSession(sessionKey: string): void {
  activityMap.delete(sessionKey);
}
