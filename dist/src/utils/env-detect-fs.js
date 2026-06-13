/**
 * utils/env-detect-fs.ts — File-system environment detection.
 *
 * Detects XiaoYi Claw vs OpenClaw by directory structure.
 * Zero external deps.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
/** Detect environment by file system signatures. */
export function detectByFileSystem() {
    const signals = [];
    const possibleRoots = [
        process.env.XIAOYI_CLAW_HOME,
        process.env.OPENCLAW_HOME,
        process.cwd(),
        dirname(process.cwd()),
    ].filter(Boolean);
    for (const root of possibleRoots) {
        const extDir = join(root, 'extensions');
        if (existsSync(extDir)) {
            try {
                const entries = readdirSync(extDir);
                if (entries.includes('claw-core') || entries.includes('xiaoyi-channel')) {
                    signals.push(`found xiaoyi extensions in ${extDir}`);
                    return { env: 'xiaoyi-claw', signals };
                }
                if (entries.includes('openclaw-better-gateway')) {
                    signals.push(`found xiaoyi-specific gateway in ${extDir}`);
                    return { env: 'xiaoyi-claw', signals };
                }
            }
            catch {
                /* ignore read errors */
            }
        }
        const ocExtDir = join(root, '.openclaw', 'extensions');
        if (existsSync(ocExtDir)) {
            signals.push(`found openclaw extensions in ${ocExtDir}`);
            return { env: 'openclaw', signals };
        }
    }
    return { env: 'unknown', signals };
}
