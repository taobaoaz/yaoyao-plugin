/**
 * celia/client.ts — stdio JSON-RPC 2.0 client for celia_memory_mcp_server.
 *
 * v1.9.1: Enables yaoyao to *delegate* overlapping memory operations to the
 * official memory-celia plugin (华为小艺 Claw) when it owns the memory slot,
 * and to *proxy* celia-only capabilities (dream / scene / global summary).
 *
 * Why spawn the binary directly?
 *   The OpenClaw plugin API has no cross-plugin tool-invocation channel
 *   (SDK surface = registerTool/registerHook/on). But celia is an MCP server
 *   (stdio JSON-RPC 2.0, see celia-memory-architecture §3.1). We act as its
 *   MCP client exactly like celia's own TS plugin (CeliaMcpClient, §3.2).
 *
 * Lifecycle:
 *   - Lazy: the server is spawned on first callTool(), not at construction.
 *   - Singleton per serverBinaryPath (getCeliaClient()).
 *   - Exponential backoff restart (1s → 30s, max 10, stable window 30s)
 *     per celia-memory-architecture TABLE 0.
 *   - Request timeout 120s (same doc).
 *
 * Safety:
 *   - Read/delegate only. This client never writes to celia's DB directly;
 *     writes go through celia's own tools (single source of truth).
 *   - All failures degrade gracefully: callers fall back to yaoyao's own
 *     implementation (see tools/index.ts wrapWithCeliaDelegate).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

/** JSON-RPC 2.0 request envelope. */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** JSON-RPC 2.0 response envelope. */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Result returned by tools/call: an array of content parts. */
export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  _meta?: Record<string, unknown>;
}

/** Restart policy (mirrors celia-memory-architecture TABLE 0). */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const MAX_RESTARTS = 10;
const STABLE_WINDOW_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 15_000;

export interface CeliaClientOptions {
  /** Absolute path to celia_memory_mcp_server binary. */
  serverBinaryPath: string;
  /** Optional env injected into the spawned process (e.g. API keys). */
  env?: Record<string, string>;
  /** Logger sink; defaults to no-op. */
  logger?: { debug?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
}

/**
 * Resolve the celia server binary path with precedence:
 *   1. explicit option
 *   2. ~/.openclaw/extensions/celia_memory/current/bin/celia_memory_mcp_server
 *   3. OPENCLAW_HOME-relative variant of #2
 * Returns "" if none found.
 */
export function resolveCeliaBinaryPath(explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    join(homedir(), ".openclaw", "extensions", "celia_memory", "current", "bin", "celia_memory_mcp_server"),
    process.env.OPENCLAW_HOME
      ? join(process.env.OPENCLAW_HOME, "extensions", "celia_memory", "current", "bin", "celia_memory_mcp_server")
      : "",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "";
}

export class CeliaMcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private buffer = "";
  private startedAt = 0;
  private restartCount = 0;
  private connected = false;
  private initializing: Promise<boolean> | null = null;

  private opts: CeliaClientOptions;
  constructor(opts: CeliaClientOptions) {
    this.opts = opts;
  }

  /** Spawn the server (if not already) and perform MCP initialize handshake. */
  async start(): Promise<boolean> {
    if (this.connected && this.proc) return true;
    if (this.initializing) return this.initializing;

    this.initializing = this._doStart();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  private async _doStart(): Promise<boolean> {
    const bin = resolveCeliaBinaryPath(this.opts.serverBinaryPath);
    if (!bin) {
      this.opts.logger?.warn?.("[yaoyao:celia] server binary not found; delegation disabled");
      return false;
    }
    try {
      this.proc = spawn(bin, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.opts.env },
      });
    } catch (e) {
      this.opts.logger?.error?.(`[yaoyao:celia] spawn failed: ${(e as Error).message}`);
      return false;
    }
    this.startedAt = Date.now();

    this.proc.stdout.setEncoding("utf-8");
    this.proc.stdout.on("data", (chunk: string) => this._onStdout(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.opts.logger?.debug?.(`[yaoyao:celia:stderr] ${chunk.toString().trim()}`);
    });
    this.proc.on("exit", (code, signal) => this._onExit(code, signal));

    // MCP initialize handshake
    try {
      await this._rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "yaoyao-memory", version: "1.9.2" },
      }, INIT_TIMEOUT_MS);
      // Acknowledge initialized notification (fire-and-forget)
      this._notify("notifications/initialized", {});
      this.connected = true;
      this.opts.logger?.debug?.("[yaoyao:celia] MCP initialized");
      return true;
    } catch (e) {
      this.opts.logger?.error?.(`[yaoyao:celia] initialize handshake failed: ${(e as Error).message}`);
      this._killProc();
      return false;
    }
  }

  /** Invoke a celia tool by name with already-mapped arguments. */
  async callTool(name: string, args: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<McpToolResult> {
    if (!(await this.start())) {
      throw new Error("celia server unavailable");
    }
    const result = await this._rpc("tools/call", { name, arguments: args }, timeoutMs);
    return result as McpToolResult;
  }

  /** Whether the server is connected and the initialize handshake completed. */
  isConnected(): boolean {
    return this.connected && !!this.proc && !this.proc.killed;
  }

  /** Gracefully shut down the server. */
  close(graceMs = 2000): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("client closing"));
    }
    this.pending.clear();
    this._killProc();
    // give the process a moment to exit cleanly
    setTimeout(() => { /* noop, fire-and-forget */ }, Math.min(graceMs, 1000));
  }

  // ── internals ──

  private _rpc(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.killed) {
        reject(new Error("celia process not running"));
        return;
      }
      const id = this.nextId++;
      const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`celia rpc timeout (${method} after ${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    });
  }

  private _notify(method: string, params: Record<string, unknown>): void {
    if (!this.proc || this.proc.killed) return;
    const note = { jsonrpc: "2.0", method, params } as const;
    try {
      this.proc.stdin.write(JSON.stringify(note) + "\n");
    } catch {
      /* ignore — notification is best-effort */
    }
  }

  private _onStdout(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line);
      } catch {
        // Not JSON (e.g. a log line); skip.
        continue;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) continue;
      clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  private _onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.connected = false;
    // Reject all in-flight requests
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(`celia process exited (code=${code} signal=${signal})`));
    }
    this.pending.clear();
    this.proc = null;

    // Restart with exponential backoff, but only if the process died early.
    const uptime = Date.now() - this.startedAt;
    const wasStable = uptime >= STABLE_WINDOW_MS;
    if (wasStable) this.restartCount = 0;
    if (this.restartCount >= MAX_RESTARTS) {
      this.opts.logger?.error?.(`[yaoyao:celia] giving up after ${MAX_RESTARTS} restarts`);
      return;
    }
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.restartCount);
    this.restartCount++;
    this.opts.logger?.warn?.(
      `[yaoyao:celia] process exited; restarting in ${delay}ms (attempt ${this.restartCount}/${MAX_RESTARTS})`,
    );
    setTimeout(() => { this.start().catch(() => { /* logged inside */ }); }, delay);
  }

  private _killProc(): void {
    this.connected = false;
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill("SIGTERM"); } catch { /* ignore */ }
    }
    this.proc = null;
  }
}

// ── Singleton per binary path ──

let _singleton: CeliaMcpClient | null = null;
let _singletonPath = "";

/** Get or create the shared celia client for the given binary path. */
export function getCeliaClient(opts: CeliaClientOptions): CeliaMcpClient {
  if (_singleton && _singletonPath === opts.serverBinaryPath) {
    return _singleton;
  }
  _singleton = new CeliaMcpClient(opts);
  _singletonPath = opts.serverBinaryPath;
  return _singleton;
}

/** Drop the singleton (used by tests / when bridge is disabled). */
export function resetCeliaClient(): void {
  if (_singleton) {
    _singleton.close();
    _singleton = null;
    _singletonPath = "";
  }
}
