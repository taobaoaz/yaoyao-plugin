/**
 * entry/version.ts — Read plugin version from package.json.
 */
import fs from "node:fs";
export function readPluginVersion() {
    try {
        const currentUrl = import.meta.url;
        // src/entry/version.ts → ../../package.json (project root)
        let pkgPath = new URL("../../package.json", currentUrl);
        if (!fs.existsSync(pkgPath)) {
            // Fallback: maybe running from dist/src/entry/version.js
            pkgPath = new URL("../../../package.json", currentUrl);
        }
        if (!fs.existsSync(pkgPath)) {
            // Last resort: relative to current file
            pkgPath = new URL("./package.json", currentUrl);
        }
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        return pkg.version || "dev";
    }
    catch {
        return "dev";
    }
}
