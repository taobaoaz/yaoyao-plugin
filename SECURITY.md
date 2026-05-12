# Security Disclosure — yaoyao-memory

> This document explains the moderation flags that may appear when installing this plugin from ClawHub.

## Moderation Flags

| Flag | Source | Explanation |
|------|--------|-------------|
| `suspicious.dynamic_code_execution` | `child_process` usage | Cloud backup adapters invoke system commands (`sftp`, `smbclient`, `net use`) for file transfer. **No arbitrary code execution.** All commands are hardcoded with fixed arguments. |
| `suspicious.llm_suspicious` | Optional LLM API calls | L1→L3 pipeline calls external LLM API (DeepSeek/OpenAI compatible) for memory extraction. Only enabled when user explicitly configures `llm.apiKey`. |
| `suspicious.vt_suspicious` | VirusTotal heuristic | Likely triggered by `child_process` imports. Source code is fully auditable. |

## Why These Are Safe

### 1. `child_process` — Cloud Backup Only

The `child_process` module is **only** used in `src/utils/cloud-adapter.ts` for cloud backup functionality:

| Adapter | Command | Purpose |
|---------|---------|---------|
| SFTP | `sshpass -e sftp` | File transfer to SFTP servers |
| Samba (Linux) | `smbclient` | File transfer to NAS/Samba shares |
| Samba (Windows) | `net use` | Map network drive for file copy |

**Security measures:**
- All commands use **hardcoded arguments** — no user-supplied strings in command templates
- Passwords passed via **environment variables** (`SSHPASS`, `PASSWD`), not command-line arguments (prevents `ps aux` exposure)
- All operations wrapped in `try-catch` with timeout limits (10-30 seconds)
- Cloud backup is **opt-in** — requires explicit credential configuration in `~/.openclaw/credentials/secrets.env`
- If no credentials are configured, cloud tools are silently skipped

### 2. LLM API Calls — User-Configured, Not Phoning Home

LLM calls are used for:
- **L1→L2 extraction**: Structuring raw conversation logs into scene blocks
- **L2→L3 persona generation**: Building user profile from interaction patterns

**Security measures:**
- LLM endpoint is **user-configured** (`llm.baseUrl`, `llm.apiKey` in plugin config)
- Default: `https://api.deepseek.com` — but only active when API key is provided
- Users can disable with `llm: { enabled: false }`
- No data is sent anywhere without explicit user configuration

### 3. Data Storage — 100% Local

| Data | Location | Format |
|------|----------|--------|
| Daily logs | `memory/YYYY-MM-DD.md` | Plain text Markdown |
| Search index | `memory/.yaoyao.db` | SQLite FTS5 |
| User profile | `memory/persona.md` | Plain text Markdown |
| Backups | `memory/.backups/` | Timestamped ZIP/JSON |
| Cloud credentials | `~/.openclaw/credentials/secrets.env` | Key=value (user-managed) |

**No telemetry. No analytics. No external data transmission without explicit configuration.**

## Architecture Isolation

yaoyao-memory operates in a **completely isolated** data space:

- Uses its own `.yaoyao.db` — does not touch OpenClaw's internal databases
- Reads/writes only within the configured `memory/` directory
- Does not interfere with OpenClaw's built-in memory systems (`memory-core`, `memory-lancedb`)
- Registered as a separate plugin with its own `openclaw.plugin.json`

## Dependency Audit

| Dependency | Source | Purpose |
|------------|--------|---------|
| `node:sqlite` | Node.js built-in (v22+) | FTS5 search index |
| `node:fs` | Node.js built-in | File I/O |
| `node:https`/`node:http` | Node.js built-in | WebDAV/S3 API calls |
| `node:crypto` | Node.js built-in | S3 AWS Signature V4 |
| `node:child_process` | Node.js built-in | SFTP/Samba cloud backup |
| `node:path` | Node.js built-in | Path manipulation |
| `sqlite-vec` | npm (optional) | Native SQLite extension for vector/KNN search |

**Minimal external dependency.** `sqlite-vec` is optional — without it, vector search gracefully degrades to FTS5-only hybrid ranking.

## Open Source

Full source code is available at: https://github.com/taobaoaz/yaoyao-plugin

All code is auditable. No obfuscation, no bundled binaries.

---

*Last updated: 2026-05-08*
