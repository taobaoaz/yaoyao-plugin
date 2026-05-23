/**
 * core/boot/import-memories.ts — Import existing workspace memories at startup.
 *
 * v1.7.2: Added vector embedding support for imported memories.
 * Orchestrates file discovery → parsing → FTS5 indexing → optional vector storage.
 * Delegates all algorithm work to utils/ modules.
 */

import fs from "node:fs";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig, MemoryStore } from "../../utils/memory-store.ts";
import type { Storage } from "../../storage/bridge.ts";
import { MIN_ENTRY_LENGTH, MAX_ENTRY_LENGTH } from "../../utils/markdown-helpers.ts";
import { parseFile } from "../../utils/memory-parser.ts";
import { readImportManifest, writeImportManifest } from "../../utils/import-manifest.ts";
import { discoverMemoryFiles } from "../../utils/discover-memory-files.ts";


/** Import existing memories from workspace files at startup. */
export function stepImportExistingMemories(
  logger: PluginLogger | undefined,
  workspaceDir: string,
  _config: YaoyaoMemoryConfig,
  store: MemoryStore,
  storage: Storage,
): { imported: number; skipped: number; files: number } {
  const baseDir = store.baseDir;
  const manifest = readImportManifest(baseDir);
  const importedFiles = new Map(Object.entries(manifest.importedFiles || {}));

  let imported = 0;
  let skipped = 0;
  let processedFiles = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const file of discoverMemoryFiles(workspaceDir, store)) {
    try {
      const stat = fs.statSync(file.path);
      const lastMtime = importedFiles.get(file.path) || 0;

      // Skip today's daily file (still being written)
      if (file.type === "daily" && file.date === today) {
        skipped++;
        continue;
      }

      // Skip unchanged files
      if (stat.mtimeMs <= lastMtime) {
        skipped++;
        continue;
      }

      const content = fs.readFileSync(file.path, "utf-8");
      const fileDate = file.date || today;
      const entries = parseFile(content, file.filename, fileDate);

      let fileImported = 0;
      for (const entry of entries) {
        if (entry.text.length < MIN_ENTRY_LENGTH) continue;
        const text = entry.text.length > MAX_ENTRY_LENGTH
          ? entry.text.slice(0, MAX_ENTRY_LENGTH) + "..."
          : entry.text;
        storage.indexTurn(text, "", entry.date, entry.meta);
        imported++;
        fileImported++;
      }

      importedFiles.set(file.path, stat.mtimeMs);
      processedFiles++;
      logger?.info?.(`[yaoyao-memory] Imported ${fileImported} entries from ${file.filename} (${file.type})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger?.warn?.(`[yaoyao-memory] Failed to import ${file.filename}: ${msg}`);
    }
  }

  // Persist manifest
  writeImportManifest(baseDir, {
    lastImportAt: new Date().toISOString(),
    importedFiles: Object.fromEntries(importedFiles),
  });

  logger?.info?.(
    `[yaoyao-memory] Memory import complete: ${imported} entries from ${processedFiles} files, ${skipped} skipped`
  );
  return { imported, skipped, files: processedFiles };
}
