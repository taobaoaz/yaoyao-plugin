/**
 * utils/structured-log.ts — 结构化日志 (Structured Logging)
 *
 * v1.7.5 引入：
 *   - 统一 requestId 关联（同一调用链可追踪）
 *   - 自动 duration 测量
 *   - outcome 字段（hit/miss/error/skipped）便于聚合
 *   - 写入 audit log 与 plugin logger 双通道
 *
 * 用法：
 *   const end = startTimedLog(api.logger, 'memory-call-search', { query, intent });
 *   const result = await doWork();
 *   end({ outcome: 'hit', resultCount: result.length });
 *
 * 替代历史：
 *   api.logger.info?.(`[yaoyao-memory] ${action} took ${Date.now() - t0}ms`);
 *   那种写法无法聚合、无法关联、无 outcome 分类。
 */
/** requestId 计数器（每模块独立，避免冲突） */
const counters = new Map();
/**
 * 生成一个 8 字符的短 ID + 模块前缀 + 序号。
 * 例：`mcs_a1b2c3d4_42`。
 */
export function newRequestId(action) {
    const prefix = action.split('-').map((p) => p[0]).join('').slice(0, 3) || 'op';
    const seq = (counters.get(action) ?? 0) + 1;
    counters.set(action, seq);
    const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    return `${prefix}_${rand}_${seq}`;
}
/** 序列化为单行 JSON（兼容 grep/jq） */
function toLine(entry) {
    return JSON.stringify(entry);
}
/**
 * 开始一次计时的结构化日志，返回结束回调。
 * 结束时自动计算 duration，并按 outcome 输出到 plugin logger + 可选 audit sink。
 */
export function startTimedLog(logger, action, context, opts = {}) {
    const t0 = Date.now();
    const requestId = newRequestId(action);
    return (extra) => {
        const durationMs = Date.now() - t0;
        const outcome = extra?.outcome ?? 'success';
        const entry = {
            requestId,
            parentId: opts.parentId,
            action,
            durationMs,
            outcome,
            context: { ...context, ...extra?.context },
            ts: new Date().toISOString(),
        };
        if (extra?.error !== undefined) {
            entry.error = extra.error instanceof Error ? extra.error.message : String(extra.error);
        }
        const line = toLine(entry);
        // Plugin logger（人可读通道）
        const level = outcome === 'error' ? 'error' : 'info';
        const msg = `[yaoyao-memory] ${action} ${outcome} ${durationMs}ms rid=${requestId}`;
        logger?.[level]?.(msg);
        // 可选 audit sink（机器可读通道）
        if (opts.auditSink) {
            try {
                opts.auditSink(line);
            }
            catch {
                // 审计失败不能影响主流程
            }
        }
    };
}
/** 直接输出一次性的结构化日志（不计时） */
export function logOnce(logger, action, outcome, context) {
    const requestId = newRequestId(action);
    const entry = {
        requestId,
        action,
        durationMs: 0,
        outcome,
        context,
        ts: new Date().toISOString(),
    };
    logger?.info?.(`[yaoyao-memory] ${action} ${outcome} rid=${requestId}`);
    return requestId;
}
