/**
 * core/conflict/types.ts — Conflict detection types and markers.
 */
export type ConflictRelation =
  | 'supersedes'
  | 'conflicts_with'
  | 'compatible'
  | 'related'
  | 'not_conflict';

export interface ConflictCandidate {
  memoryId: number;
  date: string;
  snippet: string;
  confidence: number;
  reason: string;
  signals: ConflictSignals;
}

export interface ConflictSignals {
  lexicalSimilarity: number;
  semanticOverlap: number;
  lengthRatio: number;
  hasContradictionMarkers: boolean;
}

export interface ConflictRelationRecord {
  memoryAId: number;
  memoryBId: number;
  relation: ConflictRelation;
  judgedBy: 'agent' | 'user' | 'auto';
  reason: string;
  evidence?: string;
  judgedAt: string;
}

export interface DetectConflictOptions {
  minConfidence?: number;
  maxCandidates?: number;
  suggestRelations?: boolean;
}

export const CONTRADICTION_MARKERS = [
  /\b(but|however|instead|rather|unlike|contrary|opposite|actually|wrong)\b/i,
  /\b(not|don'?t|doesn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|won'?t)\b/i,
  /(但是|然而|但是|反而|相反|其实|不对|不是|不应|不能用)/,
  /(不喜欢|讨厌|不要|别用|改成|换成)/,
];

export const PREFERENCE_MARKERS = [
  /\b(prefer|like|dislike|favorite|hate|love|use|uses|used)\b/i,
  /(喜欢|偏好|讨厌|爱|用|使用|习惯)/,
];

export const DECISION_MARKERS = [
  /\b(decide|decided|choose|chose|select|pick|go with|switch|switch to|migrate|migrated)\b/i,
  /(决定|选了|选择|切换|换成|改用|迁移)/,
];

export const DETECT_DEFAULTS: Required<DetectConflictOptions> = {
  minConfidence: 0.4,
  maxCandidates: 5,
  suggestRelations: true,
};
