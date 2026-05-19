# Yaoyao Memory 架构方案与开发要求

> **版本**：v2.0.0 架构基线
> **更新**：2026-05-18
> **开发者**：所有参与 yaoyao-plugin 开发的人员
> **核心原则**：多人协作，架构统一。任何偏离本指南的代码都不允许合入主分支。

---

## 第一部分：架构方案

### 1. 总览

```
src/
├── entry/          ← 插件入口，仅做错误边界和委派（<40行）
│
├── core/           ← 纯算法层：无 I/O、无平台依赖、无副作用
│   ├── app.ts      ← 启动编排：依赖注入、初始化顺序、关机清理
│   ├── conflict/   ← engram 启发式冲突检测
│   ├── search/     ← 搜索管线（pipeline.ts 是统一入口）
│   ├── sentiment/  ← 情感分析
│   ├── verify/     ← 反幻觉
│   ├── cloud/      ← 云同步
│   ├── export/     ← 导出逻辑
│   ├── import/     ← 导入逻辑
│   ├── quality/    ← 质量打分
│   ├── recommend/  ← 推荐引擎
│   ├── retain/     ← 保留策略
│   ├── tag/        ← 标签算法
│   ├── trends/     ← 趋势分析
│   └── graph/      ← 知识图谱
│
├── storage/        ← 数据访问层：唯一访问数据库的层
│   ├── bridge.ts   ← 门面（~150行），暴露 Storage 接口
│   ├── fts.ts      ← FTS5 引擎
│   ├── vector-store.ts  ← 向量存储
│   ├── hybrid.ts   ← RRF + 加权融合
│   ├── schema.ts   ← 表定义 + 迁移
│   └── types.ts    ← 数据层类型
│
├── features/       ← 工具层：每个工具一个文件，只做参数校验+输出格式化
│   ├── save/tool.ts
│   ├── search/tool.ts
│   ├── conflict/tool.ts
│   └── ...         ← 29 个工具
│
├── hooks/          ← 钩子层：事件驱动，协调各层
│   ├── auto-capture.ts      ← 编排器（~150行）
│   ├── capture-content.ts   ← 内容提取
│   ├── capture-filter.ts    ← 会话过滤
│   ├── capture-watermark.ts ← 水印监控
│   └── auto-recall.ts       ← 自动召回
│
├── optional/       ← 可选功能注册表
│   ├── registry.ts ← FeatureRegistry（拓扑排序初始化）
│   ├── types.ts
│   └── features/   ← 各可选功能定义
│
├── tools/          ← 工具注册脚本（无业务逻辑）
├── platform/       ← SQLite 兼容层（file-db/better-sqlite3/node:sqlite）
├── utils/          ← 纯工具函数：日志、配置、缓存、哈希（不含算法）
└── types/          ← OpenClaw 类型扩展
```

### 2. 依赖方向（严格单向）

```
                    ┌──────────────────┐
                    │   features/      │  参数校验 + 输出格式化
                    └────────┬─────────┘
                             │ 只能调用 core/ 算法和 storage/ 查询
                             ▼
┌────────────────┐    ┌──────────────────┐
│   hooks/       │◄──►│    core/         │  纯算法逻辑，无 I/O
│  事件驱动      │    └────────┬─────────┘
└────────────────┘             │ 不能直接调用 platform/
                               ▼
                    ┌──────────────────┐
                    │   storage/       │  唯一数据访问层
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   platform/      │  SQLite 兼容
                    └──────────────────┘

    utils/  ← 全层可用（纯工具函数）
```

**绝对禁止**的跨层调用：
- `features/` 直接 `import` `platform/` ❌
- `features/` 写 SQL ❌
- `hooks/` 直接操作 `storage/bridge.ts` 以外的存储 ❌
- `core/` 直接 `import` `utils/db-bridge.ts` ❌（应 import `storage/bridge.ts`）

### 3. 数据流

#### 3.1 写入（Capture Pipeline）

```
agent_end 事件
  │
  ├─ [capture-filter.ts]    决策：是否捕获？
  │  ├─ 会话标签过滤
  │  ├─ Agent 排除
  │  ├─ 暖启动模式（1→2→4→8）
  │  ├─ 固定间隔捕获
  │  ├─ 正则排除
  │  └─ 活跃窗口追踪
  │
  ├─ [capture-watermark.ts] 监测：上下文水位？
  │  └─ 返回 mild/aggressive/emergency 级别
  │
  ├─ [核心管线]
  │  ├─ 噪音/Trivial 过滤
  │  ├─ Memory Upgrader（元数据）
  │  ├─ L1 事实提取
  │  ├─ 去重检查
  │  └─ Mermaid 卸载
  │
  ├─ [L0] memory-store → 每日 Markdown 文件
  ├─ [L1] storage/fts.ts → FTS5 索引
  └─ [L2] storage/vector-store.ts → 向量索引（可选）
```

#### 3.2 读取（Search Pipeline）

```
memory_search / memory_search_multi 工具
  │
  └─ features/<tool>.ts
       │
       └─ [SearchPipeline] core/search/pipeline.ts
            │
            ├─ strategy="fts" → storage/fts.ts
            ├─ strategy="hybrid" → storage/fts.ts + storage/vector-store.ts + storage/hybrid.ts（加权）
            ├─ strategy="rrf"（默认）→ storage/fts.ts + storage/vector-store.ts + storage/hybrid.ts（RRF）
            ├─ strategy="multi-signal" → core/search/multi-signal.ts（BM25+FTS+向量+实体）
            └─ strategy="additive" → core/search/additive-scorer.ts（mem0 v3 分数叠加）
```

### 4. 搜索策略速查表

| Strategy | 用途 | 速度 | 需要向量 | 中文友好 |
|:---------|:-----|:----:|:--------:|:--------:|
| `fts` | 纯关键词 | ⚡ | ❌ | ❌（LIKE 回退） |
| `hybrid` | 语义+关键词加权 | 🟢 | ✅ | 🟡 |
| `rrf` | **推荐通用** | 🟢 | ❌（降级纯 FTS） | 🟢（BM25 + FTS5 + LIKE） |
| `multi-signal` | 高精度，中文搜索 | 🟡 | ❌ | ✅ |
| `additive` | mem0 v3 分数叠加 | 🟡 | ❌ | ✅ |

---

## 第二部分：开发要求

### 5. 代码约束（强制）

#### 5.1 文件大小红线

| 指标 | 上限 | 违例处理 |
|:----|:----|:---------|
| 单文件行数 | **200 行** | 必须拆分模块 |
| 单文件 import 数 | **15 个** | 提取中间层或抽象 |
| 工具函数体行数 | **50 行** | 提取子函数 |
| `entry/index.ts` | **40 行 / 10 import** | 委派给 `core/app.ts` |
| `storage/bridge.ts` | **200 行** | 功能移回独立引擎文件 |

#### 5.2 命名规范（多人协作必须统一）

##### 5.2.1 文件命名

```
✅ 强制规则：一律使用 kebab-case

src/storage/fts.ts          ✅
src/storage/vector-store.ts ✅
src/features/multi-signal/  ✅
src/hooks/auto-capture.ts   ✅

❌ 禁止
src/Storage/FTS.ts            ❌ 大写
src/storage/vectorStore.ts    ❌ camelCase
src/storage/vector_store.ts   ❌ snake_case
```

##### 5.2.2 目录命名

```
✅ 一律使用英文复数名词

src/features/    ← 所有工具
src/hooks/       ← 所有钩子
src/optional/    ← 可选功能
src/core/        ← 算法模块

❌ 禁止
src/feature/     ← 单数
src/hook/        ← 单数
src/func/        ← 语义模糊
```

##### 5.2.3 函数命名

| 模式 | 前缀 | 示例 |
|:----|:-----|:-----|
| 工厂函数 | `create` | `createSearchTool()`, `createFtsEngine()` |
| 纯算法 | `compute` | `computeScores()`, `computeTfIdf()` |
| 格式化 | `format` | `formatAsText(), `formatAsJson()` |
| 校验 | `validate` | `validateConfig(), `validateQuery()` |
| 布尔判断 | `is/has/should` | `isEnabled(), `hasResults(), `shouldCapture()` |
| 获取 | `get` | `getById(), `getStats()` |
| 索引/写入 | `index` | `indexTurn()` |
| 搜索 | `search` | —（统一通过 SearchPipeline） |

**绝对禁止**：
- `getData()` / `doThing()` / `processItem()` — 语义无意义
- `mgr` / `cfg` / `val` / `info` 等缩写（`db` 是通用缩写可接受，其余禁止）
- 函数名超过 5 个单词

##### 5.2.4 变量命名

```typescript
// ✅ 可接受的通用缩写
db    → 数据库实例
cfg   → ❌ 禁止，用 config
info  → ❌ 禁止，用 data 或具体名
mgr   → ❌ 禁止，用 manager
res   → ❌ 禁止，用 result 或 results

// ✅ 正确示范
const storage = createStorage(config);
const searchResults = pipeline.search(query, options);
const isEligible = shouldCapture(session);
```

#### 5.3 类型约束

```typescript
// ✅ 总是使用 interface 定义对象形状（优于 type）
export interface SearchResult {
  id?: number;
  snippet: string;
  score: number;
}

// 仅在联合类型、交叉类型、工具类型时用 type
export type SearchStrategy = "fts" | "hybrid" | "rrf";

// ✅ 导出工厂函数统一前缀 create
export function createStorage(config): Storage { ... }
export function createFtsEngine(config): FtsEngine { ... }

// ❌ 禁止 any（仅 storage/bridge.ts 和 shim 文件可豁免）
// ❌ 禁止 Record<string, unknown> 传播到 core/ 或 features/
// ❌ 禁止 as any 强制类型转换（使用 as unknown as TargetType 替代）
```

#### 5.4 错误处理

```typescript
// ✅ features/ 层
execute: withErrorHandling(async (id, params) => {
  // 业务逻辑，异常由 withErrorHandling 统一处理
});

// ✅ core/ 层 — 返回默认值而非 throw
function search(db: UnifiedDB, query: string): SearchResult[] {
  try { ... } catch { return []; }
}

// ✅ storage/ 层 — 异常冒泡到调用方
function indexTurn(...): number {
  try { ... } catch { return -1; }
}

// ❌ 禁止在 features/ 层 catch 后静默忽略
```

#### 5.5 异步与性能约束

##### 5.5.1 性能目标

| 场景 | P99 目标 | 测量方式 |
|:-----|:--------:|:---------|
| 搜索（含 RRF 融合） | < 200ms | `console.time()` 或性能日志 |
| 捕获（agent_end 处理） | < 50ms | 同上 |
| 单次 DB 写入 | < 10ms | SQLite WAL 模式下 |

##### 5.5.2 批量操作规则

```typescript
// ✅ 超过 100 条必须分页
async function batchInsert(records: Record[]) {
  const PAGE = 100;
  for (let i = 0; i < records.length; i += PAGE) {
    const batch = records.slice(i, i + PAGE);
    db.transaction(() => {
      for (const r of batch) insertOne(r);
    })();
  }
}

// ❌ 禁止一次插入数千条（导致 SQLITE_BUSY 和 UI 卡顿）
```

##### 5.5.3 `getRawDb()` 权限限制

```
`getRawDb()` 仅限于：
  ✅ storage/bridge.ts 内部使用
  ✅ core/search/ 中需要直接操作 SQLite 的场景
  ❌ features/ 工具层直接调用（应通过 storage.xxx() 封装方法）
  ❌ hooks/ 中直接调用（应通过 storage.xxx() 封装方法）
```

##### 5.5.4 SQLite 并发规则

```
storage/bridge.ts:
  ├─ 单一 WAL 连接，全局共享
  ├─ 读操作：允许多个并行（WAL 模式原生支持并发读）
  ├─ 写操作：排队执行（indexTurn, deleteByKeyword 等串行化）
  └─ 长事务禁止：任何单个事务 ≤ 500ms

❌ 禁止：
  - 多个 features/ 各自创建独立 DB 连接
  - 在事务中做 I/O 操作（写文件、网络请求）
  - 事务嵌套超过 3 层
```

### 6. 模块迁移规范

每次模块迁移**必须**遵循 4 步流程：

```
步骤 1：在新位置创建模块
步骤 2：更新所有消费者 import 路径
步骤 3：在旧位置创建 shim（export * from "新路径"）
步骤 4：至少保留 shim 一个大版本后方可删除
```

**当前活跃的 shim：**

| 旧位置 | 新位置 | 保留期限 |
|:------|:------|:--------|
| `utils/db-bridge.ts` | `storage/bridge.ts` | v2.n+1 |
| `utils/rrf.ts` | `core/search/rrf.ts` | v2.n+1 |
| `utils/sentiment.ts` | `core/sentiment/index.ts` | v2.n+1 |

### 7. 新增功能开发全流程

如果要在 yaoyao-plugin 中添加一个全新的功能（例如"记忆重要性评分"），**必须按以下 8 步逐一确认文件归属**，缺一不可：

#### 步骤 1：定义类型（如需要新数据结构）

```
□ 是否有新的数据对象？
   → 是 → 定义在 storage/types.ts（全层共享）或 core/<domain>/types.ts
```

#### 步骤 2：实现核心算法

```
□ 是否有新的算法/计算逻辑？
   → 是 → 放在 core/<domain>/（纯函数，无 I/O）
   → 导出工厂函数 createXxx() 或纯函数 computeXxx()
```

#### 步骤 3：实现数据存储（如需要持久化）

```
□ 是否需要新的 DB 表或数据操作？
   → 是 → 在 storage/schema.ts 加表定义
   → 在 storage/ 下新增 <engine>.ts（或扩充 fts.ts / vector-store.ts）
   → 在 storage/bridge.ts 暴露新方法
```

#### 步骤 4：实现工具层（如需暴露给用户）

```
□ 是否要让用户通过 MCP 工具调用？
   → 是 → 在 features/<name>/tool.ts 中实现
   → 结构：参数校验 → 调用 core/ 算法 + storage/ 查询 → 格式化输出
   → 工具注册在 tools/index.ts 中
```

#### 步骤 5：实现钩子（如需事件驱动）

```
□ 是否需要在 agent_end / message 等事件触发？
   → 是 → 在 hooks/<name>.ts 中实现
   → 结构：事件监听 → 调用 core/ 算法 + storage/ 查询
```

#### 步骤 6：实现可选配置

```
□ 是否允许用户通过配置启停？
   → 是 → 在 optional/features/<name>.ts 实现 OptionalFeature
   → 涉及初始化顺序 → 在 core/app.ts 的 bootstrapYaoyao() 中注册
   → 不涉及初始化顺序 → 通过 FeatureRegistry 自动管理
```

#### 步骤 7：文件大小检查

```
□ 单文件 > 200 行？
   → 是 → 拆分为子模块
□ 单文件 import > 15 个？
   → 是 → 提取中间层或抽象
□ features/<name>/tool.ts > 100 行？
   → 是 → 输出格式化逻辑提取到独立的 formatter.ts
```

#### 步骤 8：依赖检查

```
□ 是否引入了新的 npm 包？
   → 禁止（必须零外部依赖）
□ 是否引入了 node:fs / node:path / node:os？
   → storage/ 层面可以，features/ 和 core/ 层面禁止
```

### 8. 新增功能自查表（PR 提交标准）

每次提交新功能时，PR 描述**必须**逐项确认：

```markdown
## 新功能：<功能名称>

### 文件检查
- [ ] 算法存在于 `core/<domain>/`（无 I/O）
- [ ] 数据操作存在于 `storage/`（如需要）
- [ ] 工具存在于 `features/<name>/tool.ts`（如需要）
- [ ] 钩子存在于 `hooks/<name>.ts`（如需要）
- [ ] 可选配置存在于 `optional/features/<name>.ts`（如需要）
- [ ] 工具注册于 `tools/index.ts`
- [ ] 启动初始化为 `core/app.ts` 或 FeatureRegistry

### 约束检查
- [ ] 所有单文件 <= 200 行
- [ ] 所有单文件 import <= 15 个
- [ ] 零新增外部依赖
- [ ] `core/` 层未引用 `fs`/`path`/`platform/`
- [ ] `features/` 层未引用 `platform/`
- [ ] `features/` 层未直接写 SQL（`db.prepare("SELECT...")`）
- [ ] 配置字段使用 `config-validator.ts` 校验，不在 features/ 内自行 getProp
- [ ] TypeScript 编译零错误

### 向后兼容
- [ ] 没有修改导出函数的签名（如修改了，提供了 shim）
- [ ] 没有删除已有公开类型
- [ ] 没有改变已有配置项含义

### Code Review 专项（Reviewer 检查）
- [ ] 是否引入了新的 `Record<string, unknown>` 传递链
- [ ] features/ 层是否有 `db.prepare("SELECT...")` 模式
- [ ] 新类型是否用 `interface` 而非 `type`
- [ ] 错误是否按层级处理
- [ ] 文件是否新增超过 200 行
- [ ] 命名是否符合 kebab-case + create/compute/format 前缀规范
```

### 9. feature/ 目录职责细化

#### 9.1 单文件结构（≤100 行）

```typescript
// features/<name>/tool.ts
export function create<Name>Tool(storage: Storage): ToolRegistration {
  return {
    execute: withErrorHandling(async (id, params) => {
      //  参数校验 → core/ 算法 → storage/ 查询 → 格式化输出
      const results = storage.search(query, limit);
      const text = results.map(r => formatDisplay(r)).join("\n");
      return { content: [{ type: "text", text }] };
    }),
  };
}

function formatDisplay(result: SearchResult): string {
  return `【${result.filename}】${result.snippet}`;
}
```

#### 9.2 复杂功能拆分子模块（>100 行时）

当一个 feature 的工具逻辑超过 100 行，**必须**按以下模式拆分：

```
features/<name>/
├── tool.ts              ← 工具入口（只做参数校验 + 调用 + 返回）
├── formatter.ts         ← 输出格式化（text / json 转换）
└── provider.ts          ← 数据源的复杂组装逻辑（可选）
```

**限制**：一个 feature 目录下最多 3 个文件（`tool.ts`, `formatter.ts`, `provider.ts`）。超过 → 功能拆到多个 feature。

#### 9.3 禁止 features/ 直接引用 platform/

以下文件当前违反了规则，需逐步迁移到 storage/bridge.ts 封装：

| 文件 | 违规引用 | 目标方法 |
|:-----|:---------|:---------|
| `features/import/tool.ts` | `createCompatDB` | `storage.getRawDb()` + 批量导入封装 |
| `features/import-oc/tool.ts` | `createCompatDB` | 同上 |
| `features/tag/tool.ts` | `createCompatDB` | `storage.batchInsertTags()` 等封装 |
| `features/unify/tool.ts` | `createCompatDB` | `storage.getConfig()` + 多 backend 统一查询 |
| `features/recommend/tool.ts` | `UnifiedDB` 类型 | `storage.search()` + `storage.getStats()` |

**新代码绝对不允许** `import { createCompatDB } from "../../platform/db/compat.ts"`。

### 10. 配置项管理规则

#### 10.1 配置校验集中化

所有配置项的校验**必须**放在 `utils/config-validator.ts` 中，不要在 features/ 或 hooks/ 中自行 `getProp`。

```typescript
// ✅ 正确
// utils/config-validator.ts
export function validateMyFeature(config: YaoyaoMemoryConfig): ValidationResult {
  const enabled = config.myFeature?.enabled;
  if (enabled === true && !config.myFeature?.apiKey) {
    return { level: "error", message: "myFeature.enabled=true but no apiKey" };
  }
}

// ❌ 错误：分散在各 features/*/tool.ts 中
const apiKey = getProp(config, "myFeature.apiKey", "");
```

#### 10.2 配置读取入口统一

```
utils/config.ts              ← getProp / getObj / getBool 通用工具
utils/config-validator.ts    ← 所有配置项的集中校验
```

#### 10.3 配置变更向后兼容规则

```
配置项改名流程：
  1. 旧名在 migration 阶段自动映射到新名
  2. 记录 warn 日志："config key xxx is deprecated, use yyy instead"
  3. 保留旧名兼容至少 2 个版本
  4. 标记 deprecation 后在下一个大版本删除

配置项废弃流程：
  1. 标记为 deprecated（代码注释 + config schema）
  2. 每次加载时打印 warn 日志
  3. 保留至少 2 个版本

Boolean 默认值规则：
  ✅ enableXxx 默认值为 false（安全方向）
  ❌ enableXxx 默认值为 true（除非有极强理由）
```

### 11. 依赖注入模式

#### 11.1 唯一方式：工厂函数传参

```
✅ 正确：通过工厂函数注入依赖
features/search/tool.ts:
    createSearchTool(storage: Storage, pipeline?: SearchPipeline)

hooks/auto-capture.ts:
    createAutoCapture(storage: Storage, config: CaptureConfig)

core/app.ts:
    const storage = createStorage(config);
    const pipeline = createSearchPipeline(storage);
    const searchTool = createSearchTool(storage, pipeline);

❌ 禁止方式：
  - 全局单例（const db = new Database(...)）
  - import 一个已实例化的对象
  - 静态类方法
  - 模块级变量做运行时状态（const config = {...})
```

#### 11.2 为什么要这样

```typescript
// 工厂函数传参的 3 个好处：
// 1. 测试时可注入 mock storage
// 2. 初始化顺序由 app.ts 控制，不隐含在 import 链
// 3. 每个工具功能独立，不存在状态耦合

// ❌ 反例：全局单例导致测试困难
import { db } from "../utils/db-instance.ts"; // 已经实例化了
// 测试时无法替换为 memory-db

// ✅ 正例：工厂函数可注入
export function createMyTool(storage: Storage) { ... }
// 测试时：createMyTool(createMemoryStorage())
```

### 12. 输出格式化规范

#### 12.1 用户 vs 调试错误信息

```typescript
// ✅ 用户看到的错误：中文、友好、可操作
const USER_ERRORS = {
  TIMEOUT: "搜索超时，请稍后重试",
  EMPTY_QUERY: "请输入搜索关键词",
  NO_RESULTS: "没有找到相关记忆",
  DB_FAILURE: "记忆服务暂时不可用，请稍后重试",
};

// ✅ 调试日志：英文、结构化、含上下文
console.log(`[search] strategy=${strategy}, query="${query.substring(0, 50)}", took=${elapsed}ms`);

// ❌ 禁止
// 1. 向用户暴露 SQL
return { content: [{ type: "text", text: `SELECT error: ${err.message}` }] };  // ❌
// 2. 向用户暴露堆栈
return { content: [{ type: "text", text: err.stack }] };  // ❌
// 3. 向用户暴露文件路径
return { content: [{ type: "text", text: `Error in /src/features/save/tool.ts` }] };  // ❌
```

#### 12.2 text 格式

```typescript
// ✅ 工具层输出 readable text
const text = results.map(r => {
  return `${r.emoji} 【${r.filename}】(得分: ${r.score.toFixed(3)})\n${r.snippet}`;
}).join("\n\n---\n\n");
```

#### 12.3 json 格式

```typescript
// ✅ 结构化的 json 输出
return {
  content: [{
    type: "text",
    text: JSON.stringify({ query, count: results.length, results }, null, 2),
  }],
};
```

#### 12.4 格式化逻辑提取（tool.ts > 100 行时）

当格式化逻辑复杂，**必须**提取到独立的 `formatter.ts`。

```typescript
// features/<name>/formatter.ts
export function formatAsText(results: SearchResult[], query: string): string { ... }
export function formatAsJson(results: SearchResult[], query: string): string { ... }
```

### 13. 中文/CJK 文本处理规范

```typescript
// 1. 搜索默认走 multi-signal 策略，而非纯 fts
// 原因：FTS5 对中文分词效果差
const results = pipeline.search(query, { strategy: "multi-signal" });  // ✅

// 2. LIKE 查询作为中文回退（FTS5 无结果时降级）
if (results.length === 0) {
  results = await storage.fallbackSearch(query);  // 纯 LIKE %keyword%
}

// 3. 实体提取统一使用 entity-extractor
import { extractEntities } from "../../utils/entity-extractor.ts";  // ✅
// ❌ 禁止自己写中文正则提取实体
const entities = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];

// 4. 英文词干还原使用 bm25.ts 中已有的 lemmatizer
import { stem } from "../../utils/bm25.ts";
```

### 14. 当前架构债务清单

以下为已识别的违规项，新功能**不要增加**同类问题，已有问题逐步修复：

#### 14.1 features/ 超 200 行 ✅ 已修复

所有 29 个 `features/*/tool.ts` 均 ≤ 169 行。5 个原大文件拆分为子模块：

| 文件 | 原行数 | 现tool.ts | 子模块 |
|:-----|:------:|:---------:|:-------|
| `features/cloud-sync/` | 330 | 153 | + `provider.ts` (224) |
| `features/conflict/` | 245 | 155 | + `formatter.ts` (51) |
| `features/multi-signal/` | 213 | 124 | + `formatter.ts` (82) |
| `features/retain/` | 223 | 55 | + `handlers.ts` (88) + `store.ts` (58) |
| `features/unify/` | 210 | 114 | + `provider.ts` (59) + `formatter.ts` (113) |

#### 14.2 utils/ 算法文件迁移 ✅ 已迁移

| 文件 | 行数 | 目标位置 | 状态 |
|:-----|:----:|:---------|:----:|
| `utils/bm25.ts` | 266 | `core/search/bm25.ts` + shim | ✅ |
| `utils/entity-extractor.ts` | 170 | `core/search/entity-extractor.ts` + shim | ✅ |
| `utils/memory-compactor.ts` | 210 | `core/compactor/index.ts` + shim | ✅ |
| `utils/noise-filter.ts` | 118 | `core/filter/noise.ts` + shim | ✅ |
| `utils/trivial-detector.ts` | 129 | `core/filter/trivial.ts` + shim | ✅ |
| `utils/memory-upgrader.ts` | 55 | `core/upgrader/index.ts` + shim | ✅ |

#### 14.3 features/ 直接引用 platform/ ✅ 已修复

所有 features/ 文件已改为引用 `storage/bridge.ts`（其 re-export 了 `createCompatDB`、`UnifiedDB`、`SQLiteRow`）。

同时 `core/` 下 `search/search.ts`、`import/import.ts`、`export/export.ts`、`tag/tag.ts` 以及
`features/unify/provider.ts` 的 platform 引用也已修复。

#### 14.4 hooks/ 超 200 行 ✅ 已拆分

| 文件 | 原行数 | 现行数 | 子模块 |
|:-----|:------:|:------:|:-------|
| `hooks/auto-recall.ts` | 408 | 195 | + `recall-config.ts` + `recall-scoring.ts` + `recall-session.ts` |
| `hooks/auto-capture.ts` | 488 | 169 | + `capture-pipeline.ts` (201) [先前已拆分: `capture-filter.ts`, `capture-content.ts`, `capture-watermark.ts`] |

#### 14.5 搜索工具统一到 SearchPipeline ✅ 已迁移

| 文件 | 旧模式 | 新模式 |
|:-----|:-------|:-------|
| `features/search/tool.ts` | `searchFTS(db.getRawDb())` | `pipeline.search(query, { strategy: "fts" })` |
| `features/search-timeline/tool.ts` | `db.search()` | `pipeline.search(query, { strategy: "fts" })` |
| `features/enhanced-search/tool.ts` | `db.hybridSearch()` / `db.rrfHybridSearch()` | `pipeline.search(query, { strategy: "rrf" })` |

#### 14.6 utils/ 大文件拆分 ✅ 已完成

| 文件 | 原行数 | 现行数 | 子模块/方案 |
|:-----|:------:|:------:|:-----------|
| `utils/cloud-adapter.ts` | 775 | 22 (barrel) | `cloud-adapter/{types,webdav,s3,sftp,samba,factory}.ts` (35~133 行) |
| `core/search/multi-signal.ts` | 319 | 13 (barrel) | + `signal-fusion.ts` (177) + `multi-signal-formatter.ts` (42) |
| `core/conflict/detect.ts` | 300 | 17 (barrel) | + `types.ts` + `detection.ts` + `relation.ts` + `formatter.ts` |
| `core/sentiment/index.ts` | 301 | 13 (barrel) | + `types.ts` + `lexicon.ts` + `analysis.ts` |

#### 14.7 utils/ shim 清理 ✅ 已完成



8 个旧 shim 文件在确认零引用后全部删除。旧 `__tests__/` 引用已迁移到规范路径。



| 删除的 shim | 原路径 → 规范路径 |

|:------------|:------------------|

| `utils/bm25.ts` | → `core/search/bm25.ts` |

| `utils/entity-extractor.ts` | → `core/search/entity-extractor.ts` |

| `utils/memory-compactor.ts` | → `core/compactor/index.ts` |

| `utils/noise-filter.ts` | → `core/filter/noise.ts` |

| `utils/trivial-detector.ts` | → `core/filter/trivial.ts` |

| `utils/memory-upgrader.ts` | → `core/upgrader/index.ts` |

| `utils/rrf.ts` | → `core/search/rrf.ts` |

| `utils/sentiment.ts` | → `core/sentiment/index.ts` |



#### 14.8 db-compat.ts 拆分 ✅ 已完成

| 文件 | 原行数 | 现行数 | 子模块 |
|:-----|:------:|:------:|:-------|
| `utils/db-compat.ts` | 343 | 188 | + `utils/file-db.ts` (169) FileDB 类独立 |

#### 14.9 剩余大文件（下阶段候选）



`utils/` 和 `core/` 仍有以下 ≥200 行的文件，暂不做拆分：



| 文件 | 行数 | 不动原因 |

|:-----|:----:|:---------|

| `utils/db-compat.ts` | 343 | 平台兼容层，接口稳定 |

| `storage/bridge.ts` | 315 | 统一 DB 桥接，接口稳定 |

| `core/graph/graph.ts` | 288 | 图算法，逻辑紧密 |

| `core/search/bm25.ts` | 266 | 算法文件，内部结构紧凑 |

| `core/verify/verify.ts` | 234 | 验证逻辑，模块化程度高 |

| `core/app.ts` | 230 | 启动编排，保持单文件可读 |

| `core/quality/quality.ts` | 221 | 质量评估，逻辑耦合 |

| `core/compactor/index.ts` | 210 | 压缩逻辑，已迁移至 core/ |

| `core/trends/trends.ts` | 204 | 趋势分析，后续考虑 |



其余 `utils/` 中的 210~260 行文件（embedding, llm-client, memory-store 等）保持现状。
| `core/` | 纯算法函数、计算逻辑 | `import fs/path`, `import platform/`, 直接 DB 操作 |
| `storage/` | DB 操作、SQL、向量操作 | 业务逻辑、格式化输出、情感分析 |
| `features/` | 参数校验、格式化输出、log | 算法实现、SQL、直接平台调用 |
| `hooks/` | 事件监听、编排调用 | 算法实现、SQL |
| `utils/` | 纯工具函数、日志、配置、缓存 | 算法逻辑（核心算法必须放在 core/） |

### 16. 测试要求

| 层 | 测试策略 | 示例 |
|:---|:---------|:-----|
| `core/` | ✅ 必须单元测试 | `additiveScoreAndRank()` 纯函数测试 |
| `storage/` | ✅ 必须（使用 in-memory DB） | `fts.search()` 返回正确结果 |
| `features/` | ❌ 不做单元测试 | 通过集成测试覆盖 |
| `hooks/` | ❌ 不做单元测试 | 通过集成测试覆盖 |
| `optional/` | ❌ 不做单元测试 | 通过集成测试覆盖 |

---

## 第三部分：常见违规模式

以下是历史上出现过的违规模式，新开发**坚决避免**：

### ❌ 模式 1：功能逻辑塞入 features/tool.ts

```typescript
// 错误：tool.ts 包含算法逻辑
async function execute(params) {
  const df = computeTfIdf(params.query);  // ← 算法应在 core/
  const doc = db.prepare("SELECT...");    // ← SQL 应在 storage/
}

// 正确：tool.ts 只做编排
execute: withErrorHandling(async (id, params) => {
  const algorithmResults = computeTfIdf(params.query);  // core/
  const dbResults = storage.search(query, limit);        // storage/
  return {
    content: [{ type: "text", text: formatResults(algorithmResults, dbResults) }],
  };
});
```

### ❌ 模式 2：新功能直接写在 entry/index.ts

```typescript
// 错误：entry/index.ts 里做功能初始化
if (config.myFeature?.enabled) {
  initMyFeature(api);  // ← 应在 core/app.ts 或 FeatureRegistry
}

// 正确
// optional/features/my-feature.ts 中定义
// core/app.ts 中 registry.register(myFeatureFeature);
// registry.initAll(api, config);
```

### ❌ 模式 3：绕过 storage/ 直接操作数据库

```typescript
// 错误
import { createCompatDB } from "../../platform/db/compat.ts";
const db = createCompatDB(dbPath);
db.prepare("SELECT...");

// 正确
const results = storage.search(query, limit);
```

### ❌ 模式 4：重复造轮子

```typescript
// 错误：在 features/xxx/tool.ts 里写实体提取
const entities = text.match(/[A-Z]\w+/g) || [];

// 正确
import { extractEntities } from "../../utils/entity-extractor.ts";
const entities = extractEntities(text);
```

### ❌ 模式 5：超大单文件

```typescript
// 错误：300+ 行的文件
// 正确：拆分为 <200 行的子模块
// hooks/xxx/
// ├── index.ts   （编排器，~100行）
// ├── sub-a.ts   （子逻辑A）
// └── sub-b.ts   （子逻辑B）
```

### ❌ 模式 6：忽视模块迁移 4 步流程

```typescript
// 错误：直接删除旧文件，不创建 shim
// git rm src/utils/rrf.ts

// 正确：先创建 shim 再通知消费者迁移
// src/utils/rrf.ts
export * from "../core/search/rrf.ts"; // 保留至少一个大版本
```

### ❌ 模式 7：全局单例 / 模块级状态

```typescript
// 错误：全局单例
const db = new Database(path);  // ❌ 无法测试，无法替换

// 正确：工厂函数传参
export function createMyFeature(storage: Storage) {
  // 使用传入的 storage，不自己创建
}
```

### ❌ 模式 8：向用户暴露内部错误

```typescript
// 错误
try { ... } catch (err) {
  return `Error: ${err.message}`;  // ❌ 可能暴露 SQL / 堆栈
}

// 正确
try { ... } catch (err) {
  console.error("[save]", err);  // 记录调试日志
  return "记忆保存失败，请稍后重试";  // 返回用户友好信息
}
```

---

## 第五部分：版本规划

```
v2.0.0（当前）
  ├─ storage/ 层拆分（629行 → 5个模块794行）
  ├─ core/app.ts 统一启动编排
  ├─ SearchPipeline 统一搜索入口
  ├─ 6 个算法文件从 utils/ 迁移到 core/（bm25, entity-extractor, memory-compactor, noise-filter, trivial-detector, memory-upgrader）
  ├─ auto-capture 拆分为 4 个模块，auto-recall 拆分为 4 个模块
  ├─ 8 个 features/ 的 platform/ 引用全部修复
  ├─ 3 个搜索工具统一到 SearchPipeline
  ├─ 5 个大 features/ 文件拆分为 tool+子模块模式
  ├─ cloud-adapter.ts 775行 → 6 子模块（types+webdav+s3+sftp+samba+factory）
  ├─ core/search/multi-signal.ts 319行 → signal-fusion + formatter
  ├─ core/conflict/detect.ts 300行 → types + detection + relation + formatter
  ├─ core/sentiment/index.ts 301行 → types + lexicon + analysis
  ├─ 8 个旧 shim 文件全部删除（utils/bm25, entity-extractor, memory-compactor, noise-filter, trivial-detector, memory-upgrader, rrf, sentiment）
  ├─ 462 个单元测试全部通过
  └─ DEVELOPER_GUIDE.md（本文件 + 完整债务清单）

v2.1.0（待定）
  ├─ entry/index.ts 精简到 <20 行
  ├─ core/app.ts 启动流程重构
  ├─ memory_store 移入 storage/
  ├─ 更多 optional/ 功能转为 FeatureRegistry 管理
  └─ 扩展测试覆盖率
```

---

_本文件为 yaoyao-plugin 架构方案与开发要求的正式文档。所有开发活动以此为准，重大偏离需团队评审。_
