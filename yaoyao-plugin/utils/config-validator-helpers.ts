/**
 * utils/config-validator-helpers.ts — Validation helper utilities.
 */
import type { ConfigValidation } from "./config-validator.ts";

export type ValidationSink = ConfigValidation[];

export function pushError(
  sink: ValidationSink,
  field: string,
  message: string,
  suggestion?: string,
): void {
  sink.push({ level: "error", field, message, suggestion });
}

export function pushWarn(
  sink: ValidationSink,
  field: string,
  message: string,
  suggestion?: string,
): void {
  sink.push({ level: "warn", field, message, suggestion });
}

export function pushInfo(
  sink: ValidationSink,
  field: string,
  message: string,
  suggestion?: string,
): void {
  sink.push({ level: "info", field, message, suggestion });
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http");
  } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] Error: ${msg}`);
      return false;
    }
}

export function isPositiveInt(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export function inRange(n: number, min: number, max: number): boolean {
  return n >= min && n <= max;
}
