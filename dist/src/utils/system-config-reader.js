/**
 * utils/system-config-reader.ts — System architecture detection and strategy recommendation.
 *
 * v1.7.9: XiaoYi Claw strategy removed. Pure OpenClaw detection.
 */
import os from "node:os";
import { detectEnvironment, isOpenClaw } from "./environment-detector.js";
export function detectSystemArchitecture() {
    const env = detectEnvironment();
    const isOC = isOpenClaw();
    return {
        os: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        isContainer: process.env.KUBERNETES_SERVICE_HOST !== undefined,
        openClawVersion: isOC ? (env.signals.find(s => s.includes('openclaw')) || 'unknown') : 'unknown',
    };
}
export function getRecommendedStrategy(_arch) {
    // Single strategy: full capture + hybrid recall
    return {
        name: 'full',
        captureMode: 'async',
        recallMode: 'hybrid',
    };
}
