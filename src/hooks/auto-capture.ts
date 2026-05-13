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
import { clampNum } from "../utils/clamp.js";
import fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore, YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { createSessionFilter } from "../utils/session-filter.js";

/** Safely extract text content from a message, handling string/array/object formats */
function extractContent(msg: unknown, maxLen?: number): string {
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
      .join(" ")
      .slice(0, limit);
  }

  // Fallback: try JSON stringify
  try {
    return JSON.stringify(content).slice(0, limit);
  } catch {
    return "[unparseable content]";
  }
}

export function registerCaptureHook(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
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

      const messages = (e.messages as unknown[]) ?? [];
      if (messages.length === 0) return;

      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
      const lastAsstMsg = [...messages].reverse().find((m: any) => m.role === "assistant");

      if (!lastUserMsg) return;

      // Issue #16: Use timezone-aware date if config.tz is set
      const date = config.tz
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: config.tz, year: "numeric", month: "2-digit", day: "2-digit" } as Intl.DateTimeFormatOptions).format(new Date())
        : new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

      const captureCfg = ((config as Record<string, unknown>).capture || {}) as Record<string, unknown>;
      const captureMaxLen = clampNum(captureCfg.maxContentLen, 500, 50, 5000);
      const minContentLen = clampNum(captureCfg.minContentLen, 3, 0, 100);

      const userContent = extractContent(lastUserMsg, captureMaxLen);
      const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, captureMaxLen) : "(no response)";

      // Skip trivial entries
      if (userContent.length < minContentLen) return;

      // Bug #12: Skip indexing if assistant content is empty or "(no response)"
      const indexableAsst = (!asstContent || asstContent === "(no response)")
        ? "[空内容]"
        : asstContent;

      // Write to daily Markdown log (L0)
      const entry = `\n### ${timestamp}\n**User:** ${userContent}\n**AI:** ${asstContent}\n`;

      // Issue #12: Make file append and DB index atomic — if index fails, log error but do NOT rollback.
      // Rationale: L0 (daily file) and L1 (FTS5 index) are independent systems.
      // Rolling back file writes introduces race conditions under concurrent agent_end hooks.
      // It's safer to let L0 succeed and L1 fail separately, than to corrupt L0 trying to undo it.
      try {
        store.appendToDaily(date, entry);
        db.indexTurn(userContent, indexableAsst, date);
      } catch (indexErr: any) {
        api.logger.error(`[yaoyao-memory:capture] Index failed after file append: ${indexErr.message || String(indexErr)}`);
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
