declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface PluginLogger {
    info: (msg: string) => void;
    error?: (msg: string) => void;
    warn?: (msg: string) => void;
    debug?: (msg: string) => void;
  }

  export interface OpenClawPluginApi {
    pluginConfig: Record<string, unknown>;
    baseDir: string;
    logger: PluginLogger;
    registerTool: (tool: unknown) => void;
    on: (event: string, handler: (...args: unknown[]) => unknown) => void;
  }

  export function definePluginEntry(entry: unknown): unknown;
}
