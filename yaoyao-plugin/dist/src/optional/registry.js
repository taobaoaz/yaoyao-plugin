export class FeatureRegistry {
    features = new Map();
    resolved = new Map();
    /** Register a feature. Duplicate IDs are overwritten (last wins). */
    register(feature) {
        this.features.set(feature.id, feature);
    }
    /** Get a resolved feature result */
    get(id) {
        return this.resolved.get(id);
    }
    /** Check if a feature is active */
    isActive(id) {
        return this.resolved.get(id)?.active ?? false;
    }
    /** Get the service instance for a feature (null if inactive) */
    service(id) {
        return (this.resolved.get(id)?.service ?? null);
    }
    /**
     * Initialize all registered features in dependency order.
     * Features with no dependencies go first.
     * Circular dependencies are detected and skipped.
     */
    initAll(api, config) {
        // Close previously resolved features before clearing
        this.closeAll(api);
        this.resolved.clear();
        const pending = new Set(this.features.keys());
        const inProgress = new Set();
        while (pending.size > 0) {
            let progressed = false;
            for (const id of pending) {
                const feature = this.features.get(id);
                // Check if all dependencies are already resolved
                const depsReady = feature.dependencies.every(did => this.resolved.has(did));
                if (!depsReady)
                    continue;
                // Circular dependency guard
                if (inProgress.has(id)) {
                    api.logger.warn?.(`[yaoyao-memory:optional] Circular dependency detected: "${id}" — skipping`);
                    pending.delete(id);
                    continue;
                }
                inProgress.add(id);
                // Check config switch
                const enabled = isFeatureEnabled(feature, config);
                if (!enabled) {
                    this.resolved.set(id, {
                        active: false,
                        service: null,
                        message: `${feature.name} disabled via config`,
                    });
                    pending.delete(id);
                    inProgress.delete(id);
                    progressed = true;
                    continue;
                }
                // Build dependency map for this feature
                const depMap = new Map();
                for (const did of feature.dependencies) {
                    depMap.set(did, this.resolved.get(did));
                }
                // Initialize
                let result;
                try {
                    result = feature.init(api, config, depMap);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    api.logger.warn?.(`[yaoyao-memory:optional] ${feature.name} init failed: ${msg} — skipping`);
                    result = {
                        active: false,
                        service: null,
                        message: `${feature.name} init failed: ${msg}`,
                    };
                }
                this.resolved.set(id, result);
                pending.delete(id);
                inProgress.delete(id);
                progressed = true;
                // Log result
                const level = result.active ? "info" : "debug";
                api.logger[level]?.(`[yaoyao-memory:optional] ${result.message}`);
                if (result.warning) {
                    api.logger.warn?.(`[yaoyao-memory:optional] ${feature.name}: ${result.warning}`);
                }
            }
            if (!progressed && pending.size > 0) {
                // Deadlock: remaining features have unresolved dependencies
                for (const id of pending) {
                    const feature = this.features.get(id);
                    const missing = feature.dependencies.filter(did => !this.resolved.has(did));
                    const depHint = missing.length > 0 ? ` (missing deps: ${missing.join(", ")})` : "";
                    api.logger.error?.(`[yaoyao-memory:optional] Dependency deadlock: "${id}"${depHint}`);
                }
                const ids = [...pending].join(", ");
                api.logger.error?.(`[yaoyao-memory:optional] Dependency deadlock for: ${ids} — skipping`);
                for (const id of pending) {
                    const f = this.features.get(id);
                    this.resolved.set(id, {
                        active: false,
                        service: null,
                        message: `${f.name} skipped (unresolved dependencies)`,
                    });
                }
                break;
            }
        }
        return this.resolved;
    }
    /** Close all active features in reverse registration order */
    closeAll(api) {
        for (const [id, result] of this.resolved) {
            const feature = this.features.get(id);
            if (!feature?.close || !result.active)
                continue;
            try {
                feature.close(result);
            }
            catch (err) {
                api.logger.warn?.(`[yaoyao-memory:optional] ${feature.name} close failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
}
/** Check if a feature is enabled via config */
function isFeatureEnabled(feature, config) {
    if (!feature.configKey)
        return feature.defaultEnabled;
    const parts = feature.configKey.split(".");
    let current = config;
    for (const part of parts) {
        if (current === null || current === undefined)
            return feature.defaultEnabled;
        if (typeof current !== "object")
            return feature.defaultEnabled;
        current = current[part];
    }
    // Explicit false → disabled
    if (current === false)
        return false;
    // Explicit true → enabled
    if (current === true)
        return true;
    // null/undefined/other → use default
    return feature.defaultEnabled;
}
export function createFeatureRegistry() {
    return new FeatureRegistry();
}
