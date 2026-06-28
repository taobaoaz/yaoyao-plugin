/**
 * features/setup/state.ts — track whether first-run guidance was already shown.
 *
 * Persists a tiny marker file in the memory dir so we don't nag the user every
 * conversation. The marker is keyed by a "guidance signature": if the config
 * materially changes (e.g. user enables celiaBridge, or switches from coexist
 * to standalone), the signature changes and guidance surfaces once more.
 *
 * All ops are best-effort: any FS error is swallowed (treated as "not shown"),
 * so a read-only/locked memory dir never breaks startup.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
const MARKER_FILENAME = ".yaoyao-setup-guided.json";
/**
 * Compute a signature that captures the guidance-relevant config state.
 * When this changes, guidance is shown again (once).
 */
export function computeGuidanceSignature(input) {
    // Intentionally coarse: only re-prompt on meaningful changes.
    const parts = [
        input.mode,
        input.slotOwner || "-",
        input.bridgeEnabled ? "bridge-on" : "bridge-off",
        input.bridgeMode || "-",
        input.embeddingEnabled ? "vec" : "novec",
        input.memoryEmpty ? "empty" : "has-data",
    ];
    return parts.join("|");
}
/** Path to the marker file inside the given memory dir. */
function markerPath(memoryDir) {
    return join(memoryDir, MARKER_FILENAME);
}
/**
 * Has guidance already been shown for the current signature?
 * Returns false on any error (so we err toward showing guidance).
 */
export function isGuidanceShown(memoryDir, signature, _version) {
    try {
        const p = markerPath(memoryDir);
        if (!existsSync(p))
            return false;
        const raw = readFileSync(p, "utf-8");
        const marker = JSON.parse(raw);
        return marker.signature === signature;
    }
    catch {
        return false;
    }
}
/**
 * Record that guidance has been shown for this signature.
 * Best-effort; FS errors are swallowed.
 */
export function markGuidanceShown(memoryDir, signature, version) {
    try {
        const p = markerPath(memoryDir);
        mkdirSync(dirname(p), { recursive: true });
        const marker = { signature, shownAt: Date.now(), version };
        writeFileSync(p, JSON.stringify(marker, null, 2), "utf-8");
    }
    catch {
        // Swallow: read-only dir must not break startup.
    }
}
/** Test hook: clear the marker (used by tests). */
export function clearGuidanceMarker(memoryDir) {
    try {
        const p = markerPath(memoryDir);
        if (existsSync(p)) {
            unlinkSync(p);
        }
    }
    catch {
        // ignore
    }
}
