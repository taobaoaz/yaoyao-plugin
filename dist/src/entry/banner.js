/**
 * entry/banner.ts — Yaoyao Memory startup banner.
 *
 * Zero logic, pure formatting. Reads platform report + health result,
 * produces the 🎲 banner.
 */
export function buildBanner(ctx) {
    const { pluginVersion, toolCount, memoryDir, cap, health } = ctx;
    const verStr = `v${pluginVersion}`;
    const toolStr = `${toolCount} Tools`;
    const backendLabel = cap.backend === "node-sqlite" ? "FTS5 + sqlite-vec + 时间线 + 云备份"
        : cap.backend === "better-sqlite3" ? "FTS5 (better-sqlite3) + 时间线 + 云备份"
            : "文件降级模式 — daily markdown + 简单搜索";
    const banner = [
        "🎲 ══════════════════════════════════════════",
        "🎲    摇摇 · 记忆引擎已启动",
        `🎲    ${verStr}  ·  ${toolStr}  ·  3 Hooks`,
        `🎲    ${backendLabel}`,
        `🎲    记忆目录: ${memoryDir}`,
    ];
    const healthFails = health.checks.filter((c) => c.status === "fail").length;
    const healthWarns = health.checks.filter((c) => c.status === "warn").length;
    if (healthFails > 0) {
        banner.push(`🎲    ⚠️  环境检测: ${healthFails} 项未通过`);
        banner.push("🎲    查看日志 [yaoyao-memory:health] 了解详情");
    }
    else if (healthWarns > 0) {
        banner.push(`🎲    ℹ️  环境检测: ${healthWarns} 项警告`);
    }
    else {
        banner.push("🎲    环境检测: 全部通过");
    }
    if (cap.backend !== "node-sqlite" && cap.warnings.length > 0) {
        banner.push(`🎲    ⚠️  ${cap.warnings[0].slice(0, 50)}...`);
    }
    banner.push("🎲 ══════════════════════════════════════════");
    return banner;
}
export function showBanner(logger, ctx) {
    const lines = buildBanner(ctx);
    for (const line of lines) {
        logger.info?.(line);
    }
}
