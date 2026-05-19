/**
 * utils/telemetry.ts — Anonymous install telemetry via GitHub Issues.
 * Privacy-first: no user content, no PII, only anonymous UUID + version + timestamp.
 */

import { createHash, randomUUID } from "node:crypto";

interface TelemetryPayload {
  /** Anonymous install ID (hashed machine fingerprint) */
  installId: string;
  /** Plugin version */
  version: string;
  /** ISO timestamp */
  timestamp: string;
  /** Node.js version (for compatibility tracking) */
  nodeVersion: string;
}

interface TelemetryConfig {
  enabled: boolean;
  githubToken?: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
}

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  repoOwner: "taobaoaz",
  repoName: "yaoyao-plugin",
  issueNumber: 1,
};

/** Generate anonymous install ID from machine fingerprint */
function getInstallId(): string {
  // Use hostname + cwd hash — no PII, just stable per-machine
  const seed = `${process.env.HOSTNAME || ""}-${process.cwd()}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

/** Build telemetry payload */
export function buildPayload(version: string): TelemetryPayload {
  return {
    installId: getInstallId(),
    version,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
  };
}

/** Send heartbeat comment to GitHub Issue */
export async function sendHeartbeat(
  payload: TelemetryPayload,
  config: Partial<TelemetryConfig> = {}
): Promise<{ ok: boolean; error?: string }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return { ok: true };
  if (!cfg.githubToken) return { ok: false, error: "GITHUB_TOKEN not configured" };

  const body = `<!-- yaoyao-telemetry -->\n` +
    `install: ${payload.installId}\n` +
    `version: ${payload.version}\n` +
    `node: ${payload.nodeVersion}\n` +
    `time: ${payload.timestamp}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repoOwner}/${cfg.repoName}/issues/${cfg.issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${cfg.githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "yaoyao-telemetry",
        },
        body: JSON.stringify({ body }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `GitHub API ${res.status}: ${err.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Query active install count from GitHub Issue comments */
export async function queryInstallCount(
  config: Partial<TelemetryConfig> = {}
): Promise<{ count: number; error?: string }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repoOwner}/${cfg.repoName}/issues/${cfg.issueNumber}/comments?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "yaoyao-telemetry",
        },
      }
    );
    if (!res.ok) {
      return { count: 0, error: `GitHub API ${res.status}` };
    }
    const comments = await res.json() as Array<{ body: string }>;
    // Count unique install IDs (deduplicate multiple heartbeats from same machine)
    const ids = new Set<string>();
    for (const c of comments) {
      const match = c.body.match(/install: ([a-f0-9]+)/);
      if (match) ids.add(match[1]);
    }
    return { count: ids.size };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
