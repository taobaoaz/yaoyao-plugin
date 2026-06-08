/**
 * features/conflict/formatter.ts — Conflict display formatting.
 *
 * Pure formatting: emoji mapping, table building, list rendering.
 */
import type { ConflictRelation } from '../../core/conflict/detect.ts';

export const VALID_RELATIONS: ConflictRelation[] = [
  'supersedes',
  'conflicts_with',
  'compatible',
  'related',
  'not_conflict',
];

const RELATION_EMOJI: Record<ConflictRelation, string> = {
  supersedes: '⬆️',
  conflicts_with: '⚡',
  compatible: '✅',
  related: '🔗',
  not_conflict: '❌',
};

export function formatRelation(relation: ConflictRelation): string {
  return `${RELATION_EMOJI[relation] || '❓'} ${relation}`;
}

export interface JudgeInput {
  memoryId: number;
  relation: ConflictRelation;
  reason: string;
  evidence?: string;
  judgedAt: string;
}

export function formatJudgeResult(input: JudgeInput): string {
  const lines = [
    '✅ **裁决已记录**',
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    `| 目标记忆 | ID ${input.memoryId} |`,
    `| 关系 | ${formatRelation(input.relation)} |`,
    `| 理由 | ${input.reason} |`,
    input.evidence ? `| 证据 | ${input.evidence} |` : '',
    `| 时间 | ${input.judgedAt} |`,
    '',
    '此裁决已持久化到记忆元数据中，未来搜索将引用此关系。',
  ];
  return lines.filter(Boolean).join('\n');
}
