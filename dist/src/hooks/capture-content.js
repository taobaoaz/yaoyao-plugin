/**
 * hooks/capture-content.ts — Content extraction utilities.
 *
 * v1.8.0: Added device tool call extraction for XiaoYi device bridge awareness.
 */

const THINKING_TAG_RE = /<think[\s>][\s\S]*?<\/think>\s*/gi;
const FINAL_TAG_RE = /<\/?final\s*>/gi;

export function extractContent(msg, maxLen) {
    if (!msg) return "";
    const content = msg.content;
    const role = msg.role;
    const limit = maxLen && maxLen > 0 ? maxLen : 500;

    let text;
    if (typeof content === "string") {
        text = content;
    } else if (Array.isArray(content)) {
        text = content
            .map((part) => {
                if (part.type === "text") return String(part.text ?? "");
                return "";
            })
            .filter(s => s.length > 0)
            .join(" ");
    } else {
        try {
            text = safeStringify(content, limit);
        } catch {
            text = "[unparseable content]";
        }
    }

    if (role === "assistant") {
        text = text.replace(THINKING_TAG_RE, "");
        text = text.replace(FINAL_TAG_RE, "");
    }

    return text.slice(0, limit);
}

export function safeStringify(obj, maxLen) {
    const seen = new WeakSet();
    function walk(val, depth) {
        if (depth > 3) return "[...]";
        if (val === null) return "null";
        if (typeof val !== "object") return String(val);
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
        if (Array.isArray(val)) {
            const items = val.slice(0, 10).map(v => walk(v, depth + 1));
            const tail = val.length > 10 ? `,...${val.length - 10} more` : "";
            return `[${items.join(",")}${tail}]`;
        }
        const entries = Object.entries(val).slice(0, 10);
        const tail = Object.keys(val).length > 10 ? ",...}" : "}";
        const pairs = entries.map(([k, v]) => `${k}:${walk(v, depth + 1)}`);
        return `{${pairs.join(",")}${tail}`;
    }
    return walk(obj, 0).slice(0, maxLen);
}

// === Device Tool Call Extraction (v1.8.0) ===

const DEVICE_TOOL_NAMES = new Set([
    "create_note", "search_note", "append_note",
    "create_calendar_event", "search_calendar_event",
    "create_alarm", "search_alarm", "modify_alarm", "delete_alarm",
    "search_contact", "dial_call", "send_sms",
    "search_file", "upload_file", "save_to_file",
    "search_photo", "upload_photo", "save_to_device",
    "call_device_tool",
]);

const TIME_SENSITIVE_TOOLS = new Set([
    "create_calendar_event", "search_calendar_event",
    "create_alarm", "modify_alarm", "delete_alarm",
]);

export function extractDeviceInteractions(messages) {
    const interactions = [];

    for (const msg of messages) {
        const role = msg.role;
        if (role === "assistant") {
            const toolCalls = msg.tool_calls;
            if (Array.isArray(toolCalls)) {
                for (const tc of toolCalls) {
                    const fn = tc.function;
                    const toolName = (fn?.name) || (tc.name) || "";
                    if (DEVICE_TOOL_NAMES.has(toolName)) {
                        interactions.push({
                            tool: toolName,
                            summary: _extractToolSummary(fn),
                        });
                    }
                }
            }
        }
        if (role === "tool" || role === "function") {
            const toolName = (msg.name) || (msg.tool_name) || "";
            if (DEVICE_TOOL_NAMES.has(toolName)) {
                const content = typeof msg.content === "string" ? msg.content : safeStringify(msg.content, 200);
                interactions.push({
                    tool: toolName,
                    summary: content.slice(0, 200),
                });
            }
        }
    }

    return interactions;
}

export function hasTimeSensitiveInteraction(interactions) {
    return interactions.some(i => TIME_SENSITIVE_TOOLS.has(i.tool));
}

function _extractToolSummary(fn) {
    if (!fn) return "";
    const args = fn.arguments;
    if (typeof args === "string") {
        try {
            const parsed = JSON.parse(args);
            return _summarizeArgs(parsed);
        } catch {
            return args.slice(0, 200);
        }
    }
    if (args && typeof args === "object") {
        return _summarizeArgs(args);
    }
    return "";
}

function _summarizeArgs(args) {
    const keys = ["title", "content", "event", "name", "time", "date", "query", "text", "message"];
    const parts = [];
    for (const key of keys) {
        if (args[key] && typeof args[key] === "string") {
            parts.push(`${key}: ${args[key]}`);
        }
    }
    return parts.slice(0, 3).join(", ").slice(0, 200);
}