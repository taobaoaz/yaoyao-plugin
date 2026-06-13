# Yaoyao Memory v1.7.8 全方位核查报告

> 核查时间：2026-06-13
> 版本：v1.7.8（commit f18c771）
> 核查范围：入口、工具注册、初始化流程、hooks、共存检测、构建产物、配置一致性

---

## 🔴 严重问题（必须修复）

### 1. coexistence.ts 检测逻辑为空
**位置**：`src/utils/coexistence.ts:detectCoexistence()`

```typescript
export function detectCoexistence(): CoexistState {
  if (_isInStartupGrace()) {
    return _currentState;  // 宽限期内返回当前状态
  }
  // After grace period, actual detection logic runs here.
  // In production, this would check gspd heartbeat / mmap shared memory.
  return _currentState;  // ← 宽限期后仍然直接返回当前状态，没有任何检测！
}
```

**问题**：600ms 启动宽限期后，`detectCoexistence()` 仍然直接返回 `_currentState`（初始为 `unknown`），没有任何实际的共存检测逻辑。`startCoexistenceMonitor` 也是空转。

**影响**：共存检测永远不会自动工作。除非 `entry/index.ts` 通过 `sysArch.isXiaoYiClaw` 强制设置，否则 `_currentMode` 永远是 `'unknown'`。

**修复建议**：实现实际的检测逻辑——检查 gspd 进程是否存在、检查共享内存、或检查特定文件/端口。

---

### 2. contracts.tools 缺少 `memory_conflicts`
**位置**：`openclaw.plugin.json` vs `src/features/conflict/tool.ts`

`openclaw.plugin.json` 的 `contracts.tools` 声明了 37 个工具，但缺少 `memory_conflicts`。

`src/tools/index.ts` 第 94 行注册了 `memory_conflicts`：
```typescript
api.registerTool(createConflictsTool(db));
```

`src/features/conflict/tool.ts` 定义了该工具：
```typescript
export function createConflictsTool(db: DBBridge): ToolRegistration {
  return {
    id: "memory_conflicts",
    name: "memory_conflicts",
    ...
  };
}
```

**影响**：OpenClaw 会报错 "must declare contracts.tools"，工具无法暴露给 AI 使用。

**修复建议**：在 `openclaw.plugin.json` 的 `contracts.tools` 数组中添加 `"memory_conflicts"`。

---

## 🟡 中等问题（建议修复）

### 3. entry/index.ts 中 createTelemetryTool 重复注册
**位置**：`src/entry/index.ts:55` 和 `src/tools/index.ts:99`

`entry/index.ts` 第 55 行：
```typescript
api.registerTool(createTelemetryTool(version));
```

`tools/index.ts` 第 99 行：
```typescript
api.registerTool(createTelemetryTool(readPluginVersion()));
```

**影响**：同一个工具被注册两次。OpenClaw 可能会静默去重，也可能报错。

**修复建议**：删除 `entry/index.ts` 中的重复注册，只保留 `tools/index.ts` 中的。

---

### 4. system-config-reader.ts 是 stub（硬编码）
**位置**：`src/utils/system-config-reader.ts`

```typescript
export function detectSystemArchitecture(): SystemArchitecture {
  return {
    type: "openclaw",
    version: "2026.5.6",
    hasGspd: false,
    hasXiaoYi: false,
  };
}

export function getRecommendedStrategy(arch: SystemArchitecture): CoexistStrategy {
  return { mode: "standalone", reason: "default" };
}
```

**问题**：`detectSystemArchitecture()` 永远返回 `type: "openclaw"`，`getRecommendedStrategy()` 永远返回 `standalone`。没有实际检测系统架构。

**影响**：`entry/index.ts` 中 `sysArch.type === "xiaoyi-claw"` 永远不会为真，小艺适配逻辑永远不会触发。

**修复建议**：实现实际的检测逻辑——检查进程列表、检查环境变量、检查文件系统等。

---

### 5. xiaoyi-adapter.ts 定义但未被使用
**位置**：`src/entry/xiaoyi-adapter.ts`

定义了 `getAdaptedApi()`、`getAdaptedApiExtended()`、`isXiaoYiClaw()`、`getXiaoYiVersion()`、`getXiaoYiFeatures()` 等函数，但 `entry/index.ts` 中没有调用这些函数。

`entry/index.ts` 检测到小艺环境后只打印了日志：
```typescript
if (sysArch.isXiaoYiClaw) {
  logger.info?.(`[yaoyao-memory] 检测到小艺 Claw 环境，启用共存模式`);
  // 没有调用任何适配器函数！
}
```

**影响**：小艺适配器定义了但完全没被使用，小艺环境下的工具注册、hooks 注册等可能不兼容。

**修复建议**：在 `entry/index.ts` 中调用 `getAdaptedApi()` 或 `getAdaptedApiExtended()` 来适配小艺环境的 API。

---

### 6. stepCleanupScheduler 中配置键不匹配
**位置**：`src/core/boot/steps.ts:92`

```typescript
const cfg = (typeof config.cleaner === "object" ? config.cleaner : {}) as CleanerConfig;
```

但 `configSchema` 中定义的是 `cleanup`（不是 `cleaner`）：
```typescript
cleanup: z.object({ enabled: z.boolean().default(true), ... })
```

`cleanerFeature` 的 `configKey` 也是 `"cleanup.enabled"`。

**影响**：`config.cleaner` 永远是 undefined，清理调度器使用空配置运行，可能无法正确读取用户的清理配置。

**修复建议**：将 `config.cleaner` 改为 `config.cleanup`。

---

### 7. package.json node 版本要求 >=22.0.0（覆盖不足）
**位置**：`package.json:engines.node`

```json
"engines": { "node": ">=22.0.0" }
```

用户之前要求"对node适配增加版本，尽量覆盖多一些"。当前要求 >=22.0.0，但 Node 22 的 `node:sqlite` 模块在 v22.5.1 才稳定，且很多用户可能还在用 Node 20/18。

**影响**：Node <22 的用户无法安装或使用该插件。

**修复建议**：
- 如果确实需要 `node:sqlite`，保持 >=22.0.0，但文档中说明 Node 20/18 用户需要安装 `better-sqlite3`
- 或者降级到 >=18.0.0，并在代码中动态检测 `node:sqlite` 可用性（已有 `createCompatDB` 做兼容）

---

## 🟢 轻微问题 / 建议改进

### 8. import-memories.ts 缺失
**位置**：`src/core/boot/import-memories.ts`（不存在）

旧版有 `core/boot/import-memories.ts`，新版没有了。但 `md-sync.ts` 提供了 `.md → SQLite` 同步，`session-recovery.ts` 提供了跨会话恢复。

**状态**：功能已被替代，但需确认是否完整覆盖"自动读取环境原本记忆"的需求。

---

### 9. entry/index.ts 的 unloadFn 类型转换脆弱
**位置**：`src/entry/index.ts:169`

```typescript
const unloadFn = ((api as unknown) as Record<string, unknown>).onUnload as (() => void) | undefined;
```

这种类型转换很脆弱。如果 `api` 的结构变化，可能获取不到 `onUnload`。

**建议**：使用类型守卫或更安全的访问方式。

---

### 10. heartbeat-recall.ts 中 api.on 事件兼容性
**位置**：`src/hooks/heartbeat-recall.ts:31`

```typescript
const unsub = api.on("heartbeat_prompt_contribution", ...);
```

`"heartbeat_prompt_contribution"` 事件可能不是所有 OpenClaw 版本都支持。如果 Gateway 版本较旧，此 hook 可能静默失效。

**建议**：添加 try-catch 或版本检查。

---

### 11. capture-debouncer.ts 中 flushHandler 未 await
**位置**：`src/utils/capture-debouncer.ts:doFlush()`

```typescript
function doFlush() {
  ...
  try {
    flushHandler(batch);  // ← 没有 await！
  } catch (err) { ... }
}
```

`flushHandler` 是异步函数（`auto-capture.ts` 中传入的是 `async (batch) => { ... }`），但 `doFlush` 没有 await 它。

**影响**：如果 `flushHandler` 内部抛出异步异常，可能变成未处理的 Promise rejection。

**建议**：将 `doFlush` 改为 async，并使用 `await flushHandler(batch)`。

---

## ✅ 正常 / 无需修复

| 项目 | 状态 |
|---|---|
| `src/entry/index.ts` 入口流程 | ✅ 完整，8 步初始化 |
| `src/core/app.ts` 应用初始化 | ✅ 完整，错误处理到位 |
| `src/tools/index.ts` 工具注册（除重复外） | ✅ 37 个工具正确注册 |
| `src/hooks/auto-capture.ts` 自动捕获 | ✅ 异步处理正确，dedup 在排队前 |
| `src/hooks/auto-recall.ts` 自动召回 | ✅ 超时守卫正确，Promise.race 使用得当 |
| `src/hooks/command-new.ts` 新会话钩子 | ✅ 清理逻辑正确 |
| `src/hooks/heartbeat-recall.ts` 心跳召回 | ✅ 逻辑正确 |
| `src/utils/write-queue.ts` 写入队列 | ✅ drain 逻辑正确 |
| `src/utils/dedup-engine.ts` 去重引擎 | ✅ L1/L2/L3 三级去重正确 |
| `src/storage/bridge.ts` 存储桥接 | ✅ 懒加载，重试机制 |
| `src/utils/memory-store.ts` 记忆存储 | ✅ 安全加固（权限 0o700/0o600） |
| `src/utils/healthcheck.ts` 健康检查 | ✅ 5 项检查完整 |
| `src/entry/migration.ts` 迁移检测 | ✅ 安全，不执行远程代码 |
| `dist/` 构建产物 | ✅ 完整，hooks/entry/core/ 都有 |
| `openclaw.plugin.json` hooks 路径 | ✅ 正确指向 dist/src/hooks/ |
| `src/optional/features/` 各 feature | ✅ 配置键和默认值正确 |

---

## 📋 修复优先级清单

| 优先级 | 问题 | 文件 | 预估工作量 |
|---|---|---|---|
| P0 | contracts.tools 缺少 memory_conflicts | `openclaw.plugin.json` | 1 行 |
| P0 | coexistence.ts 检测逻辑为空 | `src/utils/coexistence.ts` | ~30 行 |
| P1 | stepCleanupScheduler 配置键不匹配 | `src/core/boot/steps.ts:92` | 1 行 |
| P1 | entry/index.ts 重复注册 telemetry | `src/entry/index.ts:55` | 删除 1 行 |
| P1 | system-config-reader.ts 硬编码 | `src/utils/system-config-reader.ts` | ~20 行 |
| P1 | xiaoyi-adapter.ts 未被使用 | `src/entry/index.ts` | ~10 行 |
| P2 | capture-debouncer 未 await flushHandler | `src/utils/capture-debouncer.ts` | ~5 行 |
| P2 | package.json node >=22.0.0 | `package.json` | 1 行 + 文档 |
| P2 | unloadFn 类型转换脆弱 | `src/entry/index.ts:169` | ~5 行 |
| P3 | heartbeat-recall 事件兼容性 | `src/hooks/heartbeat-recall.ts:31` | ~5 行 |

---

## 🔍 核查方法

- 逐文件阅读源码（~30 个关键文件）
- 检查 `openclaw.plugin.json` 与代码注册的工具是否匹配
- 检查配置 schema 与代码中使用的配置键是否一致
- 检查 hooks 路径与构建产物是否对应
- 检查异步流程中的竞态条件和资源泄露
- 检查类型安全和错误处理

---

*核查完成。共发现 2 个严重问题、6 个中等问题、3 个轻微问题。*
