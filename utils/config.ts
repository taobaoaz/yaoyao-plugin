/**
 * Config value helpers — type-safe(ish) property extraction with fallbacks.
 *
 * Centralises the `(config as Record<string, unknown>).foo` pattern so
 * we have one place to change the cast strategy if we ever move to strict mode.
 */

/** Get a primitive property from an object, with fallback. */
export function getProp<T>(obj: unknown, key: string, fallback: T): T {
  if (!obj || typeof obj !== "object") return fallback;
  const val = (obj as Record<string, unknown>)[key];
  if (val === undefined || val === null) return fallback;
  return val as T;
}

/** Get a nested object property, returning undefined if missing or not an object. */
export function getObj(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const val = (obj as Record<string, unknown>)[key];
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return undefined;
}

/** Get a boolean property, coercing truthy/falsy values. */
export function getBool(obj: unknown, key: string, fallback: boolean): boolean {
  if (!obj || typeof obj !== "object") return fallback;
  const val = (obj as Record<string, unknown>)[key];
  if (val === undefined || val === null) return fallback;
  return Boolean(val);
}
