/**
 * Version comparison utilities — zero-dependency semver-like checks.
 *
 * Supports both numeric semver (1.2.3) and date-based (2026.5.6) versions.
 * No external deps (no semver package).
 */
import { createRequire } from "node:module";
/** Parse a version string into comparable parts */
export function parseVersion(ver) {
    // Strip leading 'v' or '='
    const clean = ver.replace(/^[v=]+/, "").trim();
    // Split by dot, filter out non-numeric segments gracefully
    return clean.split(".").map(s => {
        const n = parseInt(s, 10);
        return isNaN(n) ? 0 : n;
    });
}
/** Compare two version arrays. Returns: -1 (a<b), 0 (equal), 1 (a>b) */
export function compareVersions(a, b) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av < bv)
            return -1;
        if (av > bv)
            return 1;
    }
    return 0;
}
/** Check if version satisfies a range expression */
export function satisfiesVersion(ver, range) {
    const v = parseVersion(ver);
    const r = range.trim();
    // Handle >=X.Y.Z
    if (r.startsWith(">=")) {
        const min = parseVersion(r.slice(2));
        return compareVersions(v, min) >= 0;
    }
    // Handle >X.Y.Z
    if (r.startsWith(">")) {
        const min = parseVersion(r.slice(1));
        return compareVersions(v, min) > 0;
    }
    // Handle <=X.Y.Z
    if (r.startsWith("<=")) {
        const max = parseVersion(r.slice(2));
        return compareVersions(v, max) <= 0;
    }
    // Handle <X.Y.Z
    if (r.startsWith("<")) {
        const max = parseVersion(r.slice(1));
        return compareVersions(v, max) < 0;
    }
    // Handle ^X.Y.Z (caret) — same major, >= minor.patch
    if (r.startsWith("^")) {
        const base = parseVersion(r.slice(1));
        if (base.length === 0)
            return false;
        const major = base[0];
        // Must be same major, and >= the full version
        if (v[0] !== major)
            return false;
        return compareVersions(v, base) >= 0;
    }
    // Handle ~X.Y.Z (tilde) — same major.minor, >= patch
    if (r.startsWith("~")) {
        const base = parseVersion(r.slice(1));
        if (base.length < 2)
            return false;
        if (v[0] !== base[0])
            return false;
        if ((v[1] || 0) !== base[1])
            return false;
        return (v[2] || 0) >= (base[2] || 0);
    }
    // Exact match
    return compareVersions(v, parseVersion(r)) === 0;
}
/** Read the plugin's own version requirements from package.json */
export function readVersionRequirements() {
    const defaults = {
        nodeRange: "^22.0.0",
        pluginApiRange: ">=2026.5.5",
        pluginVersion: "unknown",
        openclawVersion: "unknown",
    };
    try {
        const _require = createRequire(import.meta.url);
        // Try multiple paths for dist vs src context
        let pkg;
        try {
            pkg = _require("../package.json");
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:version] Read ../package.json failed: ${msg}`);
            try {
                pkg = _require("../../package.json");
            }
            catch (e2) {
                const msg2 = e2 instanceof Error ? e2.message : String(e2);
                console.warn(`[yaoyao-memory:version] Read ../../package.json failed: ${msg2}`);
                pkg = _require("./package.json");
            }
        }
        return {
            nodeRange: pkg.engines?.node || defaults.nodeRange,
            pluginApiRange: pkg.openclaw?.compat?.pluginApi || defaults.pluginApiRange,
            pluginVersion: pkg.version || defaults.pluginVersion,
            openclawVersion: pkg.openclaw?.build?.openclawVersion || defaults.openclawVersion,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:version] Read version requirements failed: ${msg}`);
        return defaults;
    }
}
