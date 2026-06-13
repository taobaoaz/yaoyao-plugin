import os from "node:os";
import { detectEnvironment, isXiaoYiClaw, isOpenClaw } from "./environment-detector.js";
export function detectSystemArchitecture() {
    const env = detectEnvironment();
    const isXiaoYi = isXiaoYiClaw();
    const isOC = isOpenClaw();
    return {
        os: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        isContainer: process.env.KUBERNETES_SERVICE_HOST !== undefined,
        isXiaoYiClaw: isXiaoYi,
        openClawVersion: isOC ? (env.signals.find(s => s.includes('openclaw')) || 'unknown') : 'unknown',
        memorySlotOwner: isXiaoYi ? 'claw-core' : 'yaoyao-memory',
        contextEngineSlotOwner: isXiaoYi ? 'claw-core' : 'yaoyao-memory',
    };
}
export function getRecommendedStrategy(arch) {
    if (arch.isXiaoYiClaw) {
        return {
            name: 'coexist',
            captureMode: 'l0-only',
            recallMode: 'supplement',
        };
    }
    return {
        name: 'full',
        captureMode: 'async',
        recallMode: 'hybrid',
    };
}
