/**
 * utils/mmap-state.ts — Read extended-claw mmap structured state.
 *
 * v4.6 Gateway writes 4KB JSON heartbeat to /var/claw_shared_state every 5s.
 * Zero-copy read — no IPC overhead, no socket creation.
 */

import { existsSync, readFileSync } from "node:fs";

const MMAP_PATH = "/var/claw_shared_state";

/** Parsed Gateway heartbeat state. */
export interface MmapGatewayState {
  /** Gateway process PID */
  pid?: number;
  /** Uptime in seconds */
  uptime?: number;
  /** RSS memory in MB */
  memoryRss?: number;
  /** Registered _gatewayMethods list */
  methods?: string[];
  /** Gateway version (e.g. "v4.6") */
  version?: string;
  /** Last heartbeat timestamp (epoch ms) */
  timestamp?: number;
}

/** Read mmap state without parsing errors. */
export function readMmapState(): MmapGatewayState | null {
  if (!existsSync(MMAP_PATH)) return null;
  try {
    // 4KB shared region — read small, fast
    const buf = readFileSync(MMAP_PATH, { encoding: "utf-8", flag: "r" });
    // JSON segment may be padded — extract first complete JSON object
    const match = buf.match(/\{[\s\S]*?\}(?=\s*$)/);
    if (!match) return null;
    const data = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      pid: typeof data.pid === "number" ? data.pid : undefined,
      uptime: typeof data.uptime === "number" ? data.uptime : undefined,
      memoryRss: typeof data.memory_rss === "number" ? data.memory_rss : undefined,
      methods: Array.isArray(data.methods) ? data.methods.filter((m): m is string => typeof m === "string") : undefined,
      version: typeof data.version === "string" ? data.version : undefined,
      timestamp: typeof data.timestamp === "number" ? data.timestamp : undefined,
    };
  } catch {
    return null;
  }
}

/** Check if Gateway is alive based on heartbeat recency. */
export function isGatewayAlive(thresholdMs = 15000): boolean {
  const state = readMmapState();
  if (!state?.timestamp) return false;
  return Date.now() - state.timestamp < thresholdMs;
}

/** Get Gateway version string or null. */
export function getGatewayVersion(): string | null {
  return readMmapState()?.version ?? null;
}

/** Check if a specific method is registered in _gatewayMethods. */
export function hasGatewayMethod(method: string): boolean {
  const methods = readMmapState()?.methods;
  if (!methods) return false;
  return methods.includes(method);
}
