import { createSessionFilter } from "../utils/session-filter.js";
/** Safely extract text content from a message, handling string/array/object formats */
function extractContent(msg, maxLen) {
    if (!msg)
        return "";
    const content = msg.content;
    if (typeof content === "string")
        return content.slice(0, maxLen);
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (part.type === "text")
                return String(part.text ?? "");
            return "";
        })
            .join(" ")
            .slice(0, maxLen);
    }
    // Fallback: try JSON stringify
    try {
        return JSON.stringify(content).slice(0, maxLen);
    }
    catch {
        return "[unparseable content]";
    }
}
export function registerCaptureHook(api, store, db, config, personaState) {
    api.logger.info("[yaoyao-memory] Registering agent_end hook (auto-capture + FTS5 index)");
    // Create session filter with configured blockLabels
    const sessionFilter = createSessionFilter({
        blockLabels: config.blockLabels || [],
        blockInternal: true,
        minMessages: 1,
    });
    api.on("agent_end", async (event, ctx) => {
        try {
            const e = event;
            if (!e.success)
                return;
            // Session filter: skip internal/system sessions
            const sessionKey = ctx.sessionKey || "default";
            if (!sessionFilter.shouldProcess(sessionKey)) {
                return;
            }
            const messages = e.messages ?? [];
            if (messages.length === 0)
                return;
            const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
            const lastAsstMsg = [...messages].reverse().find((m) => m.role === "assistant");
            if (!lastUserMsg)
                return;
            const date = new Date().toISOString().slice(0, 10);
            const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
            const userContent = extractContent(lastUserMsg, 500);
            const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, 500) : "(no response)";
            // Skip trivial entries (e.g., heartbeat, empty responses)
            if (userContent.length < 3)
                return;
            // Write to daily Markdown log (L0)
            const entry = `\n### ${timestamp}\n**User:** ${userContent}\n**AI:** ${asstContent}\n`;
            store.appendToDaily(date, entry);
            // Index in FTS5 for search (L1 index)
            db.indexTurn(userContent, asstContent, date);
            // ── Update PersonaStateMachine (fire-and-forget, best-effort) ──
            if (personaState) {
                // Determine if this turn was "successful" (the assistant actually responded)
                const success = asstContent.length > 10 && asstContent !== "(no response)";
                personaState.update({
                    textSample: userContent,
                    successCount: success ? 1 : 0,
                    failCount: success ? 0 : 1,
                    intensity: 0.3, // default moderate intensity per turn
                });
            }
            api.logger.debug?.("[yaoyao-memory:capture] Captured turn to " + date);
        }
        catch (err) {
            api.logger.error(`[yaoyao-memory:capture] Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
