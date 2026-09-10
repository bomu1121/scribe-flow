# 知识巩固节点方案（`process.drill`「练一练」）

> 状态：**方案待评审**（不写代码）
> 需求原话：「一个功能卡，针对一段文字输入的内容，提炼里面可以考察的知识点，根据这些知识点分析与延伸，输出一份用户可以交互（比如答题之类）的产物，在结果页」
> 依据：① 2026-09-10 联网调研（17 份产品一手页面存 `docs/research/raw/drill-2026-*.md`、5 篇论文、2 份算法文档）；② 现有代码范式：`process.mindmap` 节点 + `MindMapViewer`、`builtin.trace.v2` 结构化产物 + `TraceReportViewer`、M8-1 配方断言门 `citationsInOriginal`
> 与既有规划的关系：**不动** M6/M7 已定内容，作为独立节点立项

---

## 0. 一句话

**一张功能卡：一段文字进去 → 可考察的知识点 + 检验题 + 延伸问题出来 → 在结果页一题一屏直接答题。**

```
文稿/笔记 ──▶ [知识巩固 process.drill] ──▶ 产物 drillSet(JSON)
                                          ├─ points[]      可考察的知识点（带逐字原文依据）
                                          ├─ items[]       检验题（单选/多选/判断/填空）
                                          └─ extensions[]  分析与延伸（「再想一步」）
                                                     │
                                          结果页 DrillViewer：答题 → 即时对错 + 解析 + 原文依据
                                                              → 答完分组「已能自己答出来 / 需要回看」
                                                              → 错题重做 → 导出 Markdown
```

---

## 1. 用户视角长什么样

| 环节 | 表现 |
|---|---|
| 拖节点 | 节点面板里多一张「知识巩固」卡，连在 AI 加工节点或文本节点之后 |
| 调参数 | 卡片内 4 个参数：考察点数量 / 题型 / 难度 / 是否输出延伸问题 |
| 运行 | 节点卡产物摘要：`8 个考察点 · 8 题（4 单选 2 判断 2 填空）· 6 条延伸` |
| 看结果 | 运行详情页点开该节点 → 一题一屏作答 → 提交即出对错 + 解析 + **原文依据** |
| 收尾 | 「已经能自己答出来的 5 个点 / 建议回看的 3 个点」+ 只重做错题 + 导出 Markdown |

---

## 2. 调研结论（2026-09 实况）

### 2.1 市面格局

| 产品 | 关键事实 | 对我们的意义 |
|---|---|---|
| **NotebookLM / Gemini Notebook**（[官方学生页](https://notebook.google/students)、[官方博客](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-app-quizzes-flashcards/)） | 2025-09 上线闪卡+测验；2025-11 支持自定义主题/难度/数量；错题给解释；**只基于你的来源作答** | 「出题」已是商品；而且连 Google 都选择**做成交互而非文档** |
| **Jungle**（原 Wisdolia，[官网](https://www.wisdolia.com/)） | 任意 PDF/网页/YouTube → MCQ + 自由作答 + 案例题；官网挂出与 Quizlet/Turbo/Gizmo/StudyFetch 的盲评对比 | 「干扰项可信度」是全行业最弱项（自家 69，竞品 28–56）→ **题目质量才是门槛** |
| **StudyFetch / Turbo AI** | 8M / 10M+ 用户；上传资料 → 测验、闪卡、Arcade、讲解视频、音频复述 | 同一素材多形态输出是标配；我们不跟 |
| **RemNote** | 100 万+ 学生；笔记里就地做卡；考试日期倒排日程 | 卡片与知识原文强绑定 |
| **Anki + FSRS**（[手册](https://docs.ankiweb.net/deck-options.html)） | 23.10+ 以 FSRS 取代 SM-2 | 调度有现成标准（`ts-fsrs` MIT）；但**本卡不引入调度** |
| 腾讯云 LearnBuddy 等国内教育智能体 | 智能出题 + 自动批改 | 出题+批改在中文语境是标准组合 |

> 抓取失败、不做判断的：秘塔、腾讯 ima（SPA 空壳页 <600 字节）、Quizlet Magic Notes（登录墙）。

### 2.2 三条可迁移的经验

1. **做成交互，不要做成文档**。所有头部产品都把练习做成答题目界面，没有一个把题打印成一篇读的。
2. **必须挂原文依据**。NotebookLM 明确「grounded only in your sources」；出题最大的风险是幻觉（[arXiv 2601.06098](http://arxiv.org/abs/2601.06098) 用因果图+多智能体双重验证把质量提升最高 70%）。
3. **错答要给解释**，而且是**指向原文的解释**，不是把正确答案再说一遍。

### 2.3 学习科学依据（对设计的硬约束）

| 结论 | 出处 | 约束 |
|---|---|---|
| **测试效应**：对散文做即时自由回忆测试，一周后保留显著优于反复阅读 | Roediger & Karpicke 2006, [doi](https://doi.org/10.1111/j.1467-9280.2006.01693.x) | 产物必须是**要你答的题**，不是让你再读一遍的总结 |
| **合意难度**：检索、间隔带来练习期的不流畅，换长期保持 | Bjork & Bjork 2020, JARMAC | 先答后看；原文依据**默认折叠**，点开才显示 |
| **LLM 出题实证**：有 LLM 生成 MCQ 练习的一周准确率 89% vs 无练习周 73%；但作者强调**题质不稳定，须人工复核后发放** | [arXiv 2507.05629](http://arxiv.org/abs/2507.05629) | 必须有**确定性的质量闸**，不能"生成即入库" |
| **生成-再验证**：先广生成、再筛选，小模型也能出好题 | [arXiv 2512.10110](http://arxiv.org/abs/2512.10110) | 出题步骤与自检步骤**分开** |

> 这些是设计依据，不是效果承诺。

---

## 3. 为什么不是「输出一篇 Markdown 题目集」

Markdown 只能读。把题写成文档，用户会**扫一眼答案**，那就退化成「再读一遍」——恰好是测试效应要避免的那件事。所以：

| | Markdown 题目集 | 结果页答题（本方案） |
|---|---|---|
| 用户动作 | 看题 → 看答案 | 答题 → 提交 → 才知道对不对 |
| 认知负荷 | 识别（recognition） | 提取（recall） |
| 反馈 | 无 | 对错 + 解析 + 原文依据 |
| 收尾 | 文件躺在磁盘里 | 明确「哪几个点能自己答出来」+ 错题重做 |

Markdown 仍然要能导出（复制/带走/接下游），但**它是副产品，不是主形态**。

---

## 4. 产物契约：`drillSet`（JSON）

节点产物是一份结构化 JSON（沿用 `builtin.trace.v2` 的做法：JSON 给交互视图消费，Markdown 按需导出）。

```jsonc
{
  "schema": 1,
  "title": "《长视频转笔记》知识巩固",
  "points": [
    {
      "id": "p1",
      "name": "为什么按语义切章优于按字数切章",
      "type": "causal",                 // concept | fact | causal | method | claim | boundary
      "gist": "一句话说清这个点在讲什么（≤60 字）",
      "worthTesting": "为什么值得考（是易混点 / 是后续理解的前提 / 是反直觉结论）",
      "sourceQuote": "逐字摘自原文的一句，用于校验与展示依据"
    }
  ],
  "items": [
    {
      "id": "q1",
      "pointId": "p1",
      "kind": "single",                // single | multi | judge | cloze
      "difficulty": "medium",          // basic | medium | hard
      "stem": "题干",
      "options": ["A 选项", "B 选项", "C 选项", "D 选项"],   // judge 固定 ["正确","错误"]
      "answer": ["A 选项"],            // 必须是 options 的子集；cloze 存填空答案
      "explanation": "为什么是这个答案",
      "sourceQuote": "逐字摘自原文的一句"
    }
  ],
  "extensions": [
    {
      "pointId": "p1",
      "question": "再想一步：如果输入是 30 分钟的长视频，这条流程哪一步会先撑不住？",
      "hint": "想想并发与上下文长度这两个约束",
      "angle": "延伸到工程约束"           // 延伸方向：与什么相关、往哪边想
    }
  ]
}
```

### 4.1 硬约束（服务器端校验，不通过即丢弃该条）

| 约束 | 值 | 理由 |
|---|---|---|
| `points` 数量 | 3–12 | 「可考察的知识点」不是「所有知识点」 |
| `items` 数量 | 1–20 | 一个点至少要有一题 |
| 每个 `point` 至少 1 题 | 是 | 没有检验题的知识点不该出现在产物里 |
| `item.pointId` | 必须存在于 `points` | 防止悬空引用 |
| `answer ⊆ options` | 是（`cloze` 除外） | 客观题可本地判分的唯一条件 |
| `sourceQuote` | **必填，且必须能在输入原文中逐字命中** | 防幻觉的硬闸（复用已有断言 `citationsInOriginal`） |
| 选项数量 | 3–5，且互不重复 | 干扰项质量（Jungle 调研揭示的行业最弱项） |
| 题干不得包含答案原文 | 启发式检查（答案长度 ≥ 4 且出现在题干 → 丢弃） | 防止送分题 |

---

## 5. 生成与把关：复用 M8-1 配方，**引擎骨架零改动**

`builtin.gameguide.v2` 已经证明「一个节点内部跑多步链」是现成能力（[recipe.ts](../packages/shared/src/recipe.ts)：顺序步骤 + 确定性断言门）。本节点直接走同一条路：

新增内置提示词块 `builtin.drill`，带 3 步配方：

| # | step id | 做什么 | `expects` |
|---|---|---|---|
| 1 | `scan` | 通读输入，列出**可考察**的知识点（含逐字引文、为什么值得考） | `kind: json`、`jsonRootKeys: ["points"]` |
| 2 | `author` | 逐点出题（按卡片所选题型与难度）+ 写「再想一步」延伸 | `kind: json`、`jsonRootKeys: ["items","extensions"]` |
| 3 | `audit` | 逐题自检：答案唯一吗？干扰项可信吗？引文真在原文里吗？删掉不合格的并返回最终对象 | `kind: json`、`jsonRootKeys: ["points","items","extensions"]`、**`citationsInOriginal: points[].sourceQuote` 与 `items[].sourceQuote`（maxMiss=0）** |

**第 3 步是整个方案的质量核心**：它是一道**确定性断言门**（不依赖第二次 LLM 的"自觉"），且 `citationsInOriginal` 是项目里已经实现好的断言类型（`recipe.ts` L17-22）。

### 5.1 断言未命中时的处理策略

现网已有配方（`insight.v3/v4`、`trace.v2`）用的是 `citationsInOriginal … maxMiss: 0`，即**只要有一条引文对不上就整节点失败**。那是对的：溯源报告的引文错了，整份报告就不可信。

**出题场景不一样**，所以本方案刻意与之不同：

| 策略 | 表现 | 评价 |
|---|---|---|
| 整节点失败（现网溯源配方的做法） | 一整篇笔记因为 1 条引文对不上而白跑 | ❌ 用户要的是能用的产物；8 题丢 1 题不影响另外 7 题 |
| **降级丢弃 + summary 明示（本方案推荐）** | `maxMiss` 放到容忍上限（如 2，避免整体失败），再由 `parseDrillSet` **精确丢弃**未命中引文的那几条，卡片显示 `8 题（丢弃 2：引文未命中）` | ✅ 透明、可用，且丢弃率本身就是题目质量的健康指标 |

代价是：题目层没有「整份产物可信」这个保证。用「每题都单独挂了可点开的原文依据」来补——用户随时能自己验一条。

### 5.2 本地兜底层（`packages/shared/src/drill.ts`，纯函数、可单测）

断言的能查引文，但查不了「答案是否在选项里」这类结构问题，所以在解析层再做一遍：

- `parseDrillSet(raw, sourceText)`：宽松解析 LLM 输出（容忍 ```json 围栏/前后废话，照搬 `mindmap.ts` 的 `extractJsonObject`）→ 结构校验 → 丢弃不合格条目 → 返回 `{ set, dropped: [{reason}] }`
- `drillSetToMarkdown(set)`：导出/下游用
- `gradeObjective(item, userAnswer)`：本地判分（single/multi/judge/cloze），**零成本、零延迟、可离线重做**

---

## 6. 结果页交互：`DrillViewer.vue`

挂在运行详情页里（与 `MindMapViewer` / `TraceReportViewer` 同位置）。

```
┌────────────────────────────────────────────────────────┐
│ 《…》知识巩固      8 题 · 已完成 3        [导出 Markdown] │
├────────────────────────────────────────────────────────┤
│  Q3 / 8    ●●○○○○○○        考察点：按语义切章 vs 按字数   │
│                                                        │
│  长视频转笔记时，为什么按语义切章优于按字数切章？          │
│   ○ A. …                                               │
│   ○ B. …                                               │
│   ○ C. …                                               │
│                                        [ 提交答案 ]     │
├────────────────────────────────────────────────────────┤
│  ✅ 回答正确                                            │
│  解析：…                                                │
│  ▸ 原文依据（点击展开）                                  │
│     「按字数切会把一个论证拦腰截断，模型看到的上下文…」    │
└────────────────────────────────────────────────────────┘
```

### 6.1 交互决策

| 项 | 决策 | 理由 |
|---|---|---|
| 布局 | **一题一屏**，不做长列表 | 一次一个回合，符合「短回合」抗枯燥 |
| 判分 | 单选/多选/判断/填空**全部本地即时判分** | 零成本、零延迟、离线可重做 |
| 开放题（简答） | **第一版不做** | AI 判分不稳定（会严/会松），且要额外调用 |
| 原文依据 | 答完**默认折叠**，点开才展开 | 合意难度：先自己回想，再看依据 |
| 反馈结构 | 对/错 → 解析 → 原文依据 → （考察点名字） | 三段式，避免只报分数 |
| 答完收尾 | 分两组：**「已经能自己答出来的点」/「建议回看的点」**；不显示百分比、不排名 | 用「能讲出来」而不是「62 分」 |
| 错题 | 「只重做错题」按钮 | 最直接的补救动作 |
| 延伸区 | 全部答完后展示 `extensions`（问题 + 提示 + 延伸方向），**不给答案** | 这就是需求里的「分析与延伸」；也给「读完之后还有得想」一个落点 |
| 重生成 | 节点卡「重跑本节点」即可（引擎已有单节点重跑） | 不新增机制 |

---

## 7. 节点卡参数（`DrillCard.vue`）

| 参数 | 字段 | 控件 | 默认 |
|---|---|---|---|
| 考察点数量 | `pointCount` | 数字（3–12） | 6 |
| 题型 | `kinds` | 多选（单选/多选/判断/填空） | 单选 + 判断 + 填空 |
| 难度 | `difficulty` | 下拉（基础/适中/挑战） | 适中 |
| 输出延伸问题 | `withExtensions` | 开关 | 开 |
| 考察侧重（可选） | `focus` | 单行文本，如「只考察数据与结论」 | 空 |

卡片内不给输入时的空态：`把一段文稿或笔记连进来`。

数据契约（`packages/shared/src/graph.ts`）：

```ts
export interface DrillData {
  pointCount?: number;                  // 3-12，默认 6
  kinds?: Array<"single" | "multi" | "judge" | "cloze">;
  difficulty?: "basic" | "medium" | "hard";
  withExtensions?: boolean;             // 默认 true
  focus?: string;                       // 可选考察侧重
}
```

---

## 8. 代码落点（逐文件，全部照搬既有范式）

| 文件 | 改动 | 照搬的参照 |
|---|---|---|
| `packages/shared/src/drill.ts` | **新增**：`DrillSet` 等类型、`parseDrillSet`、`drillSetToMarkdown`、`gradeObjective` | `shared/src/trace.ts`（结构化产物契约 + `xxxToMarkdown`） |
| `packages/shared/src/index.ts` | 导出 `./drill` | 现有导出列表 |
| `packages/shared/src/graph.ts` | `DrillData`；`NodeType` 加 `"process.drill"`；`NODE_TYPE_LABELS` 加「知识巩固」；`NODE_CARD_WIDTH` | `process.mindmap` 的三处注册 |
| `packages/shared/src/schema.ts` | 节点 `data` 的 zod 校验分支 | 现有 `process.mindmap` 分支 |
| `packages/shared/src/prompt.ts` | 新增内置块 `builtin.drill`（含 3 步 recipe 与断言） | `builtin.gameguide.v2` 的 recipe 写法 |
| `packages/shared/src/templates.ts` | **可选**：内置模板「视频 → 笔记 → 练一练」 | 现有 7 个模板 |
| `apps/server/src/lib/drill.ts` | **新增**：LLM 输出的解析/清洗/兜底校验（只依赖 Node 内置，便于单测） | `apps/server/src/lib/mindmap.ts` 的定位与写法 |
| `apps/server/src/lib/engine.ts` | 4 处：① `RETRYABLE_NODE_TYPES` 加入；② 执行 `case "process.drill"`（走配方）；③ 产物 `kind` 映射为 `noteBlock`；④ `previewFor` 显示摘要 | `process.mindmap` / `process.gameguide` 分支 |
| `apps/server/src/lib/engine.ts`（下游序列化兜底） | `merge` / `output` 收集到 drill 产物时，先 `drillSetToMarkdown()` 再合并 | 避免把原始 JSON 拼进 Markdown 文档 |
| `apps/web/src/components/DrillViewer.vue` | **新增**：答题交互（见 §6） | `MindMapViewer.vue` / `TraceReportViewer.vue` 的挂载方式 |
| `apps/web/src/components/canvas/node-cards/DrillCard.vue` | **新增**：参数卡（见 §7） | `node-cards/ChapterCard.vue` |
| `apps/web/src/components/canvas/ScribeNode.vue` | 加了分派分支、`noInlineFormTypes` 判断、节点说明文案、icon | L281/L299-309/L336-370 的现有写法 |
| `apps/web/src/components/canvas/NodePalette.vue` | 节点面板注册 | 现有节点清单 |
| `apps/web/src/views/RunDetailView.vue` | 挂载 `DrillViewer`；节点简写标签加「巩固」 | L233-244（标签）、L329（mindmap 的筛选挂载分支） |
| `apps/server/src/lib/drill.test.ts` 等 | 单测：解析/丢弃/判分/导出；引擎侧用例 | `mindmap.test.ts`、`engine.test.ts` |

> **端口改动：无。** 输入沿用现有 `transcript | noteBlock | noteDoc`（多输入按序合并的既有语义），输出沿用 `noteBlock`（内部是 JSON）。这是刻意的取舍：不新增端口类型 = 不动 `port.ts` / `schema.ts` 的连接校验，风险最低。

---

## 9. 验收

| 层 | 用例 | 通过标准 |
|---|---|---|
| L0 纯函数 | `parseDrillSet` 喂：合法 JSON / 带 ```json 围栏 / 引文不在原文 / 答案不在选项 / `pointId` 悬空 / 题干含答案 | 分别：通过 / 通过 / 丢弃该条 / 丢弃该条 / 丢弃该条 / 丢弃该条，且 `dropped[].reason` 可读 |
| L0 | `gradeObjective` 四题型 | 单选/多选/判断/填空判分正确；多选少选算错且给出「你少选了 X」 |
| L1 节点 | 文稿 → `process.drill` 跑通 | 卡片摘要形如 `8 个考察点 · 8 题 · 6 条延伸`；有丢弃时摘要含「丢弃 N（引文未命中）」 |
| L1 | 引文全不命中 | 断言门触发 → 节点失败，中文报错可读（不吐英文堆栈） |
| L2 端到端 | 文稿 → 知识巩固 → 结果页 | 8 题逐题作答 → 结果分组正确 → 错题重做只有错题 → 导出 Markdown 含题目/答案/解析/延伸 |
| L2 | 下游连通性 | drill → merge → output：产出的 Markdown 是**人可读的题目集**，不含原始 JSON |
| 人工抽检 | 随机 20 题 | 无源题 0 道、答案不唯一 0 道、题干泄漏答案 0 道、干扰项明显荒唐 ≤ 1 道 |
| 命令 | `pnpm typecheck && pnpm test && pnpm lint:slop && pnpm smoke:ui` | 全绿 |

---

## 10. 本卡明确不做

| 不做 | 原因 |
|---|---|
| 跨文章知识点库 / 知识点长期沉淀 | 本卡是**随用随取的功能卡**，不做常驻系统（用户原话：「以便于用户有这方面的需要」） |
| FSRS 间隔重复 / 每日复习队列 | 那是「练场」形态，需要独立立项（见附录） |
| 打卡、连击、排行榜、正确率排名 | 与「长知识」定位冲突，激励刷简单题 |
| AI 判分开放题（复述/追问链） | 判分不稳定 + 额外成本；第一版只用客观题 |
| AI 播客 / 音频复述 | 成本高，且「听」仍是输入而非输出 |
| 题目难度自适应（IRT / 知识追踪） | 单卡场景没有跨会话数据支撑 |

---

## 11. 待确认的开放问题

| # | 问题 | 备选 | 我的建议 |
|---|---|---|---|
| Q1 | 断言未命中时：整节点失败 vs 降级丢弃 | 失败 / 丢弃 + summary 明示 | **降级丢弃**（产物可用性优先） |
| Q2 | 产物 JSON 存哪 | 沿用 `noteBlock`（text 存 JSON，零端口改动） / 新增 `drillSet` 端口类型 | **沿用 `noteBlock`** |
| Q3 | 是否加内置模板「视频 → 笔记 → 练一练」 | 加 / 不加 | **加**（功能卡要能被一眼用上） |

---

## 附录：如果以后要做成系统（本次不做，留作索引）

本次调研已覆盖到这些设计的可用素材，若用户后续需要「长期巩固」而不只是「随用随取的卡」，可以在此方案之上叠加：

- **知识点长期库**（跨工程沉淀、合并去重、人工可编辑）→ 差异点：「这篇的 X 和三个月前那篇的 Y 有什么关系」
- **FSRS 调度**（`ts-fsrs`，MIT，v5.4.2）→ 差异点：到期自动提醒，只对 `core` 点建卡，不做无限队列
- **练法分层**（回忆 → 转述 → 追问链）→ 差异点：验证「能讲出来」而不只是「能认出来」
- **闭环反哺**（答不出的点落成「待解问题」→ 一键变成新素材节点）→ ScribeFlow 作为加工流独有的收口

调研原文索引见 `docs/research/raw/drill-2026-*.md`。
