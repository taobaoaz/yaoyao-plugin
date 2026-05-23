/**
 * utils/ssrf-guard.ts — SSRF protection for embedding URLs.
 */
const FORBIDDEN_HOSTS = [
    "localhost", "127.0.0.1", "0.0.0.0", "::1",
    "169.254", "192.168", "10.", "fc00", "fe80",
];
function isForbidden172(host) {
    if (!host.startsWith("172."))
        return false;
    const second = parseInt(host.split(".")[1], 10);
    return second >= 16 && second <= 31;
}
export function isForbiddenHost(urlStr) {
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        return FORBIDDEN_HOSTS.some(h => host === h || host.startsWith(h)) || isForbidden172(host);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
        return true;
    }
}
