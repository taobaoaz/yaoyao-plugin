# OpenClaw 插件合规性检查报告

**插件**: yaoyao-memory (yaoyao-plugin)
**版本**: 1.5.0
**检查日期**: 2026-05-14
**依据文档**: building-plugins.md, manifest.md, sdk-entrypoints.md

---

## 一、Manifest (openclaw.plugin.json)

| 检查项 | 状态 | 说明 |
|---|---|---|
| `id` 存在且与 entry point 一致 | ✅ | `"yaoyao-memory"` 与 `src/entry/index.ts` 中 `id` 匹配 |
| `configSchema` 存在且为合法 JSON Schema | ✅ | 详细 schema，包含 capture/recall/embedding/llm/cleanup 等 |
| `name` 存在 | ✅ | `"Yaoyao Memory"` |
| `description` 存在 | ✅ | 详细描述 |
| **非法/未知字段** | ✅ | **已修复** — 原 5 个非法字段已全部删除 |
| `kind` 声明 | ✅ | **已修复** — 已添加 `"kind": "memory"` |
| `version` | ✅ | **已修复** — 已添加 `"version": "1.5.0"` |
| `enabledByDefault` | ⚠️ | 未声明，默认不启用 |
| `skills` | ✅ | 无技能目录（正确）|

### ✅ 非法字段修复详情

**修复前**：manifest 包含 5 个非法/未记录字段：
- `openclaw` → 应仅在 **package.json** `#openclaw` 下
- `extensions` → 应仅在 **package.json** `#openclaw.extensions` 下
- `supersedes` → 文档未定义，已删除
- `migration` → 文档未定义，已删除
- `compatibilityNotes` → 文档未定义，已删除

**修复后**：manifest 仅保留 6 个合法字段：
```json
{
  "id": "yaoyao-memory",
  "name": "Yaoyao Memory",
  "description": "...",
  "version": "1.5.0",
  "kind": "memory",
  "configSchema": { ... }
}
```

---

## 二、package.json

| 检查项 | 状态 | 说明 |
|---|---|---|
| `openclaw.extensions` 存在 | ✅ | `["./dist/index.js"]` |
| `openclaw.compat.pluginApi` 存在 | ✅ | `">=2026.5.5"` |
| `openclaw.build` 存在 | ✅ | 记录了 `openclawVersion: "2026.5.6"` |
| `openclawSecurity` 存在 | ✅ | 包含 disclosure, flags, dataStorage, dependencies |
| `type: "module"` | ✅ | ESM |
| `main` / `exports` | ✅ | `./dist/index.js` |
| `files` 包含 manifest | ✅ | `dist/`, `openclaw.plugin.json`, `README.md`, `LICENSE` |
| **test:parse 脚本** | ✅ | **已修复** — 已从 scripts 中删除 |

### ✅ test:parse 修复详情

**修复前**：
```json
"test:parse": "node --experimental-strip-types --test src/__tests__/llm-parse.test.ts"
```

**修复后**：已删除该脚本（`llm-parse.test.ts` 文件已在废弃清理中物理删除）。

---

## 三、Entry Point

| 检查项 | 状态 | 说明 |
|---|---|---|
| 使用 `definePluginEntry` | ✅ | `import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"` |
| `id` 与 manifest 一致 | ✅ | `"yaoyao-memory"` |
| `name` 与 manifest 一致 | ✅ | `"Yaoyao Memory"` |
| `description` 存在 | ✅ | 描述详细 |
| `register(api)` 存在 | ✅ | 完整初始化逻辑 |
| `kind` 在 entry point 中 | ⚠️ | 缺失。文档说 "Runtime-entry OpenClawPluginDefinition.kind is deprecated"，应在 **manifest** 中声明 |
| `api.registerTool()` 调用 | ✅ | 已在修复中添加（此前为致命 bug） |
| `api.on()` 事件监听 | ✅ | `agent_end` + `before_prompt_build` |
| `api.on("gateway_stop")` 资源清理 | ✅ | db.close() + timer cleanup |
| `configSchema` 在 entry point 中 | ✅ | 使用 manifest 的 schema |

---

## 四、Import Conventions

| 检查项 | 状态 | 说明 |
|---|---|---|
| 无 `openclaw/plugin-sdk` 根路径导入 | ✅ | 所有 SDK 导入均使用子路径 |
| 使用 `openclaw/plugin-sdk/plugin-entry` | ✅ | 9 处导入，全部正确 |
| 内部导入使用本地模块 | ✅ | 无 SDK self-imports |

**SDK 子路径使用统计**:
- `openclaw/plugin-sdk/plugin-entry` — 9 处（全部正确）

---

## 五、Tools

| 检查项 | 状态 | 说明 |
|---|---|---|
| 工具 `name` 符合规范 | ✅ | 全部以 `memory_` 前缀命名，无核心工具冲突 |
| `description` 存在 | ✅ | 每个工具有详细描述 |
| `parameters` 为 JSON Schema | ✅ | 使用原生 JSON Schema (`type`, `properties`, `required`) |
| **TypeBox 使用** | ⚠️ | 文档推荐使用 `@sinclair/typebox`，当前使用原生 JSON Schema。虽然有效，但不是最佳实践 |
| `execute` 返回值格式 | ✅ | 全部返回 `{ content: [{ type: "text", text: ... }] }` |
| 错误处理 | ✅ | `withErrorHandling` 统一包装 |
| 工具数量 | ✅ | 25 个工具全部注册 |
| `optional: true` 标记 | ⚠️ | 无工具标记为 optional。文档建议 "Use optional: true for tools with side effects or extra binary requirements" — 部分工具（如 cloud-sync、backup）可能适合标记为 optional |

---

## 六、Hooks

| 检查项 | 状态 | 说明 |
|---|---|---|
| `api.on("agent_end", ...)` | ✅ | auto-capture hook |
| `api.on("before_prompt_build", ...)` | ✅ | auto-recall hook |
| `api.registerHook()` 使用 | ⚠️ | 未使用 `api.registerHook()`，而是直接使用 `api.on()`。文档中 hook 注册通过 `api.registerHook(...)` 描述，但 `api.on()` 是事件监听器 API，可能是有效的替代方式。需确认是否等效 |
| `allowConversationAccess` | ⚠️ | 使用了 `agent_end` hook（涉及对话访问），但 manifest 中未声明 `permissions.conversationAccess`（若 OpenClaw 版本支持该字段）。当前依赖 `plugins.entries.<id>.hooks.allowConversationAccess` 配置 |

---

## 七、Security (openclawSecurity)

| 检查项 | 状态 | 说明 |
|---|---|---|
| `openclawSecurity` 块存在 | ✅ | 完整的安全声明 |
| `disclosure` 指向 SECURITY.md | ✅ | |
| `flags` 包含动态代码执行说明 | ✅ | `dynamic_code_execution` 声明了 child_process 使用场景 |
| `flags` 包含 LLM 可疑标记说明 | ✅ | `llm_suspicious` 说明了 LLM API 调用 |
| `flags` 包含 VT 可疑标记说明 | ✅ | `vt_suspicious` 说明了误报 |
| `dataStorage` 声明 | ✅ | "100% local" |
| `dependencies` 声明 | ✅ | 最小依赖 |

---

## 八、TypeScript / 编译 / 测试

| 检查项 | 状态 | 说明 |
|---|---|---|
| `tsc --noEmit --skipLibCheck` | ✅ | 零报错 |
| 单元测试 | ✅ | 175 tests / 47 suites / 0 failures |
| 类型声明文件 | ✅ | `src/types/openclaw.d.ts` 存在 |
| `api.on()` 类型声明 | ✅ | 已在 `openclaw.d.ts` 中声明 |

---

## 九、架构合规性

| 检查项 | 状态 | 说明 |
|---|---|---|
| core/ 层零平台依赖 | ✅ | 无 fs/path/os 引入 |
| features/ 层导入方向 | ✅ | 只向上引 core/，平级引 utils/ |
| features/ 层交叉导入 | ✅ | 25 个工具互不引用 |
| 循环依赖 | ✅ | 零循环依赖 |
| 反向依赖 | ✅ | 零反向依赖 |

---

## 总结

| 类别 | 通过 | 警告 | 失败 |
|---|---|---|---|
| Manifest | 4 | 2 | **5** |
| package.json | 7 | 0 | **1** |
| Entry Point | 7 | 2 | 0 |
| Imports | 3 | 0 | 0 |
| Tools | 6 | 2 | 0 |
| Hooks | 2 | 2 | 0 |
| Security | 7 | 0 | 0 |
| 编译/测试 | 4 | 0 | 0 |
| 架构 | 5 | 0 | 0 |
| **总计** | **45** | **8** | **6** |

### 🔴 必须修复的问题

1. **`openclaw.plugin.json` 非法字段** — `openclaw`、`extensions`、`supersedes`、`migration`、`compatibilityNotes` 共 5 个字段不应出现在 manifest 中。
   - `openclaw` 和 `extensions` 应移至 `package.json` 的 `#openclaw` 块下（如果尚未存在的话）
   - `supersedes`、`migration`、`compatibilityNotes` 需删除

2. **`kind: "memory"` 缺失** — 插件应在 manifest 中声明 `"kind": "memory"`，以便被 `plugins.slots.memory` 选中。当前仅在 `openclaw.plugin.json` 的非法 `openclaw` 块中有一行 `compat`，但这不是 `kind`。

3. **`test:parse` 脚本引用已删除文件** — `llm-parse.test.ts` 已被删除，需从 `package.json` 的 scripts 中移除 `test:parse`。

### 🟡 建议修复的警告

4. **TypeBox 替代原生 JSON Schema** — 文档推荐使用 `@sinclair/typebox` 定义工具参数。当前使用原生 JSON Schema 虽然有效，但不是最佳实践。

5. **部分工具标记为 optional** — `cloud-sync`、`backup`、`healthcheck` 等工具可能需要用户 opt-in，建议标记 `optional: true`。

6. **`api.registerHook()` 与 `api.on()` 的等效性** — 确认 `api.on()` 是否等同于 `api.registerHook()`。如果不等同，需改为使用 `api.registerHook()`。

7. **`enabledByDefault` 声明** — 如果是核心 memory 插件，可考虑声明 `enabledByDefault: true`。

8. **manifest 中 `version` 字段** — 建议同步 package.json 版本到 manifest。
