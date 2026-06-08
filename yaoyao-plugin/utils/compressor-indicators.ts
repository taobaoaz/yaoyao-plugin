/**
 * utils/compressor-indicators.ts — Text scoring indicators.
 */

export const TOOL_CALL_INDICATORS = [
  /\btool_use\b/i,
  /\btool_result\b/i,
  /\bfunction_call\b/i,
  /\b(memory_store|memory_recall|memory_forget|memory_update)\b/i,
];

export const CORRECTION_INDICATORS = [
  /^no[,.\s]/i,
  /\bactually\b/i,
  /\binstead\b/i,
  /\bwrong\b/i,
  /\bcorrect(ion)?\b/i,
  /\bfix\b/i,
  /不对/,
  /应该是/,
  /错了/,
  /改成/,
  /不是.*而是/,
];

export const DECISION_INDICATORS = [
  /\blet'?s go with\b/i,
  /\bconfirmed?\b/i,
  /\bapproved?\b/i,
  /\bdecided?\b/i,
  /\bwe'?ll use\b/i,
  /\bgoing forward\b/i,
  /\bfrom now on\b/i,
  /\bagreed\b/i,
  /决定/,
  /确认/,
  /选择了/,
  /就这样/,
];

export const ACKNOWLEDGMENT_PATTERNS = [
  /^(ok|okay|k|sure|fine|thanks|thank you|thx|ty|got it|understood|cool|nice|great|good|perfect|awesome|alright|yep|yup|yeah|right)\s*[.!]?$/i,
  /^好的?\s*[。！]?$/,
  /^嗯\s*[。]?$/,
  /^收到\s*[。！]?$/,
  /^了解\s*[。！]?$/,
  /^明白\s*[。！]?$/,
  /^谢谢\s*[。！]?$/,
  /^感谢\s*[。！]?$/,
  /^👍\s*$/,
];

export const MEMORY_INTENT = /\b(remember|recall|don'?t forget|note that|keep in mind)\b/i;
export const MEMORY_INTENT_CJK = /(记住|別忘|不要忘|记一下)/;
