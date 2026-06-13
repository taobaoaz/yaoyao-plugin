/**
 * utils/fetch-helpers.ts — Fetch utilities with timeout and retry.
 */
import { isTransientUpstreamError, isNonRetryError } from "./reflection-retry.js";
/** Fetch with AbortSignal timeout */
export async function fetchWithTimeout(url, init, defaultTimeout) {
    const timeout = init.timeoutMs ?? defaultTimeout;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
        const res = await fetch(url, { ...init, signal: ac.signal });
        return res;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Retry wrapper: retries on network/timeout errors and HTTP 5xx (not 4xx). */
export async function fetchWithRetry(url, init, retries, backoffBaseMs, defaultTimeout) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetchWithTimeout(url, init, defaultTimeout);
            if (!res.ok && res.status >= 500) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res;
        }
        catch (err) {
            const isLast = attempt === retries;
            if (isLast)
                throw err;
            if (isNonRetryError(err))
                throw err;
            if (err.name === "AbortError" ||
                isTransientUpstreamError(err) ||
                err.message?.startsWith("HTTP 5")) {
                await new Promise((r) => setTimeout(r, backoffBaseMs * (attempt + 1)));
                continue;
            }
            throw err;
        }
    }
    throw new Error("Unreachable");
}
