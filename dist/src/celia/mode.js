/**
 * celia/mode.ts — normalize celiaBridge.mode value.
 *
 * v1.9.1: Different config guides spell the read-only mode inconsistently
 * ("read-only" vs "readonly"). To keep user configs working regardless of
 * which doc they copied from, we normalize before dispatching.
 *
 * Canonical internal values:
 *   "delegate"  -> spawn + delegate + proxy tools
 *   "readonly"  -> no spawn, read-only db browse tool
 */
/**
 * Normalize a raw mode string to a canonical BridgeMode.
 * Accepts: "delegate", "read-only", "readonly", "read_only", with any
 * case/spacing. Anything unrecognized defaults to "delegate" (the safe,
 * full-featured path — never silently drops the bridge).
 */
export function normalizeBridgeMode(raw) {
    if (!raw)
        return "delegate";
    const m = raw.toLowerCase().replace(/[_\s-]/g, "");
    return m === "readonly" ? "readonly" : "delegate";
}
