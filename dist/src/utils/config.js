/**
 * Config value helpers — type-safe(ish) property extraction with fallbacks.
 *
 * Centralises the `(config as Record<string, unknown>).foo` pattern so
 * we have one place to change the cast strategy if we ever move to strict mode.
 */
/** Get a primitive property from an object, with fallback. */
export function getProp(obj, key, fallback) {
    if (!obj || typeof obj !== "object")
        return fallback;
    const val = obj[key];
    if (val === undefined || val === null)
        return fallback;
    return val;
}
/** Get a nested object property, returning undefined if missing or not an object. */
export function getObj(obj, key) {
    if (!obj || typeof obj !== "object")
        return undefined;
    const val = obj[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
        return val;
    }
    return undefined;
}
/** Get a boolean property, coercing truthy/falsy values. */
export function getBool(obj, key, fallback) {
    if (!obj || typeof obj !== "object")
        return fallback;
    const val = obj[key];
    if (val === undefined || val === null)
        return fallback;
    return Boolean(val);
}
