import fs from 'node:fs';

export function readPluginVersion(): string {
  try {
    const currentUrl = import.meta.url;
    // src/entry/version.ts → ../../package.json (project root)
    let pkgPath = new URL('../../package.json', currentUrl);
    if (!fs.existsSync(pkgPath)) {
      // Fallback: maybe running from dist/src/entry/version.js
      pkgPath = new URL('../../../package.json', currentUrl);
    }
    if (!fs.existsSync(pkgPath)) {
      // Last resort: relative to current file
      pkgPath = new URL('./package.json', currentUrl);
    }
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:version] Parse package.json failed: ${msg}`);
      return '0.0.0';
    }
    return (pkg.version as string | undefined) || 'dev';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:version] Read version failed: ${msg}`);
    return 'dev';
  }
}
