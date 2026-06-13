/**
 * core/search/gmm-cluster.ts — MemGAS 风格的 GMM 记忆聚类
 *
 * 论文：MemGAS (arXiv:2505.19549) — 多粒度记忆架构
 * 核心思想：用 GMM（高斯混合模型）把记忆按"主题分布"软聚类，
 *          新记忆入仓后异步跑一次小规模聚类，自动发现关联主题。
 *
 * 为什么不用 sklearn：
 *   ① OpenClaw 插件运行环境无 Python/NumPy
 *   ② GMM 单轮 EM 算法 ~150 行 TS 即可实现
 *   ③ 内存聚类在 1k 记忆以下、特征维度 ≤ 32 时延迟 < 50ms
 *
 * 简化点（vs 论文全量实现）：
 *   - 特征维度固定 8（语义向量降维到 8 维）
 *   - 最大 K=8（一般场景够用，避免 O(K·N·D) 爆炸）
 *   - 用对角协方差（避免奇异矩阵求逆）
 *   - 软分配：返回每条记忆对每个 cluster 的概率
 *
 * 入口：
 *   clusterMemories(items, opts) → { clusters, assignments }
 *   assignToCluster(embedding, model) → { clusterId, confidence }
 */
/** 简易字符串 hash（与 entropy-router 同源），用于文本特征投影 */
function simpleHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
const DEFAULTS = {
    k: 4,
    maxIterations: 25,
    tol: 1e-4,
    seed: 42,
    featureDim: 8,
    varianceFloor: 1e-3,
};
/** 简易确定性 PRNG (mulberry32)，保证 seed → 同一结果 */
function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * 把原始文本/embedding 投影到固定维度的密集向量。
 * 实现：把文本分成 D 段，对每段做字符 hash → 归一化；
 *      如果有 embedding 则先 PCA-like 降维到 D。
 */
export function projectFeatures(item, dim) {
    if (item.embedding && item.embedding.length > 0) {
        // 简化降维：把 embedding 切成 D 段，每段求平均
        const out = new Array(dim).fill(0);
        const src = item.embedding;
        const bucket = Math.max(1, Math.floor(src.length / dim));
        for (let d = 0; d < dim; d++) {
            let sum = 0;
            const start = d * bucket;
            const end = Math.min(src.length, start + bucket);
            for (let i = start; i < end; i++)
                sum += src[i] ?? 0;
            out[d] = sum / (end - start || 1);
        }
        return out;
    }
    // 文本特征：分桶 hash
    const out = new Array(dim).fill(0);
    const text = item.text || item.id;
    const bucketSize = Math.max(1, Math.floor(text.length / dim));
    for (let d = 0; d < dim; d++) {
        const start = d * bucketSize;
        const slice = text.slice(start, start + bucketSize);
        out[d] = (simpleHash(slice) % 1000) / 1000;
    }
    return out;
}
/** 高斯概率密度 (单变量对角协方差) */
function gaussianPdf(x, mean, variance) {
    const v = Math.max(variance, 1e-9);
    return Math.exp(-((x - mean) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
}
/** 一条数据对一个 cluster 的联合概率 */
function componentLogProb(x, mean, variance) {
    let logP = 0;
    for (let d = 0; d < x.length; d++) {
        const p = gaussianPdf(x[d] ?? 0, mean[d] ?? 0, variance[d] ?? 1e-3);
        logP += Math.log(Math.max(p, 1e-30));
    }
    return logP;
}
/**
 * 主入口：用 EM 算法把 memories 聚成 K 个主题簇。
 *
 * @param items 待聚类的记忆
 * @param opts  选项（k, maxIterations, ...）
 * @returns     { model, responsibilities, assignments }
 */
export function clusterMemories(items, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const N = items.length;
    if (N === 0) {
        return {
            model: { k: 0, weights: [], means: [], variances: [], iterations: 0, logLikelihood: 0 },
            responsibilities: [],
            assignments: [],
        };
    }
    // 少于 K 个样本时：每个样本单独一簇
    const K = Math.min(o.k, N);
    const D = o.featureDim;
    // 投影特征
    const X = items.map((it) => projectFeatures(it, D));
    // 初始化：随机选 K 个样本作均值，方差用全局方差
    const rng = makeRng(o.seed);
    const means = [];
    const usedIdx = new Set();
    while (means.length < K) {
        const idx = Math.floor(rng() * N);
        if (usedIdx.has(idx))
            continue;
        usedIdx.add(idx);
        const x = X[idx];
        if (!x)
            continue;
        means.push([...x]);
    }
    // 全局方差
    const globalVar = new Array(D).fill(o.varianceFloor);
    for (let d = 0; d < D; d++) {
        let s2 = 0;
        for (let i = 0; i < N; i++) {
            const xd = X[i]?.[d] ?? 0;
            s2 += xd * xd;
        }
        globalVar[d] = Math.max(s2 / N, o.varianceFloor);
    }
    const variances = means.map(() => [...globalVar]);
    const weights = new Array(K).fill(1 / K);
    // 责任矩阵
    const resp = Array.from({ length: N }, () => new Array(K).fill(0));
    let prevLogL = -Infinity;
    // EM 主循环
    let iterations = 0;
    for (let it = 0; it < o.maxIterations; it++) {
        iterations = it + 1;
        // E-step：算责任
        let logL = 0;
        for (let i = 0; i < N; i++) {
            const x = X[i];
            const logProbs = new Array(K);
            let maxLogP = -Infinity;
            for (let k = 0; k < K; k++) {
                const mean = means[k];
                const variance = variances[k];
                logProbs[k] = Math.log(Math.max(weights[k] ?? 1e-30, 1e-30)) + componentLogProb(x, mean, variance);
                if (logProbs[k] > maxLogP)
                    maxLogP = logProbs[k];
            }
            // log-sum-exp 稳定化
            let sumExp = 0;
            for (let k = 0; k < K; k++) {
                logProbs[k] = Math.exp((logProbs[k] ?? 0) - maxLogP);
                sumExp += logProbs[k] ?? 0;
            }
            for (let k = 0; k < K; k++) {
                const r = (logProbs[k] ?? 0) / Math.max(sumExp, 1e-30);
                resp[i][k] = r;
            }
            logL += maxLogP + Math.log(Math.max(sumExp, 1e-30));
        }
        // M-step：更新参数
        const newMeans = Array.from({ length: K }, () => new Array(D).fill(0));
        const newVars = Array.from({ length: K }, () => new Array(D).fill(0));
        const newWeights = new Array(K).fill(0);
        for (let k = 0; k < K; k++) {
            let nk = 0;
            for (let i = 0; i < N; i++)
                nk += resp[i][k] ?? 0;
            newWeights[k] = nk / N;
            for (let d = 0; d < D; d++) {
                let m = 0;
                for (let i = 0; i < N; i++)
                    m += (resp[i][k] ?? 0) * (X[i][d] ?? 0);
                newMeans[k][d] = nk > 1e-9 ? m / nk : (means[k][d] ?? 0);
            }
            for (let d = 0; d < D; d++) {
                let v = 0;
                for (let i = 0; i < N; i++) {
                    const diff = (X[i][d] ?? 0) - (newMeans[k][d] ?? 0);
                    v += (resp[i][k] ?? 0) * diff * diff;
                }
                newVars[k][d] = Math.max(v / Math.max(nk, 1e-9), o.varianceFloor);
            }
        }
        for (let k = 0; k < K; k++) {
            means[k] = newMeans[k];
            variances[k] = newVars[k];
        }
        for (let k = 0; k < K; k++)
            weights[k] = newWeights[k] ?? 0;
        // 收敛判定
        if (Math.abs(logL - prevLogL) < o.tol) {
            prevLogL = logL;
            break;
        }
        prevLogL = logL;
    }
    // assignments: argmax responsibility
    const assignments = new Array(N);
    for (let i = 0; i < N; i++) {
        let best = 0;
        let bestR = -Infinity;
        for (let k = 0; k < K; k++) {
            const r = resp[i][k] ?? 0;
            if (r > bestR) {
                bestR = r;
                best = k;
            }
        }
        assignments[i] = best;
    }
    return {
        model: { k: K, weights, means, variances, iterations, logLikelihood: prevLogL },
        responsibilities: resp,
        assignments,
    };
}
/**
 * 把单条新记忆分到已训练好的模型中。
 * 用于 capture 后台：每入一条新记忆，不必重跑完整 EM，
 * 直接算 E-step 即可。
 */
export function assignToCluster(item, model, featureDim = 8) {
    if (model.k === 0) {
        return { clusterId: 0, confidence: 0, distribution: [] };
    }
    const x = projectFeatures(item, featureDim);
    const K = model.k;
    const logProbs = new Array(K);
    let maxLogP = -Infinity;
    for (let k = 0; k < K; k++) {
        const w = model.weights[k] ?? 1e-30;
        const mean = model.means[k] ?? [];
        const variance = model.variances[k] ?? [];
        logProbs[k] = Math.log(Math.max(w, 1e-30)) + componentLogProb(x, mean, variance);
        if (logProbs[k] > maxLogP)
            maxLogP = logProbs[k];
    }
    let sumExp = 0;
    for (let k = 0; k < K; k++) {
        logProbs[k] = Math.exp((logProbs[k] ?? 0) - maxLogP);
        sumExp += logProbs[k] ?? 0;
    }
    const dist = logProbs.map((p) => (p ?? 0) / Math.max(sumExp, 1e-30));
    let best = 0;
    let bestR = -Infinity;
    for (let k = 0; k < K; k++) {
        const r = dist[k] ?? 0;
        if (r > bestR) {
            bestR = r;
            best = k;
        }
    }
    return { clusterId: best, confidence: bestR, distribution: dist };
}
/**
 * 便捷：对一组记忆做一次性聚类 + 立即把每条分到主簇。
 */
export function clusterAndAssign(items, opts) {
    const result = clusterMemories(items, opts);
    return items.map((it, i) => ({
        ...it,
        clusterId: result.assignments[i] ?? 0,
        confidence: result.responsibilities[i]?.[result.assignments[i] ?? 0] ?? 0,
    }));
}
