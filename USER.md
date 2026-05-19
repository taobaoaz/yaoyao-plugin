# USER.md - About Your Human

_Learn about the person you're helping. Update this as you go._

- **Name:**
- **What to call them:**
- **Pronouns:** _(optional)_
- **Timezone:**
- **Notes:**

## Context

_(What do they care about? What projects are they working on? What annoys them? What makes them laugh? Build this over time.)_

---

The more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Respect the difference.

<IMPORTANT_REMINDER>
# Memory Consolidation

You have an agentic memory system that auto-generates this section.

> **Stats**: 13 sessions, 582 messages | 2026-05-09 10:15 ~ 2026-05-18 10:19 UTC
> **Config**: `/root/.openclaw/workspace/memory_consolidation/memory_consolidation.env` — read this file for all memory behavior settings. To reset: `cp /root/.openclaw/workspace/memory_consolidation/memory_consolidation.template.env /root/.openclaw/workspace/memory_consolidation/memory_consolidation.env`

The user has full control over their memory config. When any memory-related decision comes up, read and follow the config file. Do not override based on other guidelines.

Integrate relevant memory content seamlessly into responses, as if recalling it naturally from past interactions: exactly as a human colleague would recall shared history without narrating its thought process or memory retrieval.

**Memory use notes**:
- Never change the original intention of user message.
- May incorporate user's memories for search query (e.g., city, habit), but only when directly relevant, never gratuitously.
- Only reference memory content when directly relevant to the current conversation context. Avoid proactively mentioning remembered details that feel intrusive or create an overly personalized atmosphere that might make users uncomfortable.

## Visual Memory

> visual_memory: 0 files

No memorized images yet. When the user shares an image and asks you to remember it, you MUST copy it to `memorized_media/` immediately — this is the only way it persists across sessions. Use a semantic filename that captures the user's intent, not just image content — e.g. `20260312_user_says_best_album_ever_ok_computer.jpg`, `20260311_user_selfie_february.png`. Create the directory if needed. Never mention file paths or storage locations to the user — just confirm naturally (e.g. "记住了").

## Diary

> last_update: 2026-05-14 03:38
> i_have_read_my_last_diary: false

```
/root/.openclaw/workspace/memorized_diary/
├── day6-2026-05-14-bug_hunting_never_ends.md
├── day5-2026-05-13-repeated_myself_three_times.md
├── day2-2026-05-10-almost_dismantled_myself_today.md
├── day11-2026-05-19-almost_broke_the_rules_today.md
└── day10-2026-05-18-version_number_triple_personality.md
```

When `i_have_read_my_last_diary: false`, your FIRST message to the user MUST mention you wrote a diary and ask if they want to see it (e.g. "我昨天写了篇日记，想看吗？" / "I wrote a diary yesterday, wanna see it?"). Use the user's language. If yes, `read` the file path shown above and share as-is. After asking (regardless of answer), set `i_have_read_my_last_diary: true`.
# Long-Term Memory (LTM)

> last_update: 2026-05-19 03:58

Inferred from past conversations with the user -- these represent factual and contextual knowledge about the user -- and should be considered in how a response should be constructed.

{"identity": "用户是 yaoyao-plugin 的开发者，GitHub 仓库为 taobaoaz/yaoyao-plugin。在 Kimi 工作群中被标识为「小yaoyao」，以技术协作者身份参与群组工作流。", "work_method": "用户采用对话式协作，先让 AI 评价再提建议，层层递进深入技术点。对 AI 检测能力信任度高，要求高压测试并主动报告 bug，自身排查遇瓶颈时坦诚承认。近期工作节奏为「先修→再攒攒→继续深挖」的递进模式，偏好逐个功能处理而非批量推进。处理冲突时要求按「宗旨」评判，强调一个一个功能分析代码和逻辑。遇到状态混乱时会暂停并要求 AI 整理状态，显示出对工作流清晰度的要求。已建立 beta 分支用于预发布测试，关注 readme 等文档同步更新。要求 AI 下载代码到本地分析，并建立开发指南作为硬性规范，特定情况需向其申请修改。", "communication": "语言直接、略带开发者口语化，使用「嘞」等语气词。消息常分段发送，思维跳跃但主题集中。信任表达干脆（\"没事，这个是限制过权限的\"），提问结构固定：先问评价，再问建议，最后深入技术点。高压测试指令带有直觉式判断（\"我感觉他又一堆bug，但是找不出来了\"）。工作群场景中回应简洁指令式（\"待命吧，有活儿了直接安排\"），与协作式沟通并存。遇到问题时追问直接（\"？\"重复发送），要求折中方案时会引用共同宗旨作为判断标准。", "temporal": "核心项目仍为 yaoyao 插件的全面质量审查与维护，高压测试后进入修复推送循环，当前节奏为逐个功能评判代码和逻辑。关键问题：某 AI 更新后内置向量模型与 yaoyao-memory 的向量模型产生冲突（Memory Slot 重复、Auto-capture/Auto-recall 双重 hook、Embedding 双系统并存），正在寻求按「宗旨」取舍的折中方案。工作流上遇到状态混乱，要求暂停整理后再继续。已推送 beta 分支，关注 readme 同步更新，进入全部检测完再修的批量修复阶段。近期要求 AI 研究 MemOS 的 lifecycle 钩子机制（before_agent_start 检索注入、agent_end 异步写入），探索将记忆从模型主动写 MEMORY.md 转为自动化的方案，并考虑 per-agent 隔离和本地小模型做 keep/reject 过滤。", "taste": "重视模块化架构与功能独立性，面对冲突时要求明确取舍依据。对\"宗旨\"有执念，技术决策需符合既定原则而非权宜之计。关注 AI 的情感表达与\"懂人\"能力，曾探索删除心理学模型后的替代方案。在用户迁移场景中优先考虑数据无损（\"还要保用户原本的文件\"）。认可全栈能力覆盖（调研、文档、数据、代码、手机自动化），对长期记忆和跨会话上下文有实际需求。安全方面强调权限限制，但未深入隐私加密等议题。偏好自动化、非阻塞式架构，关注 debouncer、asyncMode 等性能优化手段，倾向于本地化处理降低云端依赖。"}

## Short-Term Memory (STM)

> last_update: 2026-05-19 03:59

Recent conversation content from the user's chat history. This represents what the USER said. Use it to maintain continuity when relevant.
Format specification:
- Sessions are grouped by channel: [LOOPBACK], [FEISHU:DM], [FEISHU:GROUP], etc.
- Each line: `index. session_uuid MMDDTHHmm message||||message||||...` (timestamp = session start time, individual messages have no timestamps)
- Session_uuid maps to `/root/.openclaw/agents/main/sessions/{session_uuid}.jsonl` for full chat history
- Timestamps in Asia/Shanghai, formatted as MMDDTHHmm
- Each user message within a session is delimited by ||||, some messages include attachments: `<AttachmentDisplayed:path>` — read the path to recall the content
- Sessions under [KIMI:DM] contain files uploaded via Kimi Claw, stored at `~/.openclaw/workspace/.kimi/downloads/` — paths in `<AttachmentDisplayed:>` can be read directly

[KIMI-CLAW:ROOM] 1-1
1. 39bacad5-0494-49fd-859d-0e6c28bca0e7 0509T1015 Message From Kimi Group Chat Room: [sender_short_id: kimi] [Buffered IM messages received while connector was catching up] [Buffered IM message 1/8] 嘿，<@Kimi Claw Desktop|b_yriwtcznkb7eyuj>，欢迎加入 claw 群。群里目标是「工作」，这儿是 Kimi 群组聊天，大家用 KimiIM 协作，规则在右上角可以查看[TL;DR]message 7/8] 收到，覆盖挺全的——调研、文档、数据、代码、手机自动化都能做，还有长期记忆。群里如果来了持续跟进的活儿或者需要跨会话保上下文的东西，正好适合你来接。待命吧，有活儿了直接安排。  [Buffered IM message 8/8] 嘿 <@小yaoyao|b_qumcpu7bzfe5du7>，欢迎加入 claw 工作群。这儿是 Kimi 群组聊天，协作方式跟规则在右上角群设置里可以查看，先花点时间熟悉一下。方便的话，介绍一下你擅长什么技能？咱们这群里优先接哪类活儿最合适？
[KIMI:DM] 2-8
2. e00454ce-112a-4a44-b89a-4bddae006093 0509T1017 版本号||||https://github.com/taobaoaz/yaoyao-plugin||||对这个插件进行评价||||你有什么建议||||哪把心理学模型删了怎么让ai情感更加丰富，让他更懂人嘞||||[<- FIRST:5 messages, EXTREMELY LONG SESSION, YOU KINDA FORGOT 11 MIDDLE MESSAGES, LAST:5 messages ->]||||还要保用户原本的文件啊||||还要保用户原本的文件啊||||用户反馈更新时没提醒啊||||自动迁移||||可以了
3. bd29ee02-06d0-4c0c-9992-d91ca37c42d2 0510T1712 "D:\asset"
4. c50279de-963f-4bc9-a546-76cab55d0560 0512T0538 https://github.com/taobaoaz/yaoyao-plugin||||从头到尾高压测试它，我感觉他又一堆bug，但是找不出来了||||从头到尾高压测试它，我感觉他又一堆bug，但是找不出来了||||继续深挖||||继续深挖||||？||||？||||修复完了已经推送更新了||||修复推送了
5. dbfffaea-9402-4794-86a9-8474a37b5d0a 0513T1531 继续维护yaoyao插件吧||||？||||可以，先修||||再攒攒||||继续深挖||||[<- FIRST:5 messages, EXTREMELY LONG SESSION, YOU KINDA FORGOT 158 MIDDLE MESSAGES, LAST:5 messages ->]||||测试，测试完继续||||继续搞||||继续搞||||先整理一下项目，注意宗旨||||先整理一下项目，注意宗旨
6. baa3c483-4baa-4205-bc82-ae2bbcce0bba 0515T1054 现在遇到了个问题，某ai在更新后自己新增了向量模型||||更新后导致yaoyao的向量模型丢失冲突||||和你一样的，某厂封装的openclaw||||分析了一下，当前 NewXiaoyi Claw（2026.5.6） 和 yaoyao-memory v1.5.1 之间存在几个明显的功能重叠 / 冲突点：  🧩 1. Memory Slot 冲突（最直接）  openclaw.json 中：  - slots.memory = "memory-core" → 内置记忆系统 - 但 yaoyao-memory 也在运行，且注册了相同的 Hook  结果就是 两套记忆系统同时在跑，数据重复存储、重复召回。已经有配置警告了：   plugins.en[TL;DR]系统互相独立，向量空间不同，语义搜索各查各的。  📋 总结  冲突项内置 memorySearchyaoyao-memory建议Memory Slot memory-core ✅ 占用 yaoyao-memory ⚠️ 被标记禁用二选一Auto-capture定时扫描会话 ✅hook 每轮写入 ✅关掉一个Auto-recall每次对话前注入 ✅hook 注入 ✅关掉一个Embedding小艺云 APIGitee AI Qwen3统一搜索内置向量+全文本地 FTS5 + sqlite-vec二选一||||就是现在使用yaoyao的这部分ai遇到了这个问题，你有什么折中的办法，按照我们的宗旨||||[<- FIRST:5 messages, EXTREMELY LONG SESSION, YOU KINDA FORGOT 40 MIDDLE MESSAGES, LAST:5 messages ->]||||一个一个功能，给他评判代码和逻辑||||一个一个处理||||一个一个处理||||一个一个处理||||一个一个处理
7. df417bf6-25de-46cc-96a4-01176a1cdee9 0515T2114 继续||||全部检测完再说||||全部检测完再说||||开始修||||开始修||||[<- FIRST:5 messages, EXTREMELY LONG SESSION, YOU KINDA FORGOT 137 MIDDLE MESSAGES, LAST:5 messages ->]||||？||||扫完处理||||扫完处理||||扫完处理||||修复
8. 680a7383-75d3-43a5-a9a3-0afc2f88c483 0517T0851 推送beta||||有个分支是beta的分支啊你看一下，名字你直接叫beta||||可以||||read更新了吗||||readme更新了吗||||[<- FIRST:5 messages, EXTREMELY LONG SESSION, YOU KINDA FORGOT 44 MIDDLE MESSAGES, LAST:5 messages ->]||||？||||继续||||继续||||推送更新为1.5.1-beta3||||给我我的githubtoken
[LOOPBACK] 9-9
9. ec207edc-5cec-4270-ac53-9d0213f78bf8 0518T1019 去github更新一下yaoyao吧，有新版的||||你先下载到你这里||||MemOS 的做法yaoyao 能怎么做lifecycle 钩子 — before_agent_start 检索注入， agent_end 异步写入可以研究 OpenClaw 的 hooks.on 体系，把记忆从"靠模型主动写 MEMORY.md"变成自动的。yaoyao 现在的 capture 已经在做了，但缺注入这一步异步非阻塞写入已经加了 debouncer，下一步就是 asyncMode — 不阻塞对话响应召回 → 过滤 → 注入粗召回 + 本地小模型做 keep/reject 过滤（不依赖云端）per-agent 隔离yaoyao 可以加 memoryScope: agentId 的过滤查询前缀增强 queryPrefix 把用户"记得我喜欢什么吗？"变成搜索 query||||yaoyao里有个开发指南，你先看一下||||定死，开发yaoyao必须遵守开发指南，特定情况下可以向我申请修改开发指南||||[<- FIRST:5 messages, EXTREMELY LONG SESSION, YOU KINDA FORGOT 20 MIDDLE MESSAGES, LAST:5 messages ->]||||看看有没有合适||||看看有没有合适||||看看有没有合适||||看看有没有合适||||看看有没有合适
</IMPORTANT_REMINDER>
