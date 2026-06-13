/**
 * hooks/command-new.ts — Session boundary cleanup for /new and /reset commands.
 *
 * Listens to OpenClaw command:new and command:reset events,
 * clears per-session in-memory state to prevent keyword/activity
 * pollution across sessions.
 *
 * v1.7.0:
 *   - Clears recall keyword buffer (recall-session.ts)
 *   - Clears capture activity tracking (session-activity.ts)
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { clearSessionKeywords } from "./recall-session.ts";
import { resetSession } from "../utils/session-activity.ts";

export interface CommandNewHookHandle {
  unregister: () => void;
}

/** Create and register command:new / command:reset cleanup hooks. */
export function registerCommandNewHook(api: OpenClawPluginApi): CommandNewHookHandle {
  const handler = async (_event: unknown, ctx: unknown) => {
    const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
    clearSessionKeywords(sessionKey);
    resetSession(sessionKey);
    api.logger.debug?.(`[yaoyao-memory:command-new] Session ${sessionKey} context cleared`);
  };

  api.on("command:new", handler);
  api.on("command:reset", handler);

  return {
    unregister: () => {
      (api as unknown as { off?: (event: string, handler: unknown) => void }).off?.("command:new", handler);
      (api as unknown as { off?: (event: string, handler: unknown) => void }).off?.("command:reset", handler);
    },
  };
}
