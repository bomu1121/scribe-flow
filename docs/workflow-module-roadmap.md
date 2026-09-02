# ScribeFlow 功能工作流模块拓展路线图（R5 定稿）

> 状态：**路线图建议，待评审**（评审通过后按里程碑立实施文档）
> 输入：R1 桌面研究报告 [r1-desktop-research.md](./research/r1-desktop-research.md)、方案文档 [scribe-flow-proposal.md](./scribe-flow-proposal.md)
> 原则：先补基础件（P0），再做运行体验与自动化（P1），高级差异化（P2）需单独立项论证——防止滑向 iPaaS / Dify 路线。

---

## 1. 结论摘要

1. **P0 基础件**（市场标配、ScribeFlow 缺失）：失败重试策略、条件分支、文本工具、章节切分。建议作为 M6。
2. **P1 运行体验与自动化**（高价值、成本中等）：节点级缓存/断点续跑、定时触发、结构化抽取、第三方导出、运行 diff、来源平台扩展。建议作为 M7，其中「节点缓存」优先级最高。
3. **P2 高级差异化**（需专项论证）：子流程/可复用片段、多模型矩阵对照、轻量人工确认、RAG/知识库、自然语言生成流程、webhook 触发、Agent 接口化（MCP/OpenAPI）。建议 M8 及以后，逐个立项。
4. **不引入**：循环节点、审批/泳道、连接器生态、RBAC/SSO、桌面 RPA——与「笔记加工画布流」定位不符或成本过高。

---

## 2. 现状基线（M5 完成时）

- 节点 8 个：`source.bili / source.file / source.text / process.transcribe / process.refine / process.prompt / process.merge / process.output`。
- 端口类型 4 种：`audio / transcript / noteBlock / noteDoc`；多输入语义=按序合并。
- 运行引擎：拓扑排序、并发 2、SSE、整图/从节点/单节点重跑、强制结束；**无重试、无缓存、无分支**。
- 存储：`projects / runs / run_node_results / prompt_blocks / bili_sessions / bili_cookies`。

---

## 3. M6 基础件补全（P0）

### 3.1 失败重试策略（节点配置）

- **功能定义**：每个处理节点可配置「最大重试次数 / 退避间隔 / 可重试错误类型」；AI/ASR 超时、429、5xx 自动重试；重试过程经 SSE 可见。
- **数据模型**：`NodeBase.data` 增加可选 `retry?: { maxRetries: number; backoffMs: number }`，默认 `{ maxRetries: 2, backoffMs: 3000 }`。
- **引擎改动**：`executeNode` 外包重试循环；新增 SSE 事件 `node.retry`（attempt 计数与错误摘要）；`run_node_results` 记录 `attempts`。
- **UI 改动**：处理节点卡片「高级」折叠区加重试字段；运行详情节点行显示「重试 2 次后成功」。
- **验收**：模拟 ASR 连续失败 2 次后成功，画布状态从运行中→重试→成功，运行记录 attempts=3。

### 3.2 条件分支节点 `flow.if`

- **功能定义**：`flow.if` 节点对输入做条件判断，输出 `true/false` 两个端口；下游按满足分支执行，不满足分支标记 `skipped`。
- **数据模型**：
  - 新节点类型 `flow.if`，`data: { field: "charCount" | "contains" | "wordCount"; operator: "gt"|"gte"|"lt"|"lte"|"eq"|"contains"|"notContains"; value: string }`。
  - 输入端口 `in: transcript|noteBlock|noteDoc`；输出端口 `true`、`false`（类型与输入相同）。
  - 图模型校验：`flow.if` 最多一个输入；两个输出可分别连或不连。
- **引擎改动**：运行时计算条件；不满足的分支下游节点置 `skipped`（状态机增加第 5 态）；`run` 记录保存分支结果。
- **UI 改动**：分支节点卡片 = 字段/操作符/值三行表单；两个输出 handle 标注「是/否」；被跳过节点显示灰色「跳过」徽章。
- **验收**：模板「文本字数 > 5000 走章节切分，否则直接 AI 提炼」端到端跑通；两种输入各跑一次结果正确。

### 3.3 文本工具节点 `process.text`

- **功能定义**：纯文本加工节点，操作类型：查找替换、正则替换、模板渲染、字数统计（作为字段输出）、去除空行、Markdown 格式化（标题规范化）。
- **数据模型**：新节点类型 `process.text`，`data: { operation: "findReplace"|"regexReplace"|"template"|"cleanup"; find?; replace?; pattern?; flags?; template? }`；输入/输出端口同类型透传（`transcript|noteBlock|noteDoc`）。
- **引擎改动**：纯函数执行，无外部调用；输出快照照常。
- **UI 改动**：卡片内操作下拉 + 动态参数；实时预览（对首个输入片段运行）。
- **验收**：正则清洗转写稿时间戳；模板渲染生成统一导语。

### 3.4 章节切分节点 `process.chapter`

- **功能定义**：把长转写稿按语义切成章节，输出 `noteBlock[]`（每章一块，含标题），由下游 `merge` 合并为带目录笔记；也可直接输出 `noteDoc`。
- **数据模型**：新节点类型 `process.chapter`，`data: { granularity: "coarse"|"medium"|"fine"; maxChapters?: number }`；输入 `transcript`；输出端口 `chapters: noteBlock[]` 与 `doc: noteDoc` 二选一（默认 chapters）。
- **引擎改动**：一次 LLM 调用，返回 JSON `[{title, content}]`；校验章节数上限。
- **UI 改动**：粒度下拉 + 章节数上限；输出摘要显示「12 章 · 3.2k 字」。
- **验收**：B 站长视频模板（来源→转写→章节切分→合并→输出）产出带目录 Markdown。

> M6 完成标准：4 个节点可用；schema/引擎/UI/验收按上表逐项通过；`pnpm typecheck && pnpm test && pnpm smoke:ui` 全绿。

---

## 4. M7 运行体验与自动化（P1）

### 4.1 节点级缓存 / 断点续跑（P1 最高优先级）

- **功能定义**：重跑时对「参数与上游输入均未变化」的节点直接复用上次运行快照；用户可选「仅重跑失败/变更节点」。
- **实现要点**：节点指纹 = `node.data + 上游输出哈希`；`run_node_results` 增加 `fingerprint` 列；重跑前逐节点比对，命中则状态置 `cached`。
- **UI**：重跑菜单增加「只重跑失败/变更节点」；运行详情节点行显示「来自缓存」。
- **验收**：转写完成后连跑两次，第二次转写节点标记 cached，总耗时显著下降。

### 4.2 定时触发（合集更新自动跑）

- **功能定义**：工程可配置 cron 定时运行；到点自动创建 Run 并执行整图。
- **实现要点**：`projects` 增加 `schedule?: { cron: string; enabled: boolean; source: "bili.collection"|"manual" }`；server 内置轻量调度器（node-cron）；B 站合集更新检测（对比上次最新视频）→ 自动填充来源节点后运行。
- **UI**：工程设置弹窗加「定时运行」；运行记录标注 `触发方式: 定时`。
- **验收**：配置每 30 分钟检查一次，B 站合集新增视频后自动产出运行记录。

### 4.3 结构化抽取节点 `process.extract`

- **功能定义**：从文稿中抽取结构化 JSON（观点列表 / 术语表 / 行动项 / 自定义 schema），渲染为 Markdown 或供下游模板使用。
- **数据模型**：`process.extract`，`data: { schema: FieldDef[]; outputMode: "json"|"markdown" }`；输入 `transcript|noteBlock`；输出 `noteBlock`（或 `json` 新端口类型）。
- **验收**：从技术视频转写稿抽取「术语表」并渲染为表格。

### 4.4 第三方导出

- **功能定义**：输出节点扩展导出目标：本地下载（已有）、剪贴板、Notion、飞书文档；后续可加 Obsidian/flomo（参考 BibiGPT）。
- **实现要点**：OAuth 令牌存 `credentials` 新表（沿用 n8n 凭据库思路）；导出为幂等创建/追加。
- **验收**：一键把输出 Markdown 推到 Notion 页面。

### 4.5 运行 diff

- **功能定义**：同工程两次运行（或同运行两个 AI 分支）输出文档逐行对比。
- **UI**：运行详情页「对比」按钮 → 双栏 diff 视图。
- **验收**：两次不同提示词运行可直观看出差异。

### 4.6 来源平台扩展

- **功能定义**：`source.url` 通用网页/YouTube/播客；`source.file` 支持 srt/vtt 字幕直接入流。
- **实现要点**：YouTube 走 yt-dlp（如许可证允许）或第三方解析；网页正文提取（Readability 思路）；srt/vtt 解析为 transcript。
- **验收**：YouTube 链接 → 转写 → 笔记跑通；字幕文件 → AI 加工跑通。

---

## 5. M8 高级差异化候选（P2，逐个立项）

| 候选 | 一句话形态 | 立项前提 |
|---|---|---|
| 子流程/可复用片段 | 把「校对+观点提炼」打包为工程片段拖入画布 | 用户调研证明复用需求高频 |
| 多模型/多提示词矩阵 | 同素材 × N 提示词并行，结果对照 | M7 后视反馈 |
| 轻量人工确认节点 | 输出前在卡片内改稿确认再导出 | 用户抱怨「AI 输出不能改」 |
| RAG/知识库节点 | 结合用户历史笔记库加工 | 单独论证，防止 Dify 化 |
| 自然语言生成流程 | 一句话自动搭图（参考 Power Automate Generative actions） | M8 后期，依赖 LLM 选型 |
| webhook 触发 | 外部系统 HTTP 触发工程运行 | 有 API 化需求后 |
| Agent 接口化（MCP/OpenAPI） | 把工程暴露为 MCP 工具供外部 Agent 调用 | 生态需求验证 |

---

## 6. 数据模型演进一览

```
NodeType 增加：
  flow.if          in: transcript|noteBlock|noteDoc → out true/false（同型）
  process.text     in/out 同型透传（transcript|noteBlock|noteDoc）
  process.chapter  in: transcript → out chapters: noteBlock[] | doc: noteDoc
  process.extract  in: transcript|noteBlock → out noteBlock

RunNodeResult 增加：attempts、fingerprint、cached、skipped 状态
Project 增加：schedule
新增表：credentials（OAuth/API 凭据加密存储）
Run 增加：triggeredBy: "manual"|"schedule"|"webhook"
```

## 7. 里程碑节奏建议

| 里程碑 | 内容 | 体量估计 |
|---|---|---|
| **M6 基础件补全** | 重试策略、条件分支、文本工具、章节切分（实施清单见 [scribe-flow-m6.md](./scribe-flow-m6.md)） | 约 2 周 |
| **M7 运行体验与自动化** | 节点缓存/断点续跑、定时触发、结构化抽取、第三方导出、运行 diff、来源扩展 | 约 3–4 周 |
| **M8 高级差异化** | 按立项结论逐个做，不整体排期 | 视立项 |

## 8. 风险与红线（沿用）

- 许可证：n8n/Dify/ComfyUI 只复刻行为与语义，不抄代码；可读源码仅限 MIT/Apache-2.0（Langflow/Flowise 非 enterprise/Node-RED/Vue Flow）。
- 定位闸门：每个新节点必须能放进「素材→笔记」链路说得通；禁止引入审批、连接器市场、RBAC 等 iPaaS/BPM 能力。
- 复杂度防线：引入 `flow.if` 后引擎出现 `skipped` 态，后续所有节点执行器都要兼容跳过传播；`process.chapter` 引入 `noteBlock[]` 端口后，多输入合并语义要明确（列表先展开再合并）。
