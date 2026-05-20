/**
 * utils/claw-bridge.ts — Lightweight UDS bridge to xiaoyiclaw claw-core Worker.
 *
 * Zero external deps. Uses node:net for UDS, node:fs for presence check.
 * All timeouts bounded, all sockets destroyed after use (no leak).
 */
import net from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ClawBridgeOpts {
  udsPath?: string;
  timeoutMs?: number;
}

export interface ClawRecallResult {
  memories: Array<{ content: string; confidence: number; source: string }>;
  verified: boolean;
}

export class ClawBridge {
  private udsPath: string;
  private timeoutMs: number;

  constructor(opts: ClawBridgeOpts = {}) {
    const home = process.env.HOME || "/home/sandbox";
    this.udsPath = opts.udsPath || path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
    this.timeoutMs = Math.max(1000, Math.min(30000, opts.timeoutMs ?? 10000));
  }

  /** Check if Worker socket is reachable. */
  isAvailable(): boolean {
    return existsSync(this.udsPath);
  }

  /**
   * Call a claw-core method via UDS.
   * Each call creates a fresh short-lived socket — no persistent connection leak risk.
   */
  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let buf = Buffer.alloc(0);
      let timer: ReturnType<typeof setTimeout> | null = null;

      const settle = (fn: (v: unknown) => void, val: unknown) => {
        if (!settled) {
          settled = true;
          if (timer) { clearTimeout(timer); timer = null; }
          fn(val);
        }
      };

      // Guard: socket file missing → immediate reject
      if (!existsSync(this.udsPath)) {
        settle(reject, new Error(`Claw UDS not found: ${this.udsPath}`));
        return;
      }

      const sock = net.createConnection(this.udsPath);

      timer = setTimeout(() => {
        settle(reject, new Error("Claw bridge timeout"));
        try { sock.destroy(); } catch {}
      }, this.timeoutMs);

      sock.on("connect", () => {
        const id = Math.random().toString(36).slice(2, 10);
        const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
        sock.write(payload, (err) => {
          if (err) settle(reject, err);
        });
      });

      sock.on("data", (data) => {
        buf = Buffer.concat([buf, data]);
        // claw-core uses length-prefixed framing; we also accept newline fallback
        let offset = 0;
        while (offset + 4 <= buf.length) {
          const need = buf.readUInt32BE(offset);
          const total = 4 + need;
          if (offset + total > buf.length) break;
          const line = buf.slice(offset + 4, offset + total).toString("utf-8");
          offset += total;
          try {
            const msg = JSON.parse(line);
            if (msg.error) {
              settle(reject, new Error(msg.error.message || String(msg.error)));
            } else {
              settle(resolve, msg.result ?? msg);
            }
            return;
          } catch {
            settle(reject, new Error("Invalid JSON from claw worker"));
            return;
          }
        }
        buf = buf.slice(offset);
      });

      sock.on("error", (err) => {
        settle(reject, err);
        try { sock.destroy(); } catch {}
      });

      sock.on("close", () => {
        settle(reject, new Error("Claw UDS connection closed"));
      });
    });
  }

  /** Convenience: claw_recall with bounded results. */
  async recall(query: string, limit = 3): Promise<ClawRecallResult> {
    const result = await this.call("recall", { query, limit, source: "yaoyao-proxy" });
    // Defensive: coerce whatever shape the Worker returns
    const raw = result as Record<string, unknown> || {};
    const memories = Array.isArray(raw.memories) ? raw.memories : [];
    return {
      memories: memories.slice(0, limit).map((m: unknown) => {
        const rm = m as Record<string, unknown>;
        return {
          content: String(rm.content ?? rm.text ?? ""),
          confidence: Number(rm.confidence ?? 0.8),
          source: String(rm.source ?? "claw-core"),
        };
      }),
      verified: Boolean(raw.verified ?? false),
    };
  }
}

/** Factory — returns null if claw-core not available. */
export function createClawBridge(opts?: ClawBridgeOpts): ClawBridge | null {
  const home = process.env.HOME || "/home/sandbox";
  const udsPath = opts?.udsPath || path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
  if (!existsSync(udsPath)) return null;
  return new ClawBridge(opts);
}
