/**
 * Scope Manager — Multi-scope memory isolation (from Brain v1.1.0)
 * Zero external dependency. Lightweight access control for multi-agent setups.
 */
export const DEFAULT_SCOPE_CONFIG = {
    default: "global",
    definitions: {
        global: { description: "Shared knowledge across all agents" },
    },
    agentAccess: {},
};
const SCOPE_PATTERNS = {
    GLOBAL: "global",
    AGENT: (agentId) => `agent:${agentId}`,
    CUSTOM: (name) => `custom:${name}`,
    PROJECT: (projectId) => `project:${projectId}`,
    USER: (userId) => `user:${userId}`,
};
const SYSTEM_BYPASS_IDS = new Set(["system", "undefined"]);
export function isSystemBypassId(agentId) {
    return typeof agentId === "string" && SYSTEM_BYPASS_IDS.has(agentId);
}
/** Lightweight scope manager for memory isolation. */
export class SimpleScopeManager {
    config;
    constructor(config = DEFAULT_SCOPE_CONFIG) {
        this.config = config;
    }
    /** Get accessible scopes for an agent. */
    getAccessibleScopes(agentId) {
        const scopes = new Set(["global"]);
        if (agentId) {
            scopes.add(SCOPE_PATTERNS.AGENT(agentId));
        }
        const allowed = this.config.agentAccess[agentId || ""];
        if (Array.isArray(allowed)) {
            for (const s of allowed)
                scopes.add(s);
        }
        return Array.from(scopes);
    }
    /** Get default scope for an agent. */
    getDefaultScope(agentId) {
        if (agentId) {
            const agentScope = SCOPE_PATTERNS.AGENT(agentId);
            if (this.config.agentAccess[agentId]?.length) {
                return this.config.agentAccess[agentId][0];
            }
            // If no explicit access config, default to the agent's own scope
            return agentScope;
        }
        return this.config.default;
    }
    /** Check if an agent can access a scope. */
    isAccessible(scope, agentId) {
        if (isSystemBypassId(agentId))
            return true;
        if (scope === "global")
            return true;
        if (agentId && scope === SCOPE_PATTERNS.AGENT(agentId))
            return true;
        const allowed = this.getAccessibleScopes(agentId);
        return allowed.includes(scope);
    }
    /** Validate scope syntax. */
    validateScope(scope) {
        if (!scope || typeof scope !== "string")
            return false;
        if (scope === "global")
            return true;
        const parts = scope.split(":");
        return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0;
    }
    /** Get all known scopes. */
    getAllScopes() {
        return Object.keys(this.config.definitions);
    }
    /** Get scope definition. */
    getScopeDefinition(scope) {
        return this.config.definitions[scope];
    }
    /** Add a custom scope. */
    addScope(scope, definition) {
        this.config.definitions[scope] = definition;
    }
    /** Register agent access to scopes. */
    grantAccess(agentId, scopes) {
        this.config.agentAccess[agentId] = scopes;
    }
    /** Build a scope tag for memory metadata. */
    static buildScopeTag(agentId, projectId, userId) {
        if (projectId)
            return SCOPE_PATTERNS.PROJECT(projectId);
        if (userId)
            return SCOPE_PATTERNS.USER(userId);
        if (agentId)
            return SCOPE_PATTERNS.AGENT(agentId);
        return "global";
    }
}
/** Resolve which scope a memory should be stored under. */
export function resolveMemoryScope(agentId, explicitScope, manager) {
    if (explicitScope && manager?.validateScope(explicitScope)) {
        return explicitScope;
    }
    if (manager) {
        return manager.getDefaultScope(agentId);
    }
    return agentId ? SCOPE_PATTERNS.AGENT(agentId) : "global";
}
