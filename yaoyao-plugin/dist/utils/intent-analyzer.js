/**
 * Intent Analyzer — 意图分析 + 分类 boost
 * 从 Brain (memory-lancedb-pro) 学习：纯模式匹配意图路由
 * 零外部依赖，纯本地
 */
const INTENT_RULES = [
    {
        label: 'preference',
        patterns: [
            /\b(prefer|preference|style|convention|like|dislike|favorite|habit)\b/i,
            /\b(how do (i|we) usually|what('s| is) (my|our) (style|convention|approach))\b/i,
            /(偏好|喜欢|习惯|风格|惯例|常用|不喜欢|不要用|别用)/,
        ],
        categories: ['preference', 'decision'],
        depth: 'l0',
    },
    {
        label: 'decision',
        patterns: [
            /\b(why did (we|i)|decision|decided|chose|rationale|trade-?off|reason for)\b/i,
            /\b(what was the (reason|rationale|decision))\b/i,
            /(为什么选|决定|选择了|取舍|权衡|原因是|当时决定)/,
        ],
        categories: ['decision', 'fact'],
        depth: 'l1',
    },
    {
        label: 'entity',
        patterns: [
            /\b(who is|who are|tell me about|info on|details about|contact info)\b/i,
            /\b(who('s| is) (the|our|my)|what team|which (person|team))\b/i,
            /(谁是|告诉我关于|详情|联系方式|哪个团队)/,
        ],
        categories: ['entity', 'fact'],
        depth: 'l1',
    },
    {
        label: 'event',
        patterns: [
            /\b(when did|what happened|timeline|incident|outage|deploy|release|shipped)\b/i,
            /\b(last (week|month|time|sprint)|recently|yesterday|today)\b/i,
            /(什么时候|发生了什么|时间线|事件|上线|部署|发布|上次|最近)/,
        ],
        categories: ['entity', 'decision'],
        depth: 'full',
    },
    {
        label: 'fact',
        patterns: [
            /\b(how (does|do|to)|what (does|do|is)|explain|documentation|spec)\b/i,
            /\b(config|configuration|setup|install|architecture|api|endpoint)\b/i,
            /(怎么|如何|是什么|解释|文档|规范|配置|安装|架构|接口)/,
        ],
        categories: ['fact', 'entity'],
        depth: 'l1',
    },
];
export function analyzeIntent(query) {
    const trimmed = query.trim();
    if (!trimmed) {
        return { categories: [], depth: 'l0', confidence: 'low', label: 'empty' };
    }
    for (const rule of INTENT_RULES) {
        if (rule.patterns.some((p) => p.test(trimmed))) {
            return {
                categories: rule.categories,
                depth: rule.depth,
                confidence: 'high',
                label: rule.label,
            };
        }
    }
    return { categories: [], depth: 'l0', confidence: 'low', label: 'broad' };
}
export function applyCategoryBoost(results, intent, boostFactor = 1.15) {
    if (intent.categories.length === 0 || intent.confidence === 'low') {
        return results;
    }
    const prioritySet = new Set(intent.categories);
    const boosted = results.map((r) => {
        if (prioritySet.has(r.entry.category)) {
            return { ...r, score: Math.min(1, r.score * boostFactor) };
        }
        return r;
    });
    return boosted.sort((a, b) => b.score - a.score);
}
