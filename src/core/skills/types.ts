/**
 * core/skills/types.ts — Skill learning and pattern recognition types.
 */

export interface ToolInvocation {
  id: string;
  toolId: string;              // 工具名称
  params: Record<string, unknown>; // 调用参数
  result?: unknown;            // 返回结果
  durationMs: number;          // 耗时
  timestamp: number;           // 调用时间
  context?: string;            // 调用上下文（如查询内容）
}

export interface ToolPattern {
  id: string;
  toolId: string;
  paramSignature: string;      // 参数模式签名（如 "query=string,limit=number"）
  frequency: number;           // 出现次数
  avgDurationMs: number;       // 平均耗时
  lastSeen: number;            // 最后出现时间
  confidence: number;          // 模式置信度
}

export interface SkillSuggestion {
  type: "shortcut" | "optimization" | "automation" | "new_feature";
  description: string;
  confidence: number;
  estimatedImpact: string;     // 预估影响（如 "节省 50% 时间"）
  implementationHint: string;  // 实现提示
}

export interface SkillProfile {
  totalInvocations: number;
  uniqueTools: string[];
  topPatterns: ToolPattern[];
  suggestions: SkillSuggestion[];
  lastUpdated: number;
}
