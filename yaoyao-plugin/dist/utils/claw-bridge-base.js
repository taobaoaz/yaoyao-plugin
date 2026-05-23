/**
 * utils/claw-bridge-base.ts — Core UDS bridge (connection + queue + call).
 *
 * No convenience methods — pure transport layer.
 */
import net from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import { ClawBridgeError } from "./claw-bridge-types.js";
export class ClawBridgeBase {
    udsPath;
    timeoutMs;
    maxInFlight;
    healthCheckMs;
    sock = null;
    _buf = Buffer.alloc(0);
    _nextId = 1;
    _connected = false;
    _connectPromise = null;
    _healthTimer = null;
    _pending = new Map();
    _queue = [];
    _inFlight = 0;
    _stats = { sent: 0, success: 0, timeout: 0, error: 0, reconnects: 0 };
    constructor(opts = {}) {
        const home = process.env.HOME || "/home/sandbox";
        this.udsPath = opts.udsPath || path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
        this.timeoutMs = Math.max(1000, Math.min(60000, opts.timeoutMs ?? 10000));
        this.maxInFlight = Math.max(1, Math.min(8, opts.maxInFlight ?? 3));
        this.healthCheckMs = opts.healthCheckMs ?? 30000;
    }
    isAvailable() { return existsSync(this.udsPath); }
    async connect() {
        if (this._connected && this.sock && !this.sock.destroyed)
            return;
        if (this._connectPromise)
            return this._connectPromise;
        this._connectPromise = this._doConnect();
        try {
            await this._connectPromise;
        }
        finally {
            this._connectPromise = null;
        }
    }
    async _doConnect() {
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
    _setupSocket(sock) {
        sock.on("data", (data) => { this._buf = Buffer.concat([this._buf, data]); this._drainBuf(); });
        sock.on("error", (err) => { this._connected = false; this._failAllPending(new ClawBridgeError(`Socket error: ${err.message}`, "transient", err)); });
        sock.on("close", () => { this._connected = false; this._failAllPending(new ClawBridgeError("Socket closed", "transient")); });
    }
    _drainBuf() {
        let offset = 0;
        while (offset + 4 <= this._buf.length) {
            const need = this._buf.readUInt32BE(offset);
            const total = 4 + need;
            if (offset + total > this._buf.length)
                break;
            const line = this._buf.slice(offset + 4, offset + total).toString("utf-8");
            offset += total;
            this._handleResponse(line);
        }
        this._buf = this._buf.slice(offset);
    }
    _handleResponse(line) {
        try {
            const msg = JSON.parse(line);
            if (msg.id === undefined)
                return;
            const req = this._pending.get(String(msg.id));
            if (!req)
                return;
            this._pending.delete(String(msg.id));
            this._inFlight--;
            if (req.settled)
                return;
            req.settled = true;
            clearTimeout(req.timer);
            if (msg.error) {
                this._stats.error++;
                req.reject(new ClawBridgeError(msg.error.message || String(msg.error), "fatal", msg.error));
            }
            else {
                this._stats.success++;
                req.resolve(msg.result ?? msg);
            }
            this._flushQueue();
        }
        catch {
            this._stats.error++;
        }
    }
    _failAllPending(err) {
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
    _flushQueue() {
        while (this._queue.length > 0 && this._inFlight < this.maxInFlight) {
            const req = this._queue.shift();
            this._sendReq(req);
        }
    }
    _sendReq(req) {
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
    _startHealthCheck() {
        if (this.healthCheckMs <= 0)
            return;
        this._healthTimer = setInterval(() => {
            if (!this._connected || !this.sock || this.sock.destroyed) {
                this._connected = false;
                return;
            }
            if (this._pending.size === 0) {
                this._rawPing().catch(() => { this._connected = false; try {
                    this.sock?.destroy();
                }
                catch { } });
            }
        }, this.healthCheckMs).unref();
    }
    async _rawPing() {
        return new Promise((resolve) => {
            if (!this.sock || this.sock.destroyed) {
                resolve(false);
                return;
            }
            const id = this._nextId++;
            const payload = JSON.stringify({ jsonrpc: "2.0", id, method: "ping", params: {} }) + "\n";
            const timer = setTimeout(() => resolve(false), 3000).unref();
            const req = {
                id: String(id), method: "ping", params: {},
                resolve: () => { clearTimeout(timer); resolve(true); },
                reject: () => { clearTimeout(timer); resolve(false); },
                timer, settled: false,
            };
            this._pending.set(String(id), req);
            this.sock.write(payload, () => { });
        });
    }
    disconnect() {
        if (this._healthTimer) {
            clearInterval(this._healthTimer);
            this._healthTimer = null;
        }
        this._failAllPending(new ClawBridgeError("Bridge disconnect requested", "fatal"));
        try {
            this.sock?.destroy();
        }
        catch { }
        this.sock = null;
        this._connected = false;
    }
    async call(method, params) {
        if (!this._connected || !this.sock || this.sock.destroyed) {
            try {
                await this.connect();
            }
            catch (e) {
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
            const req = { id, method, params, resolve, reject, timer, settled: false };
            if (this._inFlight < this.maxInFlight)
                this._sendReq(req);
            else
                this._queue.push(req);
        });
    }
    getStats() {
        return { ...this._stats, pending: this._pending.size, queued: this._queue.length, connected: this._connected };
    }
}
