/**
 * Secrets loader — reads ~/.openclaw/credentials/secrets.env
 * Supports: comments (#), KEY=VALUE, KEY="quoted value", KEY='quoted value'
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const SECRETS_PATH = path.join(os.homedir(), ".openclaw", "credentials", "secrets.env");
/**
 * Parse secrets.env content into a key-value map.
 */
export function parseSecretsEnv(content) {
    const result = {};
    for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx < 0)
            continue;
        const key = line.slice(0, eqIdx).trim();
        let value = line.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}
/**
 * Load secrets from the default path. Returns empty object if file missing.
 */
export function loadSecrets(filePath) {
    const target = filePath || SECRETS_PATH;
    try {
        if (!fs.existsSync(target))
            return {};
        return parseSecretsEnv(fs.readFileSync(target, "utf-8"));
    }
    catch {
        return {};
    }
}
/**
 * Get the secrets file path.
 */
export function getSecretsPath() {
    return SECRETS_PATH;
}
