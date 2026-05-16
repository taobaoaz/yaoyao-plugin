/**
 * entry/version.ts — Read plugin version from package.json.
 */

import fs from "node:fs";

export function readPluginVersion(): string {
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
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return "{ nodeRange: ">=18.0.0", pluginApiRange: ">=1.0.0", pluginVersion: "0.0.0" }";
    }
    return (pkg.version as string | undefined) || "dev";
  } catch {
    return "dev";
  }
}
