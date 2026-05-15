/**
 * auto-capture hook — captures conversation turns into daily memory files
 * and indexes them in FTS5 for future search.
 *
 * Uses api.on("agent_end", ...) to log each agent turn to the daily log.
 * Handles both string and structured content formats.
 *
 * v1.5.0+: Removed psychological state tracking (moved to yaoyao-soul).
 *          Plugin now purely captures and indexes, without implicit tagging.
 */
import { clampNum } from "../utils/clamp.ts";
import fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore, YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { getObj, getProp } from "../utils/config.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { detectSpeculative, detectCorrection } from "../core/verify/verify.ts";

/** Safely extract text content from a message, handling string/array/object formats */
export function extractContent(msg: unknown, maxLen?: number): string {
  if (!msg) return "";
  const content = (msg as Record<string, unknown>).content;
  const limit = maxLen && maxLen > 0 ? maxLen : 500;

  if (typeof content === "string") return content.slice(0, limit);

  if (Array.isArray(content)) {
    return content
      .map((part: Record<string, unknown>) => {
        if (part.type === "text") return String(part.text ?? "");
        return "";
      })
      .filter(s => s.length > 0)
      .join(" ")
      .slice(0, limit);
  }

  // Fallback: safe JSON stringify with depth limit
  try {
    return safeStringify(content, limit);
  } catch {
    return "[unparseable content]";
  }
}

/** Depth-limited JSON stringify to avoid OOM on deeply nested / massive objects */
export function safeStringify(obj: unknown, maxLen: number): string {
  const seen = new WeakSet<object>();
  function walk(val: unknown, depth: number): string {
    if (depth > 3) return "[...]";
    if (val === null) return "null";
    if (typeof val !== "object") return String(val);
    if (seen.has(val as object)) return "[Circular]";
    seen.add(val as object);
    if (Array.isArray(val)) {
      const items = val.slice(0, 10).map(v => walk(v, depth + 1));
      const tail = val.length > 10 ? `,...${val.length - 10} more` : "";
      return `[${items.join(",")}${tail}]`;
    }
    const entries = Object.entries(val as Record<string, unknown>).slice(0, 10);
    const tail = Object.keys(val as Record<string, unknown>).length > 10 ? ",...}" : "}";
    const pairs = entries.map(([k, v]) => `${k}:${walk(v, depth + 1)}`);
    return `{${pairs.join(",")}${tail}`;
  }
  return walk(obj, 0).slice(0, maxLen);
}

export function registerCaptureHook(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  verifyActive = true, // anti-hallucination detection can be disabled via config
) {
  api.logger.info("[yaoyao-memory] Registering agent_end hook (auto-capture + FTS5 index)");

  // Create session filter with configured blockLabels
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });

  api.on("agent_end", async (event, ctx) => {
    try {
      const e = event as Record<string, unknown>;
      if (!e.success) return;

      // Session filter: skip internal/system sessions
      const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
      if (!sessionFilter.shouldProcess(sessionKey)) {
        return;
      }

      const messages = ((e as Record<string, unknown>).messages as unknown[]) ?? [];
      if (messages.length === 0) return;

      const lastUserMsg = [...messages].reverse().find((m: Record<string, unknown>) => (m as Record<string, unknown>).role === "user");
      const lastAsstMsg = [...messages].reverse().find((m: Record<string, unknown>) => (m as Record<string, unknown>).role === "assistant");

      if (!lastUserMsg) return;

      // Issue #16: Use timezone-aware date if config.tz is set
      let date: string;
      if (config.tz) {
        try {
          date = new Intl.DateTimeFormat("sv-SE", { timeZone: config.tz, year: "numeric", month: "2-digit", day: "2-digit" } as Intl.DateTimeFormatOptions).format(new Date());
        } catch {
          api.logger.warn?.(`[yaoyao-memory:capture] Invalid timezone "${config.tz}", falling back to UTC date`);
          date = new Date().toISOString().slice(0, 10);
        }
      } else {
        date = new Date().toISOString().slice(0, 10);
      }
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

      const captureCfg = getObj(config, "capture") || {};
      const captureMaxLen = clampNum(getProp(captureCfg, "maxContentLen", 500), 500, 50, 5000);
      const minContentLen = clampNum(getProp(captureCfg, "minContentLen", 3), 3, 0, 100);

      const userContent = extractContent(lastUserMsg, captureMaxLen);
      const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, captureMaxLen) : "(no response)";

      // Skip trivial entries
      if (userContent.length < minContentLen) return;

      // Bug #12: Skip indexing if assistant content is empty or "(no response)"
      const indexableAsst = (!asstContent || asstContent === "(no response)")
        ? ""
        : asstContent;

      // Anti-hallucination: detect speculative AI output and user corrections
      // Isolated try/catch: verify failure must NOT block capture
      let specCheck: ReturnType<typeof detectSpeculative> = { isSpeculative: false, markers: [], confidence: "high" };
      let corrCheck: ReturnType<typeof detectCorrection> = { isCorrection: false, markers: [] };
      if (verifyActive) {
        try {
          specCheck = detectSpeculative(asstContent);
          corrCheck = detectCorrection(userContent);
        } catch (verifyErr: unknown) {
          api.logger.warn?.(`[yaoyao-memory:capture] Verify detection failed, falling back to no-tag capture: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`);
        }
      }

      // Build hallucination risk tag for the log
      let riskTag = "";
      if (specCheck.isSpeculative) {
        riskTag = ` [⚠️ 推测性: ${specCheck.markers.join(", ")}]`;
      }
      if (corrCheck.isCorrection) {
        riskTag += ` [🚫 用户纠正]`;
      }

      // Write to daily Markdown log (L0)
      const entry = `\n### ${timestamp}\n**User:** ${userContent}${corrCheck.isCorrection ? " [纠正]" : ""}\n**AI:** ${asstContent}${riskTag}\n`;

      // Risk metadata goes into the structured meta column — NOT into asst_text,
      // so FTS5 search space isn't polluted with "⚠️ 推测性" / "🚫 用户纠正" tokens.
      const meta = specCheck.isSpeculative || corrCheck.isCorrection
        ? JSON.stringify({ speculative: specCheck.isSpeculative, confidence: specCheck.confidence, correction: corrCheck.isCorrection })
        : undefined;

      // Issue #12: Make file append and DB index atomic — if index fails, log error but do NOT rollback.
      // Rationale: L0 (daily file) and L1 (FTS5 index) are independent systems.
      // Rolling back file writes introduces race conditions under concurrent agent_end hooks.
      // It's safer to let L0 succeed and L1 fail separately, than to corrupt L0 trying to undo it.
      try {
        store.appendToDaily(date, entry);
        db.indexTurn(userContent, indexableAsst, date, meta);
      } catch (indexErr: unknown) {
        api.logger.error(`[yaoyao-memory:capture] Index failed after file append: ${indexErr instanceof Error ? indexErr.message : String(indexErr)}`);
        // Note: daily file already has the entry; next DB rebuild (startup check) will catch it.
        return;
      }

      // NOTE: Implicit observation tagging removed in v1.5.0.
      // If you want silent pattern extraction, install yaoyao-soul alongside this plugin.

      api.logger.debug?.("[yaoyao-memory:capture] Captured turn to " + date);
    } catch (err) {
      api.logger.error(`[yaoyao-memory:capture] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
