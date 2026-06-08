/**
 * features/memory-call/tool.ts — memory_call structured search tool.
 *
 * Structured memory query: natural language → structured query →
 * intent-aware search with time-range filtering.
 */

import { clampNum } from '../../utils/clamp.ts';
import { withErrorHandling } from '../../tools/common.ts';
import type { ToolRegistration } from '../../tools/common.ts';
import type { Storage } from '../../storage/bridge.ts';
import type { EmbeddingService } from '../../utils/embedding.ts';
import { parseMemoryCall, buildSearchQuery } from '../../utils/memory-call.ts';
import { executeMemoryCall } from '../../core/search/memory-call-search.ts';
import { detectSentiment } from '../../core/sentiment/index.ts';

export function createMemoryCallTool(
  storage: Storage,
  embedding?: EmbeddingService | null,
): ToolRegistration {
  return {
    id: 'memory_call',
    name: 'memory_call',
    label: 'Yaoyao MemoryCall Search',
    description:
      'Structured memory search with intent detection and time-range filtering. ' +
      "Accepts natural language queries like '上周关于部署的讨论' or '我最近喜欢的音乐'. " +
      'Auto-detects intent (factual/emotional/procedural/exploratory) and time filters.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "Natural language search query (e.g., '上周关于部署的讨论', '我最近喜欢的音乐')",
        },
        intent: {
          type: 'string',
          enum: ['factual', 'emotional', 'procedural', 'exploratory'],
          description: 'Optional intent override. Auto-detected if omitted.',
        },
        timeRange: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_week', 'last_month', 'recent'],
          description: 'Optional time range filter. Auto-detected if omitted.',
        },
        participants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter by mentioned participants/entities.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 10)',
          default: 10,
        },
      },
      required: ['query'],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const rawQuery = String(params.query ?? '').trim();
      if (!rawQuery) {
        return { content: [{ type: 'text', text: '请输入搜索查询。' }] };
      }

      // Parse natural language into structured MemoryCall
      const memoryCall = parseMemoryCall(rawQuery);

      // Apply explicit overrides from params
      if (params.intent)
        memoryCall.intent = String(
          params.intent,
        ) as import('../../utils/memory-call.ts').MemoryCallIntent;
      if (params.timeRange) {
        memoryCall.timeRange = {
          relative: String(
            params.timeRange,
          ) as import('../../utils/memory-call.ts').MemoryCallTimeRange['relative'],
        };
      }
      if (params.participants) {
        memoryCall.participants = Array.isArray(params.participants)
          ? params.participants.map(String)
          : undefined;
      }
      memoryCall.maxResults = clampNum(params.maxResults, 10, 1, 50);

      // Execute structured search
      const results = await executeMemoryCall(memoryCall, {
        storage,
        embedding,
      });

      if (results.length === 0) {
        return { content: [{ type: 'text', text: `没有找到与 "${rawQuery}" 相关的记忆。` }] };
      }

      // Format output with intent + time info
      const intentLabel = memoryCall.intent ? `[意图: ${memoryCall.intent}]` : '';
      const timeLabel = memoryCall.timeRange?.relative
        ? `[时间: ${memoryCall.timeRange.relative}]`
        : '';
      const header = `🔍 MemoryCall 搜索结果 ${intentLabel} ${timeLabel}\n\n`;

      const text = results
        .map((r) => {
          const mood = detectSentiment(r.snippet);
          return `${mood.emoji} 【${r.filename}】(得分: ${r.score.toFixed(3)})\n${r.snippet}`;
        })
        .join('\n\n---\n\n');

      return { content: [{ type: 'text', text: header + text }] };
    }),
  };
}
