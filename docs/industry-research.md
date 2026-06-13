# AI 记忆系统行业调研报告

## 一、行业头部项目（OpenClaw 生态）

### 1. Lily Memory Plugin
- **作者**: Aloysius Chan
- **特点**: FTS5 + Ollama 向量相似度，零 npm 依赖
- **架构**: Auto-recall + Auto-capture，支持 stuck detection
- **链接**: https://dev.to/aloycwl/openclaw-lily-memory-plugin

### 2. Engram (Gentleman-Programming)
- **特点**: Go 后端，SQLite + FTS5，MCP server + HTTP API + CLI + TUI
- **架构**: 结构化存储（decision/bugfix/config/procedure），topic-based 去重
- **链接**: https://github.com/Gentleman-Programming/engram

### 3. Supermemory (ivanvmoreno)
- **特点**: 图结构记忆，支持向量搜索 + 图遍历
- **架构**: FTS5 + sqlite-vec + 图遍历，渐进式回退
- **链接**: https://github.com/ivanvmoreno/supermemory-openclaw

### 4. Memory Unified (numerika-ai)
- **特点**: USMD SQLite + Ruflo HNSW 双后端
- **架构**: Qwen3-Embedding 4096 维，技能学习 + 轨迹追踪
- **链接**: https://github.com/numerika-ai/openclaw-memory-unified

### 5. Mem0 (行业标杆)
- **特点**: 通用记忆层，graph-based + embedding-based
- **架构**: 可扩展的 extract-update-pipeline
- **链接**: https://mem0.ai

---

## 二、顶尖论文（2024-2025）

### 核心论文

| 论文 | 作者 | 年份 | 核心贡献 |
|------|------|------|----------|
| **Mem0** | Chhikara et al. | 2025 | 可扩展记忆提取-更新管道，图变体 |
| **MemGPT → Letta** | Packer et al. | 2024→2025 | OS 虚拟内存类比，分页机制 |
| **A-Mem** | Xu et al. | 2025 | Zettelkasten 索引，agentic 记忆演化 |
| **Generative Agents** | Park et al. | 2023 | 记忆流 + 反思 + 规划 |
| **MemLLM** | Modarressi et al. | 2024 | 显式读写记忆模块微调 |
| **Engram** | Patel & Patel | 2025 | 轻量级记忆编排 |
| **LongMemEval** | Wu et al. | 2025 | 长期交互记忆基准测试 |
| **Memory-R1** | Yan et al. | 2025 | RL 优化记忆控制器 |
| **MemOS** | Li et al. | 2025 | AI 系统记忆操作系统 |
| **MAGMA** | Jiang et al. | 2026 | 多图 agentic 记忆架构 |

### 关键趋势

1. **分层记忆**: L0-L3/L4 架构成为标准（工作记忆→情景记忆→语义记忆）
2. **混合搜索**: FTS5 + 向量 + 图遍历融合
3. **Agentic 记忆**: 动态决定存储/更新/遗忘，而非预定义规则
4. **去重与压缩**: Topic-based dedup，渐进式摘要
5. **安全与攻击**: ER-MIA 揭示相似性检索的攻击面

---

## 三、yaoyao-memory 对比分析

### 优势
- ✅ **四层架构**: L0-L3 完整分层，质量评估 L4
- ✅ **混合搜索**: FTS5 + sqlite-vec + BM25
- ✅ **零依赖**: 纯 Node.js 内置模块
- ✅ **双模式**: Lite（零外部）/ Full（LLM 增强）
- ✅ **隐私优先**: 100% 本地存储
- ✅ **反遗忘**: 时间衰减 + 访问频率 + 情感权重

### 差距
- ❌ **无图结构**: Supermemory/MAGMA 的图遍历增强关联
- ❌ **无技能学习**: Memory Unified 的轨迹追踪和模式识别
- ❌ **无 RL 优化**: Memory-R1 的强化学习记忆策略
- ❌ **无 Zettelkasten**: A-Mem 的卡片盒索引和链接
- ❌ **无 MCP 协议**: Engram 的 Model Context Protocol 支持
- ❌ **基准测试**: 缺少 LongMemEval 等标准化测试

### 改进方向

1. **图结构记忆**（借鉴 Supermemory/MAGMA）
   - 场景块之间的关联图谱
   - 记忆节点的重要性传播

2. **Agentic 记忆策略**（借鉴 A-Mem/Memory-R1）
   - 动态决定什么值得存储
   - 基于效用的遗忘策略

3. **技能学习**（借鉴 Memory Unified）
   - 工具执行模式识别
   - 成功率追踪和优化建议

4. **MCP 协议支持**（借鉴 Engram）
   - 标准化记忆接口
   - 跨 agent 记忆共享

5. **基准测试**
   - 集成 LongMemEval
   - 建立 yaoyao 专用测试集

---

## 四、具体优化建议

### 短期（1-2 周）
- [ ] 图结构关联：在 scene_blocks 中添加 `related_scenes` 字段
- [ ] 记忆质量可视化：添加 `memory_quality` 仪表板工具
- [ ] 反遗忘增强：引入情感权重和重要性传播

### 中期（1-2 月）
- [ ] Agentic 存储：LLM 判断记忆价值，动态调整保留策略
- [ ] 技能追踪：记录工具调用模式，识别高频工作流
- [ ] MCP 适配器：支持 Model Context Protocol

### 长期（3-6 月）
- [ ] 基准测试：集成 LongMemEval，建立回归测试
- [ ] 联邦记忆：多 agent 间的记忆共享和同步
- [ ] 记忆安全：防御 ER-MIA 类攻击，记忆完整性校验

---

*报告生成时间: 2026-05-19*
*数据来源: GitHub, arXiv, OpenClaw 插件目录*
