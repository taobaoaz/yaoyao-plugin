/**
 * utils/fetch-helpers.ts — Fetch utilities with timeout and retry.
 */
import { isTransientUpstreamError, isNonRetryError } from "./reflection-retry.ts";

// Node < 18 compatibility: global fetch is not available.
// Core memory functions (capture/recall/storage) work on Node 16+.
// Network features (telemetry, LLM, cloud-sync, recall-filter) require Node 18+.
const _globalFetch: typeof fetch = typeof globalThis.fetch === "function"
  ? globalThis.fetch
  : (() => { throw new Error("global fetch is not available. Upgrade to Node 18+ or disable network features (telemetry/llm/cloud-sync)."); }) as unknown as typeof fetch;

/** Exported for files that need a Node <18-safe fetch outside fetch-helpers. */
export const globalFetch = _globalFetch;

/** Fetch with AbortSignal timeout */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  defaultTimeout: number,
): Promise<Response> {
  const timeout = init.timeoutMs ?? defaultTimeout;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  timer.unref?.();
  try {
    const res = await _globalFetch(url, { ...init, signal: ac.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Retry wrapper: retries on network/timeout errors and HTTP 5xx (not 4xx). */
export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  retries: number,
  backoffBaseMs: number,
  defaultTimeout: number,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, defaultTimeout);
      if (!res.ok && res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err: unknown) {
      const isLast = attempt === retries;
      if (isLast) throw err;
      if (isNonRetryError(err)) throw err;
      if (
        (err instanceof Error && (err.name === "AbortError" || err.message.startsWith("HTTP 5"))) ||
        isTransientUpstreamError(err) ||
        String(err).startsWith("HTTP 5")
      ) {
        await new Promise((r) => {
          const t = setTimeout(r, backoffBaseMs * (attempt + 1));
          t.unref?.();
        });
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}
