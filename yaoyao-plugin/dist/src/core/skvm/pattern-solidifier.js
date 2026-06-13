/**
 * core/skvm/pattern-solidifier.ts — SkVM 风格模式固化器
 *
 * 论文：SkVM (arXiv:2604.03088v3) — 把 LLM agent skills 当可编译代码对待
 * 核心思想：检测到重复的 tool-call 序列后，把它"固化"为原子操作，
 *          下次相同输入直接走固化路径，绕过 LLM 决策。
 *
 * 论文数据：JIT 固化后延迟降低 19-50x、token 消耗 -40%。
 *
 * 实现要点：
 *   1. ToolCallPattern — 一次"模式"=一个有序的工具调用序列
 *   2. PatternStore    — LRU 存储已固化的模式
 *   3. PatternDetector — 滑动窗口检测最近 N 次调用，识别重复子序列
 *   4. SolidifyPolicy  — 出现 ≥ minOccurrences 次 + 间隔 ≤ maxGapMs 触发固化
 *
 * 使用场景：
 *   ① auto-recall hook 每次触发时记录 tool 调用
 *   ② memory-call-search 每次成功时记录
 *   ③ 模式检测器后台比对，发现稳态后建议固化
 *   ④ 下次相同前缀输入直接返回固化结果
 *
 * 配套 fallback：
 *   任何固化路径异常（store IO 失败、key mismatch）→ 立即 fallback 到常规路径
 *   不会因为固化系统故障导致主流程阻塞。
 */
import crypto from 'node:crypto';
const DEFAULTS = {
    windowSize: 50,
    minOccurrences: 3,
    maxGapMs: 60_000,
    maxPatterns: 200,
    minPatternLength: 2,
    tokensSavedPerHit: 120,
};
/* ── Helpers ───────────────────────────────────── */
function stableStringify(obj) {
    if (obj === null || typeof obj !== 'object')
        return JSON.stringify(obj);
    if (Array.isArray(obj))
        return '[' + obj.map(stableStringify).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return ('{' +
        keys
            .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
            .join(',') +
        '}');
}
function hashParams(tool, params) {
    return crypto.createHash('sha256').update(`${tool}|${stableStringify(params ?? {})}`).digest('hex').slice(0, 16);
}
function patternId(sequence) {
    const sig = sequence.map((c) => `${c.tool}:${c.paramsHash}`).join('>');
    return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}
/* ── Detector ───────────────────────────────────── */
export class PatternDetector {
    state;
    opts;
    constructor(opts = {}) {
        this.opts = { ...DEFAULTS, ...opts };
        this.state = {
            window: [],
            patterns: new Map(),
            totalCalls: 0,
            hitCount: 0,
            totalTokensSaved: 0,
        };
    }
    /** 记录一次 tool 调用 */
    record(call) {
        const full = {
            tool: call.tool,
            paramsHash: hashParams(call.tool, call.params),
            params: call.params,
            ts: call.ts ?? Date.now(),
            resultDigest: call.resultDigest,
        };
        this.state.window.push(full);
        this.state.totalCalls += 1;
        if (this.state.window.length > this.opts.windowSize) {
            this.state.window.shift();
        }
        this.detectPatterns();
    }
    /**
     * 查找当前窗口尾部的最长已固化前缀。
     * 返回模式 + 待匹配进度（已匹配几个调用），调用方可选择性走固化路径。
     */
    matchTail() {
        const window = this.state.window;
        if (window.length < this.opts.minPatternLength)
            return null;
        let best = null;
        for (const pat of this.state.patterns.values()) {
            if (pat.sequence.length > window.length)
                continue;
            // 滑动比对：从窗口尾部往前比对
            const startIdx = window.length - pat.sequence.length;
            let matched = 0;
            for (let i = 0; i < pat.sequence.length; i++) {
                const a = window[startIdx + i];
                const b = pat.sequence[i];
                if (a && b && a.tool === b.tool && a.paramsHash === b.paramsHash)
                    matched++;
                else
                    break;
            }
            if (matched === pat.sequence.length) {
                if (!best || pat.sequence.length > best.pattern.sequence.length) {
                    best = { pattern: pat, matchedPrefix: matched };
                }
            }
        }
        if (best) {
            this.state.hitCount += 1;
            this.state.totalTokensSaved += this.opts.tokensSavedPerHit;
            best.pattern.tokensSaved += this.opts.tokensSavedPerHit;
        }
        return best;
    }
    /** 列出所有已固化模式 */
    list() {
        return [...this.state.patterns.values()].sort((a, b) => b.occurrences - a.occurrences);
    }
    /** 状态查询 */
    stats() {
        return {
            patterns: this.state.patterns.size,
            totalCalls: this.state.totalCalls,
            hitCount: this.state.hitCount,
            totalTokensSaved: this.state.totalTokensSaved,
            hitRate: this.state.totalCalls === 0 ? 0 : this.state.hitCount / this.state.totalCalls,
        };
    }
    /** 清空所有模式（测试用） */
    clear() {
        this.state.window = [];
        this.state.patterns.clear();
        this.state.totalCalls = 0;
        this.state.hitCount = 0;
        this.state.totalTokensSaved = 0;
    }
    /** LRU 淘汰 */
    evictIfNeeded() {
        if (this.state.patterns.size <= this.opts.maxPatterns)
            return;
        const sorted = [...this.state.patterns.values()].sort((a, b) => a.lastSeen - b.lastSeen);
        const toRemove = sorted.slice(0, sorted.length - this.opts.maxPatterns);
        for (const p of toRemove)
            this.state.patterns.delete(p.id);
    }
    /**
     * 核心检测：扫描最近窗口，识别出现的子序列并尝试固化。
     * 算法：枚举窗口中长度 ∈ [minLen, maxLen] 的连续子序列，
     *       按 (工具序列, 参数 hash) 统计"独立出现次数"。
     *
     * 关键修复：同一 ID 出现多次（不要求首尾相连）应累计频次，
     *          之前实现把同 ID 的多次出现只计 1。
     */
    detectPatterns() {
        const w = this.state.window;
        if (w.length < this.opts.minPatternLength)
            return;
        const minLen = this.opts.minPatternLength;
        const maxLen = Math.min(w.length, 5); // 限制最长模式为 5 步
        // 按"起止长度"枚举子序列，按 ID 累计频次
        for (let len = minLen; len <= maxLen; len++) {
            const freq = new Map();
            for (let start = 0; start + len <= w.length; start++) {
                const seq = w.slice(start, start + len);
                const sig = seq.map((c) => `${c.tool}:${c.paramsHash}`).join('>');
                const id = crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
                const lastTs = seq[seq.length - 1].ts;
                const firstTs = seq[0].ts;
                const entry = freq.get(id);
                if (entry) {
                    // 同一序列多次出现，累计 count + latencies
                    entry.count += 1;
                    entry.lastTs = Math.max(entry.lastTs, lastTs);
                    entry.firstTs = Math.min(entry.firstTs, firstTs);
                    if (entry.latencies.length < 50) {
                        entry.latencies.push(lastTs - firstTs);
                    }
                }
                else {
                    freq.set(id, { seq, lastTs, firstTs, latencies: [lastTs - firstTs], count: 1 });
                }
            }
            for (const [, entry] of freq) {
                const id = patternId(entry.seq);
                const instanceCount = entry.count;
                const existing = this.state.patterns.get(id);
                if (existing) {
                    existing.occurrences = instanceCount;
                    existing.lastSeen = entry.lastTs;
                    existing.avgLatencyMs =
                        existing.avgLatencyMs * 0.7 + (entry.latencies[0] ?? 0) * 0.3;
                }
                else if (instanceCount >= this.opts.minOccurrences && this.state.patterns.size < this.opts.maxPatterns) {
                    // 达到固化门槛才入 patterns
                    this.state.patterns.set(id, {
                        id,
                        sequence: entry.seq,
                        occurrences: instanceCount,
                        firstSeen: entry.firstTs,
                        lastSeen: entry.lastTs,
                        avgLatencyMs: entry.latencies[0] ?? 0,
                        tokensSaved: 0,
                    });
                }
            }
        }
        this.evictIfNeeded();
    }
}
/* ── Singleton helpers ─────────────────────────── */
let _defaultDetector = null;
/** 全局单例检测器（auto-recall / memory-call 等共用） */
export function getDefaultDetector() {
    if (!_defaultDetector) {
        _defaultDetector = new PatternDetector();
    }
    return _defaultDetector;
}
/** 重置单例（测试用） */
export function resetDefaultDetector() {
    _defaultDetector = null;
}
/* ── Solidify Policy ──────────────────────────── */
/**
 * 是否将某模式提升为"可信任固化"？
 * 当前策略：occurrences >= minOccurrences 且 lastSeen - firstSeen 在合理区间。
 */
export function shouldSolidify(pat, opts) {
    if (pat.occurrences < opts.minOccurrences)
        return false;
    const span = pat.lastSeen - pat.firstSeen;
    if (span < 0)
        return false;
    // 跨度不应过大（避免长尾噪声）
    return span <= opts.maxGapMs * pat.occurrences;
}
