/**
 * Simple glob match (supports * and ? wildcards).
 * Zero dependency.
 */
export function matchGlob(pattern: string, text: string): boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) {
    // No wildcards
    return pattern === text;
  }
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) {
      if (part && !text.startsWith(part)) return false;
      pos = part.length;
    } else if (i === parts.length - 1) {
      if (part && !text.endsWith(part)) return false;
    } else {
      const idx = text.indexOf(part, pos);
      if (idx === -1) return false;
      pos = idx + part.length;
    }
  }
  return true;
}

/** Check if any pattern matches the given agent id. */
export function isExcludedAgent(agentId: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchGlob(pattern, agentId)) return true;
  }
  return false;
}
