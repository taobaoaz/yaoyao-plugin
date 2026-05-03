# Yaoyao Memory Plugin

A four-layer progressive memory plugin for OpenClaw — auto-captures conversations, extracts structured memories, manages scene blocks, and generates user personas.

## Architecture

```
L0 — Daily conversation logs (memory/YYYY-MM-DD.md)
L1 — Structured memories (auto-extracted from conversations)
L2 — Scene blocks (contextual groupings)
L3 — Long-term persona (MEMORY.md)
```

## Features

- **Auto-capture** — Each agent turn is automatically recorded to daily memory files
- **Memory recall** — Relevant past memories are injected into the prompt context
- **Memory search** — Keyword-based search across all memory files
- **Memory get/read** — Read specific memory files by date or name
- **Memory list** — Browse available memory files with metadata
- **Memory save** — Manually record events and observations

## Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Search through memory files by keywords |
| `memory_get` | Read a specific memory file |
| `memory_list` | List available memory files |
| `memory_save` | Save a new memory entry |

## Hooks

- **agent_end** → auto-capture conversation turns to daily logs
- **before_prompt_build** → auto-recall relevant past memories

## Configuration

```json5
{
  "capture": {
    "enabled": true,
    "l0l1RetentionDays": 0
  },
  "recall": {
    "enabled": true,
    "maxResults": 5,
    "scoreThreshold": 0.3
  }
}
```

## Installation

```bash
openclaw plugins install @yaoyao/yaoyao-memory-plugin
```

## Data Storage

Memory files are stored in `~/.openclaw/workspace/memory/` by default.
