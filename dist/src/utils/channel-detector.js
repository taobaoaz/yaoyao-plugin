/**
 * utils/channel-detector.ts — Channel & device metadata extraction.
 *
 * v1.8.0: Extracts channel and device type information from OpenClaw
 * event context objects. Gracefully degrades to "unknown" when fields
 * are not present.
 */

const DEVICE_TYPE_VALUES = new Set(["pad", "phone", "tablet"]);

export function detectChannelInfo(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return { channel: "unknown", deviceType: "unknown" };
    }

    const c = ctx;
    const meta = (c.meta || c.metadata || c.channel);

    let channel = "unknown";
    const channelRaw = _firstString(c, meta, ["channel", "channelType", "transport", "protocol"]);
    if (channelRaw) {
        const lower = channelRaw.toLowerCase();
        if (lower.includes("a2a")) channel = "a2a";
        else if (lower.includes("websocket") || lower.includes("ws")) channel = "websocket";
        else if (lower.includes("standard") || lower.includes("local")) channel = "standard";
    }

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

export function detectChannelFromEvent(event) {
    if (!event || typeof event !== "object") {
        return { channel: "unknown", deviceType: "unknown" };
    }
    const e = event;

    const fromEvent = detectChannelInfo(e);
    if (fromEvent.channel !== "unknown" || fromEvent.deviceType !== "unknown") {
        return fromEvent;
    }

    const session = e.session;
    if (session) {
        const fromSession = detectChannelInfo(session);
        if (fromSession.channel !== "unknown" || fromSession.deviceType !== "unknown") {
            return fromSession;
        }
    }

    const context = e.context;
    if (context) {
        return detectChannelInfo(context);
    }

    return { channel: "unknown", deviceType: "unknown" };
}

function _firstString(primary, secondary, keys) {
    for (const key of keys) {
        if (primary[key] && typeof primary[key] === "string") return primary[key];
        if (secondary && secondary[key] && typeof secondary[key] === "string") return secondary[key];
    }
    return undefined;
}