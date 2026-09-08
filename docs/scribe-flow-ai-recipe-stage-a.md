# ScribeFlow M8-1：AI 加工节点配方化（阶段 A 试点）实施清单

> 状态：**已按清单实现，待验收**（2026-09-08 落地：shared 配方类型与 zod、两列幂等迁移、lib/recipe 原语、engine 接入与 v3 内置块、步骤日志与筛选 UI；验收口径见 §7）
> 日期：2026-09-08
> 依据：[AI 加工节点内部多步链调研](./research/ai-node-multistep-research.md) §3-L1、§4-阶段 A
> 目标：让 `process.prompt` 节点可执行「声明式配方」（节点内多步链），先交付 1 个内置试点配方（观点提炼 v3）+ 运行时原语 + 步骤级运行可见性；**默认行为零变化**。

---

## 1. 目标与范围

### 1.1 做

| # | 内容 | 位置 |
|---|---|---|
| 1 | `PromptBlock` 增加可选 `recipe`（配方 zod 校验 + TS 类型），内置块可携带 | `packages/shared/src/prompt.ts` |
| 2 | `prompt_blocks` 表增加 `recipe` 列（本期仅预留，自定义块编辑 UI 属阶段 C）；`run_node_logs` 表增加 `step` 列 | `apps/server/src/db/schema.ts` + `apps/server/src/db/client.ts`（幂等迁移） |
| 3 | 配方执行器（步骤模板渲染 / 断言门 / 进度映射 / 步骤日志） | `apps/server/src/lib/recipe.ts`（新建）+ `engine.ts` `process.prompt` 分支接入 |
| 4 | 新增内置试点块「观点提炼 v3（配方）」；**不动 v2** | `packages/shared/src/prompt.ts` BUILTIN 列表 |
| 5 | SSE 事件扩展 `node.step.done / node.step.error`（started/progress 复用现有 `node.progress` 文案，见 §5.2 取舍） | `packages/shared/src/run.ts` + `engine.ts` |
| 6 | 运行详情日志弹窗支持按 `step` 分组/筛选；节点卡片块下拉显示「配方 · N 步」 | `apps/web`（运行详情日志弹窗、AI 节点卡片） |

### 1.2 不做（本阶段明确排除）

- ❌ L2 收敛环 / L3 map-reduce 结构步骤（见调研 §3-L2/L3，另行立项）
- ❌ 步骤级断点重跑与缓存（依赖 M7 缓存指纹，落到阶段 C）
- ❌ 配方编辑 UI、自定义块配方（阶段 C；本期自定义块恒为 null → 单步）
- ❌ `process.refine / chapter / mindmap` 配方化（试点只挂 `process.prompt`）
- ❌ 工程图文件格式变更（recipe 只存在于块上，不进 node.data）
- ❌ 节点内 agent / 动态规划（调研 L4 明令不做）

---

## 2. 数据模型

### 2.1 `PromptBlock` 扩展（shared）

```ts
export interface RecipeStep {
  id: string;            // 如 "scan"
  label: string;         // 如 "通读拆解"（日志/UI 展示）
  system: string;        // 支持模板变量 {{input}} / {{prev}}
  model?: string;        // 覆盖模型（可选，本期试点不用）
  expects?: {
    kind: "text" | "json";
    asserts?: Assertion[];
  };
}

export type Assertion =
  | { op: "contains"; value: string } | { op: "notContains"; value: string }
  | { op: "lengthGte"; value: number } | { op: "lengthLte"; value: number }
  | { op: "jsonRootKeys"; value: string[] }
  | { op: "citationsInOriginal"; source: "input"; field: string; maxMiss: number };

export interface Recipe {
  schema: 1;
  steps: RecipeStep[];  // 1..=8 步
}

// PromptBlock 增加：
recipe?: Recipe;
```

- zod 校验放 `packages/shared/src/prompt.ts`（或独立 `recipe.ts`），`steps.length` 上限 8、`system` 非空、`id` 步内唯一。
- 模板变量只支持两个：`{{input}}`（该输入的原始文本）、`{{prev}}`（上一步输出）。渲染前校验「未识别的 `{{...}}` 视为普通文本，不报错」（避免老提示词误伤）；步骤 0 引用 `{{prev}}` 时替换为空串并记 info 日志。
- 兼容：无 `recipe` 的块 = 单步旧路径，类型上 `recipe?` 可选即可，旧序列化数据全部可读。

### 2.2 内置试点块「观点提炼 v3（配方）」

- `id: "builtin.insight.v3"`、`series: "观点提炼"`、`version: "v3"`、`description` 标注「多步配方试点，2 倍左右调用与耗时」；**不设 recommended**（v2 保持 recommended=true，模板不预绑块，默认体验不受影响）。
- 配方草案（评审基线，zod 定稿以评审为准）：

```json
{
  "schema": 1,
  "steps": [
    { "id": "scan", "label": "通读拆解",
      "system": "你是深度内容编辑。通读全文，先不写正文，输出拆解清单 JSON：{\"blocks\":[{\"title\":\"观点标题\",\"quotes\":[\"摘自原文的关键句，≤60字\"]}]}。quotes 必须逐字摘自原文；漏掉的事实/数据/案例会导致后续笔记残缺。",
      "expects": { "kind": "json", "asserts": [
        { "op": "jsonRootKeys", "value": ["blocks"] },
        { "op": "citationsInOriginal", "source": "input", "field": "blocks[].quotes[]", "maxMiss": 0 } ] } },
    { "id": "draft", "label": "分块起草",
      "system": "按拆解清单与原文起草 Markdown 笔记：总体概要 + 观点块（事实/数据/案例/金句分开呈现）+ 脉络与结论。观点块数量与拆解清单一致；关键表述保留原话。只输出笔记正文。",
      "expects": { "kind": "text", "asserts": [ { "op": "contains", "value": "#" } ] } },
    { "id": "audit", "label": "回文核对",
      "system": "把草稿中每条事实/金句/数据与原文核对，输出 JSON 核对表：{\"items\":[{\"quote\":\"草稿原句\",\"inOriginal\":true|false,\"note\":\"修正建议\"}]}。",
      "expects": { "kind": "json", "asserts": [ { "op": "jsonRootKeys", "value": ["items"] } ] } },
    { "id": "finalize", "label": "修正成稿",
      "system": "依据核对表修正草稿：原文没有的内容删除或标注为存疑，只输出最终 Markdown 笔记，不加解释。",
      "expects": { "kind": "text", "asserts": [ { "op": "notContains", "value": "```" } ] } }
  ]
}
```

### 2.3 表迁移（沿用 `client.ts` 幂等迁移先例）

`apps/server/src/db/client.ts` `ensureSchema` 末尾追加（模式与 `runs.graph_json`、`run_node_results.attempts` 补列一致，见 L144-206）：

```ts
// M8-1：prompt_blocks.recipe（阶段 C 前恒为 NULL）+ run_node_logs.step。
const blockColumns = sqlite.prepare("PRAGMA table_info(prompt_blocks)").all() as Array<{ name: string }>;
if (!blockColumns.some((col) => col.name === "recipe")) {
  sqlite.exec("ALTER TABLE prompt_blocks ADD COLUMN recipe TEXT");
}
const logColumns = sqlite.prepare("PRAGMA table_info(run_node_logs)").all() as Array<{ name: string }>;
if (!logColumns.some((col) => col.name === "step")) {
  sqlite.exec("ALTER TABLE run_node_logs ADD COLUMN step TEXT");
}
```

- `packages/shared/src/run.ts` `RunNodeLog` 增加 `step?: string`；日志查询/API 透传。
- `prompts` 路由（`routes/prompts.ts`）：自定义块 `toBlock` 透传 `recipe`（值为 null）；`createSchema/updateSchema` 本期不改（无 UI 写入口）。

---

## 3. 引擎执行（`lib/recipe.ts` + `engine.ts`）

### 3.1 接入点

`engine.ts` `case "process.prompt"`（现 L953-988）：块解析后（`blockId`/`promptOverride`/`builtin` 逻辑不变，见 L960-968）：

```
if (node.type === "process.prompt" && block?.recipe && !promptOverride.trim()) {
  → executeRecipeOnInput(...)  // 每个输入文本跑一遍整条配方
} else {
  → 现有单次调用路径（一行不改，保证零回归）
}
```

- `promptOverride` 非空且块带 recipe：**忽略 recipe 走单步**，并写一条 info 日志「自定义提示词覆盖配方，按单步执行」——覆盖是用户显式行为，优先级最高。
- `process.refine / chapter / mindmap` 不接入（本期范围）。

### 3.2 执行语义（单输入一条配方）

1. `renderStepSystem(system, { input, prev, all })` 展开 `{{input}}/{{prev}}/{{all}}`（原文 / 上一步输出 / 全部前序输出·带步骤标记）；未知 `{{...}}` 原样保留，不误伤老提示词；
2. 每步：`chatCompletion({ ...aiConfig, model: step.model ?? aiConfig.model }, system, payload, signal)`（`payload` 步骤 0 = 原文；后续 = 上一步输出；`{{all}}` 只在 system 展开，供 finalize 这类需要全局上下文的步骤；`chatCompletion` 语义不变，`lib/ai.ts` 不动）；
3. 步骤产物若为 `kind:"json"`：先 `JSON.parse` 容错（剥离 Markdown 围栏后重试一次），失败抛「步骤 <label> 输出不是合法 JSON」；
4. 断言门：`evaluateAsserts(step.expects.asserts, output, ctx)` 全部通过才进下一步；失败抛「步骤 <label> 断言未通过：<前 3 条未命中明细>」（见 §3.3 错误语义）；
5. 每步记日志（`kind: "ai-request" / "ai-response" / "info"`，新增 `step` 列 = `step.id`，`content` 前缀 `[scan] 通读拆解` 便于肉眼阅读），并 `progress(nodeId, ...)` 推进（进度分配见 3.4）；
6. 节点输出：最后一步 `kind:"text"` 产物作为该输入的输出；输出映射与现有路径一致（`process.prompt` → `noteBlock`，逐输入 `parts` 合并语义不变，见 L984-987）。

### 3.3 错误与重试

- 断言失败 / JSON 解析失败 = **非可重试业务错误**：不进入 `node.retry` 自动重试（重试同一配方大概率重蹈覆辙），直接 `node.error`，错误消息带步骤 id 与断言名。
- 网络 / 429 / 5xx：现有外层重试循环（L796-839）包住整条配方自动重试，`RETRYABLE_NODE_TYPES` 不新增条目。
- 单步断言失败会丢弃该输入中间产物？不会：中间产物已逐条落 `run_node_logs`（步骤维度审计），失败时保留到失败步为止，方便复盘。

### 3.4 进度与摘要

- 进度沿用 `node.progress`（0-100）：多输入场景每个输入分一段，段内按步均分；消息形如「输入 1/2 · 步骤 2/4 回文核对」。
- 节点 `node.done.summary` 形如「配方 4 步 · 1 输入 · 4 次调用 · 3.1k 字」（调用次数 = 步数 × 输入数，真实计数；无 recipe 时摘要格式不变）。

---

## 4. SSE 事件与前端可见性

### 4.1 `packages/shared/src/run.ts` RunEvent 扩展（L97-105 后追加）

```ts
| { type: "node.step.done"; runId: string; nodeId: string; stepId: string; index: number; total: number; summary?: string }
| { type: "node.step.error"; runId: string; nodeId: string; stepId: string; index: number; total: number; error: string }
```

### 4.2 前端取舍（与调研 §L1-3 的差异说明）

- 调研稿设想 `node.step.started/progress` 全套事件；评审建议取 **started/progress 复用现有 `node.progress`**（画布摘要行即时显示步骤文案），仅新增 `done/error` 两个收尾事件供日志与将来消费。
- `FlowCanvas.vue` `applyRunEvent`（L596-635）对未知 `nodeId` 事件的默认分支已安全（空 patch 空转），无需改动即可不崩；**本期不新增画布分支**（步骤细节在运行详情日志弹窗看）。
- 节点卡片：块下拉选中带 recipe 的块时，选项标注「配方」（沿用卡片内操作，不加步骤编辑器）；步骤数在运行摘要与详情日志可见。

### 4.3 运行详情日志

- 日志弹窗（640px，M4 已有按节点过滤）：当该节点日志含 `step` 值时，出现「步骤」筛选下拉（全部 / scan 通读拆解 / draft 分块起草 / …），后端日志接口支持可选 `?step=` 过滤。
- 中间产物不进节点预览/结果页（最终产物不变），避免与 node-result-preview 设计冲突。

---

## 5. 测试清单

### 5.1 纯函数单测（新增）

| 用例 | 文件 |
|---|---|
| 模板渲染：`{{input}}/{{prev}}/{{all}}` 替换、未知变量原样保留、空文本替换为空串 | `apps/server/src/lib/recipe.test.ts` |
| JSON 容错：围栏剥离、非法 JSON 报错文案含步骤 label | 同上 |
| 断言门：6 种 op 的通过/失败矩阵 + 失败消息含前 3 条明细 | 同上 |
| zod：`steps` 空/超 8、id 重复、断言 op 白名单 → 校验拒绝 | `packages/shared/src/recipe.test.ts` |

### 5.2 回归与集成

| 用例 | 说明 |
|---|---|
| 无 recipe 块逐字一致 | 观点提炼 v2 走旧路径：engine 日志/输出与改动前完全一致（mock chatCompletion 断言只调用 1 次、system 原文未变） |
| override 优先 | v3 块 + `promptOverride` → 单步、无 step 日志、info 提示 |
| v3 全流程 | mock 4 步各返回合法输出 → 断言门全过 → 输出 kind=noteBlock、摘要含「配方 4 步」与「4 次调用」、ai-request/ai-response 日志 step 依次为 scan/draft/audit/finalize |
| 断言失败 | audit 步返回含 `inOriginal:false` → `node.step.error` + `node.error` 文案含「回文核对」；网络错误 → 现有重试生效 |
| API | 内置列表返回 v3 且带 recipe；自定义块 recipe=null；老库启动迁移补列成功（用旧版库文件 fixture 启动一次） |

---

## 6. 开发顺序

1. shared：Recipe 类型 + zod + `PromptBlock.recipe?` + 单测；
2. db：schema.ts 两列 + client.ts 幂等迁移 + RunNodeLog.step + 日志查询/API 透传；
3. lib/recipe.ts 纯函数（渲染/断言/JSON 容错）+ 单测；
4. engine.ts 接入 + v3 内置块 + 集成测试（mock）；
5. shared RunEvent 两事件 + 引擎 emit；
6. web：日志弹窗步骤筛选 + 卡片徽标；
7. `pnpm typecheck && pnpm test && pnpm build && pnpm lint`。

---

## 7. 验收口径（分层）

| 层 | 标准 |
|---|---|
| L0 | typecheck / test / build / lint 全绿；新增单测覆盖 §5.1 |
| L1 | §5.2 集成用例全过（v2 零回归为硬门槛） |
| L2 | 真实 Key 端到端：新建工程 → 文本来源（1k+ 字真实文稿）→ AI 加工选「观点提炼 v3（配方）」→ 运行：节点摘要含配方步数、详情日志按 4 步分组可读、最终 Markdown 可在运行详情 diff 视图中与输入对比 |
| L3 | 与 v2 同稿 A/B 盲评建档（衔接调研阶段 B 评测集，本期只建档案不设通过线） |

## 8. 风险与回退

| 风险 | 对策 |
|---|---|
| 断言误杀导致可用性下降 | 断言失败=节点失败且错误可读；v3 是可选块，v2/自定义块不受影响 |
| 步骤日志刷屏 | 沿用现有 ai-request/ai-response 日志语义，按 step 分组后体积可控；超长响应若成为问题再截断 |
| 试点不达预期 | v3 块从内置列表摘除即整体回退（无 schema 残留、无图文件影响） |
| 与调研稿事件设计出入 | §4.2 取舍已记录；评审不同意的部分按评审改回 |

## 9. 关联文档

- 调研：[ai-node-multistep-research.md](./research/ai-node-multistep-research.md)（§0 结论、§3 L1、§4 阶段 A）
- 现状基线：`apps/server/src/lib/engine.ts`（prompt 执行 L953-988、重试 L796-839）、`apps/server/src/lib/ai.ts` L24-41、`packages/shared/src/run.ts`（RunEvent L97-105、RunNodeLog L81-89）、`packages/shared/src/prompt.ts`（BUILTIN L384-451）、`apps/server/src/db/schema.ts`（L122-141）、`apps/server/src/db/client.ts`（幂等迁移 L144-206）、`apps/web/src/components/canvas/FlowCanvas.vue`（L596-635）
