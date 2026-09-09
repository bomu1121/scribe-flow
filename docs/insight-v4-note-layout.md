# ScribeFlow 观点提炼 v4：期刊式轻排版版

> 状态：已实现并自检通过（内置块 `builtin.insight.v4` 已落地并接管推荐位；版式样例经用户确认；typecheck/test/build/lint 全绿，同稿渲染并排截图视觉复核通过；真实 Key L2 抽测视环境另行安排）
> 日期：2026-09-09
> 背景：用户反馈当前「观点提炼」输出文档排版丑——小标题层级堆叠、脚手架堆砌、观感差；要求在**信息不缺失**的前提下按同类笔记产品调研结果重做一版输出版式。
> 关联代码：`packages/shared/src/prompt.ts`、`packages/shared/src/prompt.test.ts`、`apps/server/src/lib/engine.recipe.test.ts`、`apps/web/src/styles/markdown.css`（仅复核，预期不动）
> 版式样例：[v2 现状版式](./samples/insight-v2-layout-sample.md) / [v4 新版式](./samples/insight-v4-layout-sample.md) / [演示稿](./samples/insight-v4-demo-transcript.md)

---

## 1. 问题诊断

当前推荐「观点提炼 v2」（`builtin.insight`，单次调用）的固定输出结构（`prompt.ts` PROMPT_GUANDIAN）：

```markdown
# 观点提炼：〈主题〉
## 总体概要
## 核心观点与支撑
### 观点1：〈主张〉
- **现象/背景**：…
- **作者的判断**：…
- **论据/支撑**：
  - **事实/数据**：…
  - **案例/类比**：…
  - **逻辑推演**：…
- **原文金句/关键表述**：…
- **边界/局限/反方观点**：未提及
### 观点2：…（整块结构重复）
## 关键事实与数据清单
## 论证脉络
## 金句摘录
## 情绪基调与弦外之音
## 启发与行动
```

“丑”的具体来源（对演示稿的真实复现见 `insight-v2-layout-sample.md`）：

1. **标题层级堆叠**：一份笔记 H1 + 8 个 H2 + 每观点一个 H3，长稿可达 30+ 个标题；树越深，扫读越累。
2. **脚手架噪音**：每个观点块机械重复 5–7 个同键标签，且空槽逐条写「未提及/未明确说明」，占行不占信息。
3. **分区多而薄**：论证脉络、情绪基调、启发等常只有一两句也各自独立成 `##` 大节，文档碎成一片。
4. **重复堆字**：同一事实/数据在观点块内、清单表格里重复粘贴，视觉与篇幅双双膨胀。

---

## 2. 同类需求排版调研

调研对象：与“把长音频/视频/文稿加工成可读笔记”最接近的产品与模板，以及通用中文 Markdown 排版规范。

| 参考对象 | 形态 | 对本版设计的借鉴点 |
|---|---|---|
| [通义听悟（智能纪要/章节速览/AI 笔记）](https://www.ithome.com/0/756/690.htm)（官方能力见[功能发布记录](https://help.aliyun.com/zh/tingwu/release-notes)） | 转写稿 + 章节速览、智能总结、关键词/金句等轻量模块 | 分节少而准；结论与要点用短句列表承载，不叠深标题；金句/关键信息独立成点缀模块 |
| [飞书·会议纪要写作方法](https://www.feishu.cn/content/article/7602953866866429153) | 纪要写作规范：结论先行、按议题组织、待办收尾 | “一句话结论 + 议题小节 + 行动项”的骨架可迁移到观点笔记：导读在前，主干少标题，启发/行动收尾 |
| [NotebookLM 报告输出（概述/时间线/学习指南等）](https://notebooklm.hk/id/blog/notebooklm-report-guide/) | 多形态简报，段落与要点为主、引用就近标注 | 输出形态按阅读场景裁剪；正文保持段落流，引用与出处作为嵌入式元素而非标题分支 |
| [NoteKing（视频/文章→学习笔记，13 套模板）](https://github.com/bcefghj/noteking) | 模块化小模板：元信息行 + 摘要块 + 分块要点 | 模板“小而平”：头部元信息不占标题位；摘要独立成块；要点平铺 |
| [bili-note（B站视频→学习导向 Markdown 笔记）](https://github.com/Rimagination/bili-note) | 一键生成带原文定位的学习笔记 | 笔记以“信息块”为单位组织，而不是章节树的复刻 |
| [BibiGPT × Zettelkasten 卡片笔记工作流](https://bibigpt-growth.chatvid.ai/zh/blog/posts/zettelkasten-method-ai-video-notes-bibigpt-2026/) | 一稿多卡：摘要卡 + 原子观点卡 | 观点之间用横向节奏（分隔/独立块）区隔，不必用标题层级表达归属 |
| [Fastread：结构化笔记 + 视觉卡片](https://forum.trae.cn/t/topic/11699/3) | 长文速读后生成结构化笔记与高颜值视觉卡 | 美观主要来自“节奏与留白”，而不是标题加粗堆叠 |
| [中文技术文档风格指南（标题规则）](https://raw.githubusercontent.com/ruanyf/document-style-guide/refs/heads/master/docs/title.md) | 排版规范：标题分级克制，细分交给列表/加粗 | 全篇标题层级压到两层以内；二级细分一律用加粗短句/列表表达 |

**调研结论（设计原则）**：

1. 标题是文档的骨架，不是容器：一篇“观点笔记”只需要 1 个 H1 + 0–3 个 H2；细分信息用**加粗主张句、单层列表、引用块**承载。
2. 结论先行：标题下第一眼应是“一句话读懂”，而不是分区目录。
3. 观点之间用横向分隔（`---` + 加粗主张句）制造卡片节奏，替代纵向的 H3 堆叠。
4. 引用/金句是“点缀物”：用引用块就地呈现，不为其建立标题分支。
5. 空槽不打印占位符：原文没讲的维度整块省略，缺失的维度信息在文末**一行汇总**，兼顾干净与可追溯。
6. 全篇保持标准 Markdown（GitHub 风味 + GFM 表格 + 引用块），在站内预览、Obsidian/坚果云、Typora、VS Code 中观感一致；不引入 Obsidian 专属 callout 语法。

---

## 3. 已确认决策（用户拍板，2026-09-09）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 版本策略 | 新增 `builtin.insight.v4`，**推荐位从 v2 移到 v4**；v1/v2/v3 保留可切换 |
| 2 | 执行方式 | 配方 4 步核对版（scan → draft → audit → finalize），复用 v3 流水线语义，替换为 v4 版式母版；约 4 次调用 |
| 3 | 排版风格 | 期刊式轻排版（第 4 节母版） |
| 4 | 空槽规则 | 省略空槽 + 文末单行汇总「原文未覆盖」 |

---

## 4. 版式母版（v4 期刊式，标准 Markdown）

```markdown
# 观点提炼：〈主题〉

> **一句话读懂**：〈1-2 句：作者在讲什么、立场是什么、最大信息增量是什么〉
>
> **脉络**：〈2-4 句：起点 → 推进 → 转折 → 落脚点；单主题极简单时可省略此行〉

---

## 核心观点

**1. 〈一句主张，加粗独立成段；作者明确的主观判断句可加“作者认为/判断”提示〉**

〈自然行文 1-3 句：现象/背景/展开；专名、数字、因果、时间原样保留；客观事实与主观判断用措辞区分〉
〈“逐字原话”若必须就地呈现，用引用块紧跟主张或行文之后〉
〈同类列举 ≥2 项且需扫读时才用单层列表，允许行首以“事实/案例/推演/边界”等短标签开头，禁止嵌套二级列表〉

---

**2. …**（观点之间以 `---` 分隔，数量与原文论证逻辑一致，通常 3-6 个）

## 事实与数据（可选）

| 事实/数据 | 出处/备注 |
|---|---|
| … | … |

## 金句摘录（可选）

> 金句一（逐字）

> 金句二（逐字）

---

**基调与弦外之音**：〈有则写，无则整段不出现〉

**启发与行动**：〈有则写，无则整段不出现〉

**原文未覆盖**：〈整篇缺失的维度在此一行汇总；全部覆盖则整行不出现〉
```

### 4.1 版式规则（提示词内化成文，同时进断言门）

| # | 规则 |
|---|---|
| R1 | 全篇**只允许 1 个 H1**；分区标题只允许 `##`，0–3 个；**禁止 `###` 及更深标题**；观点主张一律加粗段落，不设小标题 |
| R2 | H1 之后第一块内容为 `> **一句话读懂**：…` 引用块（可选第二行 `> **脉络**：…`） |
| R3 | 观点之间用 `---` 分隔；每个观点块顺序固定：主张句 → 行文 → 需要的单层列表 → 需要的逐字引用块 |
| R4 | 空槽省略：某个维度（事实/案例/金句/边界等）在该观点没有原文依据时，**该行/该块不出现**，禁止写「未提及」「未明确说明」等占位 |
| R5 | 文末汇总：某维度通篇无原文依据（如外部反方观点、情绪基调、启发）时，用 `**原文未覆盖**：…` 一行列出，让“作者没说”的元信息不丢失 |
| R6 | 事实与数据表、金句摘录区只放**可独立引用的条目**，与观点行文互为索引，不要求逐条重复；表格必须含表头分隔行 |
| R7 | 引用块内文字必须**逐字**摘自原文（audit 回查）；「原文未覆盖」行只能陈述缺失，不得编造 |
| R8 | 不输出代码围栏、HTML、JSON、开场白/结束语；不用 emoji 或符号堆砌装饰 |

### 4.2 “信息不缺失”验收定义

- 事实层：专名、数字、单位、时间、案例、因果链在观点行文或速查表中至少出现一次，写法与原文一致；
- 观点层：作者的每个重要判断（含自相矛盾处、让步、局限声明）都有对应观点块或文末汇总行；
- 原话层：值得引用的关键表述以逐字引用块保留（观点内或金句区）；
- 缺失层：任何“原文没讲”的维度只在 `**原文未覆盖**` 行声明，不虚构、不放回正文。

---

## 5. 配方与断言门设计

v4 复用仓库 `Recipe` 原语（`schema: 1`，引擎已支持，v3 试点验证过），4 步与 v3 相同的管线语义：

| 步骤 | id/label | 做什么 | 期望 | 断言门 |
|---|---|---|---|---|
| scan | 通读拆解 | 输出 `{"oneLiner":"…","blocks":[{"title":"…","quotes":["逐字摘录，≤80 字"]}]}`；不写正文 | JSON | `jsonRootKeys: ["oneLiner","blocks"]`；`citationsInOriginal: blocks[].quotes[], maxMiss 0` |
| draft | 分块起草 | 依据拆解清单 + 原文（`{{input}}`），按第 4 节母版起草 | 文本 | 含 `#`（防空稿） |
| audit | 回文核对 | 逐条回查草稿的事实/数据/专名/金句是否逐字忠于原文；同时检查版式违规（出现 `###`、出现「未提及」占位、空槽被补内容） | JSON `{"items":[{"quote","inOriginal","note"}]}` | `jsonRootKeys: ["items"]` |
| finalize | 修正成稿 | 按核对表修正，**严格按母版重排输出**：禁 H3 及更深、空槽省略、文末汇总 | 文本 | 含 `#`；`notContains: "###"`；`notContains: "```"` |

说明：

- scan 在 v3 基础上增加 `oneLiner` 根键（一句话导读的数据来源），其余沿用 v3 语义；quotes 逐字约束与回文断言复用现有 `citationsInOriginal` 能力。
- finalize 的 `notContains "###"` 是版式硬门：模型若滑回老写法会得到可读的错误（“步骤 修正成稿 断言未通过”），配合 finalize 提示词里的版式自查清单；该断言属于非重试业务错误，与 v3 的 JSON 断言同一语义。
- draft/audit/finalize 的 system 均携带原文（`{{input}}`/`{{all}}`），长稿信息不缺失由 v3 已建立的“携带原文 + 回查”机制保证，本次不新增调用轮次。

---

## 6. 内置块与推荐位

`packages/shared/src/prompt.ts` `BUILTIN_PROMPT_BLOCKS`：

- 新增：`id: "builtin.insight.v4"`，`name: "观点提炼（排版版）"`，`series: "观点提炼"`，`version: "v4"`，`recommended: true`；
- 描述文案：标注“多步核对 + 期刊式排版：4 次调用、含回文核对与版式硬门，成本约 4 倍于单次版”；
- `builtin.insight`（v2）：`recommended` 改为不设置（保留块本身，提示词一字不动）；
- `builtin.insight.v3`：保持现状（配方试点，不设推荐）。
- 样式/结构上的对照物：`builtin.trace.v2`、`builtin.gameguide.v2` 同为“推荐 = 核对版”的先例。

---

## 7. 测试与验收

### 7.1 单测与集成测试

| 用例 | 文件 |
|---|---|
| 观点提炼系列版本集合变为 `["v1","v2","v3","v4"]`；`builtin.insight.v4` 存在且 `recommended === true`；v2 不再 recommended | `packages/shared/src/prompt.test.ts`（同步修订既有断言） |
| v4 为 4 步配方：步骤 id `["scan","draft","audit","finalize"]`、每步 system 非空；finalize 断言含 `notContains "###"` | 同上 |
| v4 配方通过 Recipe zod 运行时校验 | `packages/shared/src/recipe.test.ts` |
| mock 4 步全流程：输出为 finalize 产物、日志 step 依次 scan/draft/audit/finalize；finalize 返回含 `###` → `node.step.error` 文案含步骤 label | `apps/server/src/lib/engine.recipe.test.ts` |
| 回归：v2/v3 用例保持全绿（v2 提示词文本与推荐位断言同步后仍逐字一致） | 同上 + `prompt.test.ts` |

### 7.2 验收口径

- L0：`pnpm typecheck && pnpm test && pnpm build && pnpm lint:slop`（新增提示词中文化、无 emoji 装饰，需过 slop 扫描）。
- L1：mock 集成用例全绿；v2/v3 零回归。
- L2（视真实 Key 环境）：真实文稿跑 v4，节点摘要“配方 4 步”、日志按步分组、最终 Markdown 可 diff。
- L3（视觉）：同一演示稿的 v2 / v4 样例用真实 CSS 渲染并排截图，人工复核无 H3 堆叠、分区 ≤3、信息项齐全；用户确认观感后关闭本里程碑。

### 7.3 风险与回退

| 风险 | 对策 |
|---|---|
| finalize 的 `notContains "###"` 误杀 | 错误可读（含步骤 label）；模型回退至 v2/v3 即可；若误杀率偏高，仅保留 audit 提示、放宽该断言（记录在案） |
| 4 次调用成本翻倍 | v2 单次版保留且可选；v4 描述中明示成本 |
| 观感仍不达预期 | v4 从推荐位移除或整块摘除即可回退（无 schema/图文件残留） |
| “省略空槽”被误读为丢信息 | audit 提示词与 §4.2 验收定义绑定；真实 Key L2 用例核对空槽行为 |

---

## 8. 关联文档

- 版式样例：[v2 现状版式](./samples/insight-v2-layout-sample.md) / [v4 新版式](./samples/insight-v4-layout-sample.md) / [演示稿](./samples/insight-v4-demo-transcript.md)
- 配方运行时先例：[scribe-flow-ai-recipe-stage-a.md](./scribe-flow-ai-recipe-stage-a.md)（M8-1：Recipe 原语、断言门、步骤日志）
- 多步链质量论证：[research/ai-node-multistep-research.md](./research/ai-node-multistep-research.md)
- 垂直加工模块先例：[onmyoji-guide-processing.md](./onmyoji-guide-processing.md)
- 输出与 Markdown 渲染：`apps/web/src/lib/markdown.ts`、`apps/web/src/styles/markdown.css`（`markdown-body`）
