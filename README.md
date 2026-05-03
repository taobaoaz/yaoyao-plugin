# Yaoyao Memory Plugin

搭载摇摇记忆引擎的四层记忆系统插件 — FTS5 + sqlite-vec 混合搜索 + 情感分析 + 时间线。

## Architecture

```
L0 — Daily conversation logs (memory/YYYY-MM-DD.md)
L1 — Structured memories + FTS5 index + sqlite-vec vector search (.yaoyao.db)
L2 — Scene blocks (contextual groupings via LLM)
L3 — Long-term persona (persona.md / MEMORY.md)
```

## Features

### Core
- **Auto-capture** — Each agent turn automatically recorded + FTS5 indexed
- **Auto-recall** — Relevant memories injected into prompt (FTS5 + optional vector hybrid)
- **Hybrid Search** — FTS5 full-text + sqlite-vec semantic similarity weighted scoring
- **LLM Pipeline** — L1 memory extraction → L2 scene grouping → L3 persona generation (optional)

### Unique
- **Memory Mood** 🎨 — Sentiment analysis of conversation history with emoji-based mood ring
- **Memory Timeline** 📅 — Visual heat-bar density of memory activity over days
- **Emoji Recall** — Auto-recall results tagged with mood emoji (😊 😐 😢)
- **Backup & Restore** — Timestamped snapshots of all memory data
- **Session Filtering** — Skip system/internal sessions, capture only meaningful conversations

## Tools (8)

| Tool | Description |
|------|-------------|
| `yaoyao_memory_search` | FTS5 full-text + fallback keyword search across all memories |
| `yaoyao_memory_get` | Read a specific memory file by name |
| `memory_list` | List available memory files with type/date/size metadata |
| `memory_save` | Manually record an event or observation |
| `memory_stats` | Memory statistics: file count, FTS5 index size, date distribution |
| `memory_mood` | 🆕 Analyze emotional tone of recent conversations (mood ring) |
| `memory_timeline` | 🆕 Visual timeline with heat-bar density |
| `memory_search_timeline` | 🆕 Search with date grouping + mood emoji for each result |

## Hooks

- **agent_end** → auto-capture conversation turns + FTS5 index
- **before_prompt_build** → auto-recall with FTS5 + optional vector hybrid search
- **gateway_stop** → clean DB close

## Configuration

```json5
{
  "enabled": true,
  "config": {
    "capture": {
      "enabled": true
    },
    "recall": {
      "enabled": true,
      "maxResults": 3
    },
    "embedding": {
      "enabled": true,
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-xxx",
      "model": "text-embedding-3-small",
      "dimensions": 1024
    },
    "llm": {
      "enabled": true,
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-chat"
    },
    "memoryDir": "",
    "cleanup": {
      "enabled": true,
      "l0l1RetentionDays": 30
    },
    "blockLabels": []
  }
}
```

## Data Storage

| Path | Format |
|------|--------|
| `memory/YYYY-MM-DD.md` | Daily conversation logs |
| `memory/persona.md` | LLM-generated user persona |
| `memory/.yaoyao.db` | FTS5 + sqlite-vec index |
| `memory/.backups/` | Timestamped snapshot backups |
| `memory/.pipeline/` | L1→L3 extraction checkpoints |
| `memory/scene_blocks/` | Scene grouping data |
| `memory/.archive/` | Cleaned-up old daily files |

## Installation

```bash
openclaw plugins install yaoyao-memory
```

## Requirements

- OpenClaw ^2026.3.x
- Node.js ^22 (native sqlite support)
- Optional: embedding API key for vector search
- Optional: LLM API key for extraction pipeline
