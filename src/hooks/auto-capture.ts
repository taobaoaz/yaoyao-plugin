/**
 * auto-capture hook — captures conversation turns into daily memory files
 * and indexes them in FTS5 for future search.
 *
 * Uses api.on("agent_end", ...) to log each agent turn to the daily log.
 * Handles both string and structured content formats.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore, YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { createSessionFilter } from "../utils/session-filter.js";
import { PersonaStateMachine } from "../utils/persona-state.js";

/** Safely extract text content from a message, handling string/array/object formats */
function extractContent(msg: unknown, maxLen: number): string {
  if (!msg) return "";
  const content = (msg as Record<string, unknown>).content;

  if (typeof content === "string") return content.slice(0, maxLen);

  if (Array.isArray(content)) {
    return content
      .map((part: Record<string, unknown>) => {
        if (part.type === "text") return String(part.text ?? "");
        return "";
      })
      .join(" ")
      .slice(0, maxLen);
  }

  // Fallback: try JSON stringify
  try {
    return JSON.stringify(content).slice(0, maxLen);
  } catch {
    return "[unparseable content]";
  }
}

export function registerCaptureHook(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  personaState?: PersonaStateMachine | null
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

      const date = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

      const userContent = extractContent(lastUserMsg, 500);
      const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, 500) : "(no response)";

      // Skip trivial entries (e.g., heartbeat, empty responses)
      if (userContent.length < 3) return;

      // Write to daily Markdown log (L0)
      const entry = `\n### ${timestamp}\n**User:** ${userContent}\n**AI:** ${asstContent}\n`;
      store.appendToDaily(date, entry);

      // Index in FTS5 for search (L1 index)
      db.indexTurn(userContent, asstContent, date);

      // ── v3: Implicit observation tagging (fire-and-forget) ──
      // Replaces real-time mood/energy/trust state machine updates.
      // Tags are stored silently for weekly distillation, not injected into live context.
      if (personaState) {
        try {
          personaState.extractImplicitTags(userContent);
        } catch {
          /* best effort */
        }
      }

      api.logger.debug?.("[yaoyao-memory:capture] Captured turn to " + date);
    } catch (err) {
      api.logger.error(`[yaoyao-memory:capture] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
