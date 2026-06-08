/**
 * utils/claw-bridge.ts — Full claw-bridge with convenience APIs.
 *
 * Extends ClawBridgeBase with v4.6+ methods and factory.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ClawBridgeBase } from './claw-bridge-base.ts';
import {
  ClawBridgeError,
  type ClawBridgeOpts,
  type ClawRecallResult,
} from './claw-bridge-types.ts';

export class ClawBridge extends ClawBridgeBase {
  /** v4.6: Query _gatewayMethods registry. */
  async listMethods(): Promise<string[]> {
    try {
      const result = await this.call('listMethods', {});
      const raw = result as Record<string, unknown>;
      if (Array.isArray(raw.methods)) {
        return raw.methods.filter((m): m is string => typeof m === 'string');
      }
      return [];
    } catch {
      return [];
    }
  }

  /** v4.6: Transparent Gateway proxy call via Worker _GatewayProxy. */
  async callGateway(gatewayMethod: string, params: Record<string, unknown>): Promise<unknown> {
    return this.call('gateway', { method: gatewayMethod, params });
  }

  /** v4.6: SmartProcessor unified routing — process_rccam(). */
  async processRccam(state: Record<string, unknown>): Promise<unknown> {
    return this.call('process_rccam', { state });
  }

  /** Convenience: claw_recall with bounded results. */
  async recall(query: string, limit = 3): Promise<ClawRecallResult> {
    const result = await this.call('recall', { query, limit, source: 'yaoyao-proxy' });
    const raw = (result as Record<string, unknown>) || {};
    const memories = Array.isArray(raw.memories) ? raw.memories : [];
    return {
      memories: memories.slice(0, limit).map((m: unknown) => {
        const rm = m as Record<string, unknown>;
        return {
          content: String(rm.content ?? rm.text ?? ''),
          confidence: Number(rm.confidence ?? 0.8),
          source: String(rm.source ?? 'claw-core'),
        };
      }),
      verified: Boolean(raw.verified ?? false),
    };
  }
}

/** Factory — returns null if claw-core not available. */
export function createClawBridge(opts?: ClawBridgeOpts): ClawBridge | null {
  const home = process.env.HOME || '/home/sandbox';
  const udsPath =
    opts?.udsPath || path.join(home, '.openclaw/extensions/claw-core/var/claw-worker.sock');
  if (!existsSync(udsPath)) return null;
  return new ClawBridge(opts);
}

// Re-export base and types for consumers
export { ClawBridgeBase } from './claw-bridge-base.ts';
export {
  ClawBridgeError,
  type ClawBridgeOpts,
  type ClawRecallResult,
  type ClawErrorClass,
  type PendingReq,
} from './claw-bridge-types.ts';
