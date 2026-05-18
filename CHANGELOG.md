# Changelog

## v1.6.0 (2026-05-18)

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

### ⚠️ 升级注意事项（v1.5.x → v1.6.0）

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
