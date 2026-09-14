---
title: M0–M5 关键决策记录（含用户反馈修正）
class: decision
status: accepted
owner: 念前
last_reviewed: 2026-09-14
---

# M0–M5 关键决策记录（含用户反馈修正）

> 来源：从 `docs/research/development-log.md`（原 §5）拆出，2026-09-11。原文是 M0–M5 期间逐条累积的决策流水，
> 与「现状快照」「逐日流水」混在同一份文件里。这里只保留决策本身，并补上每条**当前是否仍有效**。
> 逐条的详细论证散落在 `docs/decisions/` 下各自的方案文档里，见每条末尾的指引。

## 产品与架构

1. **产品定位**：笔记处理画布流，工程 = 工作流 + 运行记录；不做旧历史页 / 星标。
   依据 → [scribe-flow-proposal.md](./scribe-flow-proposal.md)
2. **画布底座**：Vue Flow（MIT，与 n8n 同源），交互行为照搬 n8n，不自研。
   依据 → [scribe-flow-proposal.md](./scribe-flow-proposal.md) §3
3. **B 站收藏是来源步骤的快捷选视频，不是独立收藏模块。**
4. **工程模板与提示词块归属分离**：新建工程只给工作流形状，提示词在 AI 加工节点上选择。
5. **画布去掉右侧检查器**，操作全部进节点卡片，卡片按内容自适应大小。
6. **链接输入即解析**（用户明确要求的检查点）。

## UI 与交互

7. ~~UI 原语改为 shadcn-vue registry 1:1 复制~~ —— **已被第 9 条取代**。当时修过的问题记录：
   Portal 弹层 scoped 样式失效、全局 focus outline 双层边框、focus ring 过重、节点选中背景色。
8. ~~输入框/下拉聚焦态规范：无 ring、无 outline，仅 1px 品牌蓝边框，颜色过渡包含 `border-color`；节点选中只 1px 边框 + 中性阴影，无背景色。~~ —— **已被第 9 条取代**（聚焦态现由 Element Plus 与 `styles/element-theme.css` 的 `--el-*` 桥接决定）。
9. **通用 UI 路线反转（2026-08-28）**：自设定样式连续不达标，调研确认 n8n 等同类产品采用 Element Plus；
   废弃 shadcn-vue 复制件，通用控件全部改用 Element Plus，设计令牌通过 `--el-*` 变量桥接；
   遮罩加深至 0.55、控件描边用强档令牌、节点阴影分级。
   依据 → [ui-library-replacement-research.md](./ui-library-replacement-research.md)；被取代的旧选型 →
   [ui-framework-selection.md](./ui-framework-selection.md)（`status: superseded`）
10. **「订阅合集」口径（2026-08-28）**：B 站「订阅/收藏别人的合集」无稳定公开接口；
    经用户确认改为「我的合集」，走官方 `x/polymer/web-space/seasons_series_list` 稳定接口。
11. **UI/交互主力参考（2026-09 用户确认）**：n8n、Langflow、ComfyUI 为后续视觉/交互设计的主参照系与验收基准；
    ComfyUI 仅借鉴交互行为（节点操作 / 状态 / 预览 / 运行语义），不采用暗色霓虹视觉，浅色纸灰方向不变。
    依据 → [scribe-flow-proposal.md](./scribe-flow-proposal.md) §3.1 / §3.2
12. **节点结果预览交互（2026-09 用户方向确认）**：删除选中内联预览（不再撑高卡片），
    改为以底部右侧 delta 变化徽标为热区的悬停/点击弹出「下拉同款」全内容预览浮层（含输出 / 导图，
    懒加载最近运行的完整文本），整条摘要栏保持朴素无选中态。
    依据 → [node-result-preview-research.md](../research/node-result-preview-research.md) §6

## 与既有决策的关系

- 第 9 条是一次**反转**（不是精化）：它使第 7、8 条失效，因此旧选型文档按 ADR 规则标记为
  `superseded` 而不是删除，链接见第 9 条。
- 第 11、12 条是 2026-09 追加的，属于对既有方向的收敛而非反转。

## M6 基础件补全的决策（2026-09-02）

来源：M6 实施清单（已随里程碑完成退役删除，原文见 git 历史）。该清单退役前，这 7 条决策**只存在于那一处**。决策已落入代码（`packages/shared/src/graph.ts` 的节点类型与端口、
`schema.ts` 的 zod 校验、`apps/server/src/lib/engine.ts` 的执行语义），此处补上决策记录本身。

| 项 | 结论 |
| --- | --- |
| D-M6-1 | 重试配置挂在节点 `data.retry`；仅对 transcribe / refine / prompt / chapter 生效，默认 2 次 / 3s 退避 |
| D-M6-2 | `flow.if` 条件模型：`field(字数/词数/包含) + op + value`；输入与两路输出类型动态一致 |
| D-M6-3 | 多类型端口：`PortSpec` 增加可选 `accepts: PortType[]`，支撑 if / text 的同型透传 |
| D-M6-4 | `process.chapter` 单输出 `chapters`（noteBlock），多章以多输出列表传给 merge（复用现有多输出机制） |
| D-M6-5 | 章节切分 LLM 返回 JSON 数组 `[{title, content}]`，非法 JSON 按节点失败处理 |
| D-M6-6 | 新增 SSE 事件 `node.retry`、`node.skipped`；`NodeRunStatus` 增加 `skipped` |
| D-M6-7 | `run_node_results` 增加 `attempts` 列（默认 1）；`flow.if` 分支结果写入 summary（`条件成立` / `条件不成立`） |

## AI 节点配方化的决策边界（2026-09-08）

来源：M8-1 阶段 A 实施清单（已完成退役删除，原文见 git 历史）。

- **阶段 A 已实施并验收**：Recipe 原语与确定性断言门在 `packages/shared/src/recipe.ts`，
  配方本体与内置块在 `packages/shared/src/prompt.ts`，步骤日志与 `node.step.*` 事件在
  `packages/shared/src/run.ts`。
- **阶段 B/C 未做**：步骤级断点续跑与缓存依赖 M7 的缓存指纹，见 [status.md](../status.md) 的已知缺口。
- **当时计划的「v2 / v4 同稿 A/B 盲评建档」闸门未执行**：v4 与知识巩固都直接转正了。
  这条闸门不再作为约束，但「配方改版先做盲评」这个做法本身仍值得保留。

## 「素材挑选」（段级分流）的决策（2026-09-10）

来源：`docs/research/development-log.md` 的 §15–§16.3 逐条流水（2026-09-11 合并另一侧工作后，该文件
已按既定的拆分口径归档，逐日流水见 [CHANGELOG.md](../../CHANGELOG.md)）。决策已落入代码：
节点定义与端口在 `packages/shared/src/graph.ts`，段标识与挑选判定在 `packages/shared/src/segment.ts`，
引擎侧过滤在 `apps/server/src/lib/engine.ts` 的 `resolveInputs`。

| 项 | 结论 |
| --- | --- |
| D-PICK-1 | 只做「挑段」，不做分组多支路；用**勾选真实素材**指定，而不是填序号 |
| D-PICK-2 | 未选中的素材**连同其下游一起跳过**——过滤发生在 `resolveInputs` 铺完 `items` 之后，未选中的根本不进节点，没有额外的传播逻辑；过滤后一段不剩则拒绝执行并提示可操作文案 |
| D-PICK-3 | `data.pick: Record<来源节点 id, 段标识[]>`；**键缺失 = 该来源全选**（旧工程零迁移），空数组 = 明确排除；全选时界面删掉该键，保持工程数据干净 |
| D-PICK-4 | 段标识只用素材自身稳定信息（`bvid:<bvid>:<分P>` / `file:<id>` / `node:<来源节点>`），**不掺数组下标**；产出方自带身份时优先沿用，不按「产出方 + 位置」重新派生 |
| D-PICK-5 | 素材身份可穿过「一个输入一份结果」的中间模块（转写 / 校对 / AI 加工 / 攻略 / 练一练 / 文本工具 / 挑选）；压平型模块（合并 / 输出 / 章节 / 导图 / 条件分支）身份到此为止——想按段分流必须发生在压平之前 |
| D-PICK-6 | 形态是**独立节点** `flow.pick`，而不是把选择器藏进消费节点的高级设置（用户否掉了自己先提的高级设置方案，理由是独立节点更好，也更贴 `flow.if` / `process.text` 这类中间件范式）；消费节点内的同款选择器保留，两处写同一份 `data.pick` |
| D-PICK-7 | `PUT /api/projects/:id/graph` 覆盖前把前一版留档到 `data/graph-backups/`（空图不留档，每工程保留最近 20 份）——事故驱动的防护，不依赖前端时序 |
| D-PICK-8 | 「无身份即不可筛选、一律放行」：AI 集合这类元素无稳定标识的产物不参与挑选。要支持需先为其定义稳定序号标识，属后续项 |
