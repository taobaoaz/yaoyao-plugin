/**
 * Retrieval Statistics — 聚合检索指标
 * 从 Brain (memory-lancedb-pro) 学习：Ring buffer 聚合查询指标
 * 零外部依赖，纯本地
 */
export class RetrievalStatsCollector {
    // Ring buffer: O(1) write, avoids O(n) Array.shift() GC pressure.
    _records = [];
    _head = 0;
    _count = 0;
    _maxRecords;
    constructor(maxRecords = 1000) {
        this._maxRecords = maxRecords;
        this._records = new Array(maxRecords);
    }
    recordQuery(trace, source = "auto-recall") {
        this._records[this._head] = { trace, source };
        this._head = (this._head + 1) % this._maxRecords;
        if (this._count < this._maxRecords) {
            this._count++;
        }
    }
    getStats() {
        const n = this._count;
        if (n === 0) {
            return {
                totalQueries: 0,
                zeroResultQueries: 0,
                avgLatencyMs: 0,
                p95LatencyMs: 0,
                avgResultCount: 0,
                topDropStages: [],
            };
        }
        let totalLatency = 0;
        let totalResults = 0;
        let zeroResultQueries = 0;
        const latencies = [];
        const dropsByStage = {};
        const start = n < this._maxRecords ? 0 : this._head;
        for (let i = 0; i < n; i++) {
            const rec = this._records[(start + i) % this._maxRecords];
            if (rec === undefined)
                continue;
            const { trace } = rec;
            totalLatency += trace.totalMs;
            totalResults += trace.finalCount;
            latencies.push(trace.totalMs);
            if (trace.finalCount === 0)
                zeroResultQueries++;
            for (const stage of trace.stages) {
                const dropped = stage.inputCount - stage.outputCount;
                if (dropped > 0) {
                    dropsByStage[stage.name] = (dropsByStage[stage.name] || 0) + dropped;
                }
            }
        }
        latencies.sort((a, b) => a - b);
        const p95Index = Math.min(Math.ceil(n * 0.95) - 1, n - 1);
        const topDropStages = Object.entries(dropsByStage)
            .map(([name, totalDropped]) => ({ name, totalDropped }))
            .sort((a, b) => b.totalDropped - a.totalDropped)
            .slice(0, 5);
        return {
            totalQueries: n,
            zeroResultQueries,
            avgLatencyMs: Math.round(totalLatency / n),
            p95LatencyMs: latencies[p95Index] || 0,
            avgResultCount: Math.round((totalResults / n) * 10) / 10,
            topDropStages,
        };
    }
    reset() {
        this._records = new Array(this._maxRecords);
        this._head = 0;
        this._count = 0;
    }
    get count() {
        return this._count;
    }
}
/** Global retrieval stats collector — shared across auto-recall and memory_stats tool */
export const globalRetrievalStats = new RetrievalStatsCollector(100);
