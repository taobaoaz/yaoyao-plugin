export function pushError(sink, field, message, suggestion) {
    sink.push({ level: "error", field, message, suggestion });
}
export function pushWarn(sink, field, message, suggestion) {
    sink.push({ level: "warn", field, message, suggestion });
}
export function pushInfo(sink, field, message, suggestion) {
    sink.push({ level: "info", field, message, suggestion });
}
export function isValidUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol.startsWith("http");
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
        return false;
    }
}
export function isPositiveInt(n) {
    return typeof n === "number" && Number.isInteger(n) && n > 0;
}
export function inRange(n, min, max) {
    return n >= min && n <= max;
}
