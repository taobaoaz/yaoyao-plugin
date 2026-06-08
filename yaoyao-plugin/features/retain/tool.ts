/**
 * features/retain/tool.ts — memory_retain tool.
 *
 * Thin layer: param validation → handler dispatch → response.
 * Handlers in handlers.ts, I/O in store.ts, formatting in core/retain/retain.ts.
 */
import type { ToolRegistration } from '../../tools/common.ts';
import type { MemoryStore } from '../../utils/memory-store.ts';
import type { DBBridge } from '../../utils/db-bridge.ts';
import { withErrorHandling } from '../../tools/common.ts';
import { handleCheck, handleBoost, handleImportant } from './handlers.ts';

export function createRetainTool(store: MemoryStore, db: DBBridge): ToolRegistration {
  return {
    id: 'memory_retain',
    name: 'memory_retain',
    label: 'Memory Retain',
    description:
      '🧠 记忆增强/反遗忘 — 检测重要但长期未被召回的记忆，生成强化建议。防止关键记忆被遗忘。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'boost', 'important'],
          description: 'check=检查遗忘风险, boost=强化指定记忆, important=标记重要记忆',
        },
        keyword: { type: 'string', description: '关键词（action=boost/important 时必填）' },
        filename: { type: 'string', description: '文件名（action=boost/important 时可选）' },
        reason: { type: 'string', description: '标记原因（action=important 时可选）' },
      },
      required: ['action'],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action);

      switch (action) {
        case 'check':
          return handleCheck(store, db);
        case 'boost': {
          const keyword = String(params.keyword || '');
          if (!keyword)
            return { content: [{ type: 'text', text: '❌ action=boost 时 keyword 必填' }] };
          return handleBoost(
            store,
            db,
            keyword,
            params.filename ? String(params.filename) : undefined,
            params.reason ? String(params.reason) : undefined,
          );
        }
        case 'important': {
          const keyword = String(params.keyword || '');
          if (!keyword)
            return { content: [{ type: 'text', text: '❌ action=important 时 keyword 必填' }] };
          return handleImportant(
            store,
            keyword,
            params.filename ? String(params.filename) : undefined,
            params.reason ? String(params.reason) : undefined,
          );
        }
        default:
          return {
            content: [
              { type: 'text', text: `❌ 未知操作: ${action}，支持: check, boost, important` },
            ],
          };
      }
    }),
  };
}
