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
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
/** Restart policy (mirrors celia-memory-architecture TABLE 0). */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const MAX_RESTARTS = 10;
const STABLE_WINDOW_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 15_000;
/**
 * Resolve the celia server binary path with precedence:
 *   1. explicit option
 *   2. ~/.openclaw/extensions/celia_memory/current/bin/celia_memory_mcp_server
 *   3. OPENCLAW_HOME-relative variant of #2
 * Returns "" if none found.
 */
export function resolveCeliaBinaryPath(explicit) {
    if (explicit && existsSync(explicit))
        return explicit;
    const candidates = [
        join(homedir(), ".openclaw", "extensions", "celia_memory", "current", "bin", "celia_memory_mcp_server"),
        process.env.OPENCLAW_HOME
            ? join(process.env.OPENCLAW_HOME, "extensions", "celia_memory", "current", "bin", "celia_memory_mcp_server")
            : "",
    ].filter(Boolean);
    for (const c of candidates) {
        if (existsSync(c))
            return c;
    }
    return "";
}
export class CeliaMcpClient {
    opts;
    proc = null;
    nextId = 1;
    pending = new Map();
    buffer = "";
    startedAt = 0;
    restartCount = 0;
    connected = false;
    initializing = null;
    constructor(opts) {
        this.opts = opts;
    }
    /** Spawn the server (if not already) and perform MCP initialize handshake. */
    async start() {
        if (this.connected && this.proc)
            return true;
        if (this.initializing)
            return this.initializing;
        this.initializing = this._doStart();
        try {
            return await this.initializing;
        }
        finally {
            this.initializing = null;
        }
    }
    async _doStart() {
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
        }
        catch (e) {
            this.opts.logger?.error?.(`[yaoyao:celia] spawn failed: ${e.message}`);
            return false;
        }
        this.startedAt = Date.now();
        this.proc.stdout.setEncoding("utf-8");
        this.proc.stdout.on("data", (chunk) => this._onStdout(chunk));
        this.proc.stderr.on("data", (chunk) => {
            this.opts.logger?.debug?.(`[yaoyao:celia:stderr] ${chunk.toString().trim()}`);
        });
        this.proc.on("exit", (code, signal) => this._onExit(code, signal));
        // MCP initialize handshake
        try {
            await this._rpc("initialize", {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "yaoyao-memory", version: "1.9.1" },
            }, INIT_TIMEOUT_MS);
            // Acknowledge initialized notification (fire-and-forget)
            this._notify("notifications/initialized", {});
            this.connected = true;
            this.opts.logger?.debug?.("[yaoyao:celia] MCP initialized");
            return true;
        }
        catch (e) {
            this.opts.logger?.error?.(`[yaoyao:celia] initialize handshake failed: ${e.message}`);
            this._killProc();
            return false;
        }
    }
    /** Invoke a celia tool by name with already-mapped arguments. */
    async callTool(name, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
        if (!(await this.start())) {
            throw new Error("celia server unavailable");
        }
        const result = await this._rpc("tools/call", { name, arguments: args }, timeoutMs);
        return result;
    }
    /** Whether the server is connected and the initialize handshake completed. */
    isConnected() {
        return this.connected && !!this.proc && !this.proc.killed;
    }
    /** Gracefully shut down the server. */
    close(graceMs = 2000) {
        for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer);
            reject(new Error("client closing"));
        }
        this.pending.clear();
        this._killProc();
        // give the process a moment to exit cleanly
        setTimeout(() => { }, Math.min(graceMs, 1000));
    }
    // ── internals ──
    _rpc(method, params, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (!this.proc || this.proc.killed) {
                reject(new Error("celia process not running"));
                return;
            }
            const id = this.nextId++;
            const req = { jsonrpc: "2.0", id, method, params };
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`celia rpc timeout (${method} after ${timeoutMs}ms)`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.proc.stdin.write(JSON.stringify(req) + "\n");
        });
    }
    _notify(method, params) {
        if (!this.proc || this.proc.killed)
            return;
        const note = { jsonrpc: "2.0", method, params };
        try {
            this.proc.stdin.write(JSON.stringify(note) + "\n");
        }
        catch {
            /* ignore — notification is best-effort */
        }
    }
    _onStdout(chunk) {
        this.buffer += chunk;
        let nl;
        while ((nl = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.slice(0, nl).trim();
            this.buffer = this.buffer.slice(nl + 1);
            if (!line)
                continue;
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch {
                // Not JSON (e.g. a log line); skip.
                continue;
            }
            const entry = this.pending.get(msg.id);
            if (!entry)
                continue;
            clearTimeout(entry.timer);
            this.pending.delete(msg.id);
            if (msg.error) {
                entry.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
            }
            else {
                entry.resolve(msg.result);
            }
        }
    }
    _onExit(code, signal) {
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
        if (wasStable)
            this.restartCount = 0;
        if (this.restartCount >= MAX_RESTARTS) {
            this.opts.logger?.error?.(`[yaoyao:celia] giving up after ${MAX_RESTARTS} restarts`);
            return;
        }
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.restartCount);
        this.restartCount++;
        this.opts.logger?.warn?.(`[yaoyao:celia] process exited; restarting in ${delay}ms (attempt ${this.restartCount}/${MAX_RESTARTS})`);
        setTimeout(() => { this.start().catch(() => { }); }, delay);
    }
    _killProc() {
        this.connected = false;
        if (this.proc && !this.proc.killed) {
            try {
                this.proc.kill("SIGTERM");
            }
            catch { /* ignore */ }
        }
        this.proc = null;
    }
}
// ── Singleton per binary path ──
let _singleton = null;
let _singletonPath = "";
/** Get or create the shared celia client for the given binary path. */
export function getCeliaClient(opts) {
    if (_singleton && _singletonPath === opts.serverBinaryPath) {
        return _singleton;
    }
    _singleton = new CeliaMcpClient(opts);
    _singletonPath = opts.serverBinaryPath;
    return _singleton;
}
/** Drop the singleton (used by tests / when bridge is disabled). */
export function resetCeliaClient() {
    if (_singleton) {
        _singleton.close();
        _singleton = null;
        _singletonPath = "";
    }
}
