# yaoyao-plugin 模块化重构方案

> 目标：把"补丁式兼容"变成"平台层自适应 + 核心层纯逻辑"的干净架构。

---

## 为什么现在"一团乱"

| 问题 | 表现 | 根因 |
|---|---|---|
| **index.ts 太胖** | 400+ 行，注册/自检/迁移/banner/配置全塞在一起 | 没有入口分层 |
| **tools 各自 require 底层** | memory-tag、memory-import 等 8 个文件直接 `require("node:sqlite")` | 没有平台抽象层 |
| **utils 成了杂物筐** | db-compat、install-check、healthcheck、version-check 全挤在 utils/ | 没有按职责分层 |
| **hooks 直接操作实现** | auto-capture 直接调用 db-bridge.storeMeta() | hook 应该只发信号 |
| **兼容性代码散落** | 43 处 node:sqlite 硬编码，修一处漏一处 | 没有统一的"平台差异收口" |

---

## 目标架构：三层隔离

```
yaoyao-plugin/
├── src/
│   ├── platform/           ← 🆕 平台适配层 — "因为环境不同所以要特殊处理"的全在这里
│   │   ├── db/             # 数据库后端：node:sqlite / better-sqlite3 / file-db
│   │   │   ├── compat.ts   # (原 db-compat.ts 移入)
│   │   │   ├── native.ts   # node:sqlite wrapper
│   │   │   ├── npm.ts      # better-sqlite3 wrapper
│   │   │   └── file.ts     # FileDB fallback
│   │   ├── os/             # OS 差异：Windows 路径、locale、磁盘空间
│   │   │   └── compat.ts
│   │   ├── openclaw/       # OpenClaw API 版本适配
│   │   │   └── compat.ts   # 参数格式差异、缺少方法 graceful fallback
│   │   └── node/           # Node.js 版本适配（如果需要）
│   │       └── compat.ts
│   │
│   ├── core/               ← 🆕 平台无关核心 — 纯逻辑，零环境感知
│   │   ├── search/         # 搜索算法
│   │   │   ├── fts5.ts     # FTS5 查询构建
│   │   │   ├── vector.ts   # 向量搜索逻辑
│   │   │   ├── hybrid.ts   # 混合排序算法
│   │   │   └── fallback.ts # 降级搜索（纯文本匹配）
│   │   ├── store/          # 记忆存储抽象
│   │   │   ├── daily.ts    # L0 daily markdown 读写
│   │   │   ├── l1.ts       # L1 结构化存储（通过 platform/db 接口）
│   │   │   └── l2l3.ts     # L2/L3 场景/画像（文件系统）
│   │   ├── pipeline/       # L0→L1→L2→L3 管线
│   │   │   └── extractor.ts
│   │   └── model/          # 数据模型 + 类型
│   │       └── types.ts
│   │
│   ├── features/           ← 🆕 用户功能 — 每个功能一个目录，独立可测
│   │   ├── capture/        # 🪝 auto-capture hook
│   │   │   ├── hook.ts     # (原 hooks/auto-capture.ts)
│   │   │   └── store.ts    # 存储策略（调用 core/store/）
│   │   ├── recall/         # 🪝 auto-recall hook
│   │   │   ├── hook.ts     # (原 hooks/auto-recall.ts)
│   │   │   └── strategy.ts # 召回策略（调用 core/search/）
│   │   ├── search/         # 🔧 memory_search 工具
│   │   │   └── tool.ts
│   │   ├── export/         # 🔧 memory_export
│   │   ├── import/         # 🔧 memory_import + memory_import_oc
│   │   ├── tag/            # 🔧 memory_tag
│   │   ├── timeline/       # 🔧 memory_timeline
│   │   ├── mood/           # 🔧 memory_mood
│   │   ├── stats/          # 🔧 memory_stats
│   │   ├── backup/         # 🔧 memory_backup
│   │   ├── health/         # 🔧 memory_healthcheck
│   │   └── recommend/      # 🔧 memory_recommend
│   │
│   ├── entry/              ← 🆕 入口 — 极简，只负责组装
│   │   └── index.ts        # 200 行以内：检测平台 → 初始化核心 → 注册功能
│   │
│   └── utils/              ← 纯工具函数（无状态、无副作用、不 import platform/）
│       ├── clamp.ts
│       ├── config.ts
│       ├── esc-shell-arg.ts
│       └── version-check.ts
│
├── tests/
│   ├── platform/           # 测试各平台后端
│   ├── core/               # 测试纯逻辑（mock platform 接口）
│   └── features/           # 测试每个功能
│
└── docs/
    ├── ARCHITECTURE.md     # 架构文档
    ├── COMPATIBILITY.md    # 兼容性策略
    └── MIGRATION.md        # 升级迁移指南
```

---

## 核心原则

### 1. 平台层：所有"差异"收口

**规则**：只有 `platform/` 里的代码可以 `require("node:sqlite")`、`os.platform()`、`process.version`。其他层绝对禁止。

```typescript
// platform/db/compat.ts — 唯一允许 require("node:sqlite") 的地方
export function createDB(dbPath: string): UnifiedDB { ... }

// core/search/fts5.ts — 只接受 UnifiedDB 接口，不关心底层实现
export function searchFTS5(db: UnifiedDB, query: string): SearchResult[] { ... }
```

### 2. 核心层：零环境感知

**规则**：`core/` 里的代码不能 `import fs`、`import os`、`import path`。所有 IO 通过注入的接口完成。

```typescript
// core/store/daily.ts
export interface DailyWriter {
  append(date: string, content: string): void;
}

export function writeDaily(writer: DailyWriter, turn: ConversationTurn) { ... }
// 不 import fs，writer 由 platform 层提供
```

### 3. 功能层：只组装，不实现

**规则**：`features/` 里的工具只调用 `core/` 的逻辑 + `platform/` 的接口。不在功能层里写 SQL、写文件 IO。

```typescript
// features/search/tool.ts
import { searchHybrid } from "../../core/search/hybrid.js";
import { createDB } from "../../platform/db/compat.js";

export function createSearchTool() {
  const db = createDB(dbPath);  // ← 平台层
  return {
    execute(params) {
      return searchHybrid(db, params.query);  // ← 核心层
    }
  };
}
```

### 4. 入口层：只组装，不逻辑

**规则**：`entry/index.ts` 只做三件事：
1. 检测平台能力（调用 `platform/`）
2. 初始化核心（注入平台接口）
3. 注册功能（按能力开关）

```typescript
// entry/index.ts — 目标：200 行以内
export default definePluginEntry({
  register(api) {
    // 1. Platform detection
    const platform = detectPlatform();  // 200 行以内
    
    // 2. Core init (inject platform interfaces)
    const core = initCore({
      db: platform.db,
      writer: platform.dailyWriter,
      os: platform.os,
    });
    
    // 3. Feature registration (conditional)
    if (core.db.supportsFTS5) registerSearchFeature(api, core);
    if (core.db.supportsVec) registerVectorFeature(api, core);
    registerCaptureFeature(api, core);  // always works (daily md)
    
    // 4. Banner
    showBanner(platform, core);
  }
});
```

---

## 渐进迁移路线图

不是一次性重写。分阶段，每阶段可独立验证。

### Phase 1：收口 platform/db（已完成 80%）

- [x] `db-compat.ts` 已创建
- [ ] 拆分为 `platform/db/{native,npm,file}.ts`
- [ ] 所有 tools 不再直接 `require("node:sqlite")` — **已清理 8/8**
- [ ] `db-bridge.ts` 瘦身，只保留业务逻辑，移到底层适配到 `platform/db/`

**工作量**：中等（文件移动 + import 路径更新）
**风险**：低（逻辑不变，只是搬家）

### Phase 2：创建 core/ 层

- [ ] 提取 `core/model/types.ts` — 所有接口集中定义
- [ ] 提取 `core/search/` — 搜索算法从 tools 移入
- [ ] 提取 `core/store/` — 存储逻辑从 db-bridge/memory-store 移入
- [ ] `core/` 文件禁止 `import fs/os/path`

**工作量**：中等（需要重构一些耦合点）
**风险**：中（接口设计要一次对，后面改成本高）

### Phase 3：拆分 features/

- [ ] 每个 tool + 相关 hook 移入 `features/{name}/`
- [ ] hooks 从 `hooks/` 移入对应 feature 目录
- [ ] 功能间通过 `core/` 通信，不直接互相 import

**工作量**：大（文件多，import 路径全改）
**风险**：中（测试覆盖要跟上）

### Phase 4：入口瘦身

- [ ] `index.ts` 从 400 行 → 200 行
- [ ] 迁移逻辑移到 `features/migration/`
- [ ] 自检逻辑移到 `features/health/`
- [ ] banner 移到 `entry/banner.ts`

**工作量**：小（主要是剪切粘贴）
**风险**：低

### Phase 5：创建 platform/os + platform/openclaw

- [ ] `healthcheck.ts` 中的 OS 相关检查移到 `platform/os/`
- [ ] OpenClaw API 适配层 `platform/openclaw/compat.ts`
- [ ] 版本检查从 `utils/version-check.ts` 移到 `platform/node/`

**工作量**：中等
**风险**：低

---

## 先做哪一步？

我的建议：

1. **立刻做 Phase 1 收尾** — db-compat 已经基本做好了，只差拆成 `platform/db/` 的三个子文件。这一步风险最低，效果最显。

2. **然后做 Phase 4** — 入口瘦身，把 `index.ts` 里那堆迁移代码、自检代码切出去。这一步让用户（和其他开发者）第一眼看到的就是干净的入口。

3. **再做 Phase 2** — core 层设计要慎重，因为接口一旦定下来后面不好改。需要花时间设计 `UnifiedDB`、`DailyWriter`、`SearchEngine` 这些核心接口。

4. **最后 Phase 3** — features 拆分最耗体力，但有了 core 和 platform 之后，就是纯搬家。

---

## 一个具体例子：改完后的 memory_search

```
features/search/
├── tool.ts          # OpenClaw tool 定义（参数校验、调用 core）
├── formatter.ts     # 结果格式化（markdown 输出）
└── __tests__/
    └── search.test.ts  # mock core/search，不测平台层

core/search/
├── fts5.ts          # FTS5 查询构建（纯 SQL 逻辑）
├── vector.ts        # 向量查询逻辑
├── hybrid.ts        # 混合排序算法
├── fallback.ts      # 降级搜索（纯文本匹配）
└── __tests__/
    └── hybrid.test.ts    # 测算法，不依赖 SQLite

platform/db/
├── compat.ts        # 自动选择后端
├── native.ts        # node:sqlite wrapper
├── npm.ts           # better-sqlite3 wrapper
├── file.ts          # FileDB fallback
└── __tests__/
    └── compat.test.ts    # 测后端选择逻辑
```

`memory_search` 工具只接触 `core/search/hybrid.ts`，不接触任何 SQLite 细节。要加新后端（比如 `libsql`？`duckdb`？），只需要在 `platform/db/` 里加一个 wrapper，`core/` 和 `features/` 完全不用动。

---

你觉得这个方向对吗？要我先动手做 Phase 1 收尾（把 db-compat 拆进 platform/db/），还是你想先调整这个方案？
