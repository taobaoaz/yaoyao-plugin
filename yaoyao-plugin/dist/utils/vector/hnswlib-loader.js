/**
 * utils/vector/hnswlib-loader.ts — Dynamic hnswlib-node loader.
 */
import { createRequire } from 'node:module';
/** Dynamically require hnswlib-node. Returns null if not installed or incompatible. */
export function requireHnswlib() {
    try {
        const req = createRequire(import.meta.url);
        const mod = req('hnswlib-node');
        if (mod && typeof mod === 'object' && 'HierarchicalNSW' in mod) {
            return mod;
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory]  not installed or platform incompatible : ${msg}`);
    }
    return null;
}
