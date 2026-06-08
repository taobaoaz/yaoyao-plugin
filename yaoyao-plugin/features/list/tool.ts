/**
 * features/list/tool.ts — memory_list tool (modular).
 */

import type { MemoryStore } from '../../utils/memory-store.ts';
import { clampNum } from '../../utils/clamp.ts';
import { withErrorHandling } from '../../tools/common.ts';
import type { ToolRegistration } from '../../tools/common.ts';

export function createListTool(store: MemoryStore): ToolRegistration {
  return {
    id: 'memory_list',
    name: 'memory_list',
    label: 'Memory List',
    description: 'List available memory files with metadata (type, date, size, modified time).',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['daily', 'memory', 'archive'],
          description: 'Filter by file type',
        },
        limit: { type: 'number', description: 'Max results (default: 20)', default: 20 },
        offset: { type: 'number', description: 'Skip N results (default: 0)', default: 0 },
        sort: {
          type: 'string',
          enum: ['score', 'date'],
          description: 'Sort by score or date (default: date)',
          default: 'date',
        },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const limit = clampNum(params.limit, 20, 1, 500);
      const offset = clampNum(params.offset, 0, 0, 10000);
      let files = store.listFiles();
      if (params.type && typeof params.type === 'string') {
        files = files.filter((f) => f.type === params.type);
      }
      if (params.sort === 'score') {
        files.sort((a, b) => (b.importance || 0) - (a.importance || 0));
      } else {
        files.sort((a, b) => b.modified - a.modified);
      }
      files = files.slice(offset, offset + limit);
      if (files.length === 0) return { content: [{ type: 'text', text: '没有找到记忆文件。' }] };

      const lines = files.map((f) => {
        const date = new Date(f.modified).toISOString().slice(0, 19).replace('T', ' ');
        const sizeKB = (f.size / 1024).toFixed(1);
        return `[${f.type}] ${f.filename} (${sizeKB}KB, ${date})`;
      });
      return {
        content: [
          { type: 'text', text: `记忆文件列表 (共 ${lines.length} 个):\n\n${lines.join('\n')}` },
        ],
      };
    }),
  };
}
