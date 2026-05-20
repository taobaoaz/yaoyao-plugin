# Yaoyao Memory Plugin

自适应记忆引擎：FTS5 + 向量搜索 + 时间线 + 云备份

## 版本

v1.7.2

## 功能

- **23 个记忆工具**：搜索、管理、导入、分析、系统
- **4 层记忆架构**：L0 Markdown → L1 FTS5 → L2 向量 → L3 图谱
- **双环境兼容**：OpenClaw / XiaoYi Claw
- **零外部依赖**：仅可选 sqlite-vec

## 安装

```bash
npm install yaoyao-memory-plugin
```

## 配置

```json
{
  "capture": { "enabled": true },
  "recall": { "enabled": true },
  "embedding": { "provider": "sqlite-vec" }
}
```

## 文档

- [功能列表](features/README.md)
- [开发指南](DEVELOPER_GUIDE.md)

## 许可证

MIT
