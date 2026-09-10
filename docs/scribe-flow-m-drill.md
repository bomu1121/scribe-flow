# ScribeFlow 实施清单：知识巩固节点 `process.drill`（练一练）

> 状态：**已实施（T1–T5 完成，见 §10 验收记录）**（2026-09-10 由方案 [knowledge-consolidation-module.md](./knowledge-consolidation-module.md) 拆出）
> 依据：方案文档 §4–§8；现有范式 `process.mindmap`（节点 + Viewer）、`builtin.trace.v2`（结构化产物 + 断言门）、`builtin.gameguide.v2`（节点内多步配方）
> 工作方式：沿用 M0–M6 约定——中文文案、UTF-8、颜色走设计令牌、通用组件用 Element Plus、只在项目既有范式内扩展（不新增端口类型、不改引擎骨架）
> 已确认决策：降级丢弃 + summary 明示；产物沿用 `noteBlock` 存 JSON；加内置模板

---

## 0. 目标与决策快照

**目标**：新增 1 个节点 + 1 个结果页视图，实现「一段文字 → 可考察知识点 + 检验题 + 延伸问题 → 结果页答题交互」。

| # | 模块 | 类型 | 一句话 |
|---|---|---|---|
| T1 | 共享契约 `drill.ts` | 新增 | 产物类型 + 严格解析/丢弃 + 本地判分 + Markdown 导出 |
| T2 | 内置提示词块 `builtin.drill` | 新增 | 三步配方（抽点 → 出题+延伸 → 自检），挂确定性断言 |
| T3 | 节点 `process.drill` | 新增 | 引擎执行分支 + 摘要 + 产物落库 |
| T4 | 结果页 `DrillViewer` | 新增 | 一题一屏答题、即时判分、原文依据、错题重做、导出 |
| T5 | 节点卡 `DrillCard` | 新增 | 4 个参数 + 空态提示 |

**已确认决策**：

| 项 | 结论 |
|---|---|
| D-DR-1 | 断言未命中时**降级丢弃**该条目并在 summary 明示（`8 题（丢弃 2：引文未命中）`），不整节点失败。配方 `maxMiss` 放容忍值 2，精确丢弃由 `parseDrillSet` 负责 |
| D-DR-2 | **不新增端口类型**：输入沿用 `transcript \| noteBlock \| noteDoc`（多输入按序合并），输出沿用 `noteBlock`（text 内存 JSON） |
| D-DR-3 | 新增内置模板「视频 → 笔记 → 练一练」 |
| D-DR-4 | 判分全部本地做：`single / multi / judge / cloze`；**第一版不做开放题 AI 判分** |
| D-DR-5 | 下游序列化兜底：`merge` / `output` 收到 drill 产物时先转 Markdown 再合并，避免原始 JSON 混进文档 |
| D-DR-6 | 质量分工：**机械校验**（引文逐字命中、JSON 根键）交给配方断言门；**语义校验**（干扰项、题干泄漏）交给第 3 步 LLM 自检 + 解析层启发式 |

---

## 1. packages/shared（约 1.5 天）

### 1.1 新增 `src/drill.ts`

```ts
export type DrillKind = "single" | "multi" | "judge" | "cloze";
export type DrillDifficulty = "basic" | "medium" | "hard";
export type DrillPointType = "concept" | "fact" | "causal" | "method" | "claim" | "boundary";

export interface DrillPoint {
  id: string;
  name: string;            // ≤20 字
  type: DrillPointType;
  gist: string;            // 一句话说清，≤60 字
  worthTesting?: string;   // 为什么值得考
  sourceQuote?: string;    // 逐字引文
}

export interface DrillItem {
  id: string;
  pointId: string;
  kind: DrillKind;
  difficulty?: DrillDifficulty;
  stem: string;
  options: string[];       // judge 固定 ["正确","错误"]；cloze 为空数组
  answer: string[];
  explanation?: string;
  sourceQuote?: string;    // 逐字引文
}

export interface DrillExtension {
  pointId: string;
  question: string;        // 「再想一步：…」
  hint?: string;           // 只给脚手架，不给答案
  angle?: string;          // 延伸方向
}

export interface DrillSet {
  schema: 1;
  kind: "drillSet";        // 下游检测标记（D-DR-5）
  title?: string;
  points: DrillPoint[];
  items: DrillItem[];
  extensions: DrillExtension[];
}

export interface DrillDrop { index: number; where: string; reason: string; }
export interface ParsedDrill { set: DrillSet | null; drops: DrillDrop[]; }
```

**函数**：

| 函数 | 行为 |
|---|---|
| `parseDrillSet(raw: string, sourceText: string): ParsedDrill` | 宽松解析（照搬 `mindmap.ts` 的 `extractJsonObject`：容忍 ```json 围栏与前后废话）→ 逐条校验 → 丢弃不合格 → 返回 `{ set, drops }`。`set` 为空（items.length === 0）时返回 `null` |
| `gradeObjective(item, userAnswer: string[]): { correct: boolean; note?: string }` | `single/judge` 严格相等；`multi` 集合相等，少选/多选分别给「你少选了 X」「你多选了 X」；`cloze` 归一化后比对（trim + 全角转半角 + 去尾标点 + 去空白） |
| `drillSetToMarkdown(set): string` | 导出用：标题、`### Q1 …`、选项、`答案`、`解析`、`原文依据`、`## 再想一步` |
| `maybeDrillToMarkdown(text): string` | 供引擎下游兜底（D-DR-5）：`JSON.parse` 成功且 `kind === "drillSet"` 才转换，否则原样返回 |

**`parseDrillSet` 校验规则（不合格 → 丢弃该条目 + 记 `drops`）**：

| 规则 | 处理 |
|---|---|
| `points` 非数组或为空 | 整体失败 `null` |
| `points` > 12、`items` > 20 | 截断超出部分（记 drop） |
| `point.id / name / gist` 缺失 | 丢弃该 point 及其 items、extensions |
| `item.kind` 不在 4 种内 | 丢弃该 item |
| `item.pointId` 不在 `points` 中 | 丢弃该 item |
| `options` 数量不在 3–5（`judge` 固定 2、`cloze` 为 0） | 丢弃该 item |
| `options` 有重复 | 丢弃该 item |
| `answer` 为空，或（非 cloze）`answer ⊄ options` | 丢弃该 item |
| `sourceQuote` 为空，或原文中找不到（normalize 后 substring） | 丢弃该条目，reason = `引文未命中原文` |
| 题干包含答案原文（答案长度 ≥ 4 且出现在 stem） | 丢弃该 item，reason = `题干泄漏答案` |
| 两个 item 的 `stem` 完全相同 | 丢弃后一个，reason = `重复题目` |
| 某 point 最终 0 题 | 丢弃该 point 与它的 extensions，reason = `该知识点无有效题目` |
| `extensions[].pointId` 悬空 | 丢弃该 extension |

> `normalize` 统一为一处实现（去空白、去 Markdown 强调符、全角转半角），供引文比对与 cloze 判分共用，必须单测。

### 1.2 `src/graph.ts`（4 处注册）

```ts
export interface DrillData {
  pointCount?: number;                 // 3-12，默认 6
  kinds?: DrillKind[];                 // 默认 ["single","judge","cloze"]
  difficulty?: DrillDifficulty;        // 默认 "medium"
  withExtensions?: boolean;            // 默认 true
  focus?: string;                      // 可选考察侧重，如「只考察数据与结论」
}
```

- L220 `NODE_TYPE_LABELS` 追加 `"process.drill": "知识巩固"`。
- L238 `NODE_CARD_WIDTH` 追加 `"process.drill": 300`。
- L256 `NODE_PORTS` 追加：

```ts
"process.drill": {
  inputs:  [{ id: "in",  type: "transcript", label: "文稿", accepts: ["transcript", "noteBlock", "noteDoc"] }],
  outputs: [{ id: "out", type: "noteBlock",  label: "练习产物" }],
},
```

- `NodeType` 联合与 `GraphNode` discriminatedUnion 追加 `process.drill`（data = `NodeBase["data"] & DrillData`）。

### 1.3 `src/schema.ts`

- `nodeDataByType` 追加 `drill`：

```ts
drill: baseDataSchema.extend({
  pointCount: z.number().int().min(3).max(12).optional(),
  kinds: z.array(z.enum(["single", "multi", "judge", "cloze"])).min(1).optional(),
  difficulty: z.enum(["basic", "medium", "hard"]).optional(),
  withExtensions: z.boolean().optional(),
  focus: z.string().max(200).optional(),
}),
```

- `graphNodeSchema` discriminatedUnion 追加 `nodeOf("process.drill", drill)`。

### 1.4 `src/prompt.ts`：`PROMPT_DRILL` + `RECIPE_DRILL`

在 `BUILTIN_PROMPT_BLOCKS` 末尾追加（`series: "知识巩固"`，`recommended: true`）。配方三步，**每步都把原文带上**（沿用 `RECIPE_GAME_GUIDE_V2` 的做法：每步携带原文，专名/数值更稳）：

```ts
const RECIPE_DRILL: Recipe = {
  schema: 1,
  steps: [
    {
      id: "scan", label: "抽点",
      system: `你是知识整理编辑。阅读用户提供的文稿，找出其中「值得被考察」的知识点。
只输出 JSON，不要解释、不要 Markdown 代码块：
{"points":[{"id":"p1","name":"知识点名称（≤20字）","type":"concept|fact|causal|method|claim|boundary","gist":"一句话说清（≤60字）","worthTesting":"为什么值得考（易混 / 是后续理解的前提 / 反直觉结论）","sourceQuote":"逐字摘自原文的一句"}]}

要求：
1. 只取真正的知识（概念、事实、因果、方法、观点、边界条件）；不要取过渡句、寒暄、口头禅。
2. sourceQuote 必须逐字复制原文里的一句话，不要改写、不要拼接；做不到的知识点直接不输出。
3. 知识点数量与侧重遵从上方的「出题要求」；按重要性排序，宁少勿滥，不要拆分过细——一个知识点 = 一个能被单独提问的东西。
{{params}}`,
      expects: { kind: "json", asserts: [{ op: "jsonRootKeys", value: ["points"] }] },
    },
    {
      id: "author", label: "出题与延伸",
      system: `你是出题编辑。依据下面的「原文」与已选定的「知识点」，为每个知识点出题，并写一条「再想一步」的延伸问题。
只输出 JSON，不要解释、不要 Markdown 代码块：
{"items":[{"id":"q1","pointId":"p1","kind":"single|multi|judge|cloze","difficulty":"basic|medium|hard","stem":"题干","options":["选项"],"answer":["正确答案"],"explanation":"为什么是这个答案","sourceQuote":"逐字摘自原文的一句"}],"extensions":[{"pointId":"p1","question":"再想一步：…","hint":"只给思考脚手架，不给答案","angle":"延伸方向（与其他概念的关系 / 边界条件 / 实际应用）"}]}

要求：
1. 每个知识点 1-3 题；题型、难度、数量遵从上方的「出题要求」；cloze 的 options 填空数组，answer 填原文中的填空答案。
2. 干扰项必须是「看起来对但确实错」的同类表述，禁止明显荒唐或与题干无关的选项；选项 3-5 个、互不重复。
3. 答案必须严格来自原文，不得引入原文没有的知识；answer 必须是 options 的子集。
4. 题干不得包含答案原文，否则等于送分。
5. 解析要指向原文那一句，而不是把正确答案再说一遍。
6. 难度与题型以「出题要求」为准。
7. 延伸问题不是再考一次，而是往「关系 / 边界 / 应用」方向追问一步；hint 不给答案。

原文：
---
{{input}}
---
知识点：
{{prev}}`,
      expects: { kind: "json", asserts: [{ op: "jsonRootKeys", value: ["items"] }] },
    },
    {
      id: "audit", label: "审题",
      system: `你是审题编辑。核对下面的「练习产物」与「原文」，逐条修正后输出**修正后的完整 JSON**（结构与输入相同），不要解释。
审查规则（不满足的条目直接删除，不要编造替换）：
1. 引文核对：sourceQuote 必须能在原文中逐字找到；找不到 → 删除该条。
2. 答案唯一：正确答案必须唯一，且 answer 必须是 options 的子集（cloze 除外）。
3. 题干泄漏：题干里出现了答案原文 → 改写题干；改不了就删除。
4. 干扰项：明显荒唐、与题干无关、或本身也是正确答案的选项 → 换掉或删除该题。
5. 悬空引用：item.pointId / extensions[].pointId 必须存在于 points，否则删除。
6. 每个 point 至少保留 1 题；否则连同该 point 一起删除。
7. 不要新增原文之外的知识。
8. 为产物写一个 title（≤30 字）。

原文：
---
{{input}}
---
练习产物：
{{prev}}`,
      expects: {
        kind: "json",
        asserts: [
          { op: "jsonRootKeys", value: ["points", "items", "extensions"] },
          { op: "citationsInOriginal", field: "points[].sourceQuote[]", maxMiss: 2 },
          { op: "citationsInOriginal", field: "items[].sourceQuote[]", maxMiss: 2 },
        ],
      },
    },
  ],
};
```

> **必须扩展一个模板变量**（已核实代码）：`renderStepSystem`（`apps/server/src/lib/recipe.ts`）目前只支持 `{{input}}` / `{{prev}}` / `{{all}}` / `{{source}}`，**注入不了节点参数**。因此本清单含一处小改：`StepContext` 增加 `params?: string`，`renderStepSystem` 增加一行 `.replace(/\{\{params\}\}/g, ctx.params ?? "")`，`executeRecipeOnInput()` 增加 `params` 入参并透传。不传即为空串，对现有 4 个配方（`insight.v3` / `insight.v4` / `trace.v2` / `gameguide.v2`）零影响。
> ⚠️ 不要用 `promptOverride` 拼参数——`engine.ts` L1179 的配方判定带 `!override.trim()`，一旦覆盖就退化成单步执行，三步质量和断言门全丢。

**关于 `maxMiss: 2` 的理由**（D-DR-1）：现网 `trace.v2` 用 `maxMiss: 0` 是对的——引文错了整份溯源报告不可信。出题场景 8 题丢 1 题不影响另外 7 题，所以放容忍值避免白跑；精确丢弃与计数交给解析层。

### 1.5 `src/templates.ts`

追加模板 `template.video-drill`「视频 → 笔记 → 练一练」：

```
source.bili → process.transcribe → process.prompt(builtin.insight) → process.merge → process.output
                                        └→ process.drill → （无下游，结果页消费）
```

### 1.6 共享测试（`src/drill.test.ts`）

- `parseDrillSet`：合法 JSON / ```json 围栏包裹 / 前后有废话 / 引文未命中 → 丢弃 / answer 不在 options → 丢弃 / pointId 悬空 → 丢弃 / 题干含答案 → 丢弃 / point 零题 → 连带丢弃 / 超量截断。
- `gradeObjective`：四种题型；multi 少选/多选分别出提示；cloze 全半角与空白差异判对。
- `drillSetToMarkdown`：含题目、选项、答案、解析、原文依据、延伸段。
- `maybeDrillToMarkdown`：drill JSON → Markdown；普通 Markdown 原样返回；非法 JSON 原样返回。
- `normalize`：全角/半角、Markdown 强调符、多空白。

---

## 2. 后端 apps/server（约 2–3 天）

### 2.1 新增 `src/lib/drill.ts`

与 `lib/mindmap.ts` 同一定位（只依赖 Node 内置、便于单测）：把 shared 的 `parseDrillSet` 包一层，输出 `{ set, drops, summary }`，并生成节点摘要：

```ts
export function summarizeDrill(set: DrillSet, drops: DrillDrop[]): string {
  const base = `${set.points.length} 个考察点 · ${set.items.length} 题 · ${set.extensions.length} 条延伸`;
  if (drops.length === 0) return base;
  const reasons = [...new Set(drops.map((d) => d.reason))].slice(0, 2).join("、");
  return `${base} · 丢弃 ${drops.length}（${reasons}）`;
}
```

### 2.2 引擎与接线（引擎 6 处 + 配方/预检 2 处，逐条）

| # | 位置 | 改动 |
|---|---|---|
| 1 | L41 `RETRYABLE_NODE_TYPES` | 加入 `"process.drill"`（多步配方 + 多次 AI 调用，值得重试） |
| 2 | L941-949 `combineOutputs` kind 推断 | `process.drill` → `"noteBlock"`（与 `process.prompt` 同列） |
| 3 | L993 `node.done` 的 preview | 把 `process.drill` 加入「不给 preview」名单（与 `process.mindmap` / `process.output` 同列）。理由：产物是 JSON，节点卡显示原始 JSON 是噪音，摘要由 summary 承担 |
| 4 | L1172-1179 配方接线 | `blockId` 解析加 `node.type === "process.drill" ? String(data.promptBlockId ?? "") \|\| "builtin.drill" : …`；**配方判定条件加 `node.type === "process.drill"`**（否则配方根本不执行，这是最容易漏的一处） |
| 5 | L1200-1211 配方分支内的产物后处理 | 类比 `builtin.trace.v2` 的 hook，加一段：`if (node.type === "process.drill") { const { set, drops, summary } = buildDrill(finalText, inputText); if (!set) throw new Error("没有生成可用的练习题，请重跑本节点"); finalText = JSON.stringify(set); drillSummary = summary; }`；返回处（L1215-1217）优先用 `drillSummary` |
| 6 | 新的 `case "process.drill"` | 参照 `case "process.mindmap"`（L1344-1379）：多输入按序合并 → 校验非空 → 校验 AI 密钥 → 组装节点参数指令 → 走配方分支 |
| 7 | `src/lib/recipe.ts` 模板变量 | `StepContext` 增加 `params?: string`；`renderStepSystem` 增加 `.replace(/\{\{params\}\}/g, ctx.params ?? "")`；`executeRecipeOnInput()` 增加 `params` 入参并透传（不传为空串，对现有 4 个配方零影响） |
| 8 | `src/routes/runs.ts` L99 `needsAi` | 节点类型清单加 `"process.drill"`，否则未配密钥时要跑到节点才报错（预检形同虚设） |

**第 2 处与第 4 处必须成对改**：只改一处会出现「节点永远不出题」或「出题但下游收到 text」。

**节点参数指令（第 6 处产出的 `params` 文本）**：

```
【出题要求】
考察点数量：不超过 6 个
题型：单选、判断、填空
难度：适中
输出延伸问题：是
考察侧重：只考察数据与结论
```

`focus` 为空时省略最后一行；`withExtensions` 为否时步骤 2 的 `extensions` 仍返回空数组（保持 JSON 形状稳定，解析层不为空数组判错）。

### 2.3 下游序列化兜底（D-DR-5）

- `case "process.merge"`（L1250）与 `case "process.output"`（L1258）：取 `inputs.text` 前做一次 `maybeDrillToMarkdown()`。
- 实现建议放在 `resolveInputs` 之外的**出口处**（merge/output 分支内），避免污染其他节点的输入语义——drill 产物连给 `process.prompt` 时应当保持 JSON（可被后续步骤消费）。
- 补单测：drill → merge → output，产物为 Markdown；drill → prompt 保持 JSON。

### 2.4 运行日志

- 配方分支已有逐步日志（`node.step.done`）。为 drill 补一条 `info` 日志：`丢弃明细：3 条（引文未命中 2、题干泄漏 1）`，便于排查。

---

## 3. 前端 apps/web（约 3–4 天）

### 3.1 节点面板与画布

- `NodePalette.vue`：分组「AI 加工」下新增「知识巩固」（图标 `ListChecks`）。
- `FlowCanvas.vue`：
  - `NODE_LAYOUT_WIDTH` 追加 `process.drill: 300`。
  - 创建节点默认数据：`{ pointCount: 6, kinds: ["single","judge","cloze"], difficulty: "medium", withExtensions: true }`。
  - 确认 L742 / L808 的 `process.output` / `process.mindmap` 特例名单是否需要纳入 drill（新建节点后是否自动打开结果页）。

### 3.2 `components/canvas/node-cards/DrillCard.vue`（300px）

```
考察点数量  [ 6 ]        （3-12）
题型        [x]单选 [ ]多选 [x]判断 [x]填空
难度        [ 适中 ▼ ]
[✓] 输出延伸问题
侧重（可选）[ 如：只考察数据与结论            ]
提示：连一段文稿进来，运行后在结果页答题
```

- `noInlineFormTypes` 不含 drill（卡片有形参，必须有内联表单）。
- 校验：题型至少勾 1 个，否则失焦回滚并 Toast 提示；`pointCount` 越界钳制而不是报错。
- 空态：无输入连线时卡片显示「把一段文稿或笔记连进来」。

### 3.3 `components/DrillViewer.vue`（核心交互）

Props：`drillSet: DrillSet`、`title?: string`。

状态机：

```
items 队列 → 当前题
  ├─ answering：未提交（选项可改）
  └─ graded：已提交（选项锁定，展示判定 + 解析 + 原文依据折叠）
队列耗尽 → finished：结果分组 + 延伸区
```

| 区域 | 内容 |
|---|---|
| 头部 | 标题 · `第 3/8 题` · 进度点阵 · `[导出 Markdown]` 「重跑本节点」提示（重跑走引擎既有能力，不在此实现） |
| 题目区 | 考察点名称（`points[name]`）→ 题干 → 选项/填空输入 |
| 提交 | `[提交答案]` → 调 `gradeObjective` → 立刻切到 graded，**无网络请求** |
| 反馈区 | ✅/❌ → 解析 → **原文依据（默认折叠）** → 依据里展示 `sourceQuote` 逐字引用 |
| 导航 | `[上一题] [下一题]`；已答题可回看（只读） |
| 结束页 | 两组：**「已经能自己答出来的点」/「建议回看的点」**；`[只重做错题]`；不显示百分比、不排名 |
| 延伸区 | 全部答完后展示 `extensions`（问题 + hint + 方向），**不给答案**，可折叠 |

交互细节：

- 题型渲染：`single` 单选；`multi` 多选（提交前提示「多选」）；`judge` 两个大按钮（正确/错误）；`cloze` 单行输入（回车提交）。
- 键盘：`1-9` 选项、`Enter` 提交/下一题、`Esc` 不做全局绑定（避免和弹窗冲突）。
- 折叠状态、答案、进度**只存组件内存**：本卡不做跨会话持久化（方案 §10 明确不做），刷新即重来。
- 颜色一律走 `tokens.css`；对/错用现有语义色令牌，不散写 hex；`pnpm lint:slop` 必须 0 命中。
- 无障碍：选项用 `role="radiogroup"` / `role="group"`，提交后 `aria-live` 播报结果。

### 3.4 `views/RunDetailView.vue` 挂载

- `activeTab` 联合（`"result" | "nodes" | "mindmap"`）追加 `"drill"`，标签「练一练」。
- 追加 `drillNodes` computed，照搬 L326-336 的 `mindMapNodes`：

```ts
const drillNodes = computed(() => (run.value?.nodeResults ?? [])
  .filter((n) => n.nodeType === "process.drill" && n.output?.text)
  .map((n) => ({ node: n, title: n.nodeLabel || NODE_TYPE_LABELS.process.drill })));
```

- 解析用 `parseDrillSet(n.output.text, "")`：**结果页解析时不做引文校验**（原文不在前端），只做结构解析；引文校验已在生成期完成。为此 `parseDrillSet` 需支持 `sourceText` 为空时跳过引文比对（单测覆盖）。
- tab 出现/消失会改变按钮宽度 → 复用 L338-341 的 `watch + updateTabIndicator` 模式。
- 节点简写标签表（L233-244）追加 `"process.drill": "巩固"`。
- 确认 drill 产物**不会**混进「输出文档」tab（若 `outputNodes` 按 kind 过滤，需排除 `nodeType === "process.drill"`）。

### 3.5 运行前预检

- 与 `process.mindmap` 同规则：存在 `process.drill` 但未配置 AI 密钥 → 阻断并提示先到设置页配置。

---

## 4. API 与脚本（约 0.5 天）

- 无新增路由：`PUT /api/projects/:id/graph` 经 shared `parseGraph` 自动校验新节点。
- 新增 `scripts/m-drill-api-check.mjs`（仿 `m4-api-check.mjs`）：
  1. 登录 → 创建工程 → 写入 `source.text → process.drill` 图（含中文测试文稿，≥ 500 字，含明确可考察概念）。
  2. 运行 → 断言节点 `done`、`output.kind === "noteBlock"`、`JSON.parse(output.text).kind === "drillSet"`、`items.length ≥ 3`、`points.length ≥ 3`、每题 `sourceQuote` 非空且能在输入文稿中命中。
  3. 断言 summary 形如 `N 个考察点 · M 题 · K 条延伸`。
  4. 写入 `pointCount: 99` → 断言 PUT graph 400。
  5. 写入 `kinds: []` → 断言 PUT graph 400。
  6. 接 `process.drill → process.merge → process.output`，断言输出文件是人可读 Markdown（不含 `"kind":"drillSet"`）。

---

## 5. 测试与验收

### 5.1 自动化

- `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint:slop` / `pnpm lint:ui` 全绿。
- 新增 `drill.test.ts`（shared）、`lib/drill.test.ts`（server）、`engine` 侧用例（drill → merge → output 序列化）。
- `pnpm check:api:m-drill` 通过。

### 5.2 验收清单

**T1 契约与解析**
- [ ] 引文不在原文 → 该条被丢弃，`drops[].reason === "引文未命中原文"`。
- [ ] `answer` 不在 `options` → 丢弃；`options` 重复 → 丢弃；`pointId` 悬空 → 丢弃。
- [ ] 题干含答案原文 → 丢弃。
- [ ] 某知识点最终 0 题 → 该 point 与 extensions 一并丢弃。
- [ ] `sourceText` 为空（结果页解析）→ 跳过引文比对，结构正常解析。

**T2 配方与断言**
- [ ] 三步都出现在运行日志（`node.step.done` × 3），每步耗时可见。
- [ ] 故意让模型产出 1 条假引文：`maxMiss: 2` 不触发断言失败 → 该条被解析层丢弃，卡片显示 `丢弃 1（引文未命中原文）`。
- [ ] 引文全不命中（构造 3 条以上）：断言门触发 → 节点 error，报中文错误。
- [ ] 未配置 AI 密钥 → 预检阻断，运行不启动。

**T3 节点**
- [ ] 卡片摘要形如 `8 个考察点 · 8 题 · 6 条延伸`；有丢弃时含 `丢弃 N（…）`。
- [ ] `{{params}}` 注入生效：把「考察点数量」改成 3、题型只勾「判断」、难度改「基础」，重跑后产物确实 ≤ 3 个知识点且全部是判断题。
- [ ] `withExtensions` 关掉时 `extensions` 为空数组，结果页不出现延伸区，且不报错。
- [ ] 节点卡**不显示原始 JSON**（preview 被抑制）。
- [ ] 多输入（两段文稿）按序合并后出题，summary 只反映合成产物。
- [ ] drill → merge → output：输出文件为 Markdown 题目集（含答案与解析），**不含** `"drillSet"` 字样。
- [ ] drill → process.prompt：下游仍收到 JSON（语义不被破坏）。

**T4 结果页**
- [ ] 运行详情出现「练一练」tab；无 drill 节点时不出现该 tab。
- [ ] 四题型各答一题：单选/判断/填空即时判对判错；多选少选提示「你少选了 X」。
- [ ] 答完展示两组（已能自己答出来 / 建议回看），分组正确。
- [ ] 「只重做错题」仅保留错题，且重做后不污染原答案记录。
- [ ] 延伸区默认折叠、展开后有 question + hint + 方向，**无答案**。
- [ ] 导出 Markdown 与结果页内容一致。
- [ ] 键盘操作（1-9 / Enter）可用；`aria-live` 播报结果。

**全局**
- [ ] 内置模板「视频 → 笔记 → 练一练」可创建并端到端跑通。
- [ ] 旧工程（无 drill 节点）打开、运行、导入导出均不受影响。
- [ ] 全程中文文案、令牌化颜色、`pnpm lint:slop` 0 命中。
- [ ] 手机/窄屏（<1024）只读降级提示仍生效，不因新页面报错。

---

## 6. 交付边界（本次明确不做）

- 不做跨文章知识点库、不做 FSRS 间隔重复、不做每日复习队列、不做打卡/连击/排行（方案 §10）。
- 不做开放题（简答/复述/追问链）的 AI 判分。
- 不做答题记录跨会话持久化（刷新即重来）；不做错题本导出 PDF。
- 不做题目难度自适应（IRT / 知识追踪）。
- 不新增端口类型、不新增画布交互、不新增画布节点种类（只加 1 个）。
- 不做语音输入。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| **配方不生效**：只改了 `blockId` 没改配方判定条件（2.2 第 4 处） | 列为必改项；`check:api:m-drill` 断言三步日志齐全，可自动发现 |
| 模型输出的 `sourceQuote` 是改写而非逐字 → 大量丢弃 | 提示词第 2 条强制「逐字复制」；summary 暴露丢弃率；提示词单独迭代（不改代码） |
| 干扰项质量差（行业通病） | 第 3 步自检专查干扰项；验收含人工抽检 20 题（明显荒唐 ≤ 1） |
| 产物 JSON 泄漏到下游文档 | D-DR-5 的 `maybeDrillToMarkdown` + 专项验收用例 |
| 小模型（如 deepseek-chat）多步配方不稳定、超时 | 节点默认 `retry: { maxRetries: 2, backoffMs: 3000 }`（已可重试）；配方步数固定 3 步不膨胀 |
| 结果页刷新丢答案，用户觉得"没保存" | 卡片明确提示「本次作答不留存，需要保留请导出 Markdown」；若反馈强烈再单独立项做持久化 |
| 节点卡参数与提示词不同步（`pointCount` 写了但提示词没引用） | 2.2 第 6 条要求把参数拼进提示词；验收抽查「数量=3」时产物确实 ≤ 3 个知识点 |
| `RunDetailView` 变长变复杂 | 交互全部封在 `DrillViewer.vue` 内，宿主只做 tab 与解析 |

---

## 8. 工作量估算

| 阶段 | 内容 | 估时 |
|---|---|---|
| T1 | shared 契约 + 解析 + 判分 + 导出 + 单测 | 1.5 天 |
| T2 | 提示词块 + 三步配方 + 断言调优 | 1 天 |
| T3 | 服务端 drill.ts + engine/recipe/runs 8 处接线 + 兜底序列化 | 2.5 天 |
| T4 | DrillViewer（含四题型、结果分组、导出） | 2.5 天 |
| T5 | DrillCard + 面板/画布注册 | 1 天 |
| 验收 | check 脚本 + 端到端 + 人工抽检 + 提示词迭代 | 1.5 天 |
| **合计** | | **约 10 天** |

---

## 9. 下一步

评审通过后按 T1 → T2 → T3 → T4 → T5 顺序开工：T1（契约）先落，因为它决定了提示词与视图两侧的形状；T2 与 T3 可以并行（提示词块不依赖引擎）。T3 完成后即可用 `check:api:m-drill` 看到真实产物，再据实际题质迭代提示词，最后做 T4 的交互。

---

## 10. 验收记录（2026-09-10 实施完成）

### 10.1 交付物

| 层 | 文件 |
|---|---|
| 共享契约 | `packages/shared/src/drill.ts`、`src/drill.test.ts`（+ `graph.ts`/`schema.ts`/`prompt.ts`/`templates.ts`/`index.ts` 注册） |
| 提示词与配方 | `builtin.drill`（三步：scan → author → audit，含 `citationsInOriginal` 断言）、`template.video-drill` 模板 |
| 服务端 | `apps/server/src/lib/drill.ts` + `drill.test.ts`；`engine.ts` 6 处 + `recipe.ts`（`{{params}}`）+ `runs.ts` 预检；`engine.recipe.test.ts` 新增 4 个用例 |
| 前端 | `components/DrillViewer.vue`（答题交互）、`components/canvas/node-cards/DrillCard.vue`（参数卡）、`utils/drill.ts` + `drill.test.ts`；`ScribeNode.vue` / `NodesPanel.vue` / `flow.ts` / `RunDetailView.vue` 注册与挂载 |
| 脚本 | `scripts/m-drill-api-check.mjs`（`pnpm check:api:drill`） |

### 10.2 命令结果

- `pnpm typecheck` 全绿（shared / server / web）
- `pnpm test` 全绿：shared 65 · server 75 · web 14（合计 154，本模块新增 39 个用例）
- `pnpm lint:slop` 通过（无 AI 味反模式）
- `pnpm lint:ui` 通过（Portal 样式 / z-index 令牌 / 颜色单一来源）
- `pnpm build` 通过

### 10.3 引擎端到端（mock AI，`engine.recipe.test.ts`）

| 用例 | 验证点 |
|---|---|
| 三步配方跑通 | 步骤日志 `["scan","author","audit"]`、3 次调用、产物 `kind=drillSet`、摘要 `1 个考察点 · 1 题 · 1 条延伸`、`{{params}}` 已注入 step system |
| 降级丢弃 | audit 返回 1 条假引文：断言门 `maxMiss: 2` 不失败，解析层丢弃并计入摘要 `丢弃 1（引文未命中原文）`，节点仍 done |
| 下游序列化 | 知识巩固 → 合并 → 输出：写出文件是 Markdown 题目集（含 `**答案**：42`、`## 再想一步`），不含 `"drillSet"` 原始 JSON |
| 延伸开关 | `withExtensions=false` 时确定性剔除，摘要 `1 个考察点 · 1 题 · 0 条延伸` |

### 10.4 真实浏览器验收（L3，预置一份已完成运行 → 结果页答题）

| 验收项 | 结果 |
|---|---|
| 「练一练」tab 仅在存在 `process.drill` 产物时出现 | ✅ |
| 产物解析与展示（标题、`3 个考察点 · 6 题 · 已答 N 题 · 3 条延伸`、考察点名、题型标签） | ✅ |
| 四种题型本地判分：单选（点选即判）、判断、填空（忽略全角/空白/标点）、多选（少选/多选给中文提示） | ✅ |
| 答对反馈：`回答正确` + 解析 + 原文依据（默认折叠，点开显示逐字引文） | ✅ |
| 答错反馈：`这个点还没答上来` + 解析 + `改答案` 入口 | ✅ |
| 键盘操作：数字选项、Enter 提交/下一题 | ✅ |
| 结果分组：`已经能自己答出来的点（N）` / `建议回看的点（N）`（含 gist 与回到题目）、不显示百分比与排行 | ✅ |
| `只重做错题（N）`：仅重置错题（队列变 `第 1 / 1 题`，其余题保留判定） | ✅ |
| 延伸区：question + 提示 + 方向，且不给答案 | ✅ |
| 进度点阵：按对/错着色、可点击跳题 | ✅ |

### 10.5 验收中发现并修复的缺陷

**`结果` tab 把练一练产物误渲染成溯源报告**：`RunDetailView.vue` 的 `looksLikeTraceReport()` 用 `"schema":1` + `"items":` 判定溯源产物，而 drillSet 恰好也带这两个根键，于是结果页出现一张空的溯源表格。已修复：用 `kind === "drillSet"` 标记先排除，并把 drill 节点整体排除出「输出文档」列表（`isDrillOutput`）。

### 10.6 未覆盖项（需要真实 AI 密钥）

`pnpm check:api:drill` 会真实调用模型，本次环境未配置 AI 密钥，**未执行**（其余 154 个自动化用例与浏览器验收均已完成）。配置密钥后在 `pnpm dev` 起服务的状态下执行：

```bash
pnpm check:api:drill
```

覆盖：schema 拒绝越界参数、三步配方跑通、产物契约（知识点/题目/题型集合/引文逐字命中原文/答案在选项内/无悬空引用/延伸不给答案）、下游合并与输出序列化。

### 10.7 本地遗留数据说明

为做浏览器验收，在本地数据库（`apps/server/data/scribe-flow.sqlite`）写入了一个演示工程 **「知识巩固验收」** 及一条已完成运行（预置产物，未经真实 AI 调用）。它可以直接在界面上删除；不需要时删除该工程即可，不影响其它数据。

