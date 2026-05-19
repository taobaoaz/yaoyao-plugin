# Changelog

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
