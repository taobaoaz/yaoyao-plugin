/**
 * hooks/capture-coexist.ts — Coexistence detection + claw-bridge lazy init.
 *
 * Pure factory, returns read-only coexist context for capture.
 */
import { getCoexistState } from "../utils/coexistence.js";
import { createClawBridge } from "../utils/claw-bridge.js";
/** Build coexist context for capture decisions. */
export function createCoexistContext(_config) {
    const coexist = getCoexistState();
    const skipLocalIndexing = coexist.flags.skipLocalIndexing;
    const forwardCapture = coexist.flags.forwardCaptureToClaw;
    const clawBridge = forwardCapture ? (createClawBridge() ?? null) : null;
    const parts = [];
    if (skipLocalIndexing)
        parts.push("[coexist: L1/L2 skipped]");
    if (forwardCapture)
        parts.push("[coexist: forwarding to claw-core]");
    return { skipLocalIndexing, forwardCapture, clawBridge, logSuffix: parts.join("") };
}
