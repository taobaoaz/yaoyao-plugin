/**
 * utils/channel-detector.ts — Channel & device metadata extraction.
 *
 * v1.8.0: Extracts channel and device type information from OpenClaw
 * event context objects. Gracefully degrades to "unknown" when fields
 * are not present (standard OpenClaw without XiaoYi channel).
 *
 * All functions are pure and side-effect free.
 */

export interface ChannelInfo {
  channel: "a2a" | "websocket" | "standard" | "unknown";
  deviceType: "pad" | "phone" | "tablet" | "unknown";
  raw?: Record<string, unknown>;
}

const DEVICE_TYPE_VALUES = new Set(["pad", "phone", "tablet"]);

/**
 * Extract channel and device metadata from an OpenClaw event context.
 * Tries multiple known field names for resilience across API versions.
 */
export function detectChannelInfo(ctx: unknown): ChannelInfo {
  if (!ctx || typeof ctx !== "object") {
    return { channel: "unknown", deviceType: "unknown" };
  }

  const c = ctx as Record<string, unknown>;
  const meta = (c.meta || c.metadata || c.channel) as Record<string, unknown> | undefined;

  // Channel type
  let channel: ChannelInfo["channel"] = "unknown";
  const channelRaw = _firstString(c, meta, ["channel", "channelType", "transport", "protocol"]);
  if (channelRaw) {
    const lower = channelRaw.toLowerCase();
    if (lower.includes("a2a")) channel = "a2a";
    else if (lower.includes("websocket") || lower.includes("ws")) channel = "websocket";
    else if (lower.includes("standard") || lower.includes("local")) channel = "standard";
  }

  // Device type
  let deviceType: ChannelInfo["deviceType"] = "unknown";
  const deviceRaw = _firstString(c, meta, ["deviceType", "device_type", "device", "clientType"]);
  if (deviceRaw) {
    const lower = deviceRaw.toLowerCase();
    if (DEVICE_TYPE_VALUES.has(lower)) {
      deviceType = lower as ChannelInfo["deviceType"];
    }
  }

  return { channel, deviceType, ...(Object.keys(c).length > 0 ? { raw: c } : {}) };
}

/** Get first non-empty string value from multiple possible keys in one or two objects */
function _firstString(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (primary[key] && typeof primary[key] === "string") return primary[key] as string;
    if (secondary && secondary[key] && typeof secondary[key] === "string") return secondary[key] as string;
  }
  return undefined;
}