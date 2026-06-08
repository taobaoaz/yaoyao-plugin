export const VALID_RELATIONS = [
    'supersedes',
    'conflicts_with',
    'compatible',
    'related',
    'not_conflict',
];
const RELATION_EMOJI = {
    supersedes: '⬆️',
    conflicts_with: '⚡',
    compatible: '✅',
    related: '🔗',
    not_conflict: '❌',
};
export function formatRelation(relation) {
    return `${RELATION_EMOJI[relation] || '❓'} ${relation}`;
}
export function formatJudgeResult(input) {
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
