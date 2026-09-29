---
title: 展示范围：哪些节点放出来、哪些先收起来
class: decision
status: accepted
owner: 念前
last_reviewed: 2026-09-29
---

# 展示范围：收起的入口，不是关掉的能力

> 现状以源码为准：规则在 `packages/shared/src/visibility.ts`，设置读写与校验在
> `apps/server/src/lib/settings.ts` 与 `apps/server/src/routes/settings.ts`，开关界面在
> `apps/web/src/views/SettingsView.vue` 的「展示范围」分组。

## 1. 起因

演示时不想让人看到某些能力——「阴阳师攻略加工」这类只服务自己玩的垂直节点摆在节点面板里，
会被问「这是干什么的」，而它跟演示要讲的东西无关。用户要的不只是「藏一个节点」，
而是一条可复用的开关：**哪些节点放出来、哪些不想放**。

## 2. 决定

设置页新增「展示范围」分组：列出全部节点类型，逐项开关，勾上 = **不放进界面**。
保存进 `app_settings` 的 `visibility.hiddenNodes`（节点类型数组）。

三条规则（都写在 `visibility.ts` 里，四个入口共用一份判定，避免各写一遍然后漂移）：

1. **只影响新建时的可选项**：节点面板、新建工程与快捷新建的链路列表、提示词块库。
   已有工程里出现的节点照常渲染、照常运行——收起一个入口不该让旧工程失效。
2. **链路跟着节点走**：链路里用到被收起的节点（含来源轴补出来的来源与转写节点）就整条不出现。
   否则用户建出来会多出一张「我没见过的卡」。代价是：收起 `process.refine` 这类通用节点会连带
   收掉多条常用链路——这是规则的必然结果，界面上用一句说明写清楚，不做特例。
3. **提示词块跟着承载它的节点走**：`PromptBlock.requiresNode` 标出「这个块由哪个节点承载」
   （阴阳师攻略系列 → `process.gameguide`、练一练 → `process.drill`）；通用块由「AI 加工」承载，
   不标也不随任何垂直节点隐藏。

## 3. 为什么不是「关掉能力」

隐藏是**界面层的可选项过滤**，引擎、图校验、运行链路一行都没改：

- 老工程里已经有的节点照常跑（否则一勾开关就把自己的工程跑废了）；
- API 也照常接受这些节点（导入工程不受影响）；
- 因此这个开关**不能当权限或安全边界用**——它只是「眼下不想看到」。

## 4. 边界

- **不做按工程隐藏**：这是全局设置。按工程隐藏要处理「打开工程 A 时面板是这套、B 时是那套」，
  属于另一类需求，等真有场景再说。
- **不做「隐藏后连运行也不允许」**：见 §3。
- **不做节点分组级的开关**：目前是逐个节点。面板分组（来源 / 加工 / 文本与逻辑 / 组织与输出）
  与节点不是一一对应，分组开关会出现「组还在、里面空了」的歧义。

## 5. 影响面

| 位置 | 改动 |
| --- | --- |
| `packages/shared/src/visibility.ts` | 新增：`NODE_TYPE_ORDER`、`isNodeHidden`、`hiddenNodesInTemplate`、`visibleTemplates` |
| `packages/shared/src/run.ts` | `AppSettings` / `UpdateSettingsRequest` 增加 `visibility` 分组 |
| `packages/shared/src/prompt.ts` | `PromptBlock.requiresNode` + `availablePromptBlocks(blocks, searchReady, hiddenNodes)` 第三个可选参数 |
| `apps/server/src/lib/settings.ts` | 读写该分组；坏数据（手改过库）回落「什么都没隐藏」 |
| `apps/server/src/routes/settings.ts` | 校验：只认 `NodeType` 里的值，拼错的类型返回 400 而不是悄悄写库 |
| `apps/web/src/views/SettingsView.vue` | 「展示范围」分组：16 个节点开关 + 「当前收起 N 个」提示；块库按同一规则过滤 |
| `apps/web/src/components/workspace/NodesPanel.vue` | 节点面板按设置过滤，空掉的分组整组收起 |
| `apps/web/src/components/workspace/NewProjectDialog.vue` / `QuickCreateDialog.vue` | 链路列表与提示词块下拉按设置过滤 |
| `apps/web/src/components/canvas/ScribeNode.vue` | 节点内的提示词块下拉按设置过滤 |

## 6. 怎么验证

- `packages/shared/src/visibility.test.ts`：节点顺序表覆盖全部类型、`isNodeHidden` 的默认行为、
  链路联动（含**来源轴补出来的来源与转写节点**：隐藏「B站链接」时视频链路一起收起、文稿链路不受影响）、
  `visibleTemplates` 的默认与隐藏结果、`availablePromptBlocks` 的第三参数与向后兼容。
- `apps/server/src/routes/settings.test.ts`：默认空、保存去重回显、非法节点类型 400 且不写库、
  坏数据回落空数组。
- `pnpm smoke:ui`：节点面板与「展示范围」设置**一致**——不假设用户收了哪些节点，而是拿设置里的列表
  和面板实际渲染做对照（收起的不能出现）。这样它跟着被测机器的设置走，不会因为「你收了一个节点」而误报。
- 本轮实机核对（2026-09-29）：本机把「阴阳师攻略加工」收起来后，节点面板 16 → 15 项、新建工程
  链路列表 9 条 → 8 条（阴阳师攻略消失），设置页开关与说明渲染正常；`pnpm smoke:ui` 65/65。
