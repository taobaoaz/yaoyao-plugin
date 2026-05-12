# Changelog

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
