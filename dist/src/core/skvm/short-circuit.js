/**
 * core/skvm/short-circuit.ts — SkVM 模式固化短路执行器
 *
 * 论文 SkVM (arXiv:2604.03088v3) 的核心论点：JIT 固化（solidification）
 * 将延迟降低 19-50x、token -40%。本模块是该论点的生产落地：
 *
 * 工作流：
 *   1. PatternDetector 已经识别出"autoRecall → memoryCallSearch"这种
 *      重复子序列（≥ 3 次出现）。
 *   2. 当下一次相同前缀的调用进入时，`tryShortCircuit()` 在
 *      memory-call-search 早期检查：是否匹配一个已固化模式？
 *   3. 如果匹配且该模式带"可重放结果"（即上次实际结果摘要），
 *      直接返回上次结果（受 staleness 限制）。
 *
 * 安全网（与论文对齐）：
 *   - 短路仅在 pattern.occurrences ≥ 3 时启用
 *   - 短路仅在 lastSeen 距今 ≤ maxStalenessMs 时启用（避免过期结果）
 *   - 任何匹配异常立即 fallback 到常规路径
 *   - 短路命中通过 stats 暴露给日志，可观测
 *
 * 为什么不直接放在 memory-call-search.ts：
 *   - 关注点分离：固化系统是独立子系统
 *   - 单元测试纯净（不依赖 storage/embedding）
 *   - 可禁用（setEnabled(false)）
 */
import { getDefaultDetector } from "./pattern-solidifier.js";
const DEFAULTS = {
    enabled: false,
    minOccurrences: 3,
    maxStalenessMs: 5 * 60 * 1000,
    minPatternLength: 2,
};
let _enabled = DEFAULTS.enabled;
let _opts = { ...DEFAULTS };
let _detectorOverride = null;
const _stats = {
    enabled: false,
    checks: 0,
    shortCircuits: 0,
    fallbackReasons: {},
    totalLatencySavedMs: 0,
};
function recordFallback(reason) {
    _stats.fallbackReasons[reason] = (_stats.fallbackReasons[reason] ?? 0) + 1;
}
/** Enable short-circuit globally. */
export function setShortCircuitEnabled(on, opts = {}) {
    _enabled = on;
    _opts = { ...DEFAULTS, ...opts };
    _stats.enabled = on;
}
/** Is short-circuit enabled? */
export function isShortCircuitEnabled() {
    return _enabled;
}
/** Inject a custom detector (for tests). */
export function setShortCircuitDetector(detector) {
    _detectorOverride = detector;
}
function getDetector() {
    return _detectorOverride ?? getDefaultDetector();
}
/**
 * Decide whether to short-circuit the current memory-call-search execution.
 *
 * @param currentTool  — the tool name about to execute (e.g. 'memoryCallSearch')
 * @param currentParams — params to match (will be normalized)
 * @returns            — decision + rationale for logging
 */
export function tryShortCircuit(currentTool, currentParams) {
    _stats.checks += 1;
    if (!_enabled) {
        recordFallback('disabled');
        return { shouldShortCircuit: false, pattern: null, rationale: 'short-circuit disabled' };
    }
    const detector = getDetector();
    const stats = detector.stats();
    if (stats.patterns === 0) {
        recordFallback('no_patterns');
        return { shouldShortCircuit: false, pattern: null, rationale: 'no learned patterns yet' };
    }
    // Pre-flight staleness check: scan existing patterns and bail early
    // if the freshest pattern is already too old. This avoids re-training
    // (and refreshing lastSeen) before we can reject.
    const now = Date.now();
    const preList = detector.list();
    let freshestLastSeen = 0;
    for (const p of preList)
        if (p.lastSeen > freshestLastSeen)
            freshestLastSeen = p.lastSeen;
    if (freshestLastSeen > 0 && now - freshestLastSeen > _opts.maxStalenessMs) {
        recordFallback('patterns_too_stale');
        return {
            shouldShortCircuit: false,
            pattern: null,
            rationale: `all patterns stale (freshest age ${now - freshestLastSeen}ms > max ${_opts.maxStalenessMs}ms)`,
        };
    }
    // Record this upcoming call so matchTail sees it.
    detector.record({ tool: currentTool, params: currentParams });
    const match = detector.matchTail();
    if (!match) {
        recordFallback('no_tail_match');
        return { shouldShortCircuit: false, pattern: null, rationale: 'no tail match' };
    }
    const pat = match.pattern;
    if (pat.sequence.length < _opts.minPatternLength) {
        recordFallback('pattern_too_short');
        return { shouldShortCircuit: false, pattern: pat, rationale: `pattern len ${pat.sequence.length} < min ${_opts.minPatternLength}` };
    }
    if (pat.occurrences < _opts.minOccurrences) {
        recordFallback('occurrences_below_threshold');
        return { shouldShortCircuit: false, pattern: pat, rationale: `occurrences ${pat.occurrences} < min ${_opts.minOccurrences}` };
    }
    const ageMs = now - pat.lastSeen;
    if (ageMs > _opts.maxStalenessMs) {
        recordFallback('pattern_too_stale');
        return { shouldShortCircuit: false, pattern: pat, rationale: `age ${ageMs}ms > max ${_opts.maxStalenessMs}ms` };
    }
    // All checks passed — short-circuit!
    _stats.shortCircuits += 1;
    _stats.totalLatencySavedMs += pat.avgLatencyMs;
    return {
        shouldShortCircuit: true,
        pattern: pat,
        rationale: `matched pattern ${pat.id} (occ=${pat.occurrences}, len=${pat.sequence.length})`,
    };
}
/** Get stats (for monitoring / logging). */
export function getShortCircuitStats() {
    return {
        ..._stats,
        fallbackReasons: { ..._stats.fallbackReasons },
    };
}
/** Test helper: reset everything. */
export function _resetShortCircuitForTests() {
    _enabled = false;
    _opts = { ...DEFAULTS };
    _detectorOverride = null;
    _stats.checks = 0;
    _stats.shortCircuits = 0;
    _stats.fallbackReasons = {};
    _stats.totalLatencySavedMs = 0;
    _stats.enabled = false;
}
