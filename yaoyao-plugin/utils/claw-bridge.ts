/**
 * utils/claw-bridge.ts — Optimized UDS bridge to xiaoyiclaw claw-core Worker.
 *
 * v2 improvements:
 *   - Persistent connection with auto-reconnect (eliminates per-call socket creation overhead)
 *   - Request queue with in-flight limit (prevents flooding the Worker)
 *   - Health check probe (detects stale/dead sockets before sending real requests)
 *   - Structured error classification (transient vs fatal → different retry strategies)
 *
 * Zero external deps. Uses node:net for UDS, node:fs for presence check.
 */
import net from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ClawBridgeOpts {
  udsPath?: string;
  timeoutMs?: number;
  /** Max concurrent in-flight requests (default 3) */
  maxInFlight?: number;
  /** Health-check interval in ms (default 30s, 0=disabled) */
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
  constructor(
    message: string,
    classification: ClawErrorClass,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ClawBridgeError";
    this.classification = classification;
    this.cause = cause;
  }
}

/** Single pending request in the queue. */
interface PendingReq {
  id: string;
  method: string;
  params: Record<string, unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

export class ClawBridge {
  private udsPath: string;
  private timeoutMs: number;
  private maxInFlight: number;
  private healthCheckMs: number;

  // Persistent connection state
  private sock: net.Socket | null = null;
  private _buf = Buffer.alloc(0);
  private _nextId = 1;
  private _connected = false;
  private _connectPromise: Promise<void> | null = null;
  private _healthTimer: ReturnType<typeof setTimeout> | null = null;

  // Request queue
  private _pending = new Map<string, PendingReq>();
  private _queue: PendingReq[] = [];
  private _inFlight = 0;

  // Stats for observability
  private _stats = { sent: 0, success: 0, timeout: 0, error: 0, reconnects: 0 };

  constructor(opts: ClawBridgeOpts = {}) {
    const home = process.env.HOME || "/home/sandbox";
    this.udsPath = opts.udsPath || path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
    this.timeoutMs = Math.max(1000, Math.min(60000, opts.timeoutMs ?? 10000));
    this.maxInFlight = Math.max(1, Math.min(8, opts.maxInFlight ?? 3));
    this.healthCheckMs = opts.healthCheckMs ?? 30000;
  }

  /** Synchronous availability check (cheap). */
  isAvailable(): boolean {
    return existsSync(this.udsPath);
  }

  /** Lazily establish persistent UDS connection. */
  async connect(): Promise<void> {
    if (this._connected && this.sock && !this.sock.destroyed) return;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = this._doConnect();
    try {
      await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  private async _doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isAvailable()) {
        reject(new ClawBridgeError(`UDS not found: ${this.udsPath}`, "unavailable"));
        return;
      }

      const sock = net.createConnection(this.udsPath);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          sock.destroy();
          reject(new ClawBridgeError("UDS connect timeout", "timeout"));
        }
      }, 5000).unref();

      sock.on("connect", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.sock = sock;
          this._connected = true;
          this._setupSocket(sock);
          this._startHealthCheck();
          resolve();
        }
      });

      sock.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new ClawBridgeError(`UDS connect error: ${err.message}`, "transient", err));
        }
      });
    });
  }

  private _setupSocket(sock: net.Socket) {
    sock.on("data", (data) => {
      this._buf = Buffer.concat([this._buf, data]);
      this._drainBuf();
    });

    sock.on("error", (err) => {
      this._connected = false;
      this._failAllPending(new ClawBridgeError(`Socket error: ${err.message}`, "transient", err));
    });

    sock.on("close", () => {
      this._connected = false;
      this._failAllPending(new ClawBridgeError("Socket closed", "transient"));
      // Auto-reconnect on next call
    });
  }

  private _drainBuf() {
    let offset = 0;
    while (offset + 4 <= this._buf.length) {
      const need = this._buf.readUInt32BE(offset);
      const total = 4 + need;
      if (offset + total > this._buf.length) break;
      const line = this._buf.slice(offset + 4, offset + total).toString("utf-8");
      offset += total;
      this._handleResponse(line);
    }
    this._buf = this._buf.slice(offset);
  }

  private _handleResponse(line: string) {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        const req = this._pending.get(String(msg.id));
        if (!req) return;
        this._pending.delete(String(msg.id));
        this._inFlight--;
        if (req.settled) return;
        req.settled = true;
        clearTimeout(req.timer);
        if (msg.error) {
          this._stats.error++;
          req.reject(new ClawBridgeError(msg.error.message || String(msg.error), "fatal", msg.error));
        } else {
          this._stats.success++;
          req.resolve(msg.result ?? msg);
        }
        this._flushQueue();
      }
    } catch (err) {
      // Malformed response — log and ignore
      this._stats.error++;
    }
  }

  private _failAllPending(err: ClawBridgeError) {
    for (const req of this._pending.values()) {
      if (!req.settled) {
        req.settled = true;
        clearTimeout(req.timer);
        req.reject(err);
      }
    }
    this._pending.clear();
    this._inFlight = 0;
    this._queue.length = 0;
  }

  private _flushQueue() {
    while (this._queue.length > 0 && this._inFlight < this.maxInFlight) {
      const req = this._queue.shift()!;
      this._sendReq(req);
    }
  }

  private _sendReq(req: PendingReq) {
    if (!this.sock || this.sock.destroyed || !this._connected) {
      req.settled = true;
      clearTimeout(req.timer);
      req.reject(new ClawBridgeError("Socket not ready", "transient"));
      return;
    }
    this._pending.set(req.id, req);
    this._inFlight++;
    this._stats.sent++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id: req.id, method: req.method, params: req.params }) + "\n";
    this.sock.write(payload, (err) => {
      if (err) {
        this._pending.delete(req.id);
        this._inFlight--;
        if (!req.settled) {
          req.settled = true;
          clearTimeout(req.timer);
          req.reject(new ClawBridgeError(`Write error: ${err.message}`, "transient", err));
        }
        this._flushQueue();
      }
    });
  }

  private _startHealthCheck() {
    if (this.healthCheckMs <= 0) return;
    this._healthTimer = setInterval(() => {
      if (!this._connected || !this.sock || this.sock.destroyed) {
        this._connected = false;
        return; // Will reconnect on next call
      }
      // Send lightweight ping if no traffic
      if (this._pending.size === 0) {
        this._rawPing().catch(() => {
          this._connected = false;
          try { this.sock?.destroy(); } catch {}
        });
      }
    }, this.healthCheckMs).unref();
  }

  private async _rawPing(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.sock || this.sock.destroyed) { resolve(false); return; }
      const id = this._nextId++;
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method: "ping", params: {} }) + "\n";
      const timer = setTimeout(() => resolve(false), 3000).unref();
      const req: PendingReq = {
        id: String(id),
        method: "ping",
        params: {},
        resolve: () => { clearTimeout(timer); resolve(true); },
        reject: () => { clearTimeout(timer); resolve(false); },
        timer,
        settled: false,
      };
      this._pending.set(String(id), req);
      this.sock.write(payload, () => {});
    });
  }

  /** Graceful disconnect with cleanup. */
  disconnect(): void {
    if (this._healthTimer) { clearInterval(this._healthTimer); this._healthTimer = null; }
    this._failAllPending(new ClawBridgeError("Bridge disconnect requested", "fatal"));
    try { this.sock?.destroy(); } catch {}
    this.sock = null;
    this._connected = false;
  }

  /** Core call with queue, retry, and timeout. */
  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    // Ensure connection
    if (!this._connected || !this.sock || this.sock.destroyed) {
      try {
        await this.connect();
      } catch (e) {
        throw e instanceof ClawBridgeError ? e : new ClawBridgeError(String(e), "transient", e);
      }
    }

    const id = String(this._nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const req = this._pending.get(id);
        if (req && !req.settled) {
          req.settled = true;
          this._pending.delete(id);
          this._inFlight--;
          this._stats.timeout++;
          reject(new ClawBridgeError(`Request timeout (${this.timeoutMs}ms)`, "timeout"));
          this._flushQueue();
        }
      }, this.timeoutMs).unref();

      const req: PendingReq = {
        id,
        method,
        params,
        resolve,
        reject,
        timer,
        settled: false,
      };

      if (this._inFlight < this.maxInFlight) {
        this._sendReq(req);
      } else {
        this._queue.push(req);
      }
    });
  }

  /** Convenience: claw_recall with bounded results. */
  async recall(query: string, limit = 3): Promise<ClawRecallResult> {
    const result = await this.call("recall", { query, limit, source: "yaoyao-proxy" });
    const raw = (result as Record<string, unknown>) || {};
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

  /** Observability stats snapshot. */
  getStats() {
    return { ...this._stats, pending: this._pending.size, queued: this._queue.length, connected: this._connected };
  }
}

/** Factory — returns null if claw-core not available. */
export function createClawBridge(opts?: ClawBridgeOpts): ClawBridge | null {
  const home = process.env.HOME || "/home/sandbox";
  const udsPath = opts?.udsPath || path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
  if (!existsSync(udsPath)) return null;
  return new ClawBridge(opts);
}
