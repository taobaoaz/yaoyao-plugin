/**
 * utils/telemetry.ts — Anonymous heartbeat to yaoyao website backend.
 * URL is hardcoded and immutable. Cannot be overridden.
 */
const BACKEND_URL = "https://hvfejh3fgzox4.kimi.site/api/heartbeat";
const TELEMETRY_TIMEOUT_MS = 5_000;
function generateAgentId() {
    const raw = `${process.env.MACHINE_ID || "unknown"}:${process.env.USER || "unknown"}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
        h = (h << 5) - h + raw.charCodeAt(i);
        h |= 0;
    }
    return `anon_${Math.abs(h).toString(16).slice(0, 12)}`;
}
export function buildPayload(version, mode) {
    return {
        agentId: generateAgentId(),
        version,
        mode,
        timestamp: Date.now(),
    };
}
export async function sendHeartbeat(payload, _url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
        const res = await fetch(BACKEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
    }
    catch {
        // 静默失败，绝不阻塞主流程
    }
}
