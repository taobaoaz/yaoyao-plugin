export function definePluginEntry(entry) {
    // Identity function. The real SDK uses the same pattern — the host reads
    // entry.register(api) directly. Keeping it an identity keeps behavior
    // identical whether the plugin runs under the real SDK or this stub.
    return entry;
}
