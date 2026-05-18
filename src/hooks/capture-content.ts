/**
 * hooks/capture-content.ts — Content extraction utilities.
 *
 * Extracted from auto-capture.ts for modularity.
 */

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
