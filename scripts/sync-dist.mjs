#!/usr/bin/env node
/**
 * sync-dist.mjs — Sync TypeScript source to JavaScript dist (bypassing tsc type errors)
 *
 * Usage: node scripts/sync-dist.mjs [--check]
 * --check: Only check for differences, don't modify files
 *
 * Transformations:
 * 1. Remove type annotations (: Type, as Type)
 * 2. Remove interface/type declarations
 * 3. Remove import type statements
 * 4. Remove generic type parameters (<T>)
 * 5. Remove access modifiers (private/protected/public readonly)
 * 6. Convert TS-specific syntax to JS
 *
 * For complex files (like cloud-adapter.ts), it's better to manually maintain dist.
 * This script handles the common ~90% of changes automatically.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const checkOnly = process.argv.includes("--check");

// ============================================================================
// Transformations
// ============================================================================

/**
 * Remove import type statements from a line.
 */
function stripImportType(line) {
  // Pure import type: "import type { X } from ..." → delete
  if (/^\s*import\s+type\s+/.test(line)) return "";

  // Mixed import: import { foo, type X, type Y } from "..."
  // Strip "type " prefix from specifiers inside braces
  const mixedMatch = line.match(/^(\s*import\s*\{\s*)([^}]*?)(\s*\}\s*from\s)/);
  if (mixedMatch) {
    const specifiers = mixedMatch[2];
    const cleaned = specifiers.split(",").map(s => s.trim()).filter(s => s && !s.startsWith("type ")).join(", ");
    if (cleaned) return mixedMatch[1] + cleaned + mixedMatch[3] + line.slice(mixedMatch[0].length);
    return ""; // all type-only
  }

  // export type { X } from "..." or export type { X }
  if (/^\s*export\s+type\s+\{/.test(line)) return "";

  return line;
}

/**
 * Strip all TS-only syntax from a line.
 */
function stripTypeAnnotations(line) {
  let r = line;

  // ── Handle import lines carefully: keep `as` in `import * as X` and `import { X as Y }` ──
  const isImportLine = /^\s*import\s/.test(r);

  if (!isImportLine) {
    // `as { ... }` inline object types
    r = r.replace(/\s+as\s+\{[^}]*\}/g, "");

    // `as TypeA & TypeB<X>` intersection types
    r = r.replace(/\s+as\s+[A-Za-z_]\w*(?:<[^>]*>)?(?:\s*[&|]\s*[A-Za-z_]\w*(?:<[^>]*>)?)*/g, "");

    // `as const`
    r = r.replace(/\s+as\s+const/g, "");

    // `as any` / `as never` etc.
    r = r.replace(/\s+as\s+(?:any|never|unknown|undefined|null|void|string|number|boolean)\b/g, "");

    // Catch-all `as X`
    r = r.replace(/\s+as\s+[A-Za-z_]\w*/g, "");
  }

  // ── Class `implements` ──
  r = r.replace(/\s+implements\s+[A-Za-z_]\w*(?:<[^>]*>)?(?:\s*,\s*[A-Za-z_]\w*(?:<[^>]*>)?)*/g, "");

  // ── Optional param markers ──
  // `param?: Type` or `param?` → `param`
  r = r.replace(/(\w+)\?\s*:\s*(?:string|number|boolean|any|void|never|unknown|null|undefined)\b(?=\s*[,)=])/g, "$1");
  r = r.replace(/(\w+)\?\s*:\s*[A-Z]\w*(?:<[^>]*>)?(?:\s*[&|]\s*[A-Za-z_]\w*(?:<[^>]*>)?)*(?=\s*[,)=])/g, "$1");
  r = r.replace(/(\w+)\?(?=\s*[,)=])/g, "$1");

  // ── Return type annotations ──
  // `): Type {` → `) {`, `): Type =>` → `) =>`
  // Match ONLY when `)` is NOT preceded by `?` (to avoid ternary confusion)
  // Use negative lookbehind for `?`: `(?<![?])`
  r = r.replace(/(?<![?])\)\s*:\s*(?![={=])(?:[A-Za-z_]\w*(?:\.\w+)?(?:\s*<[^>]*>)?(?:\[\])?(?:\s*[&|]\s*[A-Za-z_]\w*(?:\.\w+)?(?:\s*<[^>]*>)?(?:\[\])?)*)?\s*(?=\{|=>)/g, ") ");

  // ── Catch binding ──
  r = r.replace(/catch\s*\(\s*(\w+)\s*:\s*\w+\s*\)/g, "catch ($1)");

  // ── Access modifiers ──
  r = r.replace(/^\s*(private|protected|public)\s+(?=readonly\s|static\s|[\w_])/gm, "");
  r = r.replace(/^\s*(private|protected|public)\s+readonly\s+/gm, "");
  r = r.replace(/^\s*readonly\s+/gm, "");
  r = r.replace(/(\})\s+(private|protected|public)\s+/g, "$1 ");
  r = r.replace(/(constructor\s*\()\s*(private|protected|public|readonly)\s+/g, "$1");

  // ── Type annotations on primitive types (including array suffixes like `string[]`) ──
  r = r.replace(/:\s*(?:readonly\s+)?(?:string|number|boolean|any|void|never|unknown|null|undefined|bigint|symbol|object)(?:\[\])?(?=\s*[,)=\]])/g, "");

  // ── `: InterfaceName` type annotations (including array suffixes) ──
  r = r.replace(/:\s*[A-Z]\w*(?:<[^>]*>)?(?:\[\])?(?:\s*\|\s*(?:[A-Z]\w*(?:<[^>]*>)?(?:\[\])?|null|undefined))*(?=\s*[,)=\]])/g, "");

  // ── `: Record<K, V>` generic types ──
  r = r.replace(/:\s*\w+\.?\w*<[^>]*>(?:\s*[&|]\s*\w+\.?\w*<[^>]*>)*(?=\s*[,)=])/g, "");

  // ── `: "literal" | "type"` union (must have | to avoid ternary confusion) ──
  r = r.replace(/:\s*("[^"]*"|'[^']*')\s*\|\s*("[^"]*"|'[^']*')(?:\s*\|\s*(?:"[^"]*"|'[^']*'|\w+))*\s*/g, "");

  // ── `let/const/var name: Type =` ──
  r = r.replace(/(let|const|var)\s+(\w+)\s*:\s*[^=;]*(?=\s*=)/g, "$1 $2");
  // ── `let name: Type;` (no init) → `let name;` ──
  r = r.replace(/(let|const|var)\s+(\w+)\s*:\s*[^=;]+\s*;/g, "$1 $2;");

  // ── `new X<Type>()` generics (handle nested <> with non-greedy match) ──
  // Match balanced angle brackets by matching everything between < and last >
  r = r.replace(/new\s+([A-Za-z_]\w*)\s*<[^>]*(?:>[^>]*)*>\s*(?=\()/g, "new $1");

  // ── Non-null assertion: `x!` in expressions ──
  // Strip `!` after identifiers, method calls, array accesses, etc.
  // But keep `!=` and `!==` comparison operators
  r = r.replace(/([\w)\]"])(?<![!=])!(?=[\s,);\]}]|$)/g, "$1");

  // ── Class/object property: `foo: Type;` → remove (type-only property) ──
  // Only match lines that are solely a property declaration (no `=`, not in object literal values)
  r = r.replace(/^\s*[a-z_]\w*\s*:\s*(?:string|number|boolean|any|void|never|unknown|null|undefined)[\[\]]*\s*;\s*$/gim, "");

  // ── Cleanup whitespace ──
  r = r.replace(/\s+\)/g, ")");
  r = r.replace(/\(\s+/g, "(");
  r = r.replace(/  +/g, " ");
  r = r.replace(/\s+$/gm, "");

  return r;
}

/**
 * Check if a line is the start of an interface or type declaration.
 */
function isTypeDeclStart(line) {
  return /^\s*(export\s+)?(interface\s+\w+|type\s+\w+\s*=)\s/.test(line);
}

/**
 * Strip generic type params from function calls (like `foo<Type>(...)`).
 */
function stripGenerics(line) {
  let r = line;
  // `word<Type>(` → `word(`
  r = r.replace(/(\b[A-Za-z_]\w*)\s*<\s*[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*\s*>(?=\s*\()/g, "$1");
  // `word<Type> ` → `word ` (less aggressive)
  return r;
}

/**
 * Transform a single TypeScript line into JavaScript equivalent.
 */
function transformLine(line) {
  let result = line;

  // Strip import type statements
  result = stripImportType(result);
  if (!result) return "";

  // Strip generics from function calls
  result = stripGenerics(result);

  // Strip type annotations and access modifiers
  result = stripTypeAnnotations(result);

  return result;
}

/**
 * Transform TypeScript source content to JavaScript.
 */
function transformContent(srcContent, relPath) {
  const lines = srcContent.split("\n");
  const resultLines = [];
  let inInterfaceBlock = false;
  let inTypeAliasBlock = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Preserve empty lines
    if (trimmed === "") {
      resultLines.push("");
      continue;
    }

    // ── Detect interface/type blocks ──
    if (isTypeDeclStart(line) && !inInterfaceBlock && !inTypeAliasBlock) {
      const isInterface = /^interface\s/.test(trimmed) || /^export\s+interface\s/.test(trimmed);
      if (isInterface && line.includes("}")) continue; // single-line interface
      if (isInterface) {
        inInterfaceBlock = true;
        braceDepth = (line.match(/\{/g) || []).length;
        continue;
      }
      const isType = /^type\s/.test(trimmed) || /^export\s+type\s/.test(trimmed);
      if (isType && trimmed.endsWith(";")) continue; // single-line type alias
      if (isType) {
        inTypeAliasBlock = true;
        braceDepth = (line.match(/\{/g) || []).length;
        continue;
      }
    }

    // ── Track brace depth in interface/type blocks ──
    if (inInterfaceBlock || inTypeAliasBlock) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceDepth += opens - closes;
      if (braceDepth <= 0) {
        inInterfaceBlock = false;
        inTypeAliasBlock = false;
      }
      continue;
    }

    // ── Transform the line ──
    const transformed = transformLine(line);
    if (transformed !== "") {
      resultLines.push(transformed.trimEnd());
    }
  }

  const header = `// Auto-synced from ${relPath} by sync-dist.mjs — review if issues arise\n`;
  return header + resultLines.join("\n") + "\n";
}

// ============================================================================
// File scanning and processing
// ============================================================================

/**
 * Get all .ts files recursively from a directory.
 */
function getTSFiles(dir, relativeTo) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relativeTo, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name.startsWith("__")) continue;
      results.push(...getTSFiles(fullPath, relPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(relPath);
    }
  }
  return results;
}

function getSrcPath(relPath) {
  return path.join(rootDir, relPath);
}

function getDistPath(relPath) {
  if (path.normalize(relPath) === "index.ts") {
    return path.join(rootDir, "dist", "index.js");
  }
  return path.join(rootDir, "dist", relPath.replace(/\.ts$/, ".js"));
}

/**
 * Process a single source file. Returns { action: "new"|"updated"|"skipped"|"missing"|"outdated", path }.
 */
function processFile(relPath) {
  const srcPath = getSrcPath(relPath);
  const distPath = getDistPath(relPath);

  if (!existsSync(srcPath)) return { action: "skipped", path: relPath };

  const srcStat = statSync(srcPath);
  const distExists = existsSync(distPath);

  if (checkOnly && !distExists) {
    return { action: "missing", path: relPath };
  }

  if (distExists) {
    const distStat = statSync(distPath);
    if (distStat.mtimeMs >= srcStat.mtimeMs) {
      return { action: "skipped", path: relPath };
    }
  }

  // Read and transform
  const srcContent = readFileSync(srcPath, "utf-8");
  const jsContent = transformContent(srcContent, relPath);

  // Check mode: compare content (ignoring auto-sync header)
  if (checkOnly) {
    if (!distExists) return { action: "missing", path: relPath };
    const existing = readFileSync(distPath, "utf-8");
    const bodyExisting = existing.replace(/^\/\/ Auto-synced from .*?\n/, "");
    const bodyNew = jsContent.replace(/^\/\/ Auto-synced from .*?\n/, "");
    if (bodyExisting !== bodyNew) return { action: "outdated", path: relPath };
    return { action: "skipped", path: relPath };
  }

  // Write output
  mkdirSync(path.dirname(distPath), { recursive: true });
  writeFileSync(distPath, jsContent, "utf-8");
  return { action: distExists ? "updated" : "new", path: relPath };
}

// ============================================================================
// Main
// ============================================================================

function main() {
  let newCount = 0, updatedCount = 0, skippedCount = 0, missingCount = 0;
  const errors = [];

  // Gather all .ts files
  const srcFiles = getTSFiles(path.join(rootDir, "src"), "src");
  const allFiles = [...srcFiles, "index.ts"];

  for (const relPath of allFiles) {
    try {
      const result = processFile(relPath);
      switch (result.action) {
        case "new": newCount++; break;
        case "updated": updatedCount++; break;
        case "missing":
        case "outdated": missingCount++; break;
        default: skippedCount++;
      }
    } catch (err) {
      errors.push(`  Error: ${relPath}: ${err.message}`);
    }
  }

  // Print summary
  console.log(`Sync summary: ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);
  for (const e of errors) console.error(e);

  if (checkOnly) {
    if (missingCount > 0) {
      console.log(`--check: ${missingCount} file(s) need sync`);
      process.exitCode = 1;
    } else {
      console.log("--check: all files are up to date");
    }
    return;
  }

  // Syntax check all generated files
  const allDists = allFiles.map(f => getDistPath(f));
  let syntaxErrors = 0;
  for (const file of allDists) {
    if (existsSync(file)) {
      try {
        const rel = path.relative(rootDir, file);
        execSync(`node --check "${file}"`, { stdio: "pipe", timeout: 5000 });
      } catch (e) {
        const stderr = (e.stderr?.toString() || e.message || "").trim();
        // Only show the first line of the error
        const errLine = stderr.split("\n")[0];
        console.error(`  ⚠️ Syntax error in ${path.relative(rootDir, file)}: ${errLine}`);
        syntaxErrors++;
      }
    }
  }
  if (syntaxErrors > 0) {
    console.log(`  ⚠️ ${syntaxErrors} file(s) have syntax issues — may need manual fix`);
    process.exitCode = 1;
  } else {
    console.log("  ✅ All generated files pass syntax check");
  }
}

main();
