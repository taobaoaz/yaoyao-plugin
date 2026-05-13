/**
 * Secrets loader — reads ~/.openclaw/credentials/secrets.env
 * Supports: comments (#), KEY=VALUE, KEY="quoted value", KEY='quoted value'
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SECRETS_PATH = path.join(os.homedir(), ".openclaw", "credentials", "secrets.env");

export interface Secrets {
  [key: string]: string;
}

/**
 * Parse secrets.env content into a key-value map.
 */
export function parseSecretsEnv(content: string): Secrets {
  const result: Secrets = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

let _cachedSecrets: Secrets | null = null;
let _cachedPath: string | null = null;
let _cachedMtime = 0;

/**
 * Load secrets from the default path with in-memory caching (invalidated on file change).
 * Returns empty object if file missing.
 */
export function loadSecrets(filePath?: string): Secrets {
  const target = filePath || SECRETS_PATH;
  try {
    if (!fs.existsSync(target)) return {};
    const stat = fs.statSync(target);
    if (_cachedSecrets && _cachedPath === target && _cachedMtime === stat.mtimeMs) {
      return _cachedSecrets;
    }
    const secrets = parseSecretsEnv(fs.readFileSync(target, "utf-8"));
    _cachedSecrets = secrets;
    _cachedPath = target;
    _cachedMtime = stat.mtimeMs;
    return secrets;
  } catch {
    return {};
  }
}

/**
 * Get the secrets file path.
 */
export function getSecretsPath(): string {
  return SECRETS_PATH;
}
