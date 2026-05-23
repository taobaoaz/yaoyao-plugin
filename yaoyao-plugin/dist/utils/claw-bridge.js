/**
 * utils/claw-bridge.ts — Full claw-bridge with convenience APIs.
 *
 * Extends ClawBridgeBase with v4.6+ methods and factory.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { ClawBridgeBase } from "./claw-bridge-base.js";
export class ClawBridge extends ClawBridgeBase {
    /** v4.6: Query _gatewayMethods registry. */
    async listMethods() {
        try {
            const result = await this.call("listMethods", {});
            const raw = result;
            if (Array.isArray(raw.methods)) {
                return raw.methods.filter((m) => typeof m === "string");
            }
            return [];
        }
        catch {
            return [];
        }
    }
    /** v4.6: Transparent Gateway proxy call via Worker _GatewayProxy. */
    async callGateway(gatewayMethod, params) {
        return this.call("gateway", { method: gatewayMethod, params });
    }
    /** v4.6: SmartProcessor unified routing — process_rccam(). */
    async processRccam(state) {
        return this.call("process_rccam", { state });
    }
    /** Convenience: claw_recall with bounded results. */
    async recall(query, limit = 3) {
        const result = await this.call("recall", { query, limit, source: "yaoyao-proxy" });
        const raw = result || {};
        const memories = Array.isArray(raw.memories) ? raw.memories : [];
        return {
            memories: memories.slice(0, limit).map((m) => {
                const rm = m;
                return {
                    content: String(rm.content ?? rm.text ?? ""),
                    confidence: Number(rm.confidence ?? 0.8),
                    source: String(rm.source ?? "claw-core"),
                };
            }),
            verified: Boolean(raw.verified ?? false),
        };
    }
}
/** Factory — returns null if claw-core not available. */
export function createClawBridge(opts) {
    const home = process.env.HOME || "/home/sandbox";
    const udsPath = opts?.udsPath || path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
    if (!existsSync(udsPath))
        return null;
    return new ClawBridge(opts);
}
// Re-export base and types for consumers
export { ClawBridgeBase } from "./claw-bridge-base.js";
export { ClawBridgeError } from "./claw-bridge-types.js";
