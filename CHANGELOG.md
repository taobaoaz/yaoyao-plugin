# Changelog
## v1.9.1 (memory-celia 共存 · 双环境自适应 · 2026-06-27)

### 背景
华为小艺 Claw 环境的官方记忆插件 `memory-celia` 会独占 `memory` 槽位（`openclaw.json`
的 `slots.memory = "memory-celia"`）。此前 yaoyao 因声明 `kind: "memory"` 与之竞争，
在该环境被强制关闭——coexist 检测虽能识别，但 bootstrap 未消费该信号，仅打日志。

### A coexist 检测真正生效
- `coexistence.ts`：`CoexistState` 增 `slotOwner` 字段；`_checkConfigSlotOwner`
  返回具体占用者 id（如 `memory-celia`）；新增 `getSlotOwner()` / `isCeliaActive()`
- `app.ts` bootstrap 接入降级：coexist 时自动关闭 `capture` / `recall` /
  `heartbeat`（避免与官方双写 L0、双注入 prompt），保留 40 工具作按需增强层
- monitor 增 `applyCoexistState`，slotOwner 变化也触发回调

### B celia 委托 + 强取层（可选，配置开关）
- `celia/client.ts`：stdio JSON-RPC 2.0 MCP 客户端，spawn `celia_memory_mcp_server`
  二进制，指数退避重启（1s→30s，10 次，30s 稳定窗口），懒启动单例
- `celia/tool-map.ts`：重叠工具（save/search/forget/list）的 yaoyao→celia
  参数映射；atomic_fact 等 action 型工具不委托
- `celia/delegate.ts`：`wrapWithCeliaDelegate` 高阶函数，委托失败自动
  fallback 回 yaoyao 自实现（绝不因 celia 故障中断）
- `celia/proxy-tools.ts`：把 celia 独有能力暴露为 yaoyao 工具——
  `memory_dream_status/trigger/summary`、`memory_scene_load/list`、
  `memory_global_summary`、`memory_flush_celia`（delegate 模式，7 个，标注 `[via celia]`）；
  另 `createCeliaReadOnlyTool` 注册 `memory_celia_browse`（read-only 模式，1 个）
- `celia/db-reader.ts`：read-only 模式只读 celia 库（`mem_atomic` /
  `mem_conversation` / `mem_global` / `mem_l1_index`），供 `memory_celia_browse` 查询
- `tools/index.ts` 消费 `celiaBridge.mode` 字段三路分发：
  `delegate`（spawn+委托+proxy）/ `read-only`（不 spawn，只读 browse）/
  `enabled:false`（跳过）；delegate 下二进制缺失自动降级 read-only

### C 配置
- `openclaw.plugin.json` configSchema 新增 `celiaBridge`（enabled / mode /
  serverBinaryPath / dbPath），默认 `enabled:false`——空环境/不关心 celia 的用户零影响
- `celia/mode.ts`：mode 归一化，`read-only` / `readonly` / `read_only`（大小写、
  连字符/下划线/空格无关）统一识别为只读模式。修复生产环境配置指南拼写不一致
  （`readonly`）导致误走 delegate 分支的问题。configSchema 的 mode enum 同步增加
  `readonly` 别名

### D bug 修复（潜伏）
- `celia/db-reader.ts` / `celia/client.ts` 移除 TypeScript parameter property
  （`constructor(private x)`）——`--experimental-strip-types` 运行时不支持，会导致
  目标环境模块加载即崩溃。改显式字段赋值。

### E 首次对话自动引导（agent 自主发现）
- `features/setup/detector.ts`：自检运行模式 / 共存桥未开 / 数据空 / 向量未启用 /
  能力警告，返回结构化 findings
- `features/setup/guide.ts`：渲染为「首次对话提示」（精简，注入 prompt）和
  「完整报告」（memory_setup 工具返回）两种形态
- `features/setup/state.ts`：签名去重——按配置状态签名记录"已引导"，配置实质变化
  才再提示一次；FS 错误静默降级为"未引导"（绝不阻塞启动）
- `hooks/setup-guide.ts`：`before_prompt_build` 首次注入引导，**独立于 coexist 的
  capture/recall/heartbeat 降级**（首次引导优先级更高，始终注册）
- `memory_setup` 工具（#39）：agent 可随时复查配置状态，返回优化建议 + install-guide 路径

### 测试
- 新增 `celia-tool-map.test.ts`（12 例）+ `coexistence-celia.test.ts`（4 例，
  隔离 HOME 子进程验证端到端检测）+ `celia-readonly.test.ts`（9 例，临时 celia 库
  验证 db-reader 与 browse 工具）
- 空环境回归全绿（降级/委托逻辑被 coexist + celiaBridge.enabled 双重门控）

## v1.9.0 (DB 接管 · 自适应 TTL · 2026-06-14)

### L2 接管：DB 统一到 main.sqlite
- 5 张表加 `yaoyao_` 前缀（meta / fts / tags / config / vec / vec_meta）
- 3 个公开视图（yaoyao_memories / yaoyao_tags_view / yaoyao_overview）
- 默认路径 `~/.openclaw/memory/main.sqlite`，可经 `config.yaoyao.dbPath` 或 `YAOYAO_DB_PATH` 覆盖
- 一次性幂等迁移（ATTACH + 列交集 INSERT），从 `yaoyao_memory` / `yaoyao_fts` 等旧表无损迁入

### A 记忆冲突自动消解
- `src/utils/auto-resolver.ts` + `src/features/auto-resolve/tool.ts`
- 评分公式：`0.45·recency + 0.30·source + 0.15·access + 0.10·importance`
- 败者写入 `meta.superseded_by`，胜者累积 `meta.supersedes`（双向追踪）
- 新增 `memory_auto_resolve` 工具，可手动触发批量化解

### B 自适应 TTL（按记忆类型）
- `TTL_DAYS_BY_MEMORY_TYPE` 表（fact=180 / preference=60 / event=30 / entity=180 / goal=90 / relationship=90 / behavior=90 / general=90）
- `getTtlDaysByType()` 由 `tier-manager.ts` 导出
- `startup-tasks.ts` 在 tier 评估时按类型读取 TTL

### 修复与质量
- `tier-manager.ts` 历史 bug：原本读 `metadata` 列，改为读 `meta` 列
- 迁移 `runMigrationV190` 列交集计算：避免 v1.9.0 新增列在 legacy 中不存在时静默迁 0 行
- `createBackup()` 补 `dbPath` 形参（v1.9.0 备份走 main.sqlite）
- 已注册工具：**39 个**（新增 `memory_auto_resolve`）+ 1 hidden
- 全功能测试套：**761 个测试全部通过**

## v1.8.4 (本地 OpenClaw SDK Stub · 2026-06-14)

### 修复外部依赖丢失
- 插件 entry 与 42 个内部模块原本从 `openclaw/plugin-sdk/plugin-entry` 导入，host 之外环境（git clone / 干净机器 / CI）无法解析，OpenClaw 静默丢掉插件
- 新增 `src/openclaw-sdk/plugin-entry.ts` 身份函数 stub，复刻真实 SDK 类型表面
- 42 个文件 import 路径改写为相对路径指向本地 stub
- `src/types/openclaw.d.ts` 删除（不再需要 ambient 声明）
- `healthcheck.ts` / `install-check.ts` 改为从本地 stub 读版本号
- 全功能测试套：**732 个测试全部通过**

## v1.8.3 (多模态记忆 · 2026-06-14)

### 多模态记忆（hidden · 测试中）
- `src/features/multimodal/`：types / storage / processor / tool 四件套
- 支持 image / audio / video 三种模态，按 `config.multimodal.enabled` 注册
- 文件系统落盘（`index.json` + `meta/<id>.json` + `content/<id>.<ext>`），原子写
- 6 个动作：save / get / list / search / link / delete
- 60 个多模态单元测试，全功能测试套升至 **670 个**

## v1.8.2 (XiaoYi 架构适配 · 2026-06-14)

### 小艺 Claw 全局架构适配
- 环境检测分层扩展：openclaw-xiaoyi 作为 openclaw 的加性层
- Channel/device 上下文感知（a2a / websocket / standard + pad/phone/tablet）
- Skills 输出和设备工具调用的 capture meta 标记
- MEMORY.md / USER.md / IDENTITY.md 等 workspace 配置文件读写
- Hardened 安全环境检测（secret-guardian + execution-validator）
- 通用 claw-core 共存检测（UDS / 配置槽位 / core_skills）

### 论文驱动的记忆增强
- **FadeMem**（ICLR 2025）：激活衰减 + 竞争性记忆巩固
- **MemX**（arXiv 2604.02176）：上下文长度自适应检索（EntropyRouter）
- **RecMem**（arXiv 2603.02758）：双向参考路径解码

### SmartVector 四信号融合
- BM25 + 向量 + 时间衰减 + 重要性 的七因子价值函数
- Dual Process 情景缓存（System 1 快路径 / System 2 慢路径）

### 测试与工具
- 全功能测试套：**610 个测试全部通过**
- 已注册工具：**38 个**（含 v1.8.0 memory_workspace + memory_analyze）
- TypeScript 严格模式零错误

## v1.7.8 (SRMU 记忆反传播 · 2026-06-08)

### 🧬 SRMU: 记忆反传播 (Memory Back-Propagation)

基于论文 *Self-Reinforcing Memory Units* (SRMU) 的核心机制，新增三层记忆守卫：

- **RelevanceGate** — SRMU 风格的复合评分过滤：信息密度 + 新颖性 + 时间衰减 + 内容复杂度四维评分。重复内容自动降权（timeDecay），过度重复直接拦截（repeatBlockThreshold），短噪声（<5 tokens）零容忍。
- **SemanticShiftDetector** — 轻量滑动窗口主题漂移检测。连续 N 次语义漂移自动触发 flush，空闲超时自动 flush，支持短内容跳过和 disabled 降级。
- **MemoryBackprop** — A-Mem 风格的交叉记忆关系检测。新记忆写入时自动扫描已有记忆，识别 4 种关系：`reinforces`（强化）、`supersedes`（替代）、`contradicts`（矛盾）、`elaborates`（细化）。使用 trigram 相似度 + 否定词检测，低内存 O(1) 指纹缓存防止循环。

### 🧪 测试

- 新增 28 个单元测试（3 个新测试模块）：RelevanceGate (9)、SemanticShiftDetector (11)、MemoryBackprop (8)
- 全部零依赖，`node:test` 原生运行
- TypeScript 严格模式零错误
- 全套测试总数：**698 个**

---

## v1.7.4 (论文驱动增强 · 2026-06-08)

### 🧬 MemGAS: 多粒度记忆关联 (arXiv:2505.19549)

- **GMM 聚类引擎** — EM 算法对新记忆进行主题聚类，滑动窗口增量训练，冷启动安全
- **聚类标签** — 每条记忆写入时自动标记 `cluster:<id>:conf:<f>`，GMM 每 N 条捕获自动重训练
- **熵路由** — 分析查询长度/实体数/精确词/宽泛词，计算熵值 [0,1]，自动调整 maxResults/minScore
- **多粒度分层 (C2)** — L0(熵<0.3：窄搜5条/30s TTL)/L1(0.3-0.7：中搜10条/5min)/L2(≥0.7：宽搜20条+聚类扩展/不缓存)
- **聚类扩展 (B5)** — L2 层按聚类标签拉取同簇记忆，分数折扣 + 去重

### ⚡ SkVM: 智能缓存与模式固化 (arXiv:2604.03088)

- **工具调用缓存 (P0)** — 复合键 (tool+params) 缓存 + TTL 失效，内存捕获时自动失效；L2 全局缓存 + 每 hook LRU 兜底
- **分层 TTL (C3)** — L0=30s / L1=5min / L2=不缓存，按搜索粒度精细化缓存策略
- **短路由 (B6)** — 预检模式是否已训练，跳过重复刷新，返回 fallback 原因统计
- **模式检测 (B1/B2)** — 追踪反复出现的工具调用链，为 JIT 固化做准备
- **召回模式追踪 (B4)** — FNV-1a 哈希摘要，不存原始查询文本，4 种事件类型
- **结构化日志** — requestId + duration + outcome 统一日志格式，可聚合可审计

### 🏗️ 系统架构感知与共存

- **自动检测** — 读取 OpenClaw 全局配置，检测 memory/contextEngine 槽位归属
- **共存模式** — 支持与 claw-core/xiaoyiclaw 共存，自动选择策略（full / l0-only / supplement / disabled）
- **运行时 UDS 监控** — 动态检测架构变化，支持运行时策略切换

### 🧪 测试

- **670 单元测试**（+44 个新测试），TypeScript 严格模式零错误

---

## v1.7.3 (开发中)

### 🔗 图结构记忆 (Phase 1)
- **记忆关系图谱** — 支持 4 种关系类型：
  - `supersedes` — 新记忆替代旧记忆
  - `related` — 语义关联
  - `causes` — 因果关系
  - `part_of` — 部分-整体关系
- **BFS 图遍历** — `memory_graph_relation` 工具支持 1-3 跳关联搜索
- **Mermaid 图导出** — 可视化记忆关系网

### 🧬 原子事实提取 (Phase 2)
- **SPO 结构化提取** — subject-predicate-object 三元组
- **3 种提取模式** — regex (Lite) / llm (Full) / hybrid (自适应)
- **实体索引** — 按主语/宾语快速检索事实
- **`memory_atomic_fact` 工具** — 提取/查询/总结原子事实

### 🎯 查询自适应 (Phase 3)
- **查询分类器** — 自动识别概念/时序/因果/实体查询
- **动态权重调整** — 根据查询类型优化搜索策略：
  - 概念查询 → 语义权重 50%
  - 时序查询 → 时间权重 45%
  - 因果查询 → 图遍历权重 45%
  - 实体查询 → 实体匹配权重 45%
- **`memory_adaptive_search` 工具** — 返回分类结果和调整后的权重

### 💡 技能学习 (Phase 4)
- **调用模式追踪** — 记录工具调用频率、耗时、参数签名
- **4 类优化建议** — shortcut / optimization / automation / new_feature
- **`memory_skill_analytics` 工具** — 分析使用模式并生成建议

### 📊 基准测试 (Phase 5)
- **8 个测试用例** — 覆盖 single-hop / multi-hop / temporal / open-domain
- **3 种难度** — easy / medium / hard
- **评分系统** — 精确匹配 + 部分匹配
- **`memory_benchmark` 工具** — 运行回归测试并生成报告

### 🛠️ 工具总数 26 → 31
新增 5 个 AI 可调用的记忆工具

## v1.7.2 (2026-05-19)

### 🔍 定时重置风险检测与 Cron 管理
- **reset-detector 模块** — 自动检测环境中可能定时重置记忆的机制：
  - OpenClaw `slots.memory` 冲突检测（内置 memory-core vs yaoyao）
  - OpenClaw `session.reset` 配置扫描（daily/idle 模式、重置时间）
  - 系统 crontab / systemd timer 扫描
  - 其他插件配置中的 retention/cleanup/reset/prune 字段检测
  - yaoyao 自身 `cleanup.l0l1RetentionDays` 激进策略检测
- **memory_cron 工具** — 统一接管定时任务管理：
  - `list` — 列出 OpenClaw cron、系统 crontab、systemd timers
  - `detect` — 检测与记忆系统冲突的定时任务
  - `suggest` — 给出优化建议（整点偏移、冲突移除）
  - `disable` — 生成禁用冲突任务的配置（用户确认后手动应用）
- **启动时自动检测** — `core/app.ts` 启动时自动运行 `detectScheduledResetRisks()`，风险输出到日志

### 🧱 架构规约持续执行
- **大文件拆分** (12 files):
  - `utils/backup.ts` 223→82 + backup-create.ts + backup-restore.ts
  - `utils/session-compressor.ts` 223→102 + compressor-core.ts + compressor-helpers.ts
  - `core/trends/trends.ts` 223→97 + trends-formatter.ts + trends-stopwords.ts
  - `core/quality/quality.ts` 223→101 + quality-dedup.ts + quality-report.ts
  - `utils/healthcheck.ts` 211→189 + healthcheck-formatter.ts + healthcheck-stats.ts
  - `utils/chunker.ts` 212→76 + chunker-core.ts + chunker-split.ts
  - `utils/session-recovery.ts` 216→147 + session-recovery-paths.ts + session-recovery-read.ts
  - `platform/db/file.ts` 219→173 + file-search.ts
- **全部文件 <200 行** ✅
- **友商经验对照表** 从 `DEVELOPER_GUIDE.md` 删除

## v1.7.0 (2026-05-18)

### 📖 Memory-System Enhancements
- **core/search/intent.ts** — Query intent classifier + dynamic weight profiles (entity/temporal/relational/exploratory)
- **core/search/pipeline.ts** — New `"intent-driven"` strategy with intent-weighted composite re-ranking
- **core/memory-types.ts** — Rule-based memory type tagging at capture time (preference/fact/event/entity/goal/relationship/behavior)
- **utils/capture-debouncer.ts** — Debounced capture queue: merges rapid successive events within configurable window (default 3s)
- **hooks/recall-config.ts** — Per-agent overrides (maxResults/scoreThreshold/queryPrefix/recall filter), query prefix enhancement
- **hooks/auto-recall.ts** — Intent-driven search strategy, model-based secondary recall filtering (OpenAI-compatible), agent-aware cache keys
- **hooks/auto-capture.ts** — Capture debouncer integration, fully async L0+L1+L2 persist pipeline
- **utils/retrieval-trace.ts** — Support `"intent-driven"` mode in RetrievalTrace type

### 🧱 Architecture Cleanup — 大文件拆分 & 严格模式
- **大文件拆分** (8 files):
  - `utils/cloud-adapter.ts` 775→6 子模块 (types/webdav/s3/sftp/samba/factory)
  - `core/search/multi-signal.ts` 319→177+42 (separate formatter)
  - `core/conflict/detect.ts` 300→85+64+49+41 (types/detection/relation/formatter)
  - `core/sentiment/index.ts` 301→128+90+11 (types/lexicon/analysis)
  - `core/app.ts` 230→95+178 boot/ 子模块 (orchestrator + 6 steps)
  - `entry/index.ts` 33→19 lines
  - `utils/db-compat.ts` 343→188 + `utils/file-db.ts` 169 (FileDB class extracted)
  - `utils/bm25`, `entity-extractor`, `memory-compactor`, `noise-filter`, `rrf`, `sentiment`, `memory-upgrader`, `trivial-detector` → all shimmed then deleted
- **TypeScript strict mode** — 31 errors fixed (6 files): catch types, `as any` elimination, optional chaining, null handling
- **`as any` 全面消除** — 13→0 across features/conflict, enhanced-search, boot/steps, auto-capture, auto-recall
- **重复函数清理** — removed duplicated `clampNum` in hnswlib (use shared import)
- **架构规约严格化**:
  - `features/` 直接引用 `platform/` 计数: 0 ✅
  - `hooks/` 直接引用 `platform/` 计数: 0 ✅
  - `utils/` 算法 shim 残留: 0 ✅
  - 大文件上限: 315 行 (storage/bridge.ts)

### 🧪 测试覆盖大幅提升
- **526 tests (+45 new)**, 0 fail:
  - `file-db.test.ts` — FileDB CRUD, 持久化, 损坏恢复 (10 tests)
  - `db-compat.test.ts` — 能力检测, 工厂函数 (4 tests)
  - `backup.test.ts` — 全量/增量备份, 恢复, 清理 (7 tests)
  - `memory-cleaner.test.ts` — 配置验证, cleanup 执行 (10 tests)
  - `llm-client.test.ts` — 模型检测, SSRF 保护, mock API 调用 (14 tests)
  - `fts.test.ts`, `hybrid.test.ts`, `schema.test.ts` — storage 层测试 (19 tests)
- 高覆盖率覆盖高风险 I/O 文件: db-compat, embedding, backup, llm-client, memory-cleaner

### 📚 文档与开发者体验
- `DEVELOPER_GUIDE.md` — v2.0.0 架构基线, 完整架构债务清单 (14.1-14.8)

### ⚠️ 升级注意事项（v1.5.x → v1.7.0）

1. **测试数量变化** — 从 481 增加到 526。如果自行修改过源码，pull 后运行 `npx tsc` 可能因 strict 模式新增约束而编译失败（原允许 `as any` 处现报错）。建议升级后执行 `git pull && npm test` 确认无回归。

2. **`dist/` 必须同步** — 架构重构新增 53 个 dist 文件（`core/app.js`、`core/boot/`、`hooks/capture-*`、`storage/` 等），均需提交到 git。正常 `git pull` 不受影响，但 shallow clone 或子模块场景需注意同步完整。

3. **旧 shim 文件已删除** — `utils/bm25.ts`、`utils/sentiment.ts`、`utils/rrf.ts` 等 8 个 shim 文件已物理删除。外部代码若直接 import 这些路径（而非通过 barrel index.ts）会找不到模块。

4. **lifecycle-check.sh 路径变更** — 脚本检查路径从 `dist/core/` 改为 `dist/src/core/`。若本地运行 lifecycle check，确保脚本已更新。

5. **OpenClaw 版本范围扩大** — 最低兼容从 `>=2026.5.5` 扩展到 **`>=2026.4.2`**，覆盖 v4.2 至今的全系列版本。

---

## v1.5.1-beta3 (2026-05-17)

### 🔧 Pre-release bump
- Version bump to v1.5.1-beta3 for next iteration.

## v1.5.1-beta2 (2026-05-17)

### 🔧 Fixes (Step 1 — Code Quality)
- 27 tool modules: added required `id` field for OpenClaw tool registration compatibility
- `forget`: file deletion before DB record removal (prevents orphan records)
- `list`: `offset`/`sort` parameters added to JSON Schema properties
- `recommend`/`graph`: added mtime-based scene cache to avoid re-reading directories on every call
- `unify`: simplified `queryOpenClawDB` connection management (removed redundant per-call open/close)
- `quality`: `db.search("", 50)` → `db.search("*", 50)` to avoid undefined FTS5 empty-string behavior

### 🚀 Performance (Step 2)
- `db-bridge`: hourly `PRAGMA wal_checkpoint(PASSIVE)` to prevent unbounded WAL growth
- `auto-recall`: capped `_sessionContextKeywords` to 100 sessions (LRU eviction) to prevent memory leak
- `embedding`: concurrency limiter (max 2 inflight requests) with queue to avoid upstream API bombing
- `entry/index`: saved `setTimeout` reference for cleaner scheduling, properly cleared on `gateway_stop`
- `import/tool`: unified `PRAGMA cache_size = -65536` (consistent with main connection)

### 🔗 Compatibility (Step 3)
- `_crossSessionContext`: added existence check before writing to avoid clobbering other plugins' data

### v1.5.1-beta2 — 462 tests pass / 0 fail

## v1.5.1 (2026-05-14)

### 🔒 Security Hardening (Phase 12 — P0/P1)

**File System Security**
- `memory-store.ts`: directory creation with `0o700` (owner-only), file writes followed by `chmodSync(fp, 0o600)`
- `memory-store.ts`: `validateMemoryDir()` enforces absolute paths and rejects `..` segments (path traversal prevention)

**Credential Protection**
- `mask-config.ts` (new): `maskSensitive()` recursively masks apiKey/token/password/secret in config objects; `maskAuthHeader()` masks `Authorization: Bearer <token>` headers
- `entry/index.ts`: startup embedding config logs now go through `maskSensitive()` before output

**SSRF Prevention**
- `embedding.ts`: `isForbiddenHost()` blocks localhost/127.0.0.1/0.0.0.0/::1/169.254/192.168/10./172./fc00/fe80; throws `SecurityError` on match
- `llm-client.ts`: identical SSRF guard applied to explicit LLM configs and embedding-auto fallback paths

**Supply-Chain Risk Elimination**
- `entry/migration.ts`: removed `execSync("git clone https://github.com/taobaoaz/yaoyao-soul.git")` and `execSync` import entirely
- Migration now detects legacy state and prints manual-install instructions only; no automatic remote code execution

**SQL/FTS5 Safety Clarification**
- `db-bridge.ts`: added inline comments clarifying `sanitizeFTSQuery` is **syntax safety** (prevents FTS5 parse errors), NOT SQL injection defense; actual injection defense is `prepare()` + parameterized queries

### 🛡️ Defensive Programming (Phase 11)

**DB Layered Degradation**
- `platform/db/compat.ts`: native → npm → file-db cascading fallback; any single backend crash auto-downgrades without killing the plugin

**Network Fault Isolation**
- `utils/embedding.ts`: `embed`/`embedBatch` wrapped in try/catch; timeouts produce graceful errors instead of crashing the session
- `utils/llm-client.ts`: `chat()` fetch wrapped with `AbortError` detection

**Type System Hardening**
- Eliminated 114+ `any` types across codebase; all `catch (e: any)` → `catch (e: unknown)` with safe `(e as Error).message` access
- SQL result types explicitly mapped: `SQLiteRow[]` instead of implicit `any`

### 🐛 Bug Fixes (42 audit findings + 1 self-found)

**Security (Critical)**
- `memory_import`: path traversal protection via `path.resolve()` + `startsWith(store.baseDir)`
- `cloud_adapter`: SFTP/Samba shell injection eliminated — all commands use `execFile()` with args array
- `cloud_adapter`: net use username double-quote escaped via `esc()` helper
- `memory_get`: symbol link bypass prevented via `fs.realpathSync()`

**Data Integrity (High)**
- `db_bridge`: orphan vector cleanup in `deleteByDate`/`deleteByKeyword` (`DELETE WHERE rowid NOT IN`)
- `db_bridge`: cosine similarity formula corrected to `1 - distance/2`
- `auto_recall`: time decay now uses `r.date` field instead of broken filename parsing
- `auto_capture`: empty/no-response assistant content indexed as `[空内容]` instead of garbage
- `note`/`save`: empty `asst_text` gracefully handled
- `sentiment`: negation prefixes (不/没/未) detected before joy/good matching — "不开心" no longer classified as joy
- `sentiment`: "呵呵" removed from `JOY_MARKERS`; word list deduplicated
- `embedding`: retry logic extended to cover `ECONNREFUSED`/`ETIMEDOUT`/system errors (not just `AbortError`)

**Resource & Connection (High)**
- `memory_tag`: now uses `db.getRawDb()` instead of opening independent `DatabaseSync`
- `memory_export`/`stats`: removed raw `new DatabaseSync()` — share bridge connection
- `memory_recommend`: replaced `db.prepare()` with `db.getRawDb().prepare()`
- `memory_import_workspace`/`import_oc`: fixed invalid `getConfig()`/`setConfig()`/`prepare()` calls
- `db_bridge`: `getStats()` no longer hardcodes `vecEnabled: true` — uses real init state
- `auto_recall`: session context LRU eviction (`MAX_SESSIONS=1000`, `MAX_CONTEXT_KEYWORDS=20`)
- `auto_recall`: resultCache periodic stale entry cleanup

**Runtime Robustness (Medium)**
- `memory_retain`: empty string FTS5 MATCH handled via `searchAll()` path
- `memory_search_enhanced`: keyword length capped at 100 chars before RegExp construction
- `llm_client`: AbortController timeout (30s) on all `fetch()` calls
- `embedding`: text slice reduced to 4000 chars (safer token approximation)
- `memory_graph`: cosineSimilarity length mismatch check; unified node IDs
- `auto_recall`: Jaccard dedup upgraded from character-level to token-level

### 🧹 Cleanup
- Dead code removed: `db-core`, `db-index`, `db-writer` (6 files, unconnected)
- Temp verification files cleaned (10+)

## v1.5.0 (2026-05-09)

### ✨ Features
- **34 tools** — unified naming: `memory_{action}` format for all tools
- **3 hooks** — auto-capture, auto-recall, pipeline-manager
- **Environment takeover** — `memory_import_oc` (OpenClaw chunks), `memory_import_workspace` (markdown files)
- **Anti-forgetting** — `memory_retain` detects important memories at risk of being forgotten
- **Adaptive capabilities** — self-detection banner, dimension auto-detect, feature degradation
- **Cloud backup** — `memory_cloud_sync` with SFTP/Samba/WebDAV/S3 support

### 🔧 Improvements
- **Recall enhancement**: time decay (30d half-life), diversity sampling (Jaccard dedup), context accumulation
- **Stability**: circuit breaker, timeout protection, write debounce, try-catch wrappers
- **Config**: 27 entries in memory_config table
- **Cron**: 3 jobs — patrol (6h), daily settle (10:00), weekly cleanup (Sun 11:00)

### 🐛 Fixes
- Security: SFTP/Samba/net use passwords moved to environment variables
- Tool naming: all tools unified to `memory_{action}` format
- Register function refactored: ~250→120 lines, 5 internal helpers extracted

## v1.2.1 (2026-05-06)

### ✨ Features
- **12 tools** + **2 hooks** — initial plugin release
- FTS5 hybrid search with sqlite-vec vector support
- Sentiment mood ring, memory timeline
- Scene management, user persona generation

### 🔧 Improvements
- Plugin runtime integration with OpenClaw Gateway
- Configuration schema (capture, recall, embedding, LLM, cleanup)
- SECURITY.md with moderation flag explanations

## v1.0.0 (2026-04-07)

### ✨ Initial Release
- Yaoyao Memory project launch
- SQLite FTS5 + vector search foundation
- Basic memory save/retrieve/search operations
- CLI tooling for memory management
