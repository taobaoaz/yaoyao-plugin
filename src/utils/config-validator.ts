/**
 * Config Validator — lightweight startup-time validation for yaoyao-memory plugin config.
 * Collects warnings/errors without blocking startup.
 */

import type { YaoyaoMemoryConfig } from "./memory-store.ts";

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
    // Explicitly enabled — must have full config
    if (!embed?.apiKey || embed.apiKey.length === 0) {
      results.push({
        level: "error",
        field: "embedding.apiKey",
        message: "API key is missing",
        suggestion: "Set embedding.apiKey to a valid API key",
      });
    }
    if (!embed?.baseUrl) {
      results.push({
        level: "error",
        field: "embedding.baseUrl",
        message: "Base URL is missing",
        suggestion: "Set embedding.baseUrl (e.g. https://api.openai.com/v1)",
      });
    } else {
      try {
        const url = new URL(embed.baseUrl);
        if (!url.protocol.startsWith("http")) {
          results.push({
            level: "error",
            field: "embedding.baseUrl",
            message: `Invalid protocol: ${url.protocol}`,
            suggestion: "Use http:// or https://",
          });
        }
      } catch {
        results.push({
          level: "error",
          field: "embedding.baseUrl",
          message: `Not a valid URL: ${embed.baseUrl}`,
          suggestion: "Check for typos (e.g. https://api.openai.com/v1)",
        });
      }
    }
    if (!embed?.model) {
      results.push({
        level: "warn",
        field: "embedding.model",
        message: "Model name not set",
        suggestion: "Set embedding.model (e.g. text-embedding-3-small, bge-m3)",
      });
    }
    if (embed?.dimensions !== undefined && embed.dimensions !== null) {
      if (!Number.isInteger(embed.dimensions) || embed.dimensions <= 0) {
        results.push({
          level: "error",
          field: "embedding.dimensions",
          message: `Invalid dimensions: ${embed.dimensions}`,
          suggestion: "Must be a positive integer (e.g. 128, 1024)",
        });
      }
    }
    if (embed?.authType && embed.authType !== "bearer" && embed.authType !== "custom") {
      results.push({
        level: "error",
        field: "embedding.authType",
        message: `Invalid authType: ${embed.authType}`,
        suggestion: "Use 'bearer' or 'custom'",
      });
    }
    if (embed?.authType === "custom") {
      const hasCustomHeaders = embed?.customHeaders && Object.keys(embed.customHeaders).length > 0;
      if (!hasCustomHeaders) {
        results.push({
          level: "warn",
          field: "embedding.customHeaders",
          message: "authType is 'custom' but no customHeaders configured",
          suggestion: "Add embedding.customHeaders (e.g. { x-api-key: '...' })",
        });
      }
    }
  } else if (embed?.enabled !== false && (embed?.apiKey || embed?.baseUrl || embed?.model)) {
    // Partial config present (auto-enable implied) — validate fully
    if (!embed?.apiKey || embed.apiKey.length === 0) {
      results.push({
        level: "error",
        field: "embedding.apiKey",
        message: "API key is missing",
        suggestion: "Set embedding.apiKey to a valid API key",
      });
    }
    if (!embed?.baseUrl) {
      results.push({
        level: "error",
        field: "embedding.baseUrl",
        message: "Base URL is missing",
        suggestion: "Set embedding.baseUrl (e.g. https://api.openai.com/v1)",
      });
    }
    if (!embed?.model) {
      results.push({
        level: "warn",
        field: "embedding.model",
        message: "Model name not set",
        suggestion: "Set embedding.model (e.g. text-embedding-3-small, bge-m3)",
      });
    }
  }

  // ── capture ──
  const capture = config.capture;
  if (capture) {
    if (capture.batchSize !== undefined) {
      const bs = Number(capture.batchSize);
      if (!Number.isInteger(bs) || bs < 1 || bs > 100) {
        results.push({
          level: "warn",
          field: "capture.batchSize",
          message: `Unusual batchSize: ${bs}`,
          suggestion: "Recommended range: 1-50",
        });
      }
    }
    if (capture.debounceMs !== undefined) {
      const dm = Number(capture.debounceMs);
      if (dm < 100) {
        results.push({
          level: "warn",
          field: "capture.debounceMs",
          message: `Very short debounce: ${dm}ms`,
          suggestion: "Minimum 100ms to avoid excessive writes",
        });
      }
    }
    const mode = capture.mode;
    if (mode && mode !== "sync" && mode !== "async") {
      results.push({
        level: "error",
        field: "capture.mode",
        message: `Invalid mode: ${mode}`,
        suggestion: "Use 'sync' or 'async'",
      });
    }
  }

  // ── recall ──
  const recall = config.recall;
  if (recall) {
    if (recall.topK !== undefined) {
      const tk = Number(recall.topK);
      if (!Number.isInteger(tk) || tk < 1 || tk > 50) {
        results.push({
          level: "warn",
          field: "recall.topK",
          message: `Unusual topK: ${tk}`,
          suggestion: "Recommended range: 3-15",
        });
      }
    }
    if (recall.minScore !== undefined) {
      const ms = Number(recall.minScore);
      if (ms < 0 || ms > 1) {
        results.push({
          level: "error",
          field: "recall.minScore",
          message: `Invalid minScore: ${ms}`,
          suggestion: "Must be between 0.0 and 1.0",
        });
      }
    }
    const strategy = recall.strategy;
    if (strategy && strategy !== "hybrid" && strategy !== "fts5" && strategy !== "vector") {
      results.push({
        level: "error",
        field: "recall.strategy",
        message: `Invalid strategy: ${strategy}`,
        suggestion: "Use 'hybrid', 'fts5', or 'vector'",
      });
    }
  }

  // ── cloudSync ──
  const cloud = config.cloudSync;
  if (cloud?.enabled === true) {
    if (!cloud.provider || !["webdav", "s3", "sftp", "samba"].includes(cloud.provider)) {
      results.push({
        level: "error",
        field: "cloudSync.provider",
        message: `Invalid provider: ${cloud.provider}`,
        suggestion: "Use 'webdav', 's3', 'sftp', or 'samba'",
      });
    }
    if (!cloud.endpoint) {
      results.push({
        level: "warn",
        field: "cloudSync.endpoint",
        message: "Endpoint is missing",
        suggestion: "Set cloudSync.endpoint URL",
      });
    }
  }

  // ── general sanity ──
  if (config.debug === true && config.verbose !== true) {
    results.push({
      level: "info",
      field: "debug",
      message: "Debug mode enabled without verbose — some debug logs may be suppressed",
      suggestion: "Set verbose: true to see full debug output",
    });
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
