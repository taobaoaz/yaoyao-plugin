/**
 * Retrieval Trace — 检索管道诊断
 * 从 Brain (memory-lancedb-pro) 学习：追踪各阶段 drops/分数/时间
 * 零开销（不用时不激活），可 summarize 为人类可读报告
 */
export class TraceCollector {
    _startTime;
    _stages = [];
    _pending = null;
    constructor() {
        this._startTime = Date.now();
    }
    /**
     * Begin tracking a pipeline stage.
     */
    startStage(name, entryIds) {
        if (this._pending) {
            this.endStage([...this._pending.inputIds]);
        }
        this._pending = {
            name,
            inputIds: new Set(entryIds),
            startTime: Date.now(),
        };
    }
    /**
     * End the current stage.
     * @param survivingIds - IDs of entries that survived this stage
     * @param scores - Optional scores for surviving entries
     */
    endStage(survivingIds, scores) {
        if (!this._pending)
            return;
        const { name, inputIds, startTime } = this._pending;
        const survivingSet = new Set(survivingIds);
        const droppedIds = [];
        for (const id of inputIds) {
            if (!survivingSet.has(id)) {
                droppedIds.push(id);
            }
        }
        let scoreRange = null;
        if (scores && scores.length > 0) {
            let min = Infinity;
            let max = -Infinity;
            for (const s of scores) {
                if (s < min)
                    min = s;
                if (s > max)
                    max = s;
            }
            scoreRange = [min, max];
        }
        this._stages.push({
            name,
            inputCount: inputIds.size,
            outputCount: survivingIds.length,
            droppedIds,
            scoreRange,
            durationMs: Date.now() - startTime,
        });
        this._pending = null;
    }
    /**
     * Finalize the trace and produce the complete RetrievalTrace object.
     */
    finalize(query, mode) {
        if (this._pending) {
            this.endStage([...this._pending.inputIds]);
        }
        const lastStage = this._stages[this._stages.length - 1];
        return {
            query,
            mode: mode,
            startedAt: this._startTime,
            stages: this._stages,
            finalCount: lastStage ? lastStage.outputCount : 0,
            totalMs: Date.now() - this._startTime,
        };
    }
    /**
     * Produce a human-readable summary of the trace.
     */
    summarize() {
        const lines = [];
        lines.push(`Retrieval trace (${this._stages.length} stages):`);
        for (const stage of this._stages) {
            const dropped = stage.inputCount - stage.outputCount;
            const scoreStr = stage.scoreRange
                ? ` scores=[${stage.scoreRange[0].toFixed(3)}, ${stage.scoreRange[1].toFixed(3)}]`
                : '';
            lines.push(`  ${stage.name}: ${stage.inputCount} -> ${stage.outputCount} (-${dropped}) ${stage.durationMs}ms${scoreStr}`);
            if (stage.droppedIds.length > 0 && stage.droppedIds.length <= 5) {
                lines.push(`    dropped: ${stage.droppedIds.join(', ')}`);
            }
            else if (stage.droppedIds.length > 5) {
                lines.push(`    dropped: ${stage.droppedIds.slice(0, 5).join(', ')} (+${stage.droppedIds.length - 5} more)`);
            }
        }
        const lastStage = this._stages[this._stages.length - 1];
        const totalMs = Date.now() - this._startTime;
        lines.push(`  total: ${totalMs}ms, final count: ${lastStage ? lastStage.outputCount : 0}`);
        return lines.join('\n');
    }
    /** Access collected stages (read-only). */
    get stages() {
        return this._stages;
    }
}
