/**
 * utils/session-recovery-paths.ts — Path derivation helpers for session recovery.
 */

export function deriveOpenClawHomeFromWorkspacePath(workspacePath: string): string | undefined {
  const normalized = workspacePath.trim().replace(/[\\/]+$/, "");
  if (!normalized) return undefined;
  const matched = normalized.match(/^(.*?)[\\/]workspace(?:[\\/].*)?$/);
  if (!matched || !matched[1]) return undefined;
  const home = matched[1].trim();
  return home.length ? home : undefined;
}

export function deriveOpenClawHomeFromSessionFilePath(sessionFilePath: string): string | undefined {
  const normalized = sessionFilePath.trim();
  if (!normalized) return undefined;
  const matched = normalized.match(/^(.*?)[\\/]agents[\\/][^\\/]+[\\/]sessions(?:[\\/][^\\/]+)?$/);
  if (!matched || !matched[1]) return undefined;
  const home = matched[1].trim();
  return home.length ? home : undefined;
}
