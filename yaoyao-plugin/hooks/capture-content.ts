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
export function extractContent(msg: unknown, maxLen?: number): string {
  if (!msg) return "";
  const content = (msg as Record<string, unknown>).content;
  const role = (msg as Record<string, unknown>).role as string;
  const limit = maxLen && maxLen > 0 ? maxLen : 500;

  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part: Record<string, unknown>) => {
        if (part.type === "text") return String(part.text ?? "");
        return "";
      })
      .filter(s => s.length > 0)
      .join(" ");
  } else {
    try {
      text = safeStringify(content, limit);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:capture] Content parse failed: ${msg}`);
    }
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
