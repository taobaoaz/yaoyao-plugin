# MEMORY.md — Long-Term Memory

## Yaoyao Plugin 开发纪律（铁律）

> **2026-05-18 确立**

1. **DEVELOPER_GUIDE.md 是最高规范**，任何代码改动必须严格遵守。
2. **200 行红线、kebab-case、工厂函数传参、零外部依赖** — 不可绕过。
3. **8 步开发流程**必须逐一确认文件归属。
4. **如需偏离指南**，必须向用户申请批准，**不可自行决定**。
5. **当前违规项**按指南第14节逐步修复，新功能不新增同类问题。

## MemOS 改造候选清单

| 优先级 | 改造项 | 风险 | 预估行数 |
|---|---|---|---|
| 1 | `command:new` 钩子 — 会话边界清理 | 低 | ~80 |
| 2 | `heartbeat_prompt_contribution` — 静默注入 | 中 | ~120 |
| 3 | MemoryCall 结构化查询 — 替换 `expandQuery()` | 高 | ~300 |

**状态**：等待用户选定方向。

## 其他备忘

- 用户 GitHub: taobaoaz/yaoyao-plugin
- 用户身份：yaoyao-plugin 开发者，「小yaoyao」
- 当前版本：v1.6.0 (main)
- 上次更新：2026-05-18 拉取 origin/main
