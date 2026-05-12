import { createSessionFilter } from "../utils/session-filter.js";
/** Safely extract text content from a message, handling string/array/object formats */
function extractContent(msg, maxLen) {
    if (!msg)
        return "";
    const content = msg.content;
    let text = "";
    if (typeof content === "string") {
        text = content;
    }
    else if (Array.isArray(content)) {
        text = content
            .map((part) => {
            if (part.type === "text")
                return String(part.text ?? "");
            return "";
        })
            .join(" ");
    }
    else {
        try {
            text = JSON.stringify(content);
        }
        catch {
            return "[unparseable content]";
        }
    }
    // 清理 message_id 前缀
    text = text.replace(/^\[message_id:\s*[^\]]+\]\s*/gm, "");
    // 清理 user ID 前缀 (ou_xxx: )
    text = text.replace(/^ou_[a-f0-9]+:\s*/gm, "");
    // 清理 heartbeat 标记
    if (text.trim() === "[OpenClaw heartbeat poll]")
        return "";
    // 清理 cron 标记的开头
    text = text.replace(/^\[cron:[a-f0-9\-]+\s+/, "[cron] ");
    // 截断
    return text.trim().slice(0, maxLen);
}
export function registerCaptureHook(api, store, db, config, personaState) {
    api.logger.info("[yaoyao-memory] Registering agent_end hook (auto-capture + FTS5 index)");
    // Create session filter with configured blockLabels
    const sessionFilter = createSessionFilter({
        blockLabels: config.blockLabels || [],
        blockInternal: true,
        minMessages: 1,
    });
    // ── Write buffer for debounce (2s window) ──
    let writeBuffer = [];
    let writeTimer = null;
    const WRITE_BUFFER_MS = 2000;
    function flushWriteBuffer() {
        if (writeBuffer.length === 0) return;
        const batch = writeBuffer.splice(0);
        for (const item of batch) {
            try {
                store.appendToDaily(item.date, item.entry);
                try {
                    db.indexTurn(item.taggedContent, item.asstContent, item.date, item.sourceSession);
                } catch (indexErr) {
                    // Issue #12: indexTurn failed — rollback the file append
                    try {
                        const fp = store.getDailyFile(item.date);
                        const content = store.readFile(fp);
                        if (content) {
                            const idx = content.lastIndexOf(item.entry);
                            if (idx !== -1) {
                                const updated = content.slice(0, idx);
                                const fs = require("node:fs");
                                fs.writeFileSync(fp, updated, "utf-8");
                            }
                        }
                    } catch { /* best-effort rollback */ }
                    throw indexErr; // re-throw so we log the original failure
                }
            } catch (err) {
                // Log and continue with remaining items
                const errMsg = err instanceof Error ? err.message : String(err);
                console.error(`[yaoyao-memory:capture] Buffer flush error: ${errMsg}`);
            }
        }
        writeTimer = null;
    }
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
            // Use timezone-aware date if available
            const date = typeof db.getLocalDate === 'function'
                ? db.getLocalDate(config.tz)
                : new Date().toISOString().slice(0, 10);
            const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
            const userContent = extractContent(lastUserMsg, 500);
            const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, 500) : "(no response)";
            // Skip trivial entries (heartbeat, empty, too short)
            if (userContent.length < 3)
                return;
            // ── Group chat / noise filters ──
            // 1. Skip very short AI replies (< 5 chars, e.g. "OK", "好", emoji)
            if (asstContent.length < 5 && asstContent !== "(no response)")
                return;
            // 2. Skip pure system messages (wrapped in [ ])
            if (/^\[.+\]$/.test(userContent.trim()))
                return;
            // 3. Skip pure emoji messages
            if (/^[\p{Emoji}\s]+$/u.test(userContent.trim()))
                return;
            // ── Extract source session from sessionKey ──
            let sourceSession = "";
            const skMatch = sessionKey.match(/(ou_[a-f0-9]+)$/i);
            if (skMatch)
                sourceSession = skMatch[1];
            // ── Compute importance weight ──
            let importance = 0.5;
            if (userContent.length > 50)
                importance += 0.2;
            if (userContent.length > 200)
                importance += 0.1;
            if (asstContent.length > 100)
                importance += 0.1;
            if (asstContent.length > 500)
                importance += 0.1;
            const decisionKeywords = ["决定", "选择", "方案", "确认", "agree", "decide", "confirm", "plan"];
            if (decisionKeywords.some(k => userContent.toLowerCase().includes(k)))
                importance += 0.15;
            importance = Math.min(1, importance);
            // Detect tool calls in AI reply
            const hasToolCall = lastAsstMsg && (
                (typeof lastAsstMsg.content === 'string' && /\btool[_ ]?(use|call|result)\b/i.test(lastAsstMsg.content)) ||
                (Array.isArray(lastAsstMsg.content) && lastAsstMsg.content.some(p => p.type === 'tool_use' || p.type === 'tool_result'))
            );
            const toolTag = hasToolCall ? ' 🔧' : '';
            // Write to daily Markdown log (L0) — buffered for debounce
            const entry = `\n### ${timestamp}${importance >= 0.8 ? ' ⭐' : ''}${toolTag}\n**User:** ${userContent}\n**AI:** ${asstContent}\n`;
            const taggedContent = importance >= 0.8 ? `[important] ${userContent}` : userContent;
            writeBuffer.push({ date, entry, taggedContent, asstContent, sourceSession });
            if (!writeTimer) {
                writeTimer = setTimeout(flushWriteBuffer, WRITE_BUFFER_MS);
            }
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
