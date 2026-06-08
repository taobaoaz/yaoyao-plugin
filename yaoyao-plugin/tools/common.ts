/**
 * Shared utilities for memory tools.
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';

export type ToolHandlerResult = { content: Array<{ type: string; text: string }> };
export type ToolHandler = (
  id: string,
  params: Record<string, unknown>,
) => Promise<ToolHandlerResult>;
export type ToolRegistration = Parameters<NonNullable<OpenClawPluginApi['registerTool']>>[0];

/** Wrap a tool execute handler with try/catch for consistent error handling */
export function withErrorHandling(handler: ToolHandler): ToolHandler {
  return async (id, params) => {
    try {
      return await handler(id, params);
    } catch (err: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 记忆操作出错: ${err instanceof Error ? err.message : String(err) || '未知错误'}`,
          },
        ],
      };
    }
  };
}
