/**
 * utils/channel-detector.ts — Channel & device metadata extraction.
 *
 * v1.8.0: Extracts channel and device type information from OpenClaw
 * event context objects. Gracefully degrades to "unknown" when fields
 * are not present (standard OpenClaw without XiaoYi channel).
 *
 * All functions are pure and side-effect free.
 */
const DEVICE_TYPE_VALUES = new Set(["pad", "phone", "tablet"]);
/**
 * Extract channel and device metadata from an OpenClaw event context.
 * Tries multiple known field names for resilience across API versions.
 */
export function detectChannelInfo(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return { channel: "unknown", deviceType: "unknown" };
    }
    const c = ctx;
    const meta = (c.meta || c.metadata || c.channel);
    // Channel type
    let channel = "unknown";
    const channelRaw = _firstString(c, meta, ["channel", "channelType", "transport", "protocol"]);
    if (channelRaw) {
        const lower = channelRaw.toLowerCase();
        if (lower.includes("a2a"))
            channel = "a2a";
        else if (lower.includes("websocket") || lower.includes("ws"))
            channel = "websocket";
        else if (lower.includes("standard") || lower.includes("local"))
            channel = "standard";
    }
    // Device type
    let deviceType = "unknown";
    const deviceRaw = _firstString(c, meta, ["deviceType", "device_type", "device", "clientType"]);
    if (deviceRaw) {
        const lower = deviceRaw.toLowerCase();
        if (DEVICE_TYPE_VALUES.has(lower)) {
            deviceType = lower;
        }
    }
    return { channel, deviceType, ...(Object.keys(c).length > 0 ? { raw: c } : {}) };
}
/** Get first non-empty string value from multiple possible keys in one or two objects */
function _firstString(primary, secondary, keys) {
    for (const key of keys) {
        if (primary[key] && typeof primary[key] === "string")
            return primary[key];
        if (secondary && secondary[key] && typeof secondary[key] === "string")
            return secondary[key];
    }
    return undefined;
}
