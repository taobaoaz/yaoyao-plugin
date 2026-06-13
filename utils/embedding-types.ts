/**
 * utils/embedding-types.ts — Embedding configuration types.
 */

export interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  /** Global request timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
  /** Timeout for recall-side embedding calls (overrides timeoutMs if set) */
  recallTimeoutMs?: number;
  /** Timeout for capture-side embedding calls (overrides timeoutMs if set) */
  captureTimeoutMs?: number;
  /** Retry count on network/timeout errors (default: 1) */
  retries?: number;
  /** Max input chars per text, truncates beyond this (default: 4000) */
  maxInputChars?: number;
  /** Backoff base in milliseconds (default: 1000) */
  backoffBaseMs?: number;
  /** Max batch size for embedBatch (default: 100, max 500) */
  batchSize?: number;
  /** Optional logger for timing metrics */
  logger?: { info?: (s: string) => void; debug?: (s: string) => void };
}
