/**
 * Config Validator — lightweight startup-time validation for yaoyao-memory plugin config.
 * Collects warnings/errors without blocking startup.
 */

import type { YaoyaoMemoryConfig } from "./memory-store.ts";

import { pushError, pushWarn, pushInfo, isValidUrl, isPositiveInt, inRange } from "./config-validator-helpers.ts";

export interface ConfigValidation {
  level: "error" | "warn" | "info";
  field: string;
  message: string;
  suggestion?: string;
}

/** Validate plugin configuration and return a list of findings. */
export function validateConfig(config: YaoyaoMemoryConfig): ConfigValidation[] {
  const results: ConfigValidation[] = [];

  // ── embedding ──
  const embed = config.embedding;
  if (embed?.enabled === true) {
    if (!embed?.apiKey || embed.apiKey.length === 0) {
      pushError(results, "embedding.apiKey", "API key is missing", "Set embedding.apiKey to a valid API key");
    }
    if (!embed?.baseUrl) {
      pushError(results, "embedding.baseUrl", "Base URL is missing", "Set embedding.baseUrl (e.g. https://api.openai.com/v1)");
    } else if (!isValidUrl(embed.baseUrl)) {
      pushError(results, "embedding.baseUrl", `Not a valid URL: ${embed.baseUrl}`, "Check for typos (e.g. https://api.openai.com/v1)");
    }
    if (!embed?.model) {
      pushWarn(results, "embedding.model", "Model name not set", "Set embedding.model (e.g. text-embedding-3-small, bge-m3)");
    }
    if (embed?.dimensions !== undefined && embed.dimensions !== null && !isPositiveInt(embed.dimensions)) {
      pushError(results, "embedding.dimensions", `Invalid dimensions: ${embed.dimensions}`, "Must be a positive integer (e.g. 128, 1024)");
    }
    if (embed?.authType && embed.authType !== "bearer" && embed.authType !== "custom") {
      pushError(results, "embedding.authType", `Invalid authType: ${embed.authType}`, "Use 'bearer' or 'custom'");
    }
    if (embed?.authType === "custom" && (!embed?.customHeaders || Object.keys(embed.customHeaders).length === 0)) {
      pushWarn(results, "embedding.customHeaders", "authType is 'custom' but no customHeaders configured", "Add embedding.customHeaders (e.g. { x-api-key: '...' })");
    }
  } else if (embed?.enabled !== false && (embed?.apiKey || embed?.baseUrl || embed?.model)) {
    if (!embed?.apiKey || embed.apiKey.length === 0) {
      pushError(results, "embedding.apiKey", "API key is missing", "Set embedding.apiKey to a valid API key");
    }
    if (!embed?.baseUrl) {
      pushError(results, "embedding.baseUrl", "Base URL is missing", "Set embedding.baseUrl (e.g. https://api.openai.com/v1)");
    }
    if (!embed?.model) {
      pushWarn(results, "embedding.model", "Model name not set", "Set embedding.model (e.g. text-embedding-3-small, bge-m3)");
    }
  }

  // ── capture ──
  const capture = config.capture;
  if (capture?.batchSize !== undefined) {
    const bs = Number(capture.batchSize);
    if (!Number.isInteger(bs) || !inRange(bs, 1, 100)) {
      pushWarn(results, "capture.batchSize", `Unusual batchSize: ${bs}`, "Recommended range: 1-50");
    }
  }
  if (capture?.debounceMs !== undefined) {
    const dm = Number(capture.debounceMs);
    if (dm < 100) {
      pushWarn(results, "capture.debounceMs", `Very short debounce: ${dm}ms`, "Minimum 100ms to avoid excessive writes");
    }
  }
  if (capture?.mode && capture.mode !== "sync" && capture.mode !== "async") {
    pushError(results, "capture.mode", `Invalid mode: ${capture.mode}`, "Use 'sync' or 'async'");
  }

  // ── recall ──
  const recall = config.recall;
  if (recall?.topK !== undefined) {
    const tk = Number(recall.topK);
    if (!Number.isInteger(tk) || !inRange(tk, 1, 50)) {
      pushWarn(results, "recall.topK", `Unusual topK: ${tk}`, "Recommended range: 3-15");
    }
  }
  if (recall?.minScore !== undefined) {
    const ms = Number(recall.minScore);
    if (ms < 0 || ms > 1) {
      pushError(results, "recall.minScore", `Invalid minScore: ${ms}`, "Must be between 0.0 and 1.0");
    }
  }
  if (recall?.strategy && recall.strategy !== "hybrid" && recall.strategy !== "fts" && recall.strategy !== "vector") {
    pushError(results, "recall.strategy", `Invalid strategy: ${recall.strategy}`, "Use 'hybrid', 'fts5', or 'vector'");
  }

  // ── cloudSync ──
  const cloud = config.cloudSync as { enabled?: boolean; provider?: string; endpoint?: string } | undefined;
  if (cloud?.enabled === true) {
    if (!cloud.provider || !["webdav", "s3", "sftp", "samba"].includes(cloud.provider)) {
      pushError(results, "cloudSync.provider", `Invalid provider: ${cloud.provider}`, "Use 'webdav', 's3', 'sftp', or 'samba'");
    }
    if (!cloud.endpoint) {
      pushWarn(results, "cloudSync.endpoint", "Endpoint is missing", "Set cloudSync.endpoint URL");
    }
  }

  // ── general sanity ──
  if (config.debug === true && config.verbose !== true) {
    pushInfo(results, "debug", "Debug mode enabled without verbose — some debug logs may be suppressed", "Set verbose: true to see full debug output");
  }

  // ── hooks ──
  if (config.hooks?.commandNew?.enabled !== undefined && typeof config.hooks.commandNew.enabled !== "boolean") {
    pushWarn(results, "hooks.commandNew.enabled", `Invalid value: ${config.hooks.commandNew.enabled}`, "Must be true or false");
  }

  // ── memoryCall ──
  const mc = (config as Record<string, unknown>).memoryCall as { enabled?: unknown } | undefined;
  if (mc?.enabled !== undefined && typeof mc.enabled !== "boolean") {
    pushWarn(results, "memoryCall.enabled", `Invalid value: ${mc.enabled}`, "Must be true or false");
  }

  // ── heartbeat ──
  const hb = config.hooks?.heartbeat as { enabled?: unknown; maxResults?: unknown; minScore?: unknown; maxContextChars?: unknown } | undefined;
  if (hb?.enabled !== undefined && typeof hb.enabled !== "boolean") {
    pushWarn(results, "hooks.heartbeat.enabled", `Invalid value: ${hb.enabled}`, "Must be true or false");
  }
  if (hb?.maxResults !== undefined && typeof hb.maxResults !== "number") {
    pushWarn(results, "hooks.heartbeat.maxResults", `Invalid value: ${hb.maxResults}`, "Must be a number");
  }
  if (hb?.minScore !== undefined && typeof hb.minScore !== "number") {
    pushWarn(results, "hooks.heartbeat.minScore", `Invalid value: ${hb.minScore}`, "Must be a number");
  }
  if (hb?.maxContextChars !== undefined && typeof hb.maxContextChars !== "number") {
    pushWarn(results, "hooks.heartbeat.maxContextChars", `Invalid value: ${hb.maxContextChars}`, "Must be a number");
  }

  return results;
}

/** Print validation results to logger */
export function logValidationResults(
  results: ConfigValidation[],
  logger?: { warn?: (msg: string) => void; error?: (msg: string) => void; info?: (msg: string) => void },
): void {
  for (const r of results) {
    const msg = `[yaoyao-memory:config] ${r.level.toUpperCase()} — ${r.field}: ${r.message}${
      r.suggestion ? ` (建议: ${r.suggestion})` : ""
    }`;
    if (r.level === "error") {
      logger?.error?.(msg);
    } else if (r.level === "warn") {
      logger?.warn?.(msg);
    } else {
      logger?.info?.(msg);
    }
  }
}
