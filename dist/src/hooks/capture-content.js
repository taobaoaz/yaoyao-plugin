/**
 * hooks/capture-content.ts — Content extraction utilities.
 *
 * Extracted from auto-capture.ts for modularity.
 */
/** Strip  tags from model output (DeepSeek-style reasoning). */
const THINKING_TAG_RE = /<think[\s>][\s\S]*?<\/think>\s*/gi;
/** Strip <final>…</final> tags (MiniMax-style). */
const FINAL_TAG_RE = /<\/?final\s*>/gi;
/** Safely extract text content from a message, handling string/array/object formats */
export function extractContent(msg, maxLen) {
    if (!msg)
        return "";
    const content = msg.content;
    const role = msg.role;
    const limit = maxLen && maxLen > 0 ? maxLen : 500;
    let text;
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
            .filter(s => s.length > 0)
            .join(" ");
    }
    else {
        try {
            text = safeStringify(content, limit);
        }
        catch {
            text = "[unparseable content]";
        }
    }
    // Strip reasoning tags from assistant output (DeepSeek think tags, MiniMax final tags)
    if (role === "assistant") {
        text = text.replace(THINKING_TAG_RE, "");
        text = text.replace(FINAL_TAG_RE, "");
    }
    return text.slice(0, limit);
}
/** Depth-limited JSON stringify to avoid OOM on deeply nested / massive objects */
export function safeStringify(obj, maxLen) {
    const seen = new WeakSet();
    function walk(val, depth) {
        if (depth > 3)
            return "[...]";
        if (val === null)
            return "null";
        if (typeof val !== "object")
            return String(val);
        if (seen.has(val))
            return "[Circular]";
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
