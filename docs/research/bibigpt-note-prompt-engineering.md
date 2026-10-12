---
title: BibiGPT 的视频笔记提示词工程：原文提取、槽位框架与实测对照
class: research
---

# BibiGPT 的视频笔记提示词工程：原文提取、槽位框架与实测对照

> 触发：反馈「我们目前的很多总结都感觉一般」，要求拿到 bibigpt.co 的笔记提示词工程做对标。
> 取证范围：**只读公开材料**——BibiGPT 官方博客的提示词模板文章、官方 agent skill 仓库（MIT）、
> 2023 年开源版 `BibiGPT-v1` 源码（MIT）。没有调用需要账号的私有接口，没有爬 Prompt 市场里的用户模板。
> 实测脚本与全部数字见 §4，可复现；局限见文末诚实清单。

## 0. 结论先行

1. **BibiGPT 的提示词工程不是"措辞更好"，是一张 8 行的槽位表 + 三条通用硬约束**，而且它把这套东西
   公开写在自己的博客里（§1.1、§1.2）。它值钱的地方是"替你规定输出长什么样"，不是词句漂亮。
2. **三条硬约束**：只用真实出现的时间戳 / 原文没提到就写 `not stated` / 不许补背景知识。
   它们自己的原话是："这三句才是让输出可以直接拿去用的原因"。
3. **它的产品形态是「一个视频一份笔记」，锚点用视频自带的章节与时间戳**，所以整份笔记能跳回原片。
   它明确拒绝把多段内容合成一份（§2）。
4. 对照 8 个槽位，我们**缺三个槽位**（观众、长度预算、忽略清单），**满一个槽位**
   （禁编造——我们是程序化校验，比它的提示词约束更硬），还有一个**结构性缺口**（全链路没有时间戳）。详见 §3。
5. **实测（§4）**：我们现在的单次调用提示词，产出的"总结"**比原稿还长**——
   8,116 字原稿 → 12,797 / 18,451 字笔记（**1.58× / 2.27×**）。
   一份不压缩、反而膨胀的总结，比措辞更像"一般"的来源。
6. **但"加一句长度上限"是无效的**：加上硬预算后实测仍写到上限的 **2.9–3.0 倍**。
   因为它和现有提示词的核心目标（"信息不缩水、宁可详尽"）直接冲突，模型选择牺牲预算。
   要真压下来必须**另立一个块**——这恰好印证了它那句「万能 prompt 最后会退回空总结」。

---

## 1. BibiGPT 公开的提示词工程

### 1.1 槽位表（这套东西的核心）

它把自己的方法论压成一张表，并给了同一意图的"空形容词反例"：

| 槽位 | 填什么 | 它给的反例 |
| --- | --- | --- |
| 角色 | 你要它扮演的工作身份，**带领域** | 「你是一个有帮助的助手」 |
| 观众 | 读这份总结的人，**带决策场景** | 「给大家看看」 |
| 长度 | 字数、条数、或「一屏能看完」 | 「尽量详细」 |
| 结构 | TL;DR + 要点 + 待办 + 风险，**写成标题** | 「结构化输出」 |
| 时间戳 | 要不要、格式、对应到原片哪一层 | 「如果可以的话标一下时间」 |
| 忽略清单 | 片头自我介绍、赞助、重复回顾、片尾订阅 | （空） |
| 禁编造 | 听不清就标不确定，禁止补事实 | 「补充相关背景」 |
| 语言 | 输出语言，**和视频语言分开写** | 「翻译得自然一点」 |

它的使用规则有两句值得直接抄走：

- 「**槽位表里空着的那一格，模型会用最平庸的默认值填上。你不写忽略清单，它就会把广告当论点。**」
- 另一篇文章把同样的意思收成四要素：「如果你的 prompt 里找不到**给谁看、多长、什么格式、忽略什么**
  这四项，输出几乎一定是空总结。」

### 1.2 三条通用硬约束

它在 12 条提示词那篇里把三条反复出现的约束单独点了出来，并说明为什么不能删：

1. **只用真实出现的时间戳**——「没有这句，AI 很容易顺手编一个看起来很合理的 00:14:32 出来。」
2. **原文没提到就写 `not stated`**——「凡是没写『查不到就写未提及』的提示词，迟早会给你编一个时间戳。」
3. **不许自己补背景知识**——它把这条列为"唯一不建议动的地方"。

它同时承认前提：「带时间戳的字幕稿比纯文字稿好用得多——本文有一半提示词要求回引时间戳，
**没有时间戳它就只能写 `n/a`，输出的可核查性会直接掉一半**。」

### 1.3 设计原则（从它的 4 篇文章里提炼）

| # | 原则 | 它的原话 / 做法 |
| --- | --- | --- |
| 1 | 值钱的是输出形状 | 「一条提示词值不值钱，不看措辞漂不漂亮，看它有没有替你规定输出长什么样。」 |
| 2 | 长度写成预算 | 「把长度写成预算，不要写成『详细』」「没有上限的总结会膨胀到你懒得读」 |
| 3 | 复用作者结构，不要重新分段 | 「描述区章节是**目录**，不是结论」；骨架直接复用 YouTube 官方章节 |
| 4 | 口播是证据，描述区是 SEO | 只在口播里取事实；描述区独有说法单列一节「描述区有、口播没有」 |
| 5 | ASR 错字要标注，不要静默修好 | 保留原字幕词 + 标「原字幕『X』」+ 打「待核」，**禁止**把听错的词圆成行业术语 |
| 6 | 每条技巧配反例 | 10 条技巧每条都带一个"写成空形容词之后长什么样" |
| 7 | 做不到就说做不到 | 没有有效对白/字幕缺失时**只输出失败原因**，明令「禁止编造章节」「宁可不写，也不要一份假纪要进知识库」 |
| 8 | 指令与正文用分隔符隔开 | 「指令放在最前，再用分隔符把指令和正文隔开」 |
| 9 | 提示词正文用英文，输出语言另定 | 「英文指令在各家 AI 对话工具里执行得更稳定；AI 回你的语言由你在对话里指定」 |

### 1.4 可用的成品提示词（原文摘录，按对我们的相关度排序）

以下是从它公开文章里摘的**少量代表性原文**（每篇 30 余条模板，不整库搬运；全量见文末出处）。
选它们的理由：分别对应我们的「观点笔记」「信息溯源」「练一练」「对照」四类产物。

**① 带时间戳的视频大纲**（对应我们的分段大纲）

```
You are given a video transcript with timestamps. Build a navigable outline of it.
Rules:
- Produce 6-12 sections. A section is one topic shift, not one paragraph.
- Format every line as: [HH:MM:SS] Section title - one sentence on what is covered.
- Use ONLY timestamps that appear in the transcript. Never estimate, interpolate or invent one.
  If a section starts where no timestamp is marked, write [time not marked] instead of guessing.
- Titles must be specific ("Why the 2019 pricing change backfired"), never generic
  ("Introduction", "Key points").
- End with one line: "Longest section: <title> (~<minutes> min)".
- Under 300 words. No preamble, no closing remarks.
```

**② 给决策者的摘要**（四块固定，含"没回答什么"）

```
Summarize this transcript for a busy reader who will never watch the video.
Output exactly these four blocks:
1. BOTTOM LINE - 2 sentences. The single most useful thing in the video.
2. WHAT IT COVERS - 4-6 bullets, each under 20 words.
3. WHO SHOULD WATCH - 1 sentence on who benefits, 1 sentence on who can safely skip it.
4. WHAT IT DOES NOT ANSWER - 2-3 questions a reader may arrive with that the transcript leaves open.
Rules:
- Under 250 words in total.
- Every statement must be traceable to the transcript. If something is only suggested,
  write "implied, not stated".
- Add no background knowledge of your own.
```

**③ 会议待办（负责人/期限/时间戳/把握程度 + NOT ACTIONS 单列）**（对应我们的「行动项清单」）

```
Extract the action items from this transcript.
Return a table with the columns: Action | Owner | Due or trigger | Timestamp | Confidence
Rules:
- Owner: use the name actually spoken. If nobody was named, write "unassigned"
  - do not infer an owner from context.
- Due or trigger: the exact wording used, otherwise "not stated".
- Timestamp: where the action was raised. If the transcript carries no timestamps, write "n/a".
- Confidence: high (explicitly agreed) / medium (proposed, not confirmed) / low (mentioned in passing).
- Under the table add a NOT ACTIONS list: anything that sounds like a task but was rejected or postponed.
- If there are no action items, reply "No action items found" and stop. Do not manufacture any.
```

**④ 待核实清单（明确拒绝替你做事实核查）**（对应我们的「信息溯源」）

```
Do not fact-check this transcript. Instead, build the list of things that WOULD need checking.
One row per checkable claim: Claim (one sentence) | Exact quote | Timestamp |
Type (statistic / causal / attribution / prediction / definition) | How to verify it, in one line |
Risk if wrong (high / medium / low)
Rules:
- Only falsifiable claims qualify. Tastes and preferences do not; predictions about
  measurable outcomes do.
- Do not say whether a claim is true or false, and do not use your own knowledge to judge it.
- ... Sort by risk, highest first. Maximum 15 rows.
```

**⑤ 讲课转自测题**（对应我们的「练一练」）

```
Turn this lecture transcript into a self-test.
Produce:
A. 8 recall questions (short answer) spread across the whole lecture, not only the opening third.
B. 4 application questions that require combining two ideas from the lecture.
C. An answer key. Each answer paraphrases the transcript and cites the timestamp it came from.
Rules:
- Every question must be answerable from the transcript alone. Delete any question that needs
  outside knowledge.
- Mark anything the speaker called important or exam-relevant with [flagged by speaker].
- Keep each answer under 40 words.
- If the transcript is too thin for 12 questions, produce fewer and say how many the material
  actually supports.
```

**⑥ 两个视频对比**（对应我们的「对照」）

```
You are given two transcripts on the same topic, labelled A and B.
Output:
1. AGREE - points both make, one line each, with a timestamp from each side.
2. DISAGREE - A's position, B's position, and the evidence each one offers.
3. ONLY IN A / ONLY IN B - what one covers that the other never raises.
4. WHICH TO WATCH - 3 sentences: for which reader, which video, and why.
Rules:
- Never merge the two into a single voice. Always attribute.
- A point that appears in only one transcript does not belong in AGREE.
- Where you cannot tell whether they truly disagree or merely word things differently,
  write "wording differs, substance unclear".
```

**⑦ 忽略清单（技巧 7 的完整块）**

```
请忽略并在总结里删除：
- 前 60 秒自我介绍和频道宣传
- 任何赞助口播、优惠码、联盟链接
- 「上期回顾」超过两句的部分
- 片尾求点赞、求订阅、下期预告
如果某段同时包含广告和有效信息，只保留有效信息，并标注「夹在赞助段中」。
```

### 1.5 2023 开源版的原始形态（MIT）

`JimmyLv/BibiGPT-v1` 的 `lib/openai/prompt.ts` 里的 `getUserSubtitlePrompt` /
`getUserSubtitleWithTimestampPrompt` 是这套东西最早的形态，可以看清它的骨架：

- 给模型一个**字面母版**：`## Summary` / `## Highlights` / `- Bulletpoint`；
- 条数、每条最少词数、大纲层级、是否加 emoji 全部**参数化**（`sentenceCount` / `detailLevel` / `outlineLevel`）；
- 带时间戳版直接把格式写成 `- seconds - [bullet_point]`，并要求"每条只要开始时间"；
- 输入侧把逐字稿压成 `[seconds] - [text]` 的格式；
- 输出语言单独一个槽：`Reply in ${languageName} Language.`

**这套仓库是 MIT**，所以它的实现思路可以直接用；博客里的模板文章是 BibiGPT 的版权内容，
本文件只做了框架提炼与少量引用，没有整库搬运（理由见诚实清单）。

### 1.6 它把提示词做成了什么产品能力

| 能力 | 形态 |
| --- | --- |
| 自定义提示词 | 存成"私人公式"，可置顶成默认，下次打开任意视频自动套用 |
| Prompt 市场 | 官方与其他用户的模板，可浏览筛选、一键套到当前视频 |
| 二次加工 | 已有笔记上再跑一条自定义提示词（`summary by-prompt`），**会覆盖原笔记** |
| 章节总结 | 独立接口 `summarizeByChapter`，返回带时间区间的章节数组 |
| 追问 | 拿字幕数据当上下文对具体章节提问 |
| 导出 | Obsidian / Notion / 本地 Markdown，带 YAML frontmatter |

它的 agent skill 仓库（`JimmyLv/bibigpt-skill`，MIT）里还有一条架构约定值得记：
SKILL 文件「**是发现用的存根，不是使用说明**……live sources always match the current product;
anything copied into this file would go stale.」——把易漂移的内容留在服务端而不是文档里。

---

## 2. 它明确不做的事（对我们的设计同样有约束力）

1. **不把多个视频合成一份笔记**。它对比两个视频时也是输出 AGREE / DISAGREE / ONLY IN A / ONLY IN B
   四块、强制标注归属，并明令「**Never merge the two into a single voice. Always attribute.**」
2. **不替你做事实核查**。第 ④ 条明确"不要判断真假、不要用你自己的知识评判"。
3. **内容不足就拒答**，不硬写。「宁可不写，也不要一份假纪要进知识库」。
4. **不补背景知识**，包括不替讲者圆他没说的话。

对照我们：第 1 条我们目前是**反着来的**——多份素材在同一个 AI 加工节点里汇成一份产物
（见 §3 与 §4 的合并输入实测）。

---

## 3. 对照 ScribeFlow：8 个槽位逐项

| 槽位 | BibiGPT | ScribeFlow 现状 | 证据 |
| --- | --- | --- | --- |
| 角色 | 岗位 + 领域 | ✅ 有 | `packages/shared/src/prompt.ts` 的 `PROMPT_GUANDIAN_V4`（"深度内容编辑兼版式编辑"） |
| 观众 | 带决策场景 | ❌ **无**。全篇没有"这份笔记写给谁看"，也没有"谁可以不看" | 同上 |
| 长度 | 硬预算（80 字 TL;DR / ≤7 条 / ≤600 字） | ❌ **反向**。明确要求"宁可详尽，不可因精简丢失信息" | `PROMPT_GUANDIAN_V4` 核心目标 1；`PROMPT_GUANDIAN` 同 |
| 结构 | 写成标题的母版 | ✅ 有，而且比它更细 | `PROMPT_GUANDIAN_V4` 输出母版 |
| 时间戳 | 要不要 / 格式 / 对应到哪一层 | ❌ **全链路没有**。转写只回纯文本；B 站只取 `bvid/cid/pages`，不取字幕、不取简介里的章节 | `apps/server/src/lib/ai.ts` 的 `transcribeAudio` 返回 `string`（`response_format: "json"`）；`apps/server/src/lib/bilibili.ts` 的 `x/web-interface/view` 调用只留 `bvid/cid/pages` |
| 忽略清单 | 片头 / 赞助 / 回顾 / 片尾订阅，逐条列 | △ 只有泛化的"寒暄、重复、无关闲聊可去噪" | `PROMPT_GUANDIAN_V4` 提炼方法论 3、4 |
| 禁编造 | 提示词层面要求"听不清标不确定" | ✅✅ **我们更强**：引用要过程序化校验，`blocks[].quotes[]` 必须逐字命中原文，`maxMiss: 0` | `RECIPE_INSIGHT_V4` 的 `scan` 步 `asserts`，算子见 `packages/shared/src/recipe.ts` 的 `citationsInOriginal` |
| 语言 | 输出语言与视频语言分开写 | △ 有"输出语言与原文一致"，但没有独立的输出语言槽 | `PROMPT_GUANDIAN_V4` 提炼方法论 6 |

**一句话总结差距**：我们赢在"禁编造"（程序化校验 > 提示词约束），输在"没规定形状"——
观众、长度、忽略清单三个槽位空着，加上时间戳这条路整条没修。

另外两处它做了、我们没做的小而实的动作：

- **"如果只能看 8 分钟"**：章节骨架之后追加一节，指出**一段连续时间区间**，并说明理由
  （不许推荐片头和赞助段）。我们的分段大纲没有这一层。
- **"这场讲座没提供、但文章非补不可的东西"（GAPS）**：把"缺口"当成输出的一等公民。
  我们的 v4 有"原文未覆盖"一行汇总，方向一致但更弱。

---

## 4. 实测：我们的总结到底长什么样

### 4.1 方法

同模型（用户设置里的 `deepseek-flash`）、同温度（`0.3`，与 `apps/server/src/lib/ai.ts` 的
`requestChat` 一致）、同一份真实文稿，只改提示词。三个臂：

| 臂 | 提示词 |
| --- | --- |
| **A 现状** | `BUILTIN_PROMPT_BLOCKS` 里 `builtin.insight` 的 `prompt`（观点笔记 v2，单次调用），原样 |
| **B A + 忽略清单** | 只追加 §1.4 第 ⑦ 条那个忽略清单块——**单变量臂** |
| **C A + 全槽位** | 追加观众 + 硬长度预算（≤1500 字）+ 禁编造 + 反例 + 拒绝兜底 |

每臂跑 2 次，共 6 次调用。测得数字：

### 4.2 输入一：单个视频的真实校对稿（8,116 字）

取自本机运行记录 `run_1034e5db` 的 `process.refine` 节点产物（DeepSeek 新模型评测类视频，
开头是"大家好，我是 X"式自我介绍，结尾是"能三连回回血吗"）。

| 臂 | 笔记字数 | ÷ 原稿 | completion tokens | 标题数 | "未提及"占位 | 时间戳 |
| --- | --- | --- | --- | --- | --- | --- |
| A 现状 | 18,451 / 12,797 | **2.27× / 1.58×** | 22,442 / 26,362 | 17 / 15 | 2 / 2 | 0 / 0 |
| B +忽略清单 | 12,057 / 11,347 | 1.49× / 1.40× | 17,875 / 13,422 | 16 / 17 | 1 / 1 | 0 / 0 |
| C +全槽位 | 4,411 / 4,563 | **0.54× / 0.56×** | 8,865 / 8,635 | 14 / 14 | 0 / 0 | 0 / 0 |

用平均值对比：

- **A 的笔记是原稿的 1.93 倍**（15,624 字总结 8,116 字的稿子）。C 是 **0.55 倍**（4,487 字）。
  **C 比 A 短 3.48 倍**，成本（completion tokens）**低 2.79 倍**。
- 时间戳全臂为 0——**不是模型不肯写，是输入里根本没有时间戳可引**（§3 的结构性缺口）。

### 4.3 输入二：四段不相关视频的合并稿（12,566 字）

取自 `run_4cbb` 的 `process.refine` 产物。这一份专门用来压"多份素材汇成一份"这个边界。

| 臂 | 笔记字数 | ÷ 原稿 | 标题数 | 结果 |
| --- | --- | --- | --- | --- |
| A 现状 r1 | 18,675 | 1.49× | 49 | 四篇笔记首尾相接，一个输出里出现多个 `#` 一级标题 |
| A 现状 r2 | 16,129 | 1.28× | 49 | 同上 |
| B +忽略清单 | 13,604 / 22,069 | 1.08× / 1.76× | 24 / 47 | 长度在两个样本间差 1.6 倍，不稳定 |
| C +全槽位 r1 | 3,165 | 0.25× | 13 | 为满足"一份笔记"的格式，**编了一个不存在的共同主旨**（"共同态度是反对话术遮蔽收入与治理成本……"） |
| C +全槽位 r2 | 167 | 0.013× | 0 | 直接拒答，列出四段主题请人指定其中一段 |

三种结果**没有一种是"四段各自成篇、各带归属"**——也就是 BibiGPT 用 `Never merge … Always attribute`
挡住的那个失败模式，我们这边没有任何机制挡。

### 4.4 忽略清单：小样本，方向一致

"片尾求三连"是否被写进笔记（逐条人工看上下文判定，不看关键词）：

| 臂 | 命中次数 |
| --- | --- |
| A 现状（无忽略清单） | **2 / 2** |
| B +忽略清单 | 0 / 2 |
| C +全槽位（含忽略清单） | 1 / 2 |

有忽略清单的 4 次里 1 次仍写到，无忽略清单的 2 次全写到。**n 太小，不做统计推断**；
只能说方向一致，且这个槽位不是万能的（§4.5 同理）。

### 4.5 一个反直觉的结果：长度预算拼不上去

C 臂我写明了「全篇不超过 1500 字」，实测产出 **4,411 / 4,563 字——上限的 2.94 / 3.04 倍**。

原因是它和现有提示词的核心目标直接冲突：v2 的「信息不缩水」「宁可更详尽」写在最前面，
长度预算写在最后面，模型二选一时牺牲了预算。

**这条实测的价值在于：想省字不能靠"补一句上限"，得另起一个块**——把"压缩"设成那个块的主目标，
而不是给"展开"型提示词打补丁。BibiGPT 那边正是这么做的：它的长度预算是独立模板
（"需要一屏纪要时用这条；需要深度笔记时另存一条『详细版』，**不要混用**"）。

---

## 5. 建议的落地顺序（按"性价比"排，不含产品决策）

| 顺序 | 动作 | 依据 | 规模 |
| --- | --- | --- | --- |
| 1 | 给现有块补**忽略清单**槽（片头自我介绍 / 赞助口播 / 上期回顾 / 片尾求三连） | §4.4 方向一致；§3 该槽位为空 | 改提示词文本，1 个文件 |
| 2 | 新增一个**速读版块**（观众 + 硬长度预算 + 忽略清单 + 拒绝兜底），**不动**现有 v2/v4 | §4.2 C 比 A 短 3.48 倍、成本低 2.79 倍；§4.5 说明它必须独立成块 | 新增提示词块，按现有 v1–v4 系列做法 |
| 3 | 合并输入要么**拆成多份产物并各带归属**，要么按"合并型节点"明确标注 | §4.3 三种结果都不合格；§2 第 1 条 | 引擎行为，属产品决策 |
| 4 | **时间戳**：转写改取分段（`verbose_json`）、B 站补抓字幕与简介章节、结果页可跳回原片 | §3 该槽位为空；§1.2 "可核查性会直接掉一半" | 跨 `apps/server` + `packages/shared` + `apps/web`，最大的一件事 |

第 4 条是唯一一件"不做就永远写不出可核查笔记"的事，但它涉及三个包含 UI，
**不是提示词层面的改动**，所以单独列出来等决策。

### 5.1 第 1、2 条落地后的复测（同一个模型、同一份 8,116 字校对稿）

第 1、2 条已按上表落地（`packages/shared/src/prompt.ts` 的 `SLOT_IGNORE_LIST` 与 `builtin.brief`）。
把**上线的那份提示词**直接 import 进实测脚本重跑，各 2 次：

| 臂 | 笔记字数 | ÷ 原稿 | completion tokens | 长度预算 |
| --- | --- | --- | --- | --- |
| 「观点笔记（详尽版）」现状 | 16,493 / 18,459 | 2.03× / 2.27× | 19,545 / 21,517 | 无上限，未遵守 |
| 「观点速读」新块 | **698 / 610** | **0.09× / 0.08×** | 2,272 / 3,496 | **698 / 610 ≤ 800 ✓** |

三点值得记下来：

1. **长度预算这次被遵守了**。上一轮把「不超过 1500 字」拼到详版上是 2.94–3.04 倍超标（§4.5），
   这一轮把压缩设成首要目标、并**不复用"信息不缩水"**之后，两次都落在 800 字以内。
   印证了"压缩必须独立成块"。
2. **"原稿没有回答"这一栏确实产出了有用内容**，不是套话——实测两次都点出了原稿只有相对说法、
   没有绝对价格与延迟数据，以及 V4 Pro 的下线时间未给。
3. **详版的长度不稳定**：同一个提示词四次采样落在 12,797–18,459 字之间（跨度 44%）。
   所以"详版比速读版长"这件事是稳定的，但"详版具体多长"不可预期。


---

## 诚实清单

**没做完 / 没验证的**

- **没有拿到线上产品的真实系统提示词**。拿到的是：官方博客公开的模板（30+ 条）、官方 agent skill 仓库
  （MIT，但是编排说明不是笔记提示词）、2023 开源版源码（MIT）。**线上版本可能已经更强**，
  本文所有关于"它怎么做"的陈述都以这几份公开材料为上限。
- **Prompt 市场里的用户模板没有取**（需要账号），也没有登录网页版看内置模板列表。
- **没测多步配方版**（v4 的 scan→draft→audit→finalize 四次调用）。实测的是**单次调用**的 v2。
  v4 有程序化引用校验，行为可能与 v2 有实质差别。
- **没测 B 站字幕路径**——本文结论建立在"转写只回纯文本"这个代码事实上，没有实跑一遍带字幕的视频。

**用了模型 / 简化了的**

- 实测的"观众 + 硬长度预算 + 禁编造 + 反例"是**打包成一个臂**的，没有逐槽位归因
  （只有忽略清单是严格单变量）。所以 §4.2 里 C 相对 A 的差距**不能拆成"每条槽值多少"**。
- 每臂只有 **2 个样本**，共 6 次调用。温度 0.3 下同一臂两次结果差异明显
  （A 臂 12,797–18,451 字），**不能做统计推断**，只能看方向和量级。
- 只用了**一个模型**（用户设置里的 `deepseek-flash`）。换模型结论可能变。
- 1500 字的上限是**我自己设的**，不是产品值。它没被遵守这件事能说明"拼一个上限无效"，
  但具体倍数（2.94–3.04×）只在这一个模型 + 这一份提示词上成立。

**已知有 bug / 作废的**

- **第一版探针作废**：我先用关键词（关注/点赞/收藏/转发/三连）扫库里 40 份 `process.prompt` 产物，
  报出 15/40 命中。把 15 份里每一处命中的上下文都打出来看过后，**15/15 全是误报**：
  命中的是"作者以点赞收藏三连收尾"这类**报告**（笔记在描述视频结构）、
  "三百多人点赞"（Reddit 点赞数）这类**正当内容**，以及"视频里收藏的攻略""收藏价值"
  "把请求转发给后端服务器"这类**同词不同义**。
  探针测的是"出现关键词"，不是"采纳了口播"，**作废重做**，才有 §4.4 的人工判定。
- §4.3 的 C-r1 产物本身是个 bug 现场：它为满足格式编了一个不存在的共同主旨。这是**模型的失败**，
  不是提示词的可用效果，引用时不要当成范例。
- **没有整库搬运它的模板**：博客模板是 BibiGPT 的版权内容（其页面本身面向"复制粘贴"发布，
  但整库复制进我们仓库是另一回事）。所以仓库里只留了**框架提炼 + 少量带出处的引用**，
  全量请走文末链接。它的两个 GitHub 仓库是 MIT，实现思路可放心用。

**测量局限**

- §4.2 / §4.3 的输入文稿来自本机运行库（`apps/server/data/scribe-flow.sqlite`，已在 `.gitignore` 内），
  **没有随仓库提交**，所以复现需要自己用 §4.1 里的 run id 从本地库取稿。
- "笔记字数"含 Markdown 标记与空白，是原始字符数，没有剔除格式开销；三个臂口径一致，横向可比。
- "时间戳 0"是因为输入没有时间戳，**不是模型拒绝写**。

---

## 出处

BibiGPT 官方博客（模板文章，版权归 BibiGPT）：

- 视频总结 Prompt 模板（10 条技巧 + 反例 + 6 个场景模板 + 槽位表）
  <https://bibigpt.co/blog/posts/video-summarizer-prompts>
- 视频总结 Prompt 库（12 条作业型提示词，正文为英文）
  <https://bibigpt.co/blog/posts/video-summary-prompts-library>
- YouTube 视频总结 Prompt 模板（10 条技巧 + 6 个场景，含章节/赞助/自动字幕/置顶勘误）
  <https://bibigpt.co/zh/blog/posts/youtube-video-summary-prompts>
- 第二大脑 + 知识图谱（学习型自定义提示词模板、Mermaid 导图、Obsidian 落地）
  <https://bibigpt.co/zh/blog/posts/second-brain-knowledge-graph-bibigpt-method-2026>

GitHub（均 MIT）：

- `JimmyLv/BibiGPT-v1` → `lib/openai/prompt.ts`（2023 开源版提示词实现）
  <https://github.com/JimmyLv/BibiGPT-v1>
- `JimmyLv/bibigpt-skill` → `skills/bibi/`（官方 agent skill；`workflows/quick-summary.md`、
  `deep-dive.md`、`research-compile.md`、`export-notes.md`、`advanced-tools.md`）
  <https://github.com/JimmyLv/bibigpt-skill>

本仓库内被对照的代码：

- `packages/shared/src/prompt.ts`（`PROMPT_GUANDIAN`、`PROMPT_GUANDIAN_V4`、`BUILTIN_PROMPT_BLOCKS`）
- `packages/shared/src/recipe.ts`（`RECIPE_INSIGHT_V4`、`citationsInOriginal`）
- `apps/server/src/lib/ai.ts`（`transcribeAudio`、`requestChat`）
- `apps/server/src/lib/bilibili.ts`（`x/web-interface/view` 取值范围）
- `apps/server/src/lib/engine.ts`（`withSourceMetaHint`、配方执行与联网核查分支）
