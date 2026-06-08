/**
 * utils/telemetry.ts — Anonymous heartbeat to yaoyao website backend.
 */
const DEFAULT_URL = 'https://yaoyao.dev/api/heartbeat';
function generateAgentId() {
    const raw = `${process.env.MACHINE_ID || 'unknown'}:${process.env.USER || 'unknown'}`;
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
    };
}
export async function sendHeartbeat(payload, url) {
    const target = url || process.env.YAOYAO_TELEMETRY_URL || DEFAULT_URL;
    try {
        const res = await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
    }
}
