# Changelog

## v1.5.1 (2026-05-12)

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
