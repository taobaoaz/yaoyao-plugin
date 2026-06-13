/**
 * openclaw-sdk/plugin-entry.ts — Self-contained OpenClaw SDK adapter.
 *
 * The original `openclaw/plugin-sdk/plugin-entry` module is shipped by the
 * OpenClaw host runtime. When this plugin is installed outside the host
 * (git clone, npm install, or standalone test) the package is not on disk
 * and any `import { definePluginEntry } from 'openclaw/plugin-sdk/...'`
 * resolves to `undefined`, which crashes the plugin loader and silently
 * prevents auto-registration.
 *
 * This local module re-implements the exact same surface so the plugin
 * is fully self-contained:
 *   - `definePluginEntry(entry)` is an identity function (the real SDK
 *     uses the same pattern — the host reads the entry object's
 *     `register(api)` method directly).
 *   - All type declarations match what the host provides.
 *
 * If the OpenClaw host is installed and exposes a richer SDK, the host's
 * loader will still work because it consumes the entry object structurally,
 * not by type identity.
 */
export interface PluginLogger {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
}

export interface PluginHeartbeatPromptContributionEvent {
  sessionKey?: string;
  agentId?: string;
  heartbeatName?: string;
}

export interface PluginHeartbeatPromptContributionResult {
  prependContext?: string;
  appendContext?: string;
}

export interface OpenClawPluginApi {
  pluginConfig?: Record<string, unknown>;
  baseDir?: string;
  logger: PluginLogger;
  registerTool?: (tool: unknown) => void;
  registerHook?: (hook: unknown) => void;
  on?: (event: string, handler: (...args: unknown[]) => unknown) => void;
  agentId?: string;
  onUnload?: (fn: () => void) => void;
  [k: string]: unknown;
}

export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  register: (api: OpenClawPluginApi) => void | Promise<void>;
  [k: string]: unknown;
}

export function definePluginEntry<T extends PluginEntry>(entry: T): T {
  // Identity function. The real SDK uses the same pattern — the host reads
  // entry.register(api) directly. Keeping it an identity keeps behavior
  // identical whether the plugin runs under the real SDK or this stub.
  return entry;
}
