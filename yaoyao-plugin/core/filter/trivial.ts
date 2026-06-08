/**
 * TrivialDetector — identifies and skips low-value memory captures.
 *
 * Filters out greetings, single-word responses, system messages, and
 * other "noise" that shouldn't be indexed or stored as long-term memory.
 */

export interface TrivialCheckResult {
  isTrivial: boolean;
  reason?: string;
  confidence: number; // 0.0 - 1.0
}

// Patterns that indicate trivial content
const GREETING_PATTERNS = [
  /^hi\b/i,
  /^hello\b/i,
  /^hey\b/i,
  /^greetings\b/i,
  /^good (morning|afternoon|evening|night)\b/i,
  /^how are you\b/i,
  /^what's up\b/i,
  /^sup\b/i,
];

const FAREWELL_PATTERNS = [
  /^bye\b/i,
  /^goodbye\b/i,
  /^see you\b/i,
  /^later\b/i,
  /^take care\b/i,
  /^have a good (day|night|weekend)\b/i,
];

const ACK_PATTERNS = [
  /^ok\b/i,
  /^okay\b/i,
  /^sure\b/i,
  /^yes\b/i,
  /^no\b/i,
  /^got it\b/i,
  /^understood\b/i,
  /^thanks?\b/i,
  /^thank you\b/i,
  /^np\b/i,
  /^you're welcome\b/i,
];

const SYSTEM_PATTERNS = [
  /^\[system\]/i,
  /^\[heartbeat\]/i,
  /^\[ping\]/i,
  /^\[status\]/i,
  /^hearbeat_ok$/i,
  /^no_reply$/i,
];

const URL_ONLY_PATTERN = /^https?:\/\/\S+$/;
const EMOJI_ONLY_PATTERN = /^[\p{Emoji}\s]+$/u;
const VERY_SHORT_THRESHOLD = 3; // words

export function isTrivial(text: string): TrivialCheckResult {
  const trimmed = text.trim();

  if (!trimmed) {
    return { isTrivial: true, reason: 'empty', confidence: 1.0 };
  }

  // System messages
  for (const pattern of SYSTEM_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isTrivial: true, reason: 'system_message', confidence: 1.0 };
    }
  }

  // URL-only
  if (URL_ONLY_PATTERN.test(trimmed)) {
    return { isTrivial: true, reason: 'url_only', confidence: 0.9 };
  }

  // Emoji-only
  if (EMOJI_ONLY_PATTERN.test(trimmed) && trimmed.length < 20) {
    return { isTrivial: true, reason: 'emoji_only', confidence: 0.9 };
  }

  // Very short
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= VERY_SHORT_THRESHOLD) {
    // Check against greeting/farewell/ack patterns
    const lower = trimmed.toLowerCase();
    for (const pattern of GREETING_PATTERNS) {
      if (pattern.test(lower)) {
        return { isTrivial: true, reason: 'greeting', confidence: 0.95 };
      }
    }
    for (const pattern of FAREWELL_PATTERNS) {
      if (pattern.test(lower)) {
        return { isTrivial: true, reason: 'farewell', confidence: 0.95 };
      }
    }
    for (const pattern of ACK_PATTERNS) {
      if (pattern.test(lower)) {
        return { isTrivial: true, reason: 'acknowledgment', confidence: 0.85 };
      }
    }
  }

  // Repeated characters (e.g. ".........", "hahaha")
  if (/^(.)\1{5,}$/.test(trimmed)) {
    return { isTrivial: true, reason: 'repeated_chars', confidence: 0.8 };
  }

  return { isTrivial: false, confidence: 0.0 };
}

/** Batch check multiple messages */
export function filterTrivial(messages: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const msg of messages) {
    const result = isTrivial(msg);
    if (result.isTrivial) {
      dropped.push(msg);
    } else {
      kept.push(msg);
    }
  }
  return { kept, dropped };
}
