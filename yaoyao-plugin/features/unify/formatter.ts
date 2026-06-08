/**
 * features/unify/formatter.ts — Unified status display formatting.
 *
 * Pure formatting: table building, line construction, no I/O.
 */

export function formatStatusReport(params: {
  ocFileCount: number;
  ocChunkCount: number;
  ocFtsCount: number;
  ocDbSize: string;
  dreamEvents: number;
  hasShortTermRecall: boolean;
  yaoDbExists: boolean;
  yaoDbSize: string;
  dailyFiles: number;
}): string {
  const totalBackends = (params.ocFileCount > 0 ? 1 : 0) + (params.dreamEvents > 0 ? 1 : 0) + 1;
  const lines = [
    '# 🔗 统一记忆状态面板',
    '',
    '## 📦 OpenClaw 内置记忆',
    `- 状态: ${params.ocFileCount > 0 ? '✅ 活跃' : '⚪ 无数据'}`,
    `- 索引文件: ${params.ocFileCount} 个`,
    `- 文本块: ${params.ocChunkCount} 条`,
    `- FTS5 条目: ${params.ocFtsCount} 条`,
    `- 数据库大小: ${params.ocDbSize} KB`,
    '',
    '## 💭 .dreams 短期记忆',
    `- 状态: ${params.dreamEvents > 0 ? '✅ 活跃' : '⚪ 无数据'}`,
    `- 最近事件: ${params.dreamEvents} 条`,
    `- 短期召回: ${params.hasShortTermRecall ? '✅ 有数据' : '⚪ 无'}`,
    '',
    '## 🎲 Yaoyao Memory',
    `- 数据库: ${params.yaoDbExists ? '✅ 活跃' : '⚪ 未初始化'}`,
    `- 数据库大小: ${params.yaoDbSize} KB`,
    `- 每日日志: ${params.dailyFiles} 天`,
    '',
    '## 📊 总览',
    `- 活跃后端: ${totalBackends}/3`,
    `- 共享文件: memory/*.md（所有后端共同索引）`,
    `- 统一管理: yaoyao-memory 作为统一记忆管理层`,
  ];
  return lines.join('\n');
}

export function formatBackendsReport(
  files: Array<Record<string, unknown>> | null,
  dreamEvents: Array<Record<string, unknown>>,
  yaoInfo: string[],
): string {
  const lines = ['# 🔍 记忆后端详情', ''];

  lines.push('## 1. OpenClaw 内置记忆 (main.sqlite)');
  if (files && files.length > 0) {
    lines.push('', '| 文件 | 来源 | 大小 |', '|------|------|------|');
    files.forEach((f: Record<string, unknown>) => {
      lines.push(`| ${f.path} | ${f.source} | ${(Number(f.size || 0) / 1024).toFixed(1)} KB |`);
    });
  } else {
    lines.push('- 无索引文件');
  }
  lines.push('', '**作用**: OpenClaw 原生文件记忆，通过 `memory-core` 和 `active-memory` 管理');

  lines.push('', '## 2. .dreams 短期召回');
  if (dreamEvents.length > 0) {
    lines.push('', `最近 ${Math.min(dreamEvents.length, 5)} 条事件:`);
    dreamEvents.slice(-5).forEach((e: Record<string, unknown>) => {
      lines.push(
        `- [${e.timestamp || e.ts || '?'}] ${e.type || e.event || '?'}: ${String(e.text || JSON.stringify(e)).substring(0, 80)}`,
      );
    });
  } else {
    lines.push('- 无事件');
  }

  lines.push('', '## 3. Yaoyao Memory (.yaoyao.db)');
  for (const line of yaoInfo) lines.push(line);

  return lines.join('\n');
}

export function formatCrossSearchResults(
  query: string,
  ocResults: Array<Record<string, unknown>> | null,
  dreamMatches: Array<Record<string, unknown>>,
): string {
  const lines = [`# 🔍 跨后端搜索: "${query}"`, ''];

  lines.push('## OpenClaw 内置记忆');
  if (ocResults && ocResults.length > 0) {
    ocResults.forEach((r: Record<string, unknown>) => {
      lines.push(`- **${r.path}**: ${String(r.text).substring(0, 100)}...`);
    });
  } else {
    lines.push('- 无匹配');
  }

  lines.push('', '## Yaoyao Memory');
  lines.push('_使用 memory_search 工具搜索 yaoyao 索引_');

  lines.push('', '## .dreams 事件');
  if (dreamMatches.length > 0) {
    dreamMatches.slice(0, 5).forEach((e: Record<string, unknown>) => {
      lines.push(`- ${JSON.stringify(e).substring(0, 120)}`);
    });
  } else {
    lines.push('- 无匹配');
  }

  lines.push('', '---');
  lines.push(
    `共找到: OpenClaw=${ocResults ? ocResults.length : 0}, .dreams=${dreamMatches.length}`,
  );

  return lines.join('\n');
}
