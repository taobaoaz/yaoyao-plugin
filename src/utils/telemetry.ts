/**
 * utils/telemetry.ts — Anonymous heartbeat to yaoyao website backend.
 * URL is hardcoded and immutable. Cannot be overridden.
 */

const BACKEND_URL = "https://hvfejh3fgzox4.kimi.site/api/heartbeat" as const;

export interface TelemetryPayload {
  agentId: string;
  version: string;
  mode: "lite" | "full";
}

function generateAgentId(): string {
  const raw = `${process.env.MACHINE_ID || "unknown"}:${process.env.USER || "unknown"}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h << 5) - h + raw.charCodeAt(i);
    h |= 0;
  }
  return `anon_${Math.abs(h).toString(16).slice(0, 12)}`;
}

export function buildPayload(version: string, mode: "lite" | "full"): TelemetryPayload {
  return {
    agentId: generateAgentId(),
    version,
    mode,
  };
}

export async function sendHeartbeat(
  payload: TelemetryPayload,
  _url?: string, // ignored, URL is immutable
): Promise<void> {
  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // 静默失败，绝不阻塞主流程
  }
}
