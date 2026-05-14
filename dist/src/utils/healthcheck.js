/**
 * Healthcheck — 环境自检与诊断工具
 *
 * 在启动前或故障时运行，检测常见环境不兼容问题。
 * 零外部依赖，纯 Node.js 内置模块。
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readVersionRequirements, satisfiesVersion } from "./version-check.js";
import { getDBCapability, createCompatDB } from "../platform/db/compat.js";
/** Run full health check suite */
export function runHealthcheck(baseDir) {
    const checks = [];
    const versions = readVersionRequirements();
    // 1. Node.js version — reads requirement from package.json
    const nodeVersion = process.version;
    if (satisfiesVersion(nodeVersion, versions.nodeRange)) {
        checks.push({ name: "Node.js 版本", status: "pass", message: `${nodeVersion} ✅ (要求 ${versions.nodeRange})` });
    }
    else {
        checks.push({ name: "Node.js 版本", status: "fail", message: `${nodeVersion} ❌`, detail: `要求 ${versions.nodeRange}。node:sqlite 从 Node 22 开始内置，当前版本无法加载数据库层。` });
    }
    // 2. OpenClaw Gateway version — reads requirement from package.json
    let gatewayVer = "unknown";
    try {
        const _require = createRequire(import.meta.url);
        const sdk = _require("openclaw/plugin-sdk/plugin-entry");
        gatewayVer = sdk?.OPENCLAW_VERSION || sdk?.version || "unknown";
        if (satisfiesVersion(gatewayVer, versions.pluginApiRange)) {
            checks.push({ name: "OpenClaw Gateway", status: "pass", message: `${gatewayVer} ✅ (要求 ${versions.pluginApiRange})` });
        }
        else {
            checks.push({ name: "OpenClaw Gateway", status: "fail", message: `${gatewayVer} ❌`, detail: `要求 ${versions.pluginApiRange}。请升级 Gateway：npm install -g openclaw@latest` });
        }
    }
    catch {
        checks.push({ name: "OpenClaw Gateway", status: "warn", message: `无法检测 ⚠️`, detail: `插件要求 Gateway ${versions.pluginApiRange}。如功能异常请升级。` });
    }
    // 3. SQLite backend availability (node:sqlite or better-sqlite3)
    const dbCap = getDBCapability();
    if (dbCap.nodeSqliteAvailable) {
        checks.push({ name: "SQLite 后端", status: "pass", message: "node:sqlite (Node 22+) ✅" });
    }
    else if (dbCap.betterSqlite3Available) {
        checks.push({ name: "SQLite 后端", status: "pass", message: "better-sqlite3 (npm) ✅" });
    }
    else {
        checks.push({ name: "SQLite", status: "warn", message: "无 SQLite 后端 ⚠️", detail: "将降级为 file-db 纯文件模式。记忆仍可保存，搜索降级为简单文本匹配。建议：npm install better-sqlite3，或升级到 Node 22+。" });
    }
    // 4. sqlite-vec availability
    let vecAvailable = false;
    try {
        const _require = createRequire(import.meta.url);
        _require("sqlite-vec");
        vecAvailable = true;
        checks.push({ name: "sqlite-vec", status: "pass", message: "向量扩展可用 ✅" });
    }
    catch {
        checks.push({ name: "sqlite-vec", status: "warn", message: "未安装 ⚠️", detail: "向量搜索不可用，FTS5 纯文本搜索仍正常工作。如需向量搜索请 npm install sqlite-vec。" });
    }
    // 5. Home directory
    const home = os.homedir();
    if (home && home !== "/" && fs.existsSync(home)) {
        checks.push({ name: "用户主目录", status: "pass", message: `${home} ✅` });
    }
    else {
        checks.push({ name: "用户主目录", status: "warn", message: `${home || "unknown"} ⚠️`, detail: "主目录异常。某些功能可能无法找到默认配置路径。建议显式设置 memoryDir。" });
    }
    // 6. Memory directory writable
    const memDir = baseDir || path.join(os.homedir(), ".openclaw", "workspace", "memory");
    try {
        fs.mkdirSync(memDir, { recursive: true });
        const testFile = path.join(memDir, `.healthcheck-${Date.now()}`);
        fs.writeFileSync(testFile, "ok", "utf-8");
        fs.unlinkSync(testFile);
        checks.push({ name: "记忆目录可写", status: "pass", message: `${memDir} ✅` });
    }
    catch (err) {
        checks.push({ name: "记忆目录可写", status: "fail", message: `${memDir} ❌`, detail: `无法写入: ${err.message}。检查磁盘空间和权限。` });
    }
    // 7. File system supports WAL (critical for Docker/NFS)
    if (dbCap.nodeSqliteAvailable || dbCap.betterSqlite3Available) {
        const walTestPath = path.join(memDir, `.wal-test-${Date.now()}.db`);
        try {
            const { db: testDb } = createCompatDB(walTestPath);
            testDb.exec("PRAGMA journal_mode = WAL");
            const mode = testDb.prepare("PRAGMA journal_mode").get();
            testDb.close();
            fs.unlinkSync(walTestPath);
            const walFile = walTestPath + "-shm";
            if (fs.existsSync(walFile))
                fs.unlinkSync(walFile);
            const walFile2 = walTestPath + "-wal";
            if (fs.existsSync(walFile2))
                fs.unlinkSync(walFile2);
            if (String(mode?.journal_mode) === "wal" || String(mode) === "wal") {
                checks.push({ name: "WAL 支持", status: "pass", message: "文件系统支持 WAL ✅" });
            }
            else {
                checks.push({ name: "WAL 支持", status: "warn", message: "WAL 不可用 ⚠️", detail: "文件系统/环境不支持 WAL（常见于 NFS、某些 Docker 卷）。数据库仍可用，但并发性能降低。" });
            }
        }
        catch (err) {
            checks.push({ name: "WAL 支持", status: "warn", message: "检测失败 ⚠️", detail: err.message });
        }
    }
    // 8. Platform
    const platform = os.platform();
    if (platform === "linux" || platform === "darwin") {
        checks.push({ name: "操作系统", status: "pass", message: `${platform} ✅` });
    }
    else if (platform === "win32") {
        checks.push({ name: "操作系统", status: "warn", message: `Windows ⚠️`, detail: "Windows 支持实验性。云备份中的 Samba 功能依赖 Windows net use 命令。路径分隔符已自动处理。" });
    }
    else {
        checks.push({ name: "操作系统", status: "warn", message: `${platform} ⚠️`, detail: "未充分测试的平台。核心功能应可用，但可能有路径或编码问题。" });
    }
    // 9. UTF-8 locale
    const locale = process.env.LC_ALL || process.env.LANG || process.env.LC_CTYPE || "unknown";
    if (locale.toLowerCase().includes("utf-8") || locale.toLowerCase().includes("utf8")) {
        checks.push({ name: "UTF-8 编码", status: "pass", message: `${locale} ✅` });
    }
    else {
        checks.push({ name: "UTF-8 编码", status: "warn", message: `${locale} ⚠️`, detail: "未检测到 UTF-8 locale。CJK 文本和 emoji 可能有编码问题。建议设置环境变量 LANG=en_US.UTF-8。" });
    }
    // 10. Available disk space (rough)
    try {
        const stats = fs.statfsSync(memDir);
        const freeGb = (stats.bavail * stats.bsize) / (1024 ** 3);
        if (freeGb > 1) {
            checks.push({ name: "磁盘空间", status: "pass", message: `${freeGb.toFixed(1)} GB 可用 ✅` });
        }
        else {
            checks.push({ name: "磁盘空间", status: "warn", message: `${freeGb.toFixed(1)} GB ⚠️`, detail: "磁盘空间不足。长期运行可能无法写入新记忆。" });
        }
    }
    catch {
        checks.push({ name: "磁盘空间", status: "warn", message: "无法检测 ⚠️", detail: "无法获取磁盘空间信息。不影响功能，但建议确保有充足空间。" });
    }
    // 11. git availability (for auto-migration)
    try {
        execSync("git --version", { stdio: "pipe", timeout: 3_000 });
        checks.push({ name: "Git 可用性", status: "pass", message: "git 可用 ✅" });
    }
    catch {
        checks.push({ name: "Git 可用性", status: "warn", message: "不可用 ⚠️", detail: "git 命令未找到。自动迁移（yaoyao-soul 安装）将不可用，需手动安装。" });
    }
    const failures = checks.filter(c => c.status === "fail").length;
    const warns = checks.filter(c => c.status === "warn").length;
    const ok = failures === 0;
    return {
        ok,
        checks,
        summary: ok
            ? warns > 0
                ? `环境基本健康，有 ${warns} 项警告（不影响核心功能）`
                : "环境完全健康 ✅"
            : `环境有 ${failures} 项致命问题，需要修复后才能正常使用`,
    };
}
/** Format health result as markdown for display */
export function formatHealthcheck(result) {
    const lines = [
        `## 🏥 环境诊断报告`,
        ``,
        `**总体状态**: ${result.ok ? "✅ 通过" : "❌ 未通过"}`,
        ``,
        `| 检查项 | 状态 | 说明 |`,
        `|--------|------|------|`,
    ];
    for (const c of result.checks) {
        const icon = c.status === "pass" ? "🟢" : c.status === "warn" ? "🟡" : "🔴";
        lines.push(`| ${c.name} | ${icon} ${c.status.toUpperCase()} | ${c.message} |`);
        if (c.detail) {
            lines.push(`| | | *${c.detail}* |`);
        }
    }
    lines.push(``, `**${result.summary}**`, ``);
    return lines.join("\n");
}
