# ScribeFlow 方案（v3）：笔记处理画布流

> 状态：**仅方案，待评审**（不写代码、不推送仓库）
> 目标仓库：https://github.com/bomu1121/scribe-flow.git
> v3 修订要点（按用户补充意见）：
> 1. 画布**最大化复用现成开源能力**：底层直接套 Vue Flow（MIT，n8n 编辑器同源），交互逐项照搬成熟开源画布流产品，不重新发明画布交互。
> 2. **B 站收藏不是“收藏功能”**：它是工作流第一步「来源节点」里的快捷选视频方式，因此恢复 B 站扫码登录与收藏类快捷选择，但不再作为独立模块/页面。
> 3. **移除的是旧式「历史记录页 + 星标」**：历史不再以记录收藏的形态体现，改为“运行记录（Run）”随工程归档。

---

## 0. 一页摘要

**ScribeFlow**：一个 Web 端的「笔记加工画布」。素材放进画布（B 站链接可手动粘贴，也可扫码后从收藏夹/稍后再看快捷多选；本地音视频；已有文稿），用节点连线编排加工流（转写 → 校对 → 观点提炼/技术拆解/自定义提示词 → 合并 → 输出），运行后每步产物直接显示在节点上。整个编排保存为**工作流工程**；历史不再有“记录+星标”，只有随工程归档的**运行记录**。

- **画布实现策略**：`@vue-flow/core`（MIT）做引擎，交互细节照搬 n8n（其编辑器就是 Vue Flow 做的），LLM 节点领域借鉴 Langflow / Flowise；自研量压到最低。
- **形态**：Vue 3 Web 应用 + 轻量 Node(Hono)/SQLite 服务。
- **视觉**：纸面工作台 × 工程制图，去 AI 化、浅色优先。
- **交互**：设置/登录/确认/输出预览用居中弹窗或独立页；运行进度就地显示在节点与底部运行控制台；无收藏、无星标、无旧历史页。

---

## 1. 现状诊断（bili2insight → ScribeFlow 的映射）

### 1.1 现有能力处置

| 现有模块 | 处置 |
|---|---|
| B 站链接解析 + 分 P 选择 | **保留**，作为画布「B 站来源节点」的手动输入方式 |
| B 站收藏夹 / 订阅合集 / 稍后再看 / B 站历史 | **保留为来源节点的“快捷选择器”**：扫码登录后从中多选视频，自动生成/填充来源节点；**不再是独立收藏模块，也不提供收藏管理** |
| B 站二维码登录 | **保留最小化登录**（400px 居中弹窗，仅扫码），服务于来源节点快捷选视频 |
| 短信登录 | 移除（未完成占位） |
| 本地音视频 | **保留**，改为「本地文件节点」（上传/拖拽） |
| 流水线：下载→FFmpeg→ASR→AI校对→AI提炼→Markdown | **拆解为可编排节点**，不再是硬编码单链 |
| 提示词模板（3 内置 + 自定义） | **升级为「提示词块库」**：每个 AI 节点引用一个提示词块，可全局复用、节点内覆盖 |
| 处理队列（并发 2、进度、取消/重试） | **保留为运行引擎**，进度打到画布节点 + 运行控制台 + SSE |
| 结果页（复制/导出/日志） | **保留为节点输出预览 + 文档阅读视图**，日志改弹窗 |
| 历史记录页（搜索/分页/星标/删除/清空/多轮分析/重跑） | **移除**。重做为「运行记录」：按工程归档、按节点重跑、可对比输出；**无星标/置顶/收藏语义** |
| 笔记（文件夹/笔记 CRUD/拖拽/高亮） | **整模块移除** |
| 设置抽屉（代理/AI/ASR/模板） | 改设置页：常规 / AI 模型 / 语音识别 / 提示词块库 / B 站账号 / 数据与工程 |
| 导出到磁盘（Tauri dialog） | 改浏览器下载；工程可导出 `.scribe-flow.json` |
| Steins;Gate 主题与特效 | **全部移除** |

### 1.2 移除后的“轻量化”收益

- 前端砍掉：NotesView、HistoryView（旧式）、SourceFavView（独立收藏页）、notes store、历史星标/收藏逻辑。
- 后端砍掉：notes CRUD、旧 history 星标/清空逻辑；**保留** B 站登录 + 收藏类只读列表 API（仅作来源快捷选择的数据服务）。
- 数据模型从“记录 + 收藏”简化为：**工程 Project + 运行 Run + 提示词块 PromptBlock**。

---

## 2. 产品定义

### 2.1 定位一句话

> ScribeFlow 把“从视频到笔记”变成一张可编辑的加工流：素材在左，节点连线决定加工方式，参数直接在节点卡片里调，运行后每步产出就显示在卡片上。

### 2.2 核心对象

| 对象 | 定义 |
|---|---|
| 工程 Project | 一个可保存的工作流：画布（节点+连线+视图位置）、节点参数、默认运行配置；可新建/复制/重命名/删除/导入导出 |
| 节点 Node | 画布上的处理单元，有输入/输出端口、参数、运行状态、输出预览 |
| 连线 Edge | 数据流向（音频→转写→AI 节点→合并→输出） |
| 运行 Run | 一次执行：记录每个节点的状态、耗时、输出快照、错误；可按节点重跑 |
| 提示词块 Prompt Block | 可复用提示词单元（内置 3 个 + 自定义），被 AI 节点引用 |
| 来源选择器 Source Picker | B 站来源节点内的“快捷选视频”弹窗：收藏夹/合集/稍后再看/B 站历史 多选后生成节点 |
| 文档输出 | 合并/输出节点产生的最终 Markdown，可阅读、复制、下载 |

### 2.3 工作流示例（内置工程模板）

1. **视频转笔记（单线）**：`B站链接` → `转写` → `AI 校对` → `AI 加工`（节点内选择提示词块）→ `输出(Markdown)`。
2. **视频多路笔记**：`B站链接` → `转写` → 并行两个 `AI 加工`（各选提示词块）→ `合并` → `输出`。
3. **文稿多路对照**：`文本节点` → 并行三个 `AI 加工`（各选提示词块）→ `合并` → `输出`，比较不同提示词的结果。
4. **文稿转笔记**：`文本节点`（粘贴文稿）→ `校对` → `AI 加工`（选择提示词块）→ `输出`。

> 归属关系：工程模板只描述加工路径形状；「观点提炼 / 技术文案提炼 / 信息溯源 / 自定义」提示词块属于工作流中的 `AI 加工` 节点卡片，在卡片内下拉选择，不作为新建工程的选项。

### 2.4 范围表

**P0**
- 工程：列表、新建（空白/模板）、复制、重命名、删除、自动保存、导入/导出 `.scribe-flow.json`
- 画布：节点拖入/搜索添加、连线/断线、框选、平移缩放、小地图、撤销/重做、自动布局、复制粘贴
- 来源节点：B 站链接（手动 URL + 分 P；或登录后从收藏夹/合集/稍后再看/B 站历史**快捷多选**）、本地音视频、文本粘贴
- B 站登录：最小化二维码登录弹窗（仅支撑来源快捷选择）
- 处理节点：转写（ASR）、AI 校对、观点提炼、技术文案提炼、信息溯源、自定义提示词、合并、输出
- 节点卡片内表单：URL/分P/提示词块/模型与 ASR 覆盖/输出命名；端口类型校验
- 运行：整图运行 / 从某节点运行 / 单节点重跑；并发 2；SSE 实时状态；节点状态徽章与输出预览；失败重试
- 运行记录：按工程归档，列出节点结果与耗时，删除旧运行（**唯一“记录”形态，无星标/收藏**）
- 文档：输出节点卡片内预览、阅读视图、复制、下载 Markdown、日志弹窗
- 设置：AI 模型、语音识别、提示词块库、B 站账号、数据与工程
- 响应式：桌面优先（画布天然桌面向）；<1024 提供只读降级提示

**P1**
- 运行结果版本对比（同工程两次运行 diff）
- 节点输出导出到剪贴板 / 第三方（Notion 等）
- 时间戳文稿点击跳转 B 站原视频
- 深色模式
- 工程模板分享（本地导入导出，不做运营）

**明确移除**
- 旧式「历史记录」页面与星标/置顶/清空语义（由运行记录替代）
- 独立「收藏」模块/页面与收藏管理（收藏夹只作来源节点的只读选择器）
- 笔记库（文件夹/笔记/高亮/拖拽排序）
- 短信登录、追番追剧导入（快捷选择器暂不含）
- 用户可见 HTTP 代理设置（服务端部署配置）
- Tauri、Python sidecar 随包分发、本地 Paraformer 模型
- Steins;Gate 主题、营销 Hero、终端机、CRT/辉光等全部装饰

---

## 3. 调研结论

### 3.1 同类/近邻产品

| 产品 | 借鉴点 | 不采用 |
|---|---|---|
| [BibiGPT](https://bibigpt.co) | 首页即输入；结果 = 摘要 + 时间轴文稿；导出多样 | 重订阅、功能堆叠、无编排 |
| 通义听悟 / 飞书妙记 | 转写与总结双栏阅读；任务中心化 | 会议向、协作复杂 |
| [n8n](https://n8n.io) | **节点面板 + 画布**布局；工作流作为工程保存；节点状态可视化；运行日志可追溯 | 其右侧检查器不采用（本项目改为卡片内操作）；fair-code 不能抄代码，只能复刻交互 |
| ComfyUI | 节点图运行语义清晰：按依赖执行、节点级状态、队列与重跑 | 暗色霓虹、线缆视觉 |
| [Obsidian Canvas](https://obsidian.md) / [Scrintal](https://www.scrintal.com) / Milanote | 卡片画布克制感：卡片轻、连线细 | 手动摆放为主，缺少“运行/产物”概念 |

**UI/交互主力参考（2026-09 用户确认）**：**n8n、Langflow、ComfyUI** 三家的 UI 与交互最贴合本项目审美，定为后续视觉/交互设计的主参照系，里程碑验收以此三家为准。其中 ComfyUI 只借鉴其**交互行为**（节点图操作、节点状态、结果预览、运行语义），**不采用暗色霓虹视觉**——浅色纸灰方向（见 §3.5）不变。官方站点：[n8n](https://n8n.io) · [docs.n8n.io](https://docs.n8n.io) · [GitHub](https://github.com/n8n-io/n8n)；[Langflow](https://www.langflow.org) · [docs.langflow.org](https://docs.langflow.org) · [GitHub](https://github.com/langflow-ai/langflow)；[ComfyUI](https://www.comfy.org) · [docs.comfy.org（中文）](https://docs.comfy.org/zh/index.html) · [GitHub](https://github.com/comfyanonymous/ComfyUI)。

**共性规律**：
- 主流是**左=节点库，中=画布**（n8n/ComfyUI 另有右检查器，本项目按用户偏好改为节点卡片内操作，换取更大画布）。
- 运行状态必须**就地可视化**：节点徽章/边框/输出缩略，不藏在全局抽屉里。
- 工作流是一等公民，**保存 = 保存工程**；运行是工程的一个版本。

### 3.2 画布复用调研：成熟的开源画布流应用（本次重点）

已核对 GitHub 元数据与许可证（2026-08 数据）：

| 项目 | Stars | 许可证 | 画布技术 | 对 ScribeFlow 的用途 |
|---|---|---|---|---|
| **n8n** | ~202k | Sustainable Use License（fair-code，源码可见、不可照抄商用） | **Vue Flow**（见 [PR #22399 Update vue-flow packages](https://github.com/n8n-io/n8n/pull/22399)） | **交互规范母本**（UI/交互主力参考之一）：节点创建、连线校验、运行态、输出查看等逐项复刻其“行为” |
| **Langflow** | ~154k | MIT | @xyflow/react（React Flow） | LLM 流节点组织与结果面板的**交互参考**（UI/交互主力参考之一）；MIT 可读源码 |
| **Dify** | ~154k | 修改版 Apache-2.0（附加条件） | reactflow | 工作流产品形态参考；**代码谨慎使用** |
| **Flowise** | ~55k | Apache-2.0（enterprise 目录除外） | reactflow | LLM 节点分类/配置面板参考 |
| **ComfyUI** | ~130k | GPL-3.0 | litegraph.js | 运行队列/节点级重跑语义参考 + 节点图交互/预览参考（UI/交互主力参考之一，**仅取交互行为，不取暗色霓虹视觉**）；**代码不可用** |
| **Node-RED** | ~24k | Apache-2.0 | 自研旧式画布 | 交互稳但年代旧；仅作兜底参考 |
| **Excalidraw** | ~131k | MIT | 自研自由画板 | 偏手绘白板，不适合节点图；不采用 |
| **tldraw** | ~50k | 自定 License（非 OSI） | 自研画布 SDK | 不适合节点图，许可证受限；不采用 |
| **Vue Flow** | ~6.8k | MIT | Vue 3 节点图库 | **直接采用为画布引擎**（平移/缩放/连线/框选/迷你地图/手柄） |
| Wayflow 等小项目 | <100 | MIT | Vue Flow | 未经过大规模验证，不用 |

**结论：直接套用的组合拳**
1. **引擎层直接依赖** `@vue-flow/core` + `@vue-flow/background` + `@vue-flow/controls` + `@vue-flow/minimap`（MIT），不自己实现画布几何、命中测试、连线、缩放这些最容易出 bug 且最难修的部分。
2. **交互层照搬 n8n 编辑器**（n8n 就是 Vue Flow 的最大规模生产案例）：逐条复刻交互清单，见 3.3；**Langflow / ComfyUI 与 n8n 并列为本项目 UI/交互主力参考**——观感与交互细节统一以这三家为准（ComfyUI 仅取交互，不取其暗色视觉）。
3. **业务形态参考 Langflow / Flowise**（MIT/Apache，可读源码）：LLM 节点的分类、参数面板、结果查看方式。
4. **许可证红线**：n8n、Dify、tldraw、ComfyUI 均不可直接抄代码；可复刻“交互行为”。实际可复用的代码只来自 MIT/Apache-2.0 项目（Vue Flow、Langflow、Flowise 非 enterprise 部分、Node-RED）。

### 3.3 n8n 交互照搬清单（写入实施验收，逐条打勾）

| # | 交互项 | 来源 | 套用方式 |
|---|---|---|---|
| 1 | 画布平移/滚轮缩放/触控板缩放（25%–400%） | Vue Flow | **引擎自带**，只调参数 |
| 2 | 节点拖动、多选、框选、吸附对齐 | Vue Flow | **引擎自带** |
| 3 | Handle 连线、连线预览、连线删除 | Vue Flow | **引擎自带** + `isValidConnection` 做端口类型校验 |
| 4 | 连到非法端口时端口高亮/光标反馈 | n8n | 行为复刻：可连=蓝高亮，不可连=灰+禁止光标 |
| 5 | 添加节点：节点库拖入 / 画布空白双击搜索 / 快捷搜索 | n8n 节点创建器 | 行为复刻（搜索框 + 分类列表 + 最近使用） |
| 6 | 运行中节点脉冲边框、成功绿勾、失败红框 | n8n | 行为复刻，颜色换成设计令牌 |
| 7 | 节点底部输出缩略（`12 个观点块 · 1.2k 字`）→ 点击看详情 | n8n run data | 行为复刻，详情进卡片内预览/弹窗 |
| 8 | 右键菜单：运行此节点/从此节点运行/复制/删除/复制输出 | n8n | 行为复刻 |
| 9 | Ctrl/Cmd+Z 撤销、Shift+Ctrl+Z 重做、Ctrl+D 复制、Delete 删除 | n8n/Vue Flow | 历史栈只存 graph 快照 |
| 10 | “整理画布”自动布局（分支错开 150–200px） | Dify/Langflow 布局习惯 | elkjs + 分支偏移规则 |
| 11 | 迷你地图、缩放控件、适应视图 | Vue Flow | **引擎自带** |
| 12 | 运行队列与逐节点进度 | ComfyUI 队列语义 + n8n Executions | 语义参考；自建底栏运行控制台 + SSE |
| 13 | 输出结果面板（Tab 切换多输出） | Flowise/Dify | 行为参考；做成输出节点卡片内预览 + 运行详情页 |
| 14 | 自动保存指示（`已保存 HH:mm`） | n8n | 行为复刻，500ms 防抖 |
| 15 | 来源节点“快捷选视频”弹窗（登录→列表→多选→生成节点） | 本项目独有 | 自研，但使用标准 Dialog + 表格多选 |

> 目标：除 #15 外，**不发明任何新的画布交互**；凡是清单里的行为，先照 n8n 的做法实现，遇到差异再收敛。

### 3.4 交互规范（v2 结论沿用）

- 设置、确认、输出预览 → 居中弹窗；配置项 ≥3 组 → 独立设置页 + 左分组导航。
- 长文阅读 → 独立路由页，不用抽屉。
- 短决策（删除运行、重跑确认、导出工程）→ AlertDialog。
- 全局进度 → 顶栏「运行中 N」+ `/runs`；工程内进度 → 画布节点 + 底部运行控制台（可折叠面板）。

### 3.5 去 AI 化设计（沿用并补充画布条款）

在原 10 条反 slop 铁律基础上，画布增加 5 条：

1. 节点 = 白卡片 + 发丝边框 + 名称/类型小字 + 状态点；选中只用蓝描边 + 1 个焦点环，不做发光/投影浮起。
2. 连线 = 1.5px 中性灰；运行中虚线流动（120ms 间隔、低透明度）；不画渐变流光。
3. 画布底 = 纸灰 + 12px 点阵（透明度 ≤4%）；不铺品牌色、不放插画。
4. 端口/把手只在 hover 或选中时增强显示。
5. 节点图标只用来源/处理/输出三类线框图标，不做每个节点一个彩色图标。

---

## 4. 信息架构

### 4.1 导航

左侧侧边栏（208px，可折叠）：

- **工程**：`/` 工程列表（工作台）
- **运行**：`/runs` 运行记录
- **设置**：`/settings`
- 底部：B 站账号状态（未登录显示「登录 B 站」，仅扫码）、版本标识

顶栏（52px）：当前工程名/页面标题；右侧「运行中 N」胶囊（点击到 `/runs`）。

移动端（<768px）：顶部栏 + 底部导航（工程/运行/设置）；画布编辑器提示使用桌面端，提供只读视图。

### 4.2 路由

| 路由 | 页面 |
|---|---|
| `/` | 工程列表：新建（空白/模板）、最近工程、最近运行、导入工程 |
| `/project/:id` | 画布编辑器：左节点库 / 中大画布（卡片内操作）/ 底状态条 |
| `/project/:id/run/:runId` | 运行详情：节点结果总览 + 输出文档阅读视图 |
| `/runs` | 运行记录：跨工程列表、状态筛选、打开工程/删除运行 |
| `/settings` | 设置页：常规 / AI 模型 / 语音识别 / 提示词块库 / B 站账号 / 数据与工程 |
| `/settings/prompts/:id?` | 提示词块编辑页（内置只读，自定义可编辑） |

弹窗（不占路由）：登录（400px 扫码）、来源快捷选视频（520px）、输出预览（560px）、日志（640px）、确认（420px）、工程导入导出（480px）。

### 4.3 工程数据流

```
新建工程
  → 画布拖入来源节点
    · B站：手动贴 URL，或「从我的 B 站选择」→ 扫码登录 → 收藏夹/稍后再看 多选 → 生成节点
    · 本地：上传/拖拽；文本：粘贴文稿
  → 连线：来源 → 转写 → AI节点 → 合并/输出
  → 在节点卡片内配置参数（来源卡片可批量选视频，AI 卡片选择提示词块）
  → 运行（整图/局部/单节点）
  → 节点就地显示状态与产物
  → 满意后：下载 Markdown / 保存工程 / 查看运行记录
  → 后续：复制工程改提示词 → 再运行 → 对照版本
```

---

## 5. 页面与交互设计

### 5.1 工程列表 `/`

- 页面头：「工程」+ 主按钮「新建工程」（下拉：空白工程 / 从模板创建）。
- 工程卡网格：名称、最近运行时间、节点/运行次数、来源图标；hover 显示「打开/复制/导出/删除」。
- 「最近运行」横条列表：运行时间、工程名、状态、耗时，点击进运行详情。
- 空态：`还没有工程。创建一个空白工程，或从「视频转笔记（单线）」模板开始。`

### 5.2 画布编辑器 `/project/:id`（核心页面）

**顶栏（52px）**
- 左：返回 + 工程名（可编辑）+ 保存状态（`已保存 HH:mm`）。
- 右：`运行全部` / `从选中节点运行` / `停止`；更多菜单（整理画布、导出工程、复制工程、清空运行记录）。

**左：节点库（200px，可折叠）**
- 分组：来源（B站链接/本地文件/文本）、转写、AI 加工（校对/通用提示词节点）、组织与输出（合并/输出）。
- 拖入画布创建；顶部搜索框；最近使用置顶（照搬 n8n 节点创建器行为）。

**中：大画布（Vue Flow，直接套用引擎能力）**
- 浅灰点阵底、平移/缩放、框选、小地图；节点/连线/端口行为见 3.3 照搬清单。
- 不设右侧检查器：**所有参数操作都在节点卡片内进行**，画布占满可用宽度。
- 节点卡片按内容自适应大小：
  - 来源入口要大：`B站链接` 约 380px 宽（容纳 URL 输入 + 批量选视频入口 + 分 P 信息）、`本地文件` 320px（大投放区）、`文本` 340px（多行粘贴区）。
  - 通用小卡约 224px（转写/校对/合并）。
  - `AI 加工` 320px（提示词块下拉 + 输出名 + 模型覆盖）、`输出` 320px（文件名 + 输出预览占位）。
- 节点卡片内容：
  - 头部：图标 + 可编辑节点名 + 状态点（灰=未运行/蓝=运行中/绿=完成/红=失败）。
  - 卡片内表单：URL/文稿/ASR 引擎/提示词块/输出名/文件名等，失焦提交撤销历史。
  - 运行后显示产物摘要行（如 `12 个观点块 · 1.2k 字`）。
- 端口类型校验：`音频→转写`、`文稿→AI/合并`、`笔记块→合并/输出`。

**底：状态条（30px，非抽屉）**
- 收起为一行：`运行 #12 · 3/5 节点完成 · 转写中 42%`；异常/提示也走这一行，不为空占位。

### 5.3 B 站来源快捷选择（来源步骤的一部分，非独立收藏模块）

- 入口：B 站来源**节点卡片内**「从我的 B 站选择」；未登录时先弹 400px 登录弹窗（仅扫码）。
- 弹窗（520px）：Tab = 收藏夹 / 订阅合集 / 稍后再看 / B 站历史；搜索、分页、多选。
- 确认后行为：
  - 当前节点为空 → 第一个选中视频填充该节点，其余每个视频**自动生成一个来源节点**（垂直错开 150–200px 排列，可配合「整理画布」）；
  - 生成的是普通 URL 节点（graph 里只存 `url + pageInfo`，不存 Cookie/收藏夹引用），后续可独立删除或改 URL。
- 不提供收藏管理（建/删收藏夹等），B 站只读。

### 5.4 运行详情 `/project/:id/run/:runId`

- 顶部：返回工程 + 运行编号 + 状态 + 总耗时 + 操作（重跑失败节点 / 下载 Markdown / 查看日志）。
- 主体：左=节点结果清单（状态、耗时、产物摘要，点击定位画布节点）；右=输出文档阅读视图（白纸文档、15px/1.85、h2 左侧 3px 蓝条）。
- 多输出节点 Tab 切换；日志为 640px 居中弹窗（文稿 / AI 请求 / AI 响应）。

### 5.5 运行记录 `/runs`（替代旧历史页）

- 列表：运行时间、所属工程、状态、耗时、产出摘要；筛选（全部/运行中/成功/失败）。
- 行内操作：打开详情、删除（AlertDialog 确认）。
- **明确没有**：星标、置顶、收藏、清空全部（如需要仅提供“删除失败/已完成记录”）；历史以工程维度呈现，而不是全局记录列表。

### 5.6 设置 `/settings`

| 分组 | 内容 |
|---|---|
| 常规 | 默认并发数、输出文件命名、语言（预留） |
| AI 模型 | 提供商（DeepSeek/OpenAI/自定义）→ 地址、密钥、模型、测试连接与拉取模型 |
| 语音识别 | 云 ASR 引擎（MiMo-V2.5 默认 / OpenAI 兼容端点）、地址、密钥、测试 |
| 提示词块库 | 内置 3 块（只读）+ 自定义块（新增/编辑/删除）；节点只引用块 |
| B 站账号 | 登录状态（扫码登录 / 退出登录）、Cookie 仅保存在自托管服务端、使用范围说明 |
| 数据与工程 | 数据存储位置、导出全部工程、导入工程、清理运行记录（预留） |

### 5.7 弹窗规范

- 登录 400px、确认 420px、导入导出 480px、快捷选视频 520px、输出预览 560px、日志 640px。
- 遮罩 rgba(15,17,21,.4)；150ms fade + 8px 位移；Esc 关闭；焦点圈闭；危险操作红色主按钮。

---

## 6. 设计系统

### 6.1 方向：纸面工作台 × 工程制图

- 应用外壳：浅色、纸灰画布、白表面、发丝边界、墨色导航（CLAUDE.md 既定方向）。
- 画布编辑器：像“在纸上画加工流程图”——克制、安静、可读；不做 ComfyUI 暗色霓虹，不做 FigJam 贴纸感。
- B 站蓝 `#00AEEC` 仅用于：选中节点、运行中状态、主按钮、链接、进度。

### 6.2 令牌草案

```css
--color-bg: #F4F5F6;          /* 应用画布灰 */
--color-canvas: #F8F9FA;      /* 编辑器画布 */
--color-surface: #FFFFFF;
--color-surface-muted: #F7F8F9;
--color-border: #E4E7EB;
--color-border-strong: #CDD3DA;
--color-text: #16181D;
--color-text-secondary: #545B66;
--color-text-tertiary: #8A929E;

--color-brand: #00AEEC;       /* 选中/运行/主操作 */
--color-brand-pressed: #0B88C4;
--color-brand-soft: #E6F7FE;
--color-brand-border: #B8E8FB;

--color-ink: #16181D;
--color-ink-soft: #F0F1F3;

--color-success: #18A058;
--color-warning: #D9822B;
--color-error: #D23F4E;
--color-info: #0B88C4;
```

节点/连线/端口/迷你地图追加画布令牌（`--node-radius: 10px`、`--edge-color: #C6CCD4`、`--edge-running: #00AEEC` 等）。

### 6.3 字体、动效、反 slop

- 中文系统黑体 + Geist Sans（拉丁/数字，自托管）+ Geist Mono（ID、耗时、路径、端口类型）。
- 字重 400/500/600 三档；标题最大 650。
- 动效 120–240ms；尊重 `prefers-reduced-motion`。
- 延续全部反 slop 条款 + 3.5 节 5 条画布条款；交付自检 grep 扫渐变/辉光/emoji/玻璃拟态。

### 6.4 浮层样式铁律（基础设施规则）

- Reka UI 的 `*Portal` 组件会把内容 Teleport 到 `<body>`；Vue scoped 样式不会作用到这些节点。因此所有弹层（Select / Dialog / AlertDialog / DropdownMenu / Popover / ContextMenu）样式必须写在**非 scoped** 的 `<style>` 块，类名以 `sf-` 前缀隔离。
- 浮层 z-index 只允许使用 `--z-overlay / --z-dialog / --z-select / --z-popover / --z-dropdown / --z-context` 令牌，禁止散写。
- `scripts/ui-lint.mjs` 静态执行上述两条检查，并接入 CI；新增任何 Portal 组件不合规即失败。

### 6.5 组件基线与交互态

- UI 原语实现结构参照 [shadcn-vue new-york-v4 registry](https://github.com/unovue/shadcn-vue/blob/48419525/apps/v4/content/docs/components/select.md)，不手搓缺失的 Reka 语义（Select 必须含 `SelectItemText / SelectItemIndicator / SelectIcon / ScrollUp / ScrollDown`）。
- 每个交互组件必须覆盖：`hover`、`active`、`:focus-visible`、`[data-state=open]` 动画、`disabled` 降级；弹出层进入/退出使用 `--dur-*` 与 `--ease-out`。
- 组件层使用 Tailwind 语义 utility（`bg-background / border-input / text-muted-foreground / ring-ring`），语义色在 `@theme inline` 中单一映射到设计令牌；详细代码级调研见 [docs/ui-framework-selection.md](docs/ui-framework-selection.md)。

---

## 7. 技术架构

### 7.1 总体

```
apps/web     Vue 3 + Vite + TS + Pinia + vue-router + Tailwind CSS 4
             + @vue-flow/core / background / controls / minimap（MIT，画布引擎）
             + Radix Vue 系弹窗/菜单/下拉
apps/server  Node 22 + Hono + Drizzle + SQLite
             B站 API(WBI)→下载→FFmpeg→云 ASR→AI 调用
             B站登录（QR）+ 收藏类只读列表（仅供来源快捷选择）
             DAG 运行引擎 + SSE 推送节点/运行状态
packages/shared  TS 类型：Project/WorkflowGraph/NodeSpec/Run/RunNodeResult/PromptBlock
docs         设计系统、API、n8n 交互照搬清单验收记录
```

### 7.2 关键设计

**工作流数据（可版本化、可导出）**
```jsonc
{
  "schemaVersion": 1,
  "id": "prj_xxx",
  "name": "视频转笔记（单线）",
  "graph": {
    "nodes": [{ "id": "n1", "type": "source.bili", "position": {"x":0,"y":0},
                "data": { "url": "…", "pageInfo": { "cid": 123, "part": "P1", "duration": 600 } } }],
    "edges": [{ "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "audio", "targetHandle": "audio" }],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  },
  "runDefaults": { "aiModel": "…", "asr": "mimo", "concurrency": 2 }
}
```
- 来源快捷选择只在**创建节点时**解析为 `url + pageInfo` 写入 graph；工程文件不携带 B 站 Cookie，可安全分享。

**节点类型与端口契约**
```
source.bili  → out: audio
source.file  → out: audio
source.text  → out: transcript
process.transcribe → in: audio            out: transcript
process.refine     → in: transcript       out: transcript
process.prompt     → in: transcript       out: noteBlock   （引用 promptBlockId）
process.merge      → in: noteBlock[]      out: noteDoc
process.output     → in: noteDoc|noteBlock → 产物 Markdown
```

**运行引擎**
- 拓扑排序；`运行全部`、`从节点运行`、`单节点重跑`；并发 2；每节点独立状态与取消。
- SSE：`run.started / node.started / node.progress / node.done / node.error / run.done`。
- 节点产物快照存 SQLite（`run_node_results`），供运行详情与重跑对比；大文本按需加载。

**存储**
- `projects`（graph JSON + meta）、`runs`、`run_node_results`、`prompt_blocks`、`bili_sessions`（QR 登录会话）、`bili_cookies`。
- 无 notes 表、无旧 history 表、无星标字段。

**B 站登录与快捷选择（最小化）**
- 服务端生成二维码并轮询；Cookie 存自托管服务端 SQLite（单用户），设置页可一键退出清除。
- 收藏类 API 只读：`收藏夹列表 → 视频列表`、`订阅合集`、`稍后再看`、`B 站历史`；无任何写操作。

**AI / ASR**
- 服务端调用 OpenAI 兼容接口；ASR 默认 MiMo-V2.5 云 API，预留 OpenAI 兼容端点。
- 提示词块存库，节点只存 `promptBlockId + 可选覆盖字段`。

**前端画布（直接套用，不自研）**
- 引擎：`@vue-flow/core` 全套（节点/边/Handle/MiniMap/Controls/useVueFlow），自研仅限：节点卡片样式（含卡片内表单与自适应尺寸）、节点库、来源选择器、状态徽章。
- 自动布局：`elkjs` + Dify/Langflow 的分支错开规则（150–200px）。
- 撤销/重做：graph 快照历史栈（n8n 行为）。
- 大图防御：节点数 ≤200 流畅；超过提示拆分；输出只渲染摘要。

### 7.3 API 草案

```
GET/POST/PATCH/DELETE /api/projects           工程 CRUD、复制
POST /api/projects/import | GET /api/projects/:id/export
GET/PUT /api/projects/:id/graph               画布自动保存
POST /api/projects/:id/runs                   启动运行（scope: all|fromNode|node）
GET  /api/runs | GET /api/runs/:id | GET /api/runs/:id/events (SSE)
POST /api/runs/:runId/nodes/:nodeId/retry | /stop
DELETE /api/runs/:id
GET  /api/runs/:id/outputs/:nodeId            节点产物

POST /api/videos/preview                      B站解析与分P
POST /api/files/upload                        本地音视频
POST /api/ai/test | POST /api/ai/models
GET/POST/PATCH/DELETE /api/prompts            提示词块库

POST /api/auth/qr | GET /api/auth/qr/:key | GET /api/auth/status | POST /api/auth/logout
GET  /api/bilibili/fav/folders | /api/bilibili/fav/folders/:id/videos
GET  /api/bilibili/collected/:id/videos | /api/bilibili/watch-later | /api/bilibili/history
```

### 7.4 部署

Docker：node:22-slim + ffmpeg + pnpm + dist，`/data` 卷存 SQLite；环境变量 `PORT/DATA_DIR/MAX_UPLOAD_MB/FFMPEG_PATH/BILI_PROXY`；前端可独立托管，`VITE_API_BASE` 指向后端。

---

## 8. 实施计划（6 个里程碑，约 7–9 周）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M0 骨架 | 仓库初始化、monorepo、CI、设计令牌、应用外壳（侧边栏/顶栏/弹窗原语） | 壳可跑，反 slop 自检通过 |
| M1 工程与画布 | 工程列表、Vue Flow 画布接入、节点库、连线/撤销/自动布局、卡片内表单、自动保存、导入导出 | 3.3 照搬清单第 1–11 项全部按 n8n 行为打勾 |
| M2 来源节点 | B 站解析/分 P、**登录 + 收藏类快捷选择器**、本地上传、文本节点 | 三种来源可产出数据；快捷多选自动生成节点 |
| M3 运行引擎 | 下载/FFmpeg/云 ASR/AI 节点、DAG 执行、SSE、节点状态、运行控制台、重跑 | 模板一（视频→观点笔记）端到端跑通 |
| M4 输出与运行记录 | 合并/输出节点、文档阅读、运行详情、日志弹窗、提示词块库、运行记录页 | 多分支对照流程可用；无旧历史页/星标 |
| M5 打磨发布 | 响应式、a11y、大图性能、深色预留、部署文档与 Docker | 一键部署可用，工程导入导出可迁移 |

迁移策略：类型/提示词/中文文案可复用；`worker/bili_worker.py` 的 WBI 与 `src-tauri/src/pipeline.rs` 按节点语义拆解移植；画布交互不自研，照搬清单作为验收项。

---

## 9. 待确认决策

| # | 决策点 | 建议 |
|---|---|---|
| D1 | 画布底座 | ✅ **已确认（2026-08-27）：Vue Flow（MIT）**，n8n 同源引擎；不切 React |
| D2 | UI 组件路线 | Tailwind CSS 4 + Radix Vue 自建（推荐）；备选继续 Naive UI 换肤 |
| D3 | 服务端形态 | Node(Hono)+SQLite 单服务（推荐） |
| D4 | ASR | v1 纯云 ASR（MiMo/OpenAI 兼容）；本地 Paraformer 以后做成可选 sidecar |
| D5 | 运行产物持久化 | SQLite 快照；超大文稿（>2MB）只存路径/摘要，详情按需读 |
| D6 | B 站登录 | **保留最小化扫码登录**（仅服务来源快捷选择）；Cookie 存自托管服务端，设置页可退出清除 |
| D7 | 快捷选择范围 | ✅ **已确认（2026-08-27）：收藏夹 / 订阅合集 / 稍后再看 / B 站历史**；追番追剧不进 v1 |
| D8 | 复用红线 | 只复用 MIT/Apache 代码（Vue Flow、Langflow、Flowise 非 enterprise）；n8n/Dify 只复刻交互行为，不抄代码 |
| D9 | 深色模式 | v1 不做，令牌预留 |

---

## 10. 参考资料

- 画布引擎与事实依据：[Vue Flow（MIT）](https://github.com/bcakmakoglu/vue-flow) · [n8n 更新 vue-flow 的 PR](https://github.com/n8n-io/n8n/pull/22399) · [n8n Sustainable Use License](https://docs.n8n.io/privacy-and-security/sustainable-use-license) · [xyflow](https://github.com/xyflow/xyflow)
- 开源画布流应用：[Langflow（MIT）](https://github.com/langflow-ai/langflow) · [Flowise（Apache-2.0）](https://github.com/FlowiseAI/Flowise) · [Dify](https://github.com/langgenius/dify) · [Node-RED（Apache-2.0）](https://github.com/node-red/node-red) · [ComfyUI（GPL-3.0）](https://github.com/comfyanonymous/ComfyUI)
- 交互与设计：[DAG Visual Editor Design](https://lobehub.com/skills/curiositech-some_claude_skills-dag-visual-editor-design) · [Anthropic frontend anti-slop（社区镜像）](https://github.com/SimHacker/moollm/blob/main/skills/skill-snitch/catalog/anthropic/frontend-design-anti-slop.md) · [AI Slop 反模式清单](https://raw.githubusercontent.com/Jane-xiaoer/claude-design-principles/main/ai-slop-avoid.md) · [SaaS Settings UX](https://www.saasui.design/blog/saas-settings-page-ux-patterns)
- 内部规范：`CLAUDE.md`（纸面工作台样式指南）
