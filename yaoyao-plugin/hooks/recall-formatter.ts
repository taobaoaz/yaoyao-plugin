/**
 * hooks/recall-formatter.ts — Recall context formatting helpers.
 */
import type { SearchResult } from '../utils/db-bridge.ts';

export function buildRecallContext(results: SearchResult[], maxChars = 1200): string {
  let body = '💡 相关记忆:';
  let used = 0;
  for (const r of results) {
    const line = `\n- ${r.date || ''}: ${r.snippet}`;
    if (used + line.length > maxChars) break;
    body += line;
    used += line.length;
  }
  return used > 0 ? body : '';
}

export function buildHookResult(
  context: string,
  position: 'append' | 'prepend',
): { prepend?: string; append?: string } {
  return position === 'prepend' ? { prepend: context } : { append: context };
}

export interface TraceResult {
  query: string;
  mode: 'hybrid' | 'fts' | 'intent-driven';
  startedAt: number;
  stages: Array<{
    name: string;
    inputCount: number;
    outputCount: number;
    droppedIds: string[];
    scoreRange: null;
    durationMs: number;
  }>;
  finalCount: number;
  totalMs: number;
}

export function makeSimpleTrace(
  query: string,
  mode: string,
  startMs: number,
  inputCount: number,
  outputCount: number,
): TraceResult {
  const totalMs = Date.now() - startMs;
  return {
    query,
    mode: mode as 'hybrid' | 'fts' | 'intent-driven',
    startedAt: startMs,
    stages: [
      {
        name: 'recall',
        inputCount,
        outputCount,
        droppedIds: [],
        scoreRange: null,
        durationMs: totalMs,
      },
    ],
    finalCount: outputCount,
    totalMs,
  };
}
