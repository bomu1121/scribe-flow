# ScribeFlow 实施清单 M6（基础件补全：重试 / 条件分支 / 文本工具 / 章节切分）

> 状态：**M6 实施清单，待开工**（2026-09-02 由模块拓展路线图拆出）
> 依据：[workflow-module-roadmap.md](./workflow-module-roadmap.md) §3、[r1-desktop-research.md](./research/r1-desktop-research.md)、[scribe-flow-proposal.md](./scribe-flow-proposal.md)
> 工作方式：沿用 M0–M5 约定——中文文案、UTF-8、颜色走设计令牌、交互照搬 n8n、许可证红线（只复刻行为不抄代码）。

---

## 0. M6 目标与决策快照

**目标**：在现有 8 节点体系上新增/增强 4 个基础能力，补齐「工作流产品默认能力」的缺口：

| # | 模块 | 类型 | 一句话 |
|---|---|---|---|
| T1 | 失败重试策略 | 增强 | 处理节点可配置自动重试，SSE 可见，运行记录记 attempts |
| T2 | 条件分支 | 新节点 `flow.if` | 按输入条件走 true/false 两条路，不满足分支自动 skipped |
| T3 | 文本工具 | 新节点 `process.text` | 查找替换/正则/模板/清理，纯本地执行 |
| T4 | 章节切分 | 新节点 `process.chapter` | 长文稿 LLM 切章，输出章节笔记块供合并 |

**已确认决策**：

| 项 | 结论 |
|---|---|
| D-M6-1 | 重试配置挂在节点 `data.retry`；仅对 transcribe/refine/prompt/chapter 生效，默认 2 次/3s 退避 |
| D-M6-2 | `flow.if` 条件模型：`field(字数/词数/包含) + op + value`；输入与两路输出类型动态一致 |
| D-M6-3 | 多类型端口：`PortSpec` 增加可选 `accepts: PortType[]`，支撑 if/text 的同型透传 |
| D-M6-4 | `process.chapter` 单输出 `chapters`（noteBlock），多章以多输出列表传给 merge（复用现有多输出机制） |
| D-M6-5 | 章节切分 LLM 返回 JSON 数组 `[{title, content}]`，非法 JSON 按节点失败处理 |
| D-M6-6 | 新增 SSE 事件 `node.retry`、`node.skipped`；`NodeRunStatus` 增加 `skipped` |
| D-M6-7 | `run_node_results` 增加 `attempts` 列（默认 1）；flow.if 分支结果写入 summary（`条件成立`/`条件不成立`） |

---

## 1. packages/shared 类型与 schema（约 1 天）

### 1.1 `src/port.ts`：多类型端口

```ts
export interface PortSpec {
  id: string;
  type: PortType;
  label?: string;
  /** 多类型端口（动态同型透传），存在时优先于 type。 */
  accepts?: PortType[];
}

export function canConnectSpecs(from: PortSpec, to: PortSpec): boolean {
  if (from.accepts || to.accepts) {
    const fromSet = from.accepts ?? [from.type];
    const toSet = to.accepts ?? [to.type];
    return fromSet.some((f) => toSet.includes(f));
  }
  return canConnect(from.type, to.type);
}
```

- `canConnect` 保留原语义（单类型）；`isValidConnection` 与 `schema.ts` 的端口校验改走 `canConnectSpecs`。

### 1.2 `src/graph.ts`：新节点类型与数据

```ts
export type NodeRunStatus = "idle" | "queued" | "running" | "done" | "error" | "cancelled" | "skipped";

export interface RetryConfig {
  maxRetries?: number;   // 默认 2
  backoffMs?: number;    // 默认 3000
}

export interface IfCondition {
  field: "charCount" | "wordCount" | "contains";
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains";
  /** contains 系列为要匹配的文本；其余为数字字符串。 */
  value: string;
}

export interface IfData { condition: IfCondition; }
export interface TextToolData {
  operation: "findReplace" | "regexReplace" | "template" | "cleanup";
  find?: string;
  replace?: string;
  pattern?: string;
  flags?: string;        // regexReplace 的 flag，如 "gi"
  template?: string;     // template 操作，{{input}} 占位
}
export interface ChapterData {
  granularity: "coarse" | "medium" | "fine";
  maxChapters?: number;  // 默认 20，上限 50
}
```

- `NodeBase.data` 增加可选 `retry?: RetryConfig`。
- `NodeType` 增加 `"flow.if" | "process.text" | "process.chapter"`。
- `GraphNode` 联合类型增加三个成员（data = `NodeBase["data"] & RetryConfig?` 不需要，retry 已在 base；if/text/chapter 各自 data）。
- `NODE_TYPE_LABELS`：`flow.if` = 条件分支，`process.text` = 文本工具，`process.chapter` = 章节切分。
- `NODE_PORTS`：

```ts
"flow.if": {
  inputs:  [{ id: "in", type: "transcript", label: "输入", accepts: ["transcript", "noteBlock", "noteDoc"] }],
  outputs: [
    { id: "true",  type: "transcript", label: "是", accepts: ["transcript", "noteBlock", "noteDoc"] },
    { id: "false", type: "transcript", label: "否", accepts: ["transcript", "noteBlock", "noteDoc"] },
  ],
},
"process.text": {
  inputs:  [{ id: "in", type: "transcript", label: "输入", accepts: ["transcript", "noteBlock", "noteDoc"] }],
  outputs: [{ id: "out", type: "transcript", label: "输出", accepts: ["transcript", "noteBlock", "noteDoc"] }],
},
"process.chapter": {
  inputs:  [{ id: "in", type: "transcript", label: "文稿" }],
  outputs: [{ id: "chapters", type: "noteBlock", label: "章节" }],
},
```

### 1.3 `src/schema.ts`

- `baseDataSchema` 增加 `retry: z.object({ maxRetries: z.number().int().min(0).max(10).optional(), backoffMs: z.number().int().min(100).max(60000).optional() }).optional()`；`status` enum 增加 `"skipped"`。
- `nodeDataByType` 增加：
  - `ifData`: base + `condition: z.object({ field: z.enum(["charCount","wordCount","contains"]), op: z.enum(["gt","gte","lt","lte","eq","contains","notContains"]), value: z.string() })`
  - `textTool`: base + `operation: z.enum([...])` + 可选 find/replace/pattern/flags/template
  - `chapter`: base + `granularity: z.enum(["coarse","medium","fine"])` + `maxChapters: z.number().int().min(1).max(50).optional()`
- `graphNodeSchema` discriminatedUnion 增加三行 `nodeOf(...)`。
- 端口校验函数改用 `canConnectSpecs`（同时保留 `sourceHandleType`/`targetHandleType` 返回 PortSpec 而非 type）。

### 1.4 `src/run.ts`

- `RunEvent` 增加：
  ```ts
  | { type: "node.retry"; runId: string; nodeId: string; attempt: number; maxRetries: number; error: string }
  | { type: "node.skipped"; runId: string; nodeId: string; reason: string }
  ```
- `RunNodeResult` 增加 `attempts?: number`。

### 1.5 共享测试

- `schema.test.ts` 追加用例：非法 retry（负数）拒绝；`flow.if` 连到非法端口拒绝；`process.text` 的 accepts 端口允许 transcript→noteBlock 同型连接；章节节点输出 noteBlock 可连 merge。

---

## 2. 后端（apps/server，约 3–4 天）

### 2.1 DB：`run_node_results` 加列

- `attempts: integer("attempts").notNull().default(1)`；Drizzle 迁移生成 SQL（沿用现有 better-sqlite3 迁移方式）。
- 老数据默认 1，无需回填。

### 2.2 引擎 `lib/engine.ts`：重试（T1）

- `executeNode` 改为尝试循环：

```
attempts = 0
maxRetries = data.retry?.maxRetries ?? (retryableTypes.has(node.type) ? 2 : 0)
backoffMs = data.retry?.backoffMs ?? 3000
while (true) {
  attempts += 1
  try {
    result = await runNode(...)
    updateNode(..., attempts)
    return "done"
  } catch (err) {
    if (attempts <= maxRetries && isRetryable(err) && !active.cancelled) {
      emit node.retry(attempt, maxRetries, message)
      await sleep(backoffMs * attempts)
      continue
    }
    updateNode(..., error, attempts)
    return "error" | "done(cancelled)"
  }
}
```

- `retryableTypes = new Set(["process.transcribe","process.refine","process.prompt","process.chapter"])`。
- `isRetryable(err)`：取消（`运行已取消`）与配置类错误（`未配置.*密钥`、`没有可.*输入`、`文稿为空`、`链接为空` 等）不重试；其余（超时/网络/429/5xx/空 AI 响应）重试。实现上以错误消息前缀匹配即可，不引第三方。
- `updateNode` 与 `RunNodeResult` 写 attempts；`run_node_results` 表 attempts 列。

### 2.3 引擎：条件分支 `flow.if`（T2）

- `runNode` 增加 `case "flow.if"`：
  ```
  text = inputs.text（无输入则抛「没有可判断的输入」）
  cond = node.data.condition
  value = 计算：
    charCount = text.length
    wordCount  = 中文按字、英文按空格分词后的词数（简单实现：中文字符数 + 英文单词数）
    contains   = text.includes(cond.value)
  branch = 比较结果 ? "true" : "false"
  summary = `条件${branch === "true" ? "成立" : "不成立"} · ${value}`
  outputs = [{ kind: 输入的实际 kind, text, size: text.length }]
  active.branches.set(node.id, branch)
  return { outputs, summary }
  ```

- `ActiveRun` 增加 `branches: Map<string, "true" | "false">`。
- `resolveInputs` 按 handle 过滤：
  ```
  for edge (target === node.id):
    source = ...
    if source.type === "flow.if":
      const branch = active.branches.get(source.id)
      const want = edge.sourceHandle || "true"
      if (branch !== want) continue   // 该路不输出
    outputs = ...
  ```

- `runLoop` 分支跳过传播：
  - `depsDone` 不再只看上游是否 done：若某上游边来自已执行的 flow.if 且 `branch !== (edge.sourceHandle || "true")`，则本节点「永久不满足依赖」，应跳过。
  - 实现：每轮循环先做一次 `skipBlocked(active, done)`——对所有未完成节点，若存在「断供边」（来源是已执行 flow.if 且分支不匹配），置为 skipped（updateNode + emit node.skipped + 加入 done），并从 running 候选剔除。
  - 若节点所有上游边都断供，或同时还有其它依赖未完成，按跳过处理；若节点没有任何输入边（来源节点），不受影响。
  - 被跳过的节点不再 `resolveInputs`/`executeNode`。

- `combineOutputs`：`flow.if` 输出按输入 kind 原样透传（text 或 noteBlock 或 noteDoc）；现有实现已按 node.type 推断 kind，需在 if/text 分支特殊处理：直接返回第一个 output 的 kind。

### 2.4 引擎：文本工具 `process.text`（T3）

- `runNode` 增加 `case "process.text"`：对每个非音频输入项独立处理，输出同型同数量：

| operation | 行为 |
|---|---|
| findReplace | `text.split(find).join(replace)`，find 为空则原样 |
| regexReplace | `new RegExp(pattern, flags)` 替换为 replace，非法正则抛「正则表达式无效：…」 |
| template | 把 `{{input}}` 替换为输入文本；无占位则 template 原样（不吞输入） |
| cleanup | 去首尾空白、把连续 3+ 空行压成 2 空行、统一全角标点？——只做无副作用的：去首尾空白 + 空行压缩 + 删除行尾空格 |

- 无输入时抛「没有文本输入」；输出 `kind = 输入实际 kind`（首个输入决定），summary = `${n} 个输入 · ${total} 字`。

### 2.5 引擎：章节切分 `process.chapter`（T4）

- `runNode` 增加 `case "process.chapter"`：
  ```
  text = inputs.text（不足 200 字抛「文稿过短，不适合章节切分」）
  aiConfig = getAiConfig；无 key 抛「未配置 AI 模型密钥，请到设置页填写」
  system = `你是内容编辑。把下面的文稿切分为章节。只输出 JSON，格式：
  {"chapters":[{"title":"章节标题","content":"本章内容"}]}
  要求：章节数不超过 ${maxChapters}；粒度：${granularityLabel}；保持原文信息完整，不新增观点。`
  result = chatCompletion(...)
  parse JSON（先找第一个 { 到最后一个 }，再 JSON.parse）
  chapters = parsed.chapters ?? (Array.isArray(parsed) ? parsed : [])
  校验：1..maxChapters 章；每章 title/content 非空；总字数 ≥ 原文 50%
  outputs = chapters.map(c => ({ kind:"noteBlock", text:`## ${c.title}\n\n${c.content}`, size }))
  summary = `${chapters.length} 章 · ${total} 字`
  ```
- `granularityLabel`：粗=大段/少章（≤12），中=适中（≤20，默认），细=小节/多章（≤30）。
- 章节文本合并后经 `merge` 生成带目录的 noteDoc（现成能力，不新写）。

### 2.6 SSE 与运行详情

- `routes/runs.ts` SSE 透传新事件（现为转发，确认类型即可）。
- `detail()` 返回 `attempts` 字段；前端运行详情显示「重试 N 次」。

---

## 3. 前端（apps/web，约 3–4 天）

### 3.1 节点库与画布

- `NodePalette.vue` 分组调整为：来源 / 转写 / AI 加工（校对、提示词、**章节切分**）/ 文本与逻辑（**文本工具、条件分支**）/ 组织与输出（合并、输出）。
- `FlowCanvas.vue`：
  - `NODE_LAYOUT_WIDTH` 增加：`flow.if: 300`、`process.text: 260`、`process.chapter: 240`。
  - 创建节点默认数据：`flow.if` 默认 `{ condition: { field: "charCount", op: "gt", value: "5000" } }`；`process.text` 默认 `{ operation: "findReplace", find: "", replace: "" }`；`process.chapter` 默认 `{ granularity: "medium", maxChapters: 20 }`；处理节点默认 `retry: { maxRetries: 2, backoffMs: 3000 }`（转写/校对/提示词/章节）。
  - `isValidConnection` 前端同样改用 `canConnectSpecs`（从 shared 导出）。

### 3.2 `ScribeNode.vue` 新卡片

- 图标：`flow.if` = `GitBranch`，`process.text` = `Replace`（lucide 有 `Replace`），`process.chapter` = `ListTree`。
- `canViewOutput` 增加 `flow.if`、`process.text`、`process.chapter`。
- 新增 `is-skipped` 状态样式：边框/状态点用 `--color-text-tertiary`，无脉冲；`statusClass` 已按 `data.status` 生成，补 CSS 即可。

**条件分支卡片（300px）**
```
字段：   [字数 ▼] [大于 ▼] [5000     ]
提示：   满足走「是」，否则走「否」；被跳过分支显示灰色
```
- 字段下拉：字数 / 词数 / 包含；操作符随字段联动：字数词数 = gt/gte/lt/lte/eq，包含 = contains/notContains；value 输入框（包含时 placeholder「输入要匹配的文字」）。
- 失焦提交撤销历史。

**文本工具卡片（260px）**
```
操作：   [查找替换 ▼]
参数区： 查找 [      ]  替换为 [      ]        （findReplace）
         正则 [      ]  替换为 [      ]  标志 [g ]  （regexReplace）
         模板 [ {{input}} 开头 + 正文 + 结尾 ]     （template）
         （cleanup 无参数，显示说明「去空白、压缩空行、删行尾空格」）
```

**章节切分卡片（240px）**
```
粒度：   [适中 ▼（粗/适中/细）]
最多章节：[20    ]
```

**重试高级区（转写/校对/提示词/章节 四类卡片）**
```
▸ 高级（失败重试）
  最大重试 [2] 次 · 退避 [3000] ms
```
- 用 `details`/自研小折叠实现，不引新组件；写入 `patch({ retry: {...} })`。

### 3.3 运行详情与状态展示

- `RunDetailView.vue` 节点状态列显示「跳过」灰徽章（`skipped` 已有枚举，补文案与颜色）。
- 节点结果行显示「重试 2 次后成功」当 `attempts > 1`。
- 画布节点在 SSE 收到 `node.retry` 时：状态点保持运行中，摘要区显示 `重试 2/2…`；收到 `node.skipped` 显示灰色跳过徽章。

### 3.4 预检

- 运行前预检增加两条：
  - 存在 `flow.if` 但两个输出都没有连线时提示（警告，不阻断）。
  - 存在 `process.chapter` 且上游无 transcript 输入时阻断（同现有端口预检规则）。

---

## 4. API 与脚本

- API 路由无需新增：`PUT /api/projects/:id/graph` 经 shared `parseGraph` 自动校验新节点。
- 新增 `scripts/m6-api-check.mjs`（仿 `m4-api-check.mjs`）：
  1. 登录 → 创建工程 → 写入含 `source.text → flow.if → (true)→ process.text → output` 与 `(false)→ process.text → output` 的 graph。
  2. 文本「这是一段用于测试条件分支的文稿，长度足够。」，条件 `charCount > 10`。
  3. 运行 → 断言 true 路 `done`、false 路 `skipped`、输出文件存在且内容经过文本工具处理。
  4. 写入 `process.text` 的 regexReplace 用例（`\s+` → ` `）断言替换生效。
  5. 写入非法重试配置（maxRetries=-1）断言 PUT graph 400。

---

## 5. 测试与验收

### 5.1 自动化

- `pnpm typecheck` / `pnpm test`（shared schema 新用例）/ `pnpm build` / `pnpm lint:slop` / `pnpm lint:ui` 全绿。
- `pnpm check:api:m6` 通过（条件分支、文本工具、schema 校验）。

### 5.2 M6 验收清单

**T1 失败重试**
- [ ] AI 节点配置重试 2 次；用测试端点模拟 2 次 500 后成功，节点最终 done，运行详情 attempts=3。
- [ ] 未配置密钥时不重试，直接 error。
- [ ] SSE 收到 `node.retry` 事件，画布节点显示「重试 1/2…」。
- [ ] 强制结束能中断重试等待（退避期间可取消）。

**T2 条件分支**
- [ ] `文本(5000+字) → flow.if(字数>5000) → true:章节切分 / false:AI提示词` 两条路各跑一次，分支正确、另一路 skipped。
- [ ] 端口校验：`flow.if` 的「是/否」不能连到 audio 端口。
- [ ] 运行详情中 skipped 节点显示灰色「跳过」，不显示错误。

**T3 文本工具**
- [ ] findReplace / regexReplace / template / cleanup 四种操作在真实画布各跑通一次，产物正确。
- [ ] 非法正则返回中文错误，节点 error，不崩溃。

**T4 章节切分**
- [ ] 长文转写稿 → 章节切分 → 合并 → 输出，生成带 `## 章节标题` 目录的 Markdown。
- [ ] 章节数 ≤ maxChapters；每章非空。
- [ ] 文稿过短（<200 字）报「文稿过短，不适合章节切分」。
- [ ] 提示词块/模型覆盖？章节节点走 AI 设置，节点内模型覆盖可选（复用 AiNodeData 的 model 字段）。

**全局**
- [ ] 新建工程模板不受影响（4 模板仍可创建、运行）。
- [ ] 旧工程（M5 前保存）导入/打开正常，旧 graph 无 retry/新节点字段不报错。
- [ ] 全程中文文案、令牌化颜色、`pnpm lint:slop` 0 命中。

---

## 6. 交付边界（M6 明确不做）

- 不做循环节点、子流程、定时触发、节点缓存（M7）。
- 不做 `flow.if` 的多路 switch（只做二路）；不做表达式编辑器，只做字段/操作符/值。
- 不做章节切分的说话人分离（依赖 ASR 能力，不在本里程碑）。
- 不做重试策略的「按错误类型分别配置」高级 UI（先只做次数+退避）。
- 不做移动端画布新交互。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| `flow.if` 引入 skipped 传播，引擎循环复杂度上升 | 单独实现 `skipBlocked`，所有未完成节点统一判定；补引擎单测（拓扑+断供边） |
| 多类型端口（accepts）破坏现有连线校验 | `canConnectSpecs` 优先，`canConnect` 保留；shared schema 测试覆盖旧节点 |
| 章节切分 LLM 返回非法 JSON | 取首个 `{` 到末个 `}` 再 parse；失败按节点 error 处理，日志保留原始响应 |
| 重试把运行时长成倍拉长 | 默认 2 次 3s 退避，退避随 attempt 递增；停止/强制结束必须能中断等待 |
| 前端卡片增多，ScribeNode 过长 | 新卡片逻辑抽成子组件（`node-cards/IfCard.vue`、`TextToolCard.vue`、`ChapterCard.vue`、`RetryFields.vue`），ScribeNode 只做分发 |
| 旧工程兼容 | 所有新字段 optional；schema 对旧 graph 不强制；`attempts` 默认 1 |

## 8. 下一步（M7 预告）

节点级缓存/断点续跑（fingerprint 列 + cached 状态）、定时触发（B 站合集更新自动跑）、结构化抽取节点、第三方导出、运行 diff、来源平台扩展（YouTube/播客/字幕文件）。详见 [workflow-module-roadmap.md](./workflow-module-roadmap.md) §4。
