/**
 * auto-capture hook — captures conversation turns into daily memory files
 * and indexes them in FTS5 for future search.
 *
 * Uses api.on("agent_end", ...) to log each agent turn to the daily log.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore, YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";

export function registerCaptureHook(api: OpenClawPluginApi, store: MemoryStore, db: DBBridge, config: YaoyaoMemoryConfig) {
  api.logger.info("[yaoyao-memory] Registering agent_end hook (auto-capture + FTS5 index)");

  api.on("agent_end", async (event, ctx) => {
    try {
      const e = event as Record<string, unknown>;
      if (!e.success) {
        return;
      }

      const messages = (e.messages as unknown[]) ?? [];
      if (messages.length === 0) return;

      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
      const lastAsstMsg = [...messages].reverse().find((m: any) => m.role === "assistant");

      if (!lastUserMsg || !lastAsstMsg) return;

      const date = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

      const userContent = typeof lastUserMsg.content === "string"
        ? lastUserMsg.content.slice(0, 500)
        : JSON.stringify(lastUserMsg.content).slice(0, 500);

      const asstContent = typeof lastAsstMsg.content === "string"
        ? lastAsstMsg.content.slice(0, 500)
        : JSON.stringify(lastAsstMsg.content).slice(0, 500);

      // Write to daily Markdown log (L0)
      const entry = `\n### ${timestamp}\n**User:** ${userContent}\n**AI:** ${asstContent}\n`;
      store.appendToDaily(date, entry);

      // Index in FTS5 for search (L1 index)
      db.indexTurn(userContent, asstContent, date);
    } catch (err) {
      api.logger.error(`[yaoyao-memory:capture] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
