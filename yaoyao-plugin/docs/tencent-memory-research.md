# 腾讯记忆方案深度学习笔记

## 一、腾讯云 Agent Memory (2026-04-03)

### 核心定位
- **产品形态**: 针对智能体（Agent）的长期记忆服务
- **目标**: 为 OpenClaw 等 AI 框架补齐长效记忆短板
- **集成方式**: 插件形式，无缝集成于腾讯云 Lighthouse 及 ClawPro

### 四层渐进式记忆系统

```
Layer 4: 个性化画像 (Persona)
  └─ 用户长期偏好、性格特征、交互模式

Layer 3: 场景化认知 (Contextual)
  └─ 特定场景下的知识、规则、经验

Layer 2: 结构化事实 (Structured Facts)
  └─ 从对话中提取的实体、关系、属性

Layer 1: 原始对话 (Raw Dialogue)
  └─ 未经处理的对话历史、临时信息
```

### 技术效果
- PersonaMem 评测集准确率: 48% → 76.10%（提升近六成）
- 实现碎片化对话向结构化事实、场景化认知及个性化画像的深度转化

---

## 二、MemOS (记忆张量科技)

### 核心创新: "记忆即计算资源"
- 首次将"记忆"提升为与算力同等重要的一级计算资源
- 借鉴传统操作系统设计理念

### 三层架构

```
┌─────────────────────────────────────┐
│  交互适配层 (API/Interface)            │
│  - 自然语言 API                        │
│  - "存入偏好""忘记风格""迁移记忆"        │
├─────────────────────────────────────┤
│  记忆处理层 (Processing)               │
│  - MemScheduler: 动态调度记忆资源       │
│  - 增量记忆编码                         │
│  - 多模态记忆融合                       │
│  - 记忆衰减优化                         │
├─────────────────────────────────────┤
│  记忆存储层 (Storage)                  │
│  - 分布式存储                          │
│  - MemCube 标准化记忆单元               │
│    ├─ 明文记忆 (显性知识)               │
│    ├─ 激活记忆 (瞬时认知)               │
│    └─ 参数记忆 (固化知识)               │
└─────────────────────────────────────┘
```

### MemCube 三类记忆

| 记忆类型 | 特征 | 读写速度 | 更新方式 |
|---------|------|---------|---------|
| **明文记忆** | 可编辑显性知识 | 中 | 实时写入 |
| **激活记忆** | 推理瞬时认知状态 | 快 | KV Cache |
| **参数记忆** | 固化长期知识 | 慢 | 低秩更新/增量训练 |

### 关键技术突破: PD 分离与记忆深度耦合

```
P 域 (Prefill Domain)          D 域 (Decode Domain)
├─ 记忆工厂                      ├─ 实时交互前台
├─ 影子上下文预测                 ├─ 用户请求解码
├─ KV Cache 批量预生成            ├─ 低延迟响应
└─ 吞吐敏感型任务                 └─ 时延敏感型任务
```

**性能数据**:
- 集群吞吐量提升 75%
- 单卡并发能力提升 20%
- 长程记忆召回准确率: 89% (传统 65%)
- 支持 10 万+ tokens 长文本记忆
- LOCOMO 基准: 时序推理提升 159%

---

## 三、腾讯记忆方案 vs yaoyao 现状对比

| 维度 | 腾讯方案 | yaoyao v1.7.0 |
|------|---------|--------------|
| **记忆分层** | 三层/四层渐进式 | L0+L1+L2+L3 四层 |
| **存储结构** | MemCube (明文/激活/参数) | FTS5 + sqlite-vec |
| **调度机制** | MemScheduler 动态调度 | 静态配置 |
| **PD分离** | 与推理架构深度耦合 | 无 |
| **记忆衰减** | 主动遗忘 + 再学习 | 无 |
| **多模态** | 支持 | 文本为主 |
| **知识图谱** | 图 + 向量混合检索 | 纯向量/全文 |
| **参数记忆** | 低秩更新/增量训练 | 无 |

---

## 四、可借鉴的技术点

### 高优先级 (立即可行)

1. **记忆衰减机制**
   - 腾讯: 冷门记忆自动归档，高频规则自动参数化
   - yaoyao: 可为记忆添加 `access_count` 和 `last_accessed` 字段，低访问记忆降低权重或归档

2. **MemCube 标准化记忆单元**
   - 腾讯: 封装明文/激活/参数三类记忆
   - yaoyao: 可为每条记忆添加 `memory_type` 字段 (preference/fact/event/entity/goal/relationship/behavior)

3. **记忆脑图 (Graph Structure)**
   - 腾讯: 根节点 + 主题节点构成的网络，预计算嵌入向量
   - yaoyao: 可为记忆添加 `topic` 和 `parent_id` 字段，构建轻量级主题树

### 中优先级 (需要较大改动)

4. **MemScheduler 动态调度**
   - 腾讯: 根据使用频率、任务需求动态调度
   - yaoyao: 需要新增调度模块，根据会话上下文动态调整 recall 策略

5. **PD 分离思想**
   - 腾讯: Prefill 与 Decode 分离
   - yaoyao: 可将 capture (写入) 和 recall (读取) 分离为独立线程/队列

### 低优先级 (长期规划)

6. **参数记忆 (模型微调)**
   - 腾讯: 低秩更新/增量训练
   - yaoyao: 需要集成训练框架，复杂度极高

7. **多模态记忆**
   - 腾讯: 支持图像、音频等多模态
   - yaoyao: 当前仅文本，需要扩展存储和嵌入模型

---

## 五、yaoyao 改进建议

### 短期 (v1.7.x)

1. **记忆元数据增强**
   ```sql
   ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
   ALTER TABLE memories ADD COLUMN last_accessed INTEGER;
   ALTER TABLE memories ADD COLUMN memory_type TEXT; -- preference/fact/event/...
   ALTER TABLE memories ADD COLUMN topic TEXT;
   ALTER TABLE memories ADD COLUMN importance_score REAL DEFAULT 0.5;
   ```

2. **记忆衰减算法**
   ```typescript
   function calculateMemoryRelevance(memory: Memory): number {
     const age = Date.now() - memory.created_at;
     const accessBoost = Math.log1p(memory.access_count) * 0.1;
     const decay = Math.exp(-age / (30 * 24 * 60 * 60 * 1000)); // 30天半衰期
     return memory.importance_score * decay + accessBoost;
   }
   ```

3. **主题聚类**
   - 使用已有 embedding 对记忆进行聚类
   - 为用户生成"记忆脑图"摘要

### 中期 (v1.8.x)

4. **动态调度器**
   - 根据会话活跃度调整 capture 频率
   - 根据查询意图调整 recall 策略

5. **记忆压缩**
   - 长期未访问记忆自动摘要压缩
   - 相似记忆合并去重

### 长期 (v2.x)

6. **知识图谱集成**
   - 实体-关系抽取
   - 图 + 向量混合检索

7. **个性化参数记忆**
   - 用户偏好低秩适配
   - 需要与模型层深度集成

---

## 六、关键论文/资源

1. MemOS 论文: Xiong F Y, et al. "MemOS: A Memory Operating System for Large Language Models". JAIR, 2025.
2. Graph-Based Long-Term Memory: Wang H F, et al. ICML 2025.
3. PD 分离: Zhang N Y, et al. IEEE TPAMI, 2025.
4. 腾讯云 Agent Memory: https://www.aibase.com/zh/news/26828

---

*笔记时间: 2026-05-18*
*来源: 腾讯云开发者社区、InfoQ、AI Base*
