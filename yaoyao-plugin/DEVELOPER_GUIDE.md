# Yaoyao Memory — 开发指南

## 铁律

1. **200 行红线**：单个文件不超过 200 行
2. **kebab-case**：文件名全小写，连字符分隔
3. **工厂函数传参**：禁止闭包依赖，所有依赖通过参数传入
4. **零外部依赖**：核心算法零 npm 依赖

## 8 步开发流程

1. 确定文件归属（core/ / utils/ / features/ / platform/ / hooks/ / entry/ / storage/ / optional/）
2. 检查是否已存在同类文件
3. 遵循命名规范
4. 实现纯函数
5. 添加类型定义
6. 添加 JSDoc 注释
7. 错误处理（所有 catch 必须有日志）
8. 更新 features/README.md

## 如需偏离指南

**必须向用户申请批准，不可自行决定。**

## 架构

- `core/` — 纯算法，零平台依赖
- `utils/` — 工具函数，可依赖 fs/path
- `features/` — 工具实现，依赖 core/ + utils/
- `platform/` — 平台抽象（DB、文件系统）
- `hooks/` — OpenClaw 钩子
- `storage/` — 存储层
- `entry/` — 入口文件

## 错误处理规范

```typescript
try {
  // ...
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.warn(`[yaoyao-memory:组件名] 操作失败: ${msg}`);
}
```

## 版本历史

- v1.7.3 — 修复空 catch 块、内存泄漏、配置化改进
- v1.7.0 — 添加 command:new 钩子、心跳记忆注入
- v1.6.0 — 添加 cron 管理、导入工具、冲突检测
- v1.5.0 — 添加向量搜索、云同步、质量分析
