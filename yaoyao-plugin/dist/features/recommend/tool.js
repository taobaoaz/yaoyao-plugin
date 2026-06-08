// features/recommend/tool.ts — memory_recommend tool (modular).
// v1.1: scene cache added to avoid re-reading scene_blocks on every call.
import fs from 'node:fs';
import path from 'node:path';
import { clampNum } from "../../utils/clamp.js";
import { withErrorHandling } from "../../tools/common.js";
import { diversifiedSelect, formatRecommendations, } from "../../core/recommend/recommend.js";
export function createRecommendTool(db, memoryDir) {
    // Scene cache — per-tool-instance, not module-global
    let _sceneCache = null;
    let _sceneCacheMtime = 0;
    function loadScenesCached() {
        const sceneDir = path.join(memoryDir, 'scene_blocks');
        let currentMtime = 0;
        try {
            if (fs.existsSync(sceneDir)) {
                currentMtime = fs.statSync(sceneDir).mtimeMs;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:recommend] Stat scene dir failed: ${msg}`);
        }
        if (_sceneCache && currentMtime === _sceneCacheMtime) {
            return _sceneCache;
        }
        const scenes = new Map();
        try {
            if (fs.existsSync(sceneDir)) {
                for (const sf of fs.readdirSync(sceneDir).filter((f) => f.endsWith('.md'))) {
                    const content = fs.readFileSync(path.join(sceneDir, sf), 'utf-8');
                    for (const line of content.split('\n')) {
                        const t = line.trim();
                        if (t.startsWith('- ') || t.startsWith('* ')) {
                            const mem = t.slice(2);
                            if (!scenes.has(mem))
                                scenes.set(mem, new Set());
                            scenes.get(mem).add(sf.replace('.md', ''));
                        }
                    }
                }
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:recommend] Load scenes failed: ${msg}`);
        }
        _sceneCache = scenes;
        _sceneCacheMtime = currentMtime;
        return scenes;
    }
    return {
        id: 'memory_recommend',
        name: 'memory_recommend',
        label: 'Memory Recommend',
        description: '记忆推荐引擎。基于上下文推荐多样化的相关记忆——混合不同场景、日期、标签的记忆，避免重复推荐同一类内容。',
        parameters: {
            type: 'object',
            properties: {
                context: {
                    type: 'string',
                    description: '当前上下文（如用户刚说的内容），用于匹配相关记忆',
                },
                limit: {
                    type: 'number',
                    description: '推荐数量（1-20，默认 5）',
                    default: 5,
                },
                diversity: {
                    type: 'number',
                    description: '多样化程度（0-1，0=纯相关度，1=最大多样化），默认 0.3',
                    default: 0.3,
                },
                sceneDiversity: {
                    type: 'boolean',
                    description: '是否优先从不同场景中采样（默认 true）',
                    default: true,
                },
                recallMultiplier: {
                    type: 'number',
                    description: '搜索召回超额倍数（默认 3，即取 limit*3）',
                    default: 3,
                },
                recallMax: {
                    type: 'number',
                    description: '搜索召回绝对上限（默认 30）',
                    default: 30,
                },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const context = String(params.context || '').trim();
            const limit = clampNum(params.limit, 5, 1, 20);
            const diversity = clampNum(params.diversity, 0.3, 0, 1);
            const sceneDiversity = params.sceneDiversity !== false;
            const recallMultiplier = clampNum(params.recallMultiplier, 3, 1, 10);
            const recallMax = clampNum(params.recallMax, 30, 10, 200);
            if (!context) {
                const recent = db.getRecentRawMemories(limit);
                if (recent.length === 0) {
                    return { content: [{ type: 'text', text: '暂无记忆可推荐。' }] };
                }
                const lines = recent.map((r, i) => `${i + 1}. [${r.date}] ${r.user_text || ''} ${r.asst_text ? '| ' + r.asst_text : ''}`);
                return { content: [{ type: 'text', text: '## 近期记忆\n\n' + lines.join('\n') }] };
            }
            const rawResults = db.search(context, Math.min(limit * recallMultiplier, recallMax));
            if (rawResults.length === 0) {
                const likeResults = db.searchByLike(context, limit);
                if (likeResults.length === 0) {
                    return { content: [{ type: 'text', text: '没有找到相关的记忆。' }] };
                }
                const lines = likeResults.map((r, i) => `${i + 1}. [${r.date}] ${r.user_text || ''}`);
                return { content: [{ type: 'text', text: '## 推荐记忆\n\n' + lines.join('\n') }] };
            }
            // 加载场景数据（带缓存）
            const scenes = loadScenesCached();
            // Core: diversified selection
            const candidates = rawResults.map((r) => ({
                id: r.filename || '',
                date: r.filename?.replace('.md', '') || 'unknown',
                user_text: r.snippet || '',
                asst_text: r.asst_text || '',
                score: r.score,
            }));
            const selected = diversifiedSelect(candidates, limit, scenes, diversity, sceneDiversity);
            const text = formatRecommendations(selected, context, diversity);
            return { content: [{ type: 'text', text }] };
        }),
    };
}
