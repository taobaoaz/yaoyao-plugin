/**
 * Stub type declarations for openclaw/plugin-sdk.
 * This module is provided by the OpenClaw runtime.
 * Intentionally permissive to avoid type noise during local development.
 */

export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export interface PluginRegistry {
  service<T>(name: string): T | null;
  plugin(name: string): unknown | null;
  on(event: string, handler: unknown): void;
  emit(event: string, data: unknown): void;
}

export interface OpenClawPluginApi {
  registry: PluginRegistry;
  logger: PluginLogger;
  baseDir: string;
  memoryDir: string;
  workspaceDir: string;
  pluginConfig?: Record<string, unknown>;
  onUnload?(cb: () => void): void;
  on(event: string, handler: unknown): void;
  emit(event: string, data: unknown): void;
  registerTool?(toolDef: unknown): void;
  llm?: {
    chat(model: string, messages: unknown[], opts?: unknown): Promise<unknown>;
  };
  [key: string]: unknown;
}

export interface PluginEntry {
  id?: string;
  name: string;
  version: string;
  description?: string;
  init?(api: OpenClawPluginApi): unknown;
  register?(api: OpenClawPluginApi): unknown;
}

export declare function definePluginEntry(entry: PluginEntry): PluginEntry;

export interface PluginHeartbeatPromptContributionEvent {
  prompt: string;
  system: string;
  sessionKey?: string;
}

export interface PluginHeartbeatPromptContributionResult {
  prompt?: string;
  system?: string;
  appendContext?: string;
}