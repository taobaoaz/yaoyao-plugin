# AI 记忆系统专业论文清单

## 核心架构论文

| 论文 | 作者 | 年份 | arXiv/会议 | 核心贡献 |
|------|------|------|-----------|----------|
| **Mem0** | Chhikara et al. | 2025 | arXiv:2504.19413 | 可扩展提取-更新-检索管道，图增强 |
| **MemGPT → Letta** | Packer et al. | 2023→2025 | arXiv:2310.08560 | OS 虚拟内存类比，分层架构 |
| **A-MEM** | Xu et al. | 2025 | arXiv:2502.12110 | Zettelkasten 动态索引，记忆演化 |
| **MAGMA** | Jiang et al. | 2026 | arXiv:2601.03236 | 多图正交分解，策略路由检索 |
| **MemRerank** | - | 2026 | arXiv:2603.29247 | 记忆重排序优化 |
| **Hierarchical Memory** | - | 2025 | arXiv:2507.22925 | 分层记忆高效长期推理 |
| **ReadAgent** | Lee et al. | 2024 | - | 分段阅读，关键点压缩 |
| **SCM** | Wang et al. | 2023 | - | 记忆流 + 控制器机制 |

## 基准测试与评估

| 论文 | 作者 | 年份 | 会议 | 核心贡献 |
|------|------|------|------|----------|
| **LoCoMo** | Maharana et al. | 2024 | ACL | 长期对话记忆评估 |
| **MemoryBench** | Ai et al. | 2025 | arXiv:2510.17281 | 记忆与持续学习基准 |
| **RULER** | Hsieh et al. | 2024 | COLM | 真实上下文长度测试 |
| **StreamBench** | Wu et al. | 2024 | - | 流式评估框架 |
| **ATANT** | Tanguturi | 2026 | arXiv:2604.06710 | AI 连续性评估框架 |
| **LongMemEval** | - | 2025 | - | 长期交互记忆基准 |

## 多模态与高级记忆

| 论文 | 作者 | 年份 | arXiv | 核心贡献 |
|------|------|------|-------|----------|
| **MemVerse** | - | 2025 | arXiv:2512.03627 | 多模态记忆终身学习 |
| **MM-Mem** | - | 2025 | arXiv:2603.01455 | 多模态记忆框架 |
| **MemAgent** | Yu et al. | 2025 | - | RL 优化多对话记忆 |
| **MemGen** | Zhang et al. | 2025 | - | 生成式潜在记忆网络 |
| **MemoryLLM** | Wang et al. | 2024 | - | Transformer 内潜在记忆池 |
| **MemInsight** | Salama et al. | 2025 | - | 自主信息提取与属性生成 |

## 生产级系统

| 论文/系统 | 作者 | 年份 | 特点 |
|-----------|------|------|------|
| **Mem0** (产品) | Mem0 Inc. | 2024 | 多层次摘要、压缩、快速读写 |
| **SuperMemory** | Shah et al. | 2025 | 多级摘要，可扩展 RAG |
| **Zep** | Rasmussen et al. | 2025 | arXiv:2501.13956 | 时序知识图谱架构 |
| **MemoryBank** | Zhong et al. | 2024 | - | 分层检索，时序相关性 |
| **MemoRAG** | Qian et al. | 2025 | - | 双系统检索 |
| **MemOS** | MemOS Team | 2025 | GitHub | AI 记忆操作系统 |

## 理论与信息几何

| 论文 | 作者 | 年份 | arXiv | 核心贡献 |
|------|------|------|-------|----------|
| **Info-Geometric Memory** | - | 2026 | arXiv:2603.14588 | 信息几何基础，零 LLM 企业记忆 |
| **Complementary Learning** | McClelland et al. | 1995 | Psych Review | 海马体-新皮层互补学习 |
| **Catastrophic Interference** | McCloskey & Cohen | 1989 | - | 连接主义网络的灾难性遗忘 |

## 记忆管理优化

| 论文 | 作者 | 年份 | 核心贡献 |
|------|------|------|----------|
| **Optimizing Short-Term Memory** | - | 2025 | arXiv:2507.21428 | 动态工具调用内存管理 |
| **Graph RAG-Tool Fusion** | Lumer et al. | 2025 | arXiv:2502.07223 | 图 RAG 与工具融合 |
| **ScaleMCP** | Lumer et al. | 2025 | arXiv:2505.06416 | 动态同步 MCP 工具 |
| **ToolShed** | Lumer et al. | 2024/2025 | arXiv:2410.14594 | 工具知识库扩展 |

## 按主题分类

### 分层记忆架构
- MemGPT/Letta (OS 类比)
- Hierarchical Memory (2025)
- MemoryBank (分层检索)
- Mem0 (多层次摘要)

### 图结构记忆
- MAGMA (4 图正交分解)
- Mem0-graph (图增强)
- Zep (时序知识图谱)
- SuperMemory (图遍历)

### 动态记忆演化
- A-MEM (Zettelkasten 动态链接)
- MemInsight (自主提取)
- ReadAgent (关键点压缩)

### 强化学习优化
- MemAgent (多对话 RL)
- Memory-R1 (Yan et al., 2025)
- MR.Rec (Huang et al., 2025)

### 评估基准
- LoCoMo (ACL 2024)
- MemoryBench (2025)
- RULER (COLM 2024)
- LongMemEval
- StreamBench

### 多模态记忆
- MemVerse (2025)
- MM-Mem (2025)
- MemGen (生成式潜在网络)

---

*清单生成时间: 2026-05-19*
*总计: 30+ 篇核心论文*
