/**
 * entry/migration.ts — v1.4.x → v1.5.0+ migration detection + auto-install yaoyao-soul.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getBool } from "../utils/config.js";
export function detectLegacy(config, workspaceDir) {
    const traces = [];
    // Check for old config keys
    if (getBool(config, "psychology", false))
        traces.push("config.psychology=true");
    if (getBool(config, "intervention", false))
        traces.push("config.intervention=true");
    if (getBool(config, "moodTracking", false))
        traces.push("config.moodTracking=true");
    // Check for legacy data files
    const legacyFiles = [
        path.join(workspaceDir, ".persona-state.json"),
        path.join(workspaceDir, "memory", ".persona-state.json"),
    ];
    for (const f of legacyFiles) {
        if (fs.existsSync(f))
            traces.push(`legacy file: ${path.basename(f)}`);
    }
    if (traces.length === 0) {
        return { hasLegacy: false, traces, autoMigrated: false, bannerLines: [] };
    }
    // ── Auto-migration: detect but DO NOT auto-install yaoyao-soul ──
    // Security: auto git clone introduces supply-chain risk (DNS hijack, repo takeover).
    // We detect legacy state and show instructions, but never execute remote code.
    let autoMigrated = false;
    const banner = [
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "  ⚠️  检测到从 v1.4.x 升级的痕迹",
        "",
        "  摇摇记忆插件已升级到 v1.5.0+，架构已拆分：",
        "",
        "  • 情绪分析 (memory_mood)        → 已移至 yaoyao-soul",
        "  • 画像生成 (persona-generator)   → 已移至 yaoyao-soul",
        "  • 反馈学习 (feedback-tracker)    → 已移至 yaoyao-soul",
        "  • LLM 提取管线 (L1→L2→L3)      → 已移至 yaoyao-soul",
        "",
        "  ✅ 你的数据完全安全：",
        "     memory/*.md、.yaoyao.db、persona.md 均不受影响",
        "",
        ...(autoMigrated
            ? [
                "  ✅ 已检测到 yaoyao-soul（跳过远程代码执行）",
                "",
            ]
            : [
                "  📦 如需恢复这些功能，请手动安装 yaoyao-soul：",
                "     cd ~/.openclaw/plugins",
                "     git clone https://github.com/taobaoaz/yaoyao-soul.git",
                "",
            ]),
        "  📖 完整迁移指南：",
        "     https://github.com/taobaoaz/yaoyao-plugin/blob/main/MIGRATION.md",
        "",
        `  检测到的旧版痕迹: ${traces.join(", ")}`,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
    ];
    return { hasLegacy: true, traces, autoMigrated, bannerLines: banner };
}
/**
 * Cleanup old v1.4.x skill directories.
 * Migrates any .json configs to archive dir, then deletes the old skill dir.
 */
export function cleanupOldSkills(logger) {
    const _skillsDir = path.join(os.homedir(), ".openclaw", "workspace", "skills");
    const _migratedDir = path.join(os.homedir(), ".openclaw", "extensions", "yaoyao-memory", ".skill-migrations");
    const oldSkillDirs = [
        { dir: path.join(_skillsDir, "yaoyao-memory"), name: "yaoyao-memory" },
        { dir: path.join(_skillsDir, "yaoyao-memory-v2"), name: "yaoyao-memory-v2" },
        { dir: path.join(_skillsDir, "yaoyao-cloud-backup"), name: "yaoyao-cloud-backup" },
    ];
    for (const { dir, name } of oldSkillDirs) {
        try {
            if (!fs.existsSync(dir))
                continue;
            const migrated = [];
            const jsonFiles = [];
            const walk = (d) => {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    const full = path.join(d, e.name);
                    if (e.isSymbolicLink())
                        continue; // skip symlinks to avoid directory traversal
                    if (e.isDirectory())
                        walk(full);
                    else if (e.name.endsWith(".json"))
                        jsonFiles.push(full);
                }
            };
            walk(dir);
            if (jsonFiles.length > 0) {
                fs.mkdirSync(_migratedDir, { recursive: true });
                for (const jf of jsonFiles) {
                    const rel = path.relative(dir, jf);
                    const safeName = name + "__" + rel.replace(/[\\/]/g, "_");
                    const dest = path.join(_migratedDir, safeName);
                    if (!fs.existsSync(dest))
                        fs.copyFileSync(jf, dest);
                    migrated.push(rel);
                }
            }
            fs.rmSync(dir, { recursive: true });
            if (migrated.length > 0) {
                logger.info?.(`[yaoyao-memory] 已迁移 ${migrated.length} 个配置文件并从 ${name} 转移（${_migratedDir}），旧目录已清理`);
            }
            else {
                logger.info?.(`[yaoyao-memory] 已清理旧 skill: ${name}（无配置文件需迁移）`);
            }
        }
        catch (e) {
            logger.warn?.(`[yaoyao-memory] 清理旧 skill ${name} 失败: ${e instanceof Error ? e.message : String(e)}（无影响，继续启动）`);
        }
    }
}
