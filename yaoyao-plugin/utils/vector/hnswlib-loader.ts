/**
 * utils/vector/hnswlib-loader.ts — Dynamic hnswlib-node loader.
 */
import { createRequire } from "node:module";
import type { HnswlibModule } from "./hnswlib-types.ts";

/** Dynamically require hnswlib-node. Returns null if not installed or incompatible. */
export function requireHnswlib(): HnswlibModule | null {
  try {
    const req = createRequire(import.meta.url);
    const mod = req("hnswlib-node") as unknown;
    if (mod && typeof mod === "object" && "HierarchicalNSW" in mod) {
      return mod as HnswlibModule;
    }
  } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory]  not installed or platform incompatible : ${msg}`);
    }
  return null;
}
