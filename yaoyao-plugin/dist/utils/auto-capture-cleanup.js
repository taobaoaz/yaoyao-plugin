/**
 * Auto Capture Cleanup — Strip inbound metadata / runtime wrapper boilerplate (from Brain v1.1.0)
 * Zero external dependency.
 *
 * Removes OpenClaw internal metadata that should not be captured as user memories.
 */
const INBOUND_META_SENTINELS = [
    "Conversation info (untrusted metadata):",
    "Sender (untrusted metadata):",
    "Thread starter (untrusted, for context):",
    "Replied message (untrusted, for context):",
    "Forwarded message context (untrusted metadata):",
    "Chat history since last reply (untrusted, for context):",
];
const SESSION_RESET_PREFIX = "A new session was started via /new or /reset. Execute your Session Startup sequence now";
const ADDRESSING_PREFIX_RE = /^(?:<@!?[0-9]+>|@[A-Za-z0-9_.-]+)\s*/;
const SYSTEM_EVENT_LINE_RE = /^System:\s*\[[^\n]*?\]\s*Exec\s+(?:completed|failed|started)\b.*$/gim;
const RUNTIME_WRAPPER_LINE_RE = /^\[(?:Subagent Context|Subagent Task)\]\s*/i;
const RUNTIME_WRAPPER_PREFIX_RE = /^\[(?:Subagent Context|Subagent Task)\]/i;
const RUNTIME_WRAPPER_BOILERPLATE_RE = /(?:You are running as a subagent\b.*?(?:$|(?<=\.)\s+)|Results auto-announce to your requester\.?\s*|do not busy-poll for status\.?\s*|Reply with a brief acknowledgment only\.?\s*|Do not use any memory tools\.?\s*)/gi;
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const INBOUND_META_BLOCK_RE = new RegExp(String.raw `(?:^|\n)\s*(?:${INBOUND_META_SENTINELS.map((sentinel) => escapeRegExp(sentinel)).join("|")})\s*\n\`\`\`json[\s\S]*?\n\`\`\`\s*`, "g");
/** Strip inbound metadata blocks from user text. */
export function stripInboundMetadata(text) {
    if (!text)
        return text;
    let normalized = text;
    for (let i = 0; i < 6; i++) {
        const before = normalized;
        normalized = normalized.replace(SYSTEM_EVENT_LINE_RE, "\n");
        normalized = normalized.replace(INBOUND_META_BLOCK_RE, "\n");
        normalized = normalized.replace(/\n{3,}/g, "\n\n").trim();
        if (normalized === before.trim())
            break;
    }
    return normalized.trim();
}
/** Strip session reset prefix. */
export function stripSessionResetPrefix(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith(SESSION_RESET_PREFIX))
        return trimmed;
    const blankLineIndex = trimmed.indexOf("\n\n");
    if (blankLineIndex >= 0)
        return trimmed.slice(blankLineIndex + 2).trim();
    const lines = trimmed.split("\n");
    if (lines.length <= 2)
        return "";
    return lines.slice(2).join("\n").trim();
}
/** Strip @mentions prefix. */
export function stripAddressingPrefix(text) {
    return text.replace(ADDRESSING_PREFIX_RE, "").trim();
}
/** Strip subagent boilerplate. */
export function stripRuntimeBoilerplate(text) {
    return text
        .replace(RUNTIME_WRAPPER_BOILERPLATE_RE, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}
/** Check if a line is runtime wrapper noise. */
export function isRuntimeWrapperLine(line) {
    return RUNTIME_WRAPPER_PREFIX_RE.test(line.trim());
}
/** Full cleanup pipeline. */
export function cleanCaptureText(text) {
    let result = stripInboundMetadata(text);
    result = stripSessionResetPrefix(result);
    // Remove multiple addressing prefixes in sequence
    for (let i = 0; i < 5; i++) {
        const before = result;
        result = stripAddressingPrefix(result);
        if (result === before)
            break;
    }
    result = stripRuntimeBoilerplate(result);
    return result.trim();
}
