/**
 * Numeric clamp utility — coerce + bounds + default fallback.
 *
 * Usage:
 *   clampNum(params.limit, 20, 1, 500)   // default=20, min=1, max=500
 */
export function clampNum(val, defaultVal, min, max) {
    const num = Number(val);
    if (Number.isNaN(num))
        return defaultVal;
    return Math.max(min, Math.min(max, num));
}
