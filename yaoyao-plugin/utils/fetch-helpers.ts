/**
 * utils/fetch-helpers.ts — Fetch utilities with timeout and retry.
 */
import { isTransientUpstreamError, isNonRetryError } from "./reflection-retry.ts";

/** Fetch with AbortSignal timeout */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  defaultTimeout: number,
): Promise<Response> {
  const timeout = init.timeoutMs ?? defaultTimeout;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
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
        await new Promise((r) => setTimeout(r, backoffBaseMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}
