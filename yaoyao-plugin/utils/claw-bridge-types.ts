/**
 * utils/claw-bridge-types.ts — Types and error classes for claw-bridge.
 */

export interface ClawBridgeOpts {
  udsPath?: string;
  timeoutMs?: number;
  maxInFlight?: number;
  healthCheckMs?: number;
}

export interface ClawRecallResult {
  memories: Array<{ content: string; confidence: number; source: string }>;
  verified: boolean;
}

export type ClawErrorClass = "unavailable" | "timeout" | "transient" | "fatal";

export class ClawBridgeError extends Error {
  readonly classification: ClawErrorClass;
  readonly cause?: unknown;
  constructor(message: string, classification: ClawErrorClass, cause?: unknown) {
    super(message);
    this.name = "ClawBridgeError";
    this.classification = classification;
    this.cause = cause;
  }
}

/** Single pending request in the queue. */
export interface PendingReq {
  id: string;
  method: string;
  params: Record<string, unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}
