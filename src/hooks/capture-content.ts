/**
 * hooks/capture-content.ts — Content extraction utilities.
 *
 * Extracted from auto-capture.ts for modularity.
 * v1.8.0: Added device tool call extraction for XiaoYi device bridge awareness.
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
    } catch {
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

// === Device Tool Call Extraction (v1.8.0) ===

export interface DeviceInteraction {
  tool: string;
  summary: string;
  timestamp?: string;
}

/** Known device tool names from XiaoYi device bridge */
const DEVICE_TOOL_NAMES = new Set([
  "create_note", "search_note", "append_note",
  "create_calendar_event", "search_calendar_event",
  "create_alarm", "search_alarm", "modify_alarm", "delete_alarm",
  "search_contact", "dial_call", "send_sms",
  "search_file", "upload_file", "save_to_file",
  "search_photo", "upload_photo", "save_to_device",
  "call_device_tool",
]);

/** Tools that indicate time-sensitive (dynamic) memory */
const TIME_SENSITIVE_TOOLS = new Set([
  "create_calendar_event", "search_calendar_event",
  "create_alarm", "modify_alarm", "delete_alarm",
]);

/**
 * Extract device tool interactions from messages.
 * Scans for tool_call / tool_result / function messages.
 */
export function extractDeviceInteractions(messages: Array<Record<string, unknown>>): DeviceInteraction[] {
  const interactions: DeviceInteraction[] = [];

  for (const msg of messages) {
    const role = msg.role as string;
    // Check assistant messages for tool calls
    if (role === "assistant") {
      const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown> | undefined;
          const toolName = (fn?.name as string) || (tc.name as string) || "";
          if (DEVICE_TOOL_NAMES.has(toolName)) {
            interactions.push({
              tool: toolName,
              summary: _extractToolSummary(fn),
            });
          }
        }
      }
    }
    // Check tool/function role messages for results
    if (role === "tool" || role === "function") {
      const toolName = (msg.name as string) || (msg.tool_name as string) || "";
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

/** Check if any interaction is time-sensitive (calendar/alarm) */
export function hasTimeSensitiveInteraction(interactions: DeviceInteraction[]): boolean {
  return interactions.some(i => TIME_SENSITIVE_TOOLS.has(i.tool));
}

/** Extract a brief summary from a tool call function object */
function _extractToolSummary(fn: Record<string, unknown> | undefined): string {
  if (!fn) return "";
  const args = fn.arguments as string | Record<string, unknown> | undefined;
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
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

function _summarizeArgs(args: Record<string, unknown>): string {
  const keys = ["title", "content", "event", "name", "time", "date", "query", "text", "message"];
  const parts: string[] = [];
  for (const key of keys) {
    if (args[key] && typeof args[key] === "string") {
      parts.push(`${key}: ${args[key]}`);
    }
  }
  return parts.slice(0, 3).join(", ").slice(0, 200);
}