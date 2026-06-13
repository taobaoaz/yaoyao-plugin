# yaoyao-plugin 兼容性策略

> 目标：**所有 Node.js 版本 × 所有 OpenClaw 版本** 都能运行，功能自动降级。

---

## 兼容性矩阵

### Node.js × SQLite 实现

| Node.js | SQLite 层 | FTS5 | WAL | sqlite-vec | 数据库文件 | 搜索质量 |
|---|---|---|---|---|---|---|
| **22+** | `node:sqlite` (原生) | ✅ | ✅ | ✅ (可选) | `.yaoyao.db` | 高 (FTS5+向量) |
| **20** | `better-sqlite3` (npm) | ✅ | ✅ | ❌ (需编译) | `.yaoyao.db` | 高 (FTS5) |
| **18** | 纯文件降级 | ❌ | N/A | ❌ | 无 | 低 (文件名+内容扫描) |
| **<18** | 纯文件降级 | ❌ | N/A | ❌ | 无 | 低 |

**降级原则**：
- 有 SQLite（无论原生/npm）→ 完整 L0+L1（FTS5 索引、结构化搜索）
- 无 SQLite → 纯 L0（daily md 文件读写、简单文件名扫描）
- 无 SQLite 时，`auto-capture` 仍工作，`auto-recall` 退化为文件名/内容扫描

### OpenClaw Gateway × API 适配

| Gateway 版本 | `registerTool` | `api.on` 事件 | `api.baseDir` | 适配策略 |
|---|---|---|---|---|
| **>=2026.5.5** | 新版签名 | 全事件 | 有 | 完整模式 |
| **2026.4.x** | 旧版签名 | 部分事件 | 可能有 | 参数包装器 |
| **<2026.4** | 可能缺失 | 可能缺失 | 可能缺失 | 大量 fallback |

**降级原则**：
- 缺少 `before_prompt_build` → `auto-recall` 禁用，但 `auto-capture` 仍工作
- 缺少 `agent_end` → `auto-capture` 禁用，但工具手动调用仍工作
- `registerTool` 参数格式不同 → shim 层自动适配

---

## 架构改动

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/utils/db-compat.ts` | SQLite 兼容性层：自动检测 `node:sqlite` / `better-sqlite3` / 无，统一接口 |
| `src/utils/api-compat.ts` | OpenClaw API 兼容性层：检测 API 版本，参数适配，fallback |
| `src/utils/file-db.ts` | 纯文件降级模式：模拟 db-bridge 接口（无 SQLite 时的 L0 搜索） |

### 修改文件

| 文件 | 改动 |
|---|---|
| `index.ts` | install-check 不拒绝，改为降级报告；入口支持降级模式启动 |
| `src/utils/install-check.ts` | 从 fatal/warn 改为 capability 报告 |
| `src/utils/db-bridge.ts` | 通过 `db-compat.ts` 获取 DatabaseSync，不直接 require `node:sqlite` |
| `src/utils/healthcheck.ts` | 增加降级模式检测项 |
| `src/tools/*.ts` | 通过 db-bridge 获取 rawDb，不再直接 new DatabaseSync |

### 核心接口统一

所有代码只接触这三个接口，不感知底层实现：

```typescript
// db-compat.ts 返回的统一 DB 接口
type UnifiedDB = {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: any[]): void; all(...args: any[]): any[]; get(...args: any[]): any; };
  close(): void;
  // 扩展加载（仅原生 SQLite 支持）
  enableLoadExtension?(enabled: boolean): void;
};

// file-db.ts 的纯文件降级接口（与 UnifiedDB 同签名，内部用 fs 实现）
```

---

## 纯文件降级模式（FileDB）

当没有 SQLite 时，FileDB 提供最小可用的 L0 记忆：

### 数据存储
- `memory/2026-05-14.md` — 日常对话（已有，无需改）
- `memory/.yaoyao-index.json` — 简单索引（日期→文件名映射）

### 搜索实现
```typescript
// 无 FTS5 时的简单搜索
function simpleSearch(query: string, baseDir: string): SearchResult[] {
  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.md'));
  const results: SearchResult[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(baseDir, file), 'utf-8');
    if (content.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        filename: file,
        snippet: extractSnippet(content, query),
        score: 0.5,
        date: file.replace('.md', ''),
      });
    }
  }
  return results.slice(0, limit);
}
```

### 限制
- 无 FTS5 排名 → 按日期倒序
- 无向量搜索 → 纯关键词匹配
- 无事务 → 文件写入即用
- 但：**auto-capture 仍工作，memory_search 仍能返回结果**

---

## 实现优先级

1. **P0**：`db-compat.ts` + `file-db.ts` — 核心兼容性层
2. **P0**：修改 `db-bridge.ts` 使用 db-compat
3. **P1**：修改 `install-check.ts` 为 capability 报告
4. **P1**：`api-compat.ts` — OpenClaw API 适配
5. **P2**：修改各 tools 不再直接 new DatabaseSync

---

**Last updated**: 2026-05-14
**Status**: Design → Implementation
