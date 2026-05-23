export function createSessionFilter(config) {
    const internalLabels = new Set([
        "system",
        "admin",
        "cron",
        "cronjob",
        "heartbeat",
        "healthcheck",
        "internal",
        "plugin",
        "test",
        "debug",
        "monitor",
    ]);
    const cfg = {
        blockInternal: config?.blockInternal !== false,
        blockLabels: config?.blockLabels ?? [],
        allowLabels: config?.allowLabels ?? [],
        minMessages: config?.minMessages ?? 2,
    };
    /**
     * Check if a session should be processed (captured/recalled).
     * @param sessionKey The session identifier string
     * @param context Optional context object with session metadata
     */
    function shouldProcess(sessionKey, context) {
        // Skip empty session keys
        if (!sessionKey || sessionKey.trim().length === 0)
            return false;
        // Explicit allowlist: only process matching sessions
        if (cfg.allowLabels.length > 0) {
            const sessionLabel = context?.label || sessionKey;
            return cfg.allowLabels.some(label => sessionLabel.toLowerCase().includes(label.toLowerCase()));
        }
        // Block specific labels
        if (cfg.blockLabels.length > 0) {
            for (const blocked of cfg.blockLabels) {
                if (sessionKey.toLowerCase().includes(blocked.toLowerCase()) ||
                    context?.label?.toLowerCase().includes(blocked.toLowerCase())) {
                    return false;
                }
            }
        }
        // Block internal/system sessions
        if (cfg.blockInternal) {
            for (const label of internalLabels) {
                if (sessionKey.toLowerCase().includes(label))
                    return false;
            }
        }
        // Minimum message threshold (applies to recall, not capture)
        if (context?.messageCount !== undefined && context.messageCount < cfg.minMessages) {
            return false;
        }
        return true;
    }
    /** Get internal labels list (for logging/debugging) */
    function getInternalLabels() {
        return Array.from(internalLabels);
    }
    /** Add custom labels to block list */
    function addBlockedLabels(labels) {
        for (const l of labels) {
            cfg.blockLabels.push(l);
        }
    }
    return { shouldProcess, getInternalLabels, addBlockedLabels };
}
