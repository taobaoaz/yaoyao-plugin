# 🎲 Yaoyao 插件开发范式 v1.0

> 本文档定义了「Yaoyao」系列 OpenClaw 插件的统一开发标准。
> 所有 Yaoyao 系列插件开发者必须遵循此规范，确保代码一致性、可维护性和安全性。

---

## 1. 项目结构规范

```
yaoyao-plugin/
├── openclaw.plugin.json          # 插件元数据 + 配置声明（核心入口）
├── package.json                  # NPM 包信息
├── index.ts                      # TypeScript 源码入口
├── index.js                      # 编译产物（dist/ 发布）
├── README.md                     # 快速起步说明
├── LICENSE                       # 开源协议
├── tsconfig.json                 # TypeScript 配置
│
├── dist/                         # 编译输出
│   ├── index.js
│   └── src/
│
├── src/                          # TypeScript 源码
│   ├── __tests__/                # 测试文件
│   ├── extraction/               # L1 提取模块
│   ├── scenes/                   # 场景管理
│   ├── utils/                    # 工具模块
│   └── ...
│
├── memory/                       # 运行时记忆数据（gitignore）
│
└── node_modules/                 # 依赖（gitignore）
```

### 1.1 与旧 Skill 结构的区别

| 维度 | Skill（旧） | Plugin（新） |
|------|-------------|--------------|
| 运行时 | Python 脚本 + CLI | TypeScript + Node.js |
| 注册方式 | `SKILL.md` 声明 | `openclaw.plugin.json` |
| Hook 能力 | 无 | `agent_end`、`before_prompt_build` 等 Hook |
| 工具暴露 | 通过 Python CLI | 通过 `registerTools()` / `registerHooks()` |
| 发布渠道 | ClawHub | GitHub + ClawHub |
| 用户数据 | `config/` 目录 | `openclaw.plugin.json` 中的 `configSchema` |

---

## 2. openclaw.plugin.json 规范

### 2.1 基本结构

```json
{
  "id": "yaoyao-{name}",
  "name": "Yaoyao {Display Name}",
  "description": "一句话描述插件能力",
  "configSchema": {
    "type": "object",
    "additionalProperties": true,
    "properties": { }
  },
  "supersedes": [
    "旧-skill-id"
  ],
  "migration": {
    "from": "旧-skill-id",
    "version": "1.x",
    "instructions": "迁移说明"
  }
}
```

### 2.2 配置声明（configSchema）

所有用户可配置项必须在 `configSchema` 中声明，**不允许**在代码中硬编码 API Key 或敏感信息：

```json
"configSchema": {
  "type": "object",
  "properties": {
    "capture": {
      "type": "object",
      "description": "对话自动捕获设置 (L0)",
      "properties": {
        "enabled": {
          "type": "boolean",
          "default": true,
          "description": "是否启用自动对话捕获"
        }
      }
    },
    "recall": {
      "type": "object",
      "description": "记忆自动召回设置",
      "properties": {
        "enabled": { "type": "boolean", "default": true },
        "maxResults": { "type": "number", "default": 3 }
      }
    },
    "embedding": {
      "type": "object",
      "description": "向量嵌入配置（可选）",
      "properties": {
        "enabled": { "type": "boolean", "default": false },
        "provider": { "type": "string", "default": "openai" },
        "baseUrl": { "type": "string", "default": "" },
        "apiKey": { "type": "string", "default": "" },
        "model": { "type": "string", "default": "" },
        "dimensions": { "type": "number", "default": 1024 }
      }
    }
  }
}
```

### 2.3 package.json

```json
{
  "name": "yaoyao-{name}-plugin",
  "version": "X.X.X",
  "description": "插件描述",
  "type": "module",
  "main": "index.ts",
  "exports": { ".": "./index.ts" },
  "files": ["dist/", "openclaw.plugin.json", "README.md", "LICENSE"],
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "compat": { "pluginApi": "^2026.3.0" },
    "build": {
      "openclawVersion": "2026.3.24",
      "entry": ["./dist/index.js"]
    }
  }
}
```

---

## 3. TypeScript 开发规范

### 3.1 插件入口结构

```typescript
// index.ts
import type { Plugin } from 'openclaw';

export default {
  id: 'yaoyao-memory',
  async activate(ctx) {
    // 注册工具
    ctx.registerTools([
      {
        name: 'memory_search',
        description: '搜索记忆',
        handler: async (input) => {
          // 实现
        }
      }
    ]);

    // 注册 Hook
    ctx.registerHooks({
      'agent_end': async (ctx) => {
        // 自动捕获
      },
      'before_prompt_build': async (ctx) => {
        // 自动召回
      }
    });
  }
} satisfies Plugin;
```

### 3.2 命名规范

| 元素 | 规范 | 示例 |
|------|------|------|
| 插件 slug | `yaoyao-{kebab-case}` | `yaoyao-memory` |
| NPM 包名 | `yaoyao-{name}-plugin` | `yaoyao-memory-plugin` |
| 工具名 | `{name}_{action}` | `memory_search` |
| 类名 | PascalCase | `MemoryStore` |
| 函数名 | camelCase | `searchMemory()` |
| 测试文件 | `{module}.test.ts` | `memory-store.test.ts` |

### 3.3 工具命名

工具必须使用 snake_case 命名，与 OpenClaw 的工具暴露规范一致：

```typescript
ctx.registerTool({
  name: 'memory_search',
  description: '通过文本搜索记忆',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      maxResults: { type: 'number', default: 10 }
    }
  },
  handler: async (params) => {
    // 实现
  }
});
```

### 3.4 测试规范

| 要求 | 说明 |
|------|------|
| 工具类型 | `--experimental-strip-types` + Node 原生测试 |
| 文件命名 | `src/__tests__/{module}.test.ts` |
| 覆盖率 | 核心模块必须 ≥ 70% |
| 测试内容 | Happy path + Edge case + Error path |
| 测试命令 | `npm run test` |

---

## 4. Hook 机制

### 4.1 支持的 Hook

| Hook 名称 | 触发时机 | 用途 |
|-----------|----------|------|
| `agent_end` | 每次 AI 回复后 | 自动捕获记忆 |
| `before_prompt_build` | 构建 prompt 前 | 自动召回记忆 |

### 4.2 Hook 注册

```typescript
ctx.registerHooks({
  'agent_end': {
    handler: async (hookCtx) => {
      // 自动捕获对话内容
    }
  },
  'before_prompt_build': {
    handler: async (hookCtx) => {
      // 自动召回相关记忆
    }
  }
});
```

### 4.3 Hook 性能要求

| 要求 | 说明 |
|------|------|
| `agent_end` 耗时 | ≤ 1 秒 |
| `before_prompt_build` 耗时 | ≤ 500ms |
| 异步非阻塞 | 所有 Hook 必须 await/throw |
| 降级策略 | 失败时不能阻塞主流程 |

---

## 5. 发布规范

### 5.1 构建

```bash
# 编译 TypeScript
npx tsc --project tsconfig.json

# 或直接运行（strip-types）
node --experimental-strip-types index.ts
```

### 5.2 发布到 GitHub

```bash
# 插件通过 NPM 包发布到 GitHub
git tag vX.X.X
git push origin vX.X.X
npm publish --registry https://npm.pkg.github.com
```

### 5.3 发布到 ClawHub（可选）

```bash
clawhub publish . --slug yaoyao-memory --version X.X.X
```

### 5.4 必须排除的文件

```gitignore
node_modules/
dist/
memory/
.env
*.log
```

---

## 6. 安全规范

### 6.1 敏感信息隔离

- **API Key、Token 等** 必须通过 `configSchema` 声明，用户配置后写入插件配置
- **不可** 硬编码在代码中
- **不可** 写入日志文件
- **不可** 通过工具输出暴露

### 6.2 配置读取规范

```typescript
// ✅ 正确：从插件配置读取
const apiKey = ctx.config.get('embedding.apiKey');

// ❌ 错误：硬编码
const apiKey = 'sk-xxx';
```

### 6.3 隐私保护规则

**永不记录：**
- ❌ 密码、密钥、Token
- ❌ 银行卡、身份证
- ❌ 用户明确要求不记录的

**静默自动捕获规则：**
- 捕获对话时自动过滤敏感信息
- blockLabels 配置可排除特定 session
- 用户可设置 `capture.enabled: false` 完全关闭

### 6.4 configSchema 默认值安全原则

```json
// ✅ 正确：API Key 默认留空
"apiKey": { "type": "string", "default": "" }

// ❌ 错误：不要设置默认 API Key
"apiKey": { "type": "string", "default": "sk-xxx" }
```

---

## 7. 持续开发优化规范

> 本章覆盖对 yaoyao 插件进行任何开发、修改、优化时都必须遵循的标准。

### 7.1 开发基本原则

| 原则 | 说明 |
|------|------|
| **先理解后修改** | 在修改前，先了解 `openclaw.plugin.json`（配置声明）、`index.ts`（入口）、`src/`（源码）的当前架构 |
| **增量优先** | 优先在现有架构上做增量修改，除非架构严重不合理，不轻易重构 |
| **向后兼容** | 已发布的配置项（`configSchema` property）不做破坏性变更；新增项必须以 `default` 兼容旧配置 |
| **由外而内** | `openclaw.plugin.json` → `index.ts`（注册逻辑）→ `src/`（实现逻辑），逐层理解再动手 |

### 7.2 新增功能规范

| 步骤 | 要求 |
|------|------|
| **1. 配置声明** | 先在 `openclaw.plugin.json` 的 `configSchema` 中定义新配置项，再实现 |
| **2. 工具注册** | 在 `index.ts` 中通过 `ctx.registerTool()` 注册，需提供完整的 `parameters` schema |
| **3. Hook 注册** | 在 `index.ts` 中通过 `ctx.registerHooks()` 注册，注意性能要求 |
| **4. 测试必配** | 新增功能必须附配套测试，至少覆盖 happy path + error path |
| **5. 文档更新** | 必须在 README.md 和本文件中更新相关说明 |

### 7.3 修改现有功能规范

| 场景 | 规则 |
|------|------|
| **修改 configSchema** | 必须保持向后兼容，新增配置项必须有 `default` |
| **修改工具签名** | 保持参数名和类型兼容，弃用参数用 `deprecated` 标记 |
| **修改 Hook 逻辑** | 不影响主流程，失败时降级而不是抛异常 |
| **修改数据模型** | 必须提供数据迁移方案（兼容旧数据格式或自动迁移） |

### 7.4 版本管理规范

遵循语义化版本（SemVer）：

| 版本号 | 触发条件 | 示例 |
|--------|----------|------|
| **主版本 (X.0.0)** | 接口破坏性变更、配置项删除/必填变更 | 1.0.0 → 2.0.0 |
| **次版本 (X.Y.0)** | 新增功能/配置项，向后兼容 | 1.1.0 → 1.2.0 |
| **补丁 (X.Y.Z)** | Bug 修复，功能不变 | 1.1.0 → 1.1.1 |

**版本更新时同步更新：**
- `package.json` 中的 `version`
- `openclaw.plugin.json`（通过 package.json 引用）

### 7.5 重构规范

| 允许重构的条件 | 禁止重构的场景 |
|----------------|----------------|
| 代码存在严重 bug 无法增量修复 | 仅为了"代码好看"的重构 |
| 架构阻碍了新功能正常扩展 | 不了解全部代码逻辑时的重构 |
| 性能瓶颈明显可优化 | 涉及用户数据的重构无回滚方案 |

**重构流程：**
```
1. 分析现状：理清当前逻辑和所有调用方
2. 规划边界：保证重构范围内功能不变
3. 写测试：先写覆盖现有行为的测试
4. 逐步替换：一个模块一个模块换，避免大爆炸
5. 灰度验证：先在低流量路径验证
6. 移除旧代码：确认新逻辑稳定后再删除
```

### 7.6 代码评审要求

任何变更应满足以下检查清单：

- [ ] 是否理解变更涉及的整个代码路径？
- [ ] 是否有配套测试（新增功能必测，修改功能至少回归）？
- [ ] 是否向后兼容（configSchema、工具参数、Hook 行为）？
- [ ] `openclaw.plugin.json` 是否需要更新？
- [ ] 修改是否涉及敏感数据（API Key、用户数据）处理变化？
- [ ] README.md 是否同步更新？
- [ ] 类型定义是否完整（TypeScript 类型覆盖）？

---

## 8. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-05-07 | 初始版本，基于 yaoyao-memory-plugin v1.2.4 开发实践提炼 |
