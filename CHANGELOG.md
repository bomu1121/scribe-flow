# Changelog

本项目所有值得记录的变更都写在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

**维护约定（重要）**：条目在**引入变更的同一次提交里**追加到 `## [Unreleased]` 下，不要等到发版时
回顾补写——那样会把写 changelog 变成考古，也必然漏。现状与进度看 [docs/status.md](./docs/status.md)，
本文件只记录「什么时候改了什么」。

**格式说明**：本项目尚未发布任何版本（无 git tag），因此所有条目都在 `## [Unreleased]` 下，
按日期分组——这是对 Keep a Changelog 的务实调整，等第一次打 tag 时再收进版本号。分类固定为：
`新增` / `变更` / `废弃` / `移除` / `修复` / `安全`。

## [Unreleased]

### 2026-09-28

#### 新增

- **分享会现场手册 [sharing/ROOM.md](./sharing/ROOM.md)**：把讲稿收敛成「那天说什么、绝不投什么、被问什么」。
  含三条**演示时不许点**的路径（素材挑选配在中间模块之后、自定义提示词块、把节点连成环），
  以及「这跟 BibiGPT / 通义听悟 有什么不一样」的答法与调研底牌。
- **演示道具 [sharing/tools/make-bench-graph.mjs](./sharing/tools/make-bench-graph.mjs)**：
  一条命令建好 200 节点的演示工程（纯文本链路，不需要密钥、不联网）。
- **三份调研文档**（都在 [docs/research/](./docs/research/)）：画布性能优化（三处改动与实测数字）、
  全项目审计（七个区域逐文件走过，按后果分级）、仓库可读性与过度工程（含外部对照实验）。

#### 变更

- **画布性能：跑一次 200 节点的运行，前端主线程最长阻塞从 32 655 ms 降到 264 ms**（同一操作，服务端 268 ms 就完成）。
  三处改动都在 `apps/web/src/components/canvas/FlowCanvas.vue`：开启 Vue Flow 的视口裁剪
  （DOM 元素 8 926 → 2 099）、运行事件按动画帧合流且只替换受影响的节点、自动布局改用
  `elkjs/lib/elk-api.js` 配合 Web Worker（布局长任务 728 ms → 53 ms）。
  测量口径、复现步骤与新引入的风险（裁剪会让节点反复挂载）见
  [docs/research/canvas-performance-optimization.md](./docs/research/canvas-performance-optimization.md)。
- **`AGENTS.md` 与 `README.md` 收敛**：产品说明前置（5 行扩到 31 行），文档治理类内容压到最小
  （66 行收到 17 行），并去掉「每次回复都要以目标对照表结尾」这类纯仪式规则。
  动机来自一次评审事故：工具把仓库自己的「自我批评文档」当成了项目的问题清单，
  外部证据与研究结论见 [docs/research/repo-legibility-and-over-engineering.md](./docs/research/repo-legibility-and-over-engineering.md)。

### 2026-09-27

#### 新增

- **引入 `knip` 做死代码检测**（未使用的文件 / 依赖 / 导出），并接进 `pnpm lint`：
  配置在 [knip.jsonc](./knip.jsonc)，附了每条配置的理由。动机是它补上了自研门禁的一个盲区——
  原有 22 条规则没有发现 `explorer.css` 612 行从未被加载，knip 一条命令就找到了。
  **固定在 5.x**：knip 6 换用 oxc-parser 做解析，其 raw transfer 需要分配约 6 GiB 的单个
  `ArrayBuffer`（`BLOCK_SIZE + BLOCK_ALIGN`），而 V8 的 ArrayBuffer 上限是 4 GiB，
  在 Windows 上实测 4/4 崩溃（`RangeError: Array buffer allocation failed`）；
  knip 5 不依赖 oxc-parser，本机连跑 5 次全部成功。详见 [docs/status.md](./docs/status.md)。
- `apps/server` 的三个开发期脚本接入 npm script，从「游离脚本」变成可用命令：
  `db:check`（数据库完整性/表行数）、`smoke:media`（媒体链路真实跑）、`poc:video`（下载 PoC）。
- **引入 `dependency-cruiser` 做依赖方向约束**，接进 `pnpm lint`：配置在
  [.dependency-cruiser.cjs](./.dependency-cruiser.cjs)，四条规则——禁循环依赖、
  `packages/shared` 不得反向依赖 `apps`、跨包不许深层 import 进别人的 `src`、孤儿模块告警。
  它管的是 knip 管不到的另一头：knip 找已经写死的死代码，这里拦不该长出来的依赖。
  因为根目录没有统一 tsconfig，另加了只服务它的 [tsconfig.depcruise.json](./tsconfig.depcruise.json)
  给 `@/*` 别名提供路径映射——**没有它会把 5 个在用的文件误报成孤儿**。
- **引入 `Vale` 做中文散文检查**（`pnpm check:prose`，**未接进 `pnpm lint`**，理由见下）：
  配置在 [.vale.ini](./.vale.ini)，规则在 `.vale/styles/ScribeFlow/`。
  **没有启用 Vale 内置的英文风格包**：本仓文档是中文，内置 `Vale.Spelling` 在 61 个文件上报出
  675 个 error，全是「ESLint / knip / Vue / gzip 是不是拼错了」这类技术词误报。
  实际启用的只有两条自定义正则规则：破折号密度上限（棘轮，现最高用量 17 处 / 阈值 20）与套话连接词。
- **分享会产出落地到 [sharing/](./sharing/)**：18 页 PPT（`out/ScribeFlow-前端技术分享.pptx`）+
  逐页 PNG + [讲演稿](./sharing/SPEECH.md)，三个主题按产品主线走：编排 → 运行 → 读结果。
  目录自带 `package.json`（不在 pnpm 工作区里，故不污染应用依赖图），含四个工具：
  `build-deck.cjs`（生成）、`qa-deck.cjs`（几何/结构自检）、`export-slides.ps1`（PowerPoint COM 导出，脚本内不写中文）。
  **PPT 已过独立视觉验收**：第一轮 4 页不合格（数字口径含糊、卡片半空、孤字行、代码续行顶格），修完复检通过。
  **但另一次独立复检（2026-09-27，改到 18 页之后）仍发现 3 页不合格**，尚未修：
  P11 左卡标题对比度 2.88:1、P18 深色页正文 2.59:1（都低于 WCAG 4.5:1），P6 卡片下方约三成空白且没有收尾句。
  前两处的改动很小（`build-deck.cjs` 里 P11 的 `tone` 与 P18 的正文色各一处），改完需要重新生成 PPT 与导出图。
  导出路径没有走 LibreOffice：本机没有 LibreOffice / pdftoppm，只有 PowerPoint COM。

#### 修复

- **解开 `packages/shared` 的一处类型循环依赖**：`graph.ts` ↔ `segment.ts` 互相 `import type`
  （由 dependency-cruiser 检出，手工复核确认是双向类型引用）。把单行的 `NodePick`
  从 `segment.ts` 移到消费它的 `graph.ts`（`NodeBase.data.pick` 的契约），
  `segment.ts` 改为从 `graph.ts` 引入。包根是 `export *`，外部调用方零改动。
  纯类型循环运行时无害，改它是因为成本只有三行，且不修就会让 depcruise 每次红。

#### 移除

- **4 个死文件（共 622 行）**，全部由 knip 检出并逐个 grep 复核：
  - `apps/web/src/styles/explorer.css`（**612 行**）：定义 50+ 个 `.xpl-*` 类名，
    但 `main.ts` 的样式清单里从来没有它，模板里也 0 处使用 `.xpl-*`——
    上一次「工程探索器 → 工作区单面板」重构留下的孤儿，从未生效过。
  - `apps/web/src/components/canvas/NodePalette.vue`（4 行）：已废弃存根，内容为
    `<template><div /></template>` + 一行指向 `NodesPanel.vue` 的注释。
  - `apps/web/src/components/workspace/RunFolderNode.vue`（4 行）：同类存根，指向 `ProjectFolderNode.vue`。
  - `apps/web/src/components/workspace/run-tree-utils.ts`（2 行）：同类存根，`export {}`。
- **2 个未使用依赖**：`@vueuse/core`（`apps/web`，源码 0 处 import，连字符串都搜不到）、
  `@hono/zod-validator`（`apps/server`，源码 0 处引用）。

### 2026-09-26

#### 新增

- 三份「现状」说明文档，补上此前只有决策/调研/验收档案、没有成品说明的空档：
  - [docs/nodes.md](./docs/nodes.md) 节点手册：16 个节点逐个写清要填什么（字段名与取值）、产出什么、
    什么时候会失败，以及所有节点共有的语义（端口与连线规则、多输入的两类行为、状态与产物、
    素材挑选、重试、运行前预检）。节点总表由 `pnpm docs:gen` 从 `graph.ts` / `engine.ts` / `segment.ts` 推导。
  - [docs/architecture.md](./docs/architecture.md) 架构与实现总览：三个包的职责、技术栈与许可证实读结果、
    一次运行的全链路（调度/并发/跳过/取消/恢复）、10 个 SSE 事件、12 张表的数据模型、媒体库的内容寻址与重下、
    外部集成（B 站 / 坚果云 / AI-ASR）、接口清单（生成）、前端结构与关键契约。
  - [docs/usage.md](./docs/usage.md) 使用说明：第一次要配什么、一条最短路径、画布操作、
    三个高频操作（选 B 站视频的两条轨道 / 素材挑选 / 选提示词块）、结果页怎么读、
    工程与运行记录的管理、备份与迁移、常见问题对照表。
- `pnpm docs:gen` 新增两个生成块，都是此前手写必然漂移的清单：
  节点总表从 `graph.ts` + `RETRYABLE_NODE_TYPES` + `PER_INPUT_NODE_TYPES` 推导（并断言四处记录覆盖同一批类型、
  来源节点无输入端口），接口清单从 `app.ts` 的挂载与 `routes/*.ts` 的方法声明推导（并断言每个路由文件都被挂载、
  每个挂载点都解析出至少一条路由）。生成器在解析失败时直接失败，不生成一张悄悄少一行的表。
- 左侧栏「项目文档」阅读器因此能直接读到这三份现状文档（它读的就是仓库 `docs/` 目录）。

#### 变更

- `AGENTS.md`：`docs/` 根不再只有 `status.md` 与 `deploy.md` 两份现状文档，节点手册 / 架构 / 使用说明同属 `status` 类；
  补上「需要生成块的文档必须在 `scripts/docs-gen.mjs` 的 `TARGETS` 里登记」。
- `README.md`：文档一节新增按用途挑选的四条入口（使用说明 / 节点手册 / 架构 / 部署）。

#### 修复

- 校正两处与实现不符的表述：
  - `AGENTS.md` 与 `docs/status.md` 都称 `packages/shared/src/schema.ts` 的 `data` 「没有字段级校验」，
    实际 `nodeDataByType` 已按节点类型分别校验；文本工具正则缺口的原因是 `pattern` / `flags` 只有类型校验、
    缺长度上限与白名单（`docs/status.md` 的 P0 条目已按此改写）。
  - `AGENTS.md` 硬规则 6 把多输入语义写成「AI 节点按连接顺序以空行合并」，实际只有压平型节点合并，
    AI/转写这类是「一个输入一份结果」逐项处理；规则文本已改为按两类分别描述并指向 `docs/nodes.md`。

#### 修复

- `pnpm dev` 起不来后端：pnpm 跑多包时会为多路输出加包名前缀，代价是把子进程的 stdin 换成
  「打开但永不写入的管道」，而 `tsx watch` 在该条件下会静默挂住——子进程存活、CPU 归零、
  不监听端口、连一行启动日志都不打，表现为「前端能开、后端连不上，且没有任何报错可查」。
  单包运行或 stdin 直接继承时不复现，所以此前只在 `pnpm dev` 这条路径上暴露。
  后端 dev 脚本改为 `node --watch --import tsx src/index.ts`：watcher 换成 Node 自带的（不读 stdin），
  TS 仍由 tsx 的 loader 承担，热重载实测保留。

#### 变更

- 项目文档阅读器的加载改为**一次请求取全**：`GET /api/docs?body=1` 连正文一起返回，打开阅读器
  从「取列表 + 取首篇正文」两次串行往返降到一次，之后每次切换文档不再发请求。真实 Chrome 实测
  （每次全新 profile，连 `localhost:5173`）：打开到正文可读 **355 → 62 ms**，其中第二个请求原本
  要新建一条 TCP 连接、而开发环境里对 `localhost:5173` 新建连接要等约 205 ms（该停顿的定位见
  `docs/status.md` 的 P1 条目）；改用 `127.0.0.1:5173` 排除连接停顿后是 81 → 66 ms，
  切换一篇没读过的文档 19 → 8.7 ms。代价是列表可见从 25 ms 变成 66 ms（等聚合响应），
  换来的是「正文可读」不再晚于列表、且切换零请求。
- 阅读器的加载态改成全站统一的那套（`styles/app.css` 的 `.sf-loading-hint` + `.sf-loading-spinner`，
  画布节点与小卡预览同款），并按 180 ms 延迟出现：本地打开实测约 60 ms，指示灯一闪而过比不显示更
  刺眼，延迟后正常打开**完全不出现加载态**（限速到 1.5 s 时才会看到居中的 spinner 与「正在读取…」）。
  切换文档时旧正文仍保留在屏上并压暗到 0.45——不再有「正文整块消失 → 重新出现」的闪动，
  也不再显示「0 篇」。服务端没返回正文时（例如后端进程还是旧版）仍逐篇取，这条退回路径已单独验证。
- `listDocs` 改为只读文件头（4096 字节）取元数据：front matter 未闭合、首个 H1 被截断或位于头部
  之外时退回整读，因此结果与整读**逐字段等价**（新增 6 个边界样例与「只读头部 vs 整读」对拍测试）。
  实测 listDocs 中位 5.77 → 4.69 ms、实际读取字节 643 → 301 KB。这个改动只有约 19%，而不是数量级：
  成本大头是逐文件 open/read/decode 的固定开销，不是字节数（57 次 stat 的下限是 0.27 ms），
  收益体现在少读一半字节（冷盘更明显）。
- `start-dev.cmd` 从「一条命令开两个窗口」改为单窗口跑 `pnpm dev`——前后端输出带包名前缀合并在一处，
  Ctrl+C 一次停两边，并保留出错后窗口不自动关闭（否则双击启动时错误一闪而过）。

### 2026-09-14

#### 变更

- B站链接节点的选集拆成两条互不重叠的轨道，不再由一颗按钮按选中数量走两套逻辑。原先「生成所选集数」
  在只勾 1 集时会把整个节点的链接换成那一集（多选卡片随之消失），勾多集时才是合并成多选卡片——
  差别只在数量上，界面上看不出来。现在：点列表里的一行＝把节点切到那一集/那一P（当前项用底色标出）；
  勾选框 + 底部「合并为一张卡片」＝多选合并。切换成功不弹提示条，当前行也不挂 tooltip——
  底色变化与预览更新本身就是反馈，不再叠一层冗余提示（合并会改变卡片形态，仍保留提示）。
- 合并按钮在勾选不足 2 项时禁用，并在列表下方写出原因（「已勾选 1 集 · 再勾 1 集才能合并」），
  不必靠猜为什么点不动。
- 分P 与合集两个列表行为对齐，当前项用墨色底 + 加粗标出（与下拉选中项、文档列表同一套语汇，不用品牌色——
  品牌色在本仓库只留给「运行中」这类交互信号）；分P 列表补上此前缺失的滚轮守卫，在列表内滚动不再让画布缩放。
- B站多选卡片头部新增「改选集」：回到选集界面重新编辑，且不改 `data.items`——解析失败或反悔时
  已合并的选集都还在。这是原来那条隐藏分支唯一的入口，此前一旦合并成多选卡片就再也切不回单集。
- 重新进入选集界面时，合集的勾选状态与分P 一样从卡片里已合并的项还原（此前只勾中当前链接那一集）。

### 2026-09-11

#### 新增

- 文档门禁：`pnpm docs:lint` 十二条规则——front matter 合法性、supersede 双向链接、生成块同步、
  文档地图覆盖、废弃文档的祈使句、验收档案内容指纹、漂移数字、markdown 死链、
  源码注释里的文档路径、前端首屏体积预算、class 与目录一致、代码位置引用可解析；
  配 `--strict` 供定时任务用。
- `pnpm docs:gen`：从源码静态推导后注入 README / status 的数字块与文档地图，取代此前的数字手写。
- `pnpm docs:freeze`：显式重新冻结验收档案的内容指纹（lint 不自动修复，避免"改了验收结论"被静默合法化）。
- 现状权威来源 [docs/status.md](./docs/status.md)：里程碑进度、已知缺口清单与完整文档地图。
- [AGENTS.md](./AGENTS.md)：项目约定与文档生命周期规则（取代此前散落的说明）。
- 左侧栏底部（设置按钮上方）新增「项目文档」入口，打开一个只读的文档阅读器：左栏按目录分组
  并支持搜索，右栏渲染正文，头部单独呈现 front matter（class / status / 责任人 / 最后复核 /
  冻结日期 / 内容指纹）；缺 front matter 的文档在列表里标出——那正是门禁会报 R1 的情况。
- `GET /api/docs` 与 `GET /api/docs/file`：只读，仅允许读取 `docs/` 下的 markdown。
  路径包含性用 `path.relative` + `realpath` 双重校验，并强制 `docs/` 前缀，使仓库根文件不可达。
- 门禁补三条盲区：`R11` class 必须与所在目录一致；`R12` 文档里 `路径:行号` 形式的代码引用必须可解析
  （文件存在、行号不越界）；`R3` 增加计数口径守卫——测试出现 `.each(` 时静态数 `it(` 的口径失效，直接失败。
- 每周一的文档新鲜度定时扫描 workflow。
- 素材挑选节点 `flow.pick`「素材挑选」：接在上游模块之后，卡片直接列出识别到的素材供勾选，
  未勾选的不往下走（未选中的素材连同其下游一并跳过）。识别会穿过「一个输入一份结果」的中间模块
  （转写 / 校对 / AI 加工 / 攻略 / 练一练 / 文本工具 / 挑选），因此「校对模块处理了 8 个输入」能识别成
  8 个可选项；消费节点高级设置内提供同款选择器，与挑选节点共用同一份 `data.pick`。
- 段标识契约 `packages/shared/src/segment.ts`：段标识只用素材自身稳定信息
  （`bvid:<bvid>:<分P>` / `file:<id>` / `node:<来源节点>`），不掺数组下标；引擎与界面共用同一套
  挑选判定，不各写一份。
- 结果页在挑选生效时说明「只加工了选中的素材：共 N 段，另有 M 段未加工」，避免把「按挑选产出」
  误读成笔记丢了内容；节点摘要带「处理 2/3 段」。
- `PUT /api/projects/:id/graph` 覆盖前把前一版工程图留档到 `data/graph-backups/`
  （空图不留档，每工程保留最近 20 份）——工程图只有服务端一份，而编辑器在异常路径下可能写回空画布，
  一次覆盖即永久丢失。

#### 变更

- `docs/` 按生命周期重排目录，目录名即分类信号：`docs/decisions/`（方案 / 选型 / 架构）、
  `docs/plans/`（实施清单 / 路线图）、`docs/evidence/`（冻结快照，文件名带冻结日期）、
  `docs/research/`（调研）。28 份文档迁移，全仓引用（含源码注释）同步重写。
- 全部历史文档补齐 front matter 并归类。`supersedes` / `superseded_by` 改用仓库相对路径。
- 拆分 `development-log.md`：决策流水 → [early-decisions.md](./docs/decisions/early-decisions.md)，
  交付清单 → [2026-08-28-m0-m5-delivery.md](./docs/evidence/2026-08-28-m0-m5-delivery.md)，
  逐日流水 → 本文件；原文件改为指向这三处的存根。
- 文档阅读器正文复用结果页的 `.markdown-body` 排版，保证两处阅读体验一致；正文里的相对链接在
  阅读器内跳转，不把浏览器带去一个必然 404 的路径。部署镜像未包含 `docs/` 时接口返回
  `available: false` 并给出明确提示，而不是报错。
- `docs-gen` / `docs-lint` 与阅读器共用的 front matter 解析在两侧各有一份（门禁脚本必须能
  不依赖构建直接运行），新增对拍测试锁住两者行为一致。
- 两份提示词模板文档从仓库根移入 `docs/decisions/`（`history-cognition-template.md`、
  `cascade-video-summary-template.md`），并标注提示词正文以 `packages/shared/src/prompt.ts` 为准
  ——它们此前是根目录的第二真相源，内嵌提示词已与源码分叉。
- 修正 `development-log.md` 与 [node-result-preview-research.md](./docs/research/node-result-preview-research.md)
  中「2026-10 用户方向确认」的日期笔误（该内容在 2026-09-06 之前已提交，应为 2026-09）。
- 清理一批已过期的内容陈述：10 余份文档的「待评审 / 不写代码」现在时状态行改为已实施，
  `scribe-flow-proposal.md` 里已被 Element Plus 取代的 UI 路线与 `CLAUDE.md` 引用改为指向现行文档。

#### 修复

- `scripts/m4-api-check.mjs` 的内置块断言原先硬编码「等于 8」，新增内置块后长期静默失败；
  改为从 `packages/shared/src/prompt.ts` 推导数量（现 12/12 通过）。
- 取输入阶段失败会让节点**永远停在「运行中」**：`resolveInputs` 原先在 `try` 之外，抛错后不落任何
  终态。现在该阶段失败也写一条失败状态并广播 `node.error`。
- `.sf-node-desc--block` 一直没有对应的 CSS 规则（空类），练一练卡片与攻略节点的正文说明同样被单行
  截断，已补换行规则（`white-space: normal`）。


### 2026-09-10 — 结果页阅读体验与知识巩固

#### 新增

- 视频下载与结果页播放（M9）：`media_assets` / `run_media` 表与幂等迁移、内容寻址去重与 GC、
  Range 流式与缺失重下、自研 `MediaPlayer`、来源节点高级设置里的 keepVideo 开关与清晰度段选。
  验收见 [2026-09-10-video-module-acceptance.md](./docs/evidence/2026-09-10-video-module-acceptance.md)。
- 知识巩固节点 `process.drill`「练一练」：文字 → 知识点 + 题目 + 延伸，结果页可直接答题。
- 多输入分段阅读：`utils/run-segments.ts` 作为唯一分段来源，结果页输出、结果页链路输入、
  画布结果预览浮层、运行日志弹窗四处入口全覆盖；`run_node_logs` 新增 `input_index` / `input_total`。
- 结果页右侧分段大纲：序号 + 两行标题 + 字数 / 时长，当前段墨色标记，顶部「全文（N 段合并）」，
  段数 > 12 出筛选框，底部翻页与 `↑↓` 提示，支持键盘 `↑↓` / `jk` / `Home` / `End`。
- 结果页 tab 语义化：`role=tablist/tab`、`roving tabindex`、`←/→/Home/End` 键盘支持，
  失败节点红点并写进 `aria-label`。
- 观点提炼 v4（期刊式轻排版）：新增 `PROMPT_GUANDIAN_V4` 与 `RECIPE_INSIGHT_V4`（四步核对版，
  含禁 `###` 硬门），`builtin.insight.v4` 接管推荐位。

#### 变更

- 分段导航控件类型纠错：第一版的「8 个横向胶囊」实为标签页控件，不适用于**顺序**内容
  （Apple HIG 段数上限、Material 3「标签只用于并列内容」、NN/g 横排退化为轮播）；
  结果页改用右侧大纲栏，窄屏与画布浮层改用单行标题 + 下拉。依据见
  [segment-navigation-research.md](./docs/research/segment-navigation-research.md)。
- tab 切换改为单个绝对定位的滑动墨条（`transform` + `width` 过渡走 `--dur-3` / `--ease-out`），
  用 `ResizeObserver` 在窗口缩放、字体加载、tab 增删时重新测量。

#### 移除

- 结果页 tab 的内容淡入动画——实测 Element Plus 无、Ant Design 默认
  `{inkBar:true, tabPane:false}`、Material 3 明确不用 fade，属自加行为。依据见
  [tab-interaction-research.md](./docs/research/tab-interaction-research.md)。
- 被右侧大纲取代的横向胶囊组件 `SegmentTabs.vue`。

#### 修复

- 画布空内容保存前二次确认，避免误触清空工程。
- 配方引用的回查宽容规则与 `quotes` 整句照抄要求。
- 冒烟脚本「工程树渲染出工程行」改为等待工程行本身出现（原先只等任意树行，文件夹行先渲染时误判）。

### 2026-09-09 — 配方运行时、攻略加工、溯源核对与日志查看器

#### 新增

- AI 加工节点配方化（M8-1 阶段 A）：Recipe 原语、确定性断言门、步骤级日志；以观点提炼 v3 试点。
- 阴阳师攻略视频文稿加工模块。
- 溯源模块结构化外部核对（结构化产物 + 报告阅读器）。
- 提示词块库支持全文查看与版本对比。
- 运行日志查看器重构：多维筛选、折叠、复制与下载。

#### 变更

- 运行详情章节目录改为半透明常驻浮层；链路输入与输出列表样式重做。
- B 站视频快捷选择器交互重做，统一交互颜色。

#### 修复

- 画布小卡文本框滚轮与下拉取消选中问题；toast 离场改为原地淡出并同步补位。
- 工程重命名后标题同步；运行期间锁定画布。

### 2026-09-07 ~ 09-08 — 工作台与坚果云

#### 新增

- 单面板工作台与文件夹 / 运行库重构，含自研拖拽；工程树支持框选多选、移动对话框内新建文件夹。
- 坚果云 WebDAV 同步 / 读取 / 备份模块，以及从云端备份一键热恢复。

#### 变更

- 左侧面板改为平滑抽屉式收起 / 展开；排序下拉收进图标菜单。

#### 修复

- 空文件夹去掉虚线占位，行内编辑支持点击外部失焦；设置页弹层被画布浮动操作遮挡；对话框挂到 body
  避免位置被裁切。

### 2026-08-31 ~ 09-06 — M5 之后的画布与结果页迭代

#### 新增

- 节点结果预览：以摘要栏 delta 徽标为热区的悬停 / 点击弹出全内容预览浮层（懒加载最近运行文本）。
- 思维导图节点与预览；节点结果 diff。
- Obsidian 笔记输出、人物 / 事件 / 时期提取与自动关联。
- 历史认知加工与 CASCADE 概念演进摘要两个内置提示词块。
- 画布浮动操作栏；错误节点顶部圆形提示。

#### 变更

- 节点库从左侧常驻栏改为单按钮 + 覆盖层面板；节点操作入口统一进卡片。
- 自研右下角通知栈取代 `ElMessage`。

#### 修复

- B 站下载网络错误自动重试、展开错误 `cause`；部分上游失败时下游用可用输入继续。
- 不过滤默认私密收藏夹；修复收藏夹多选视频缺少 `cid` 导致运行失败。

### 2026-08-27 ~ 08-28 — M0–M5

M0–M5 六个里程碑的开发、验收与发布过程。交付内容与当时的验证记录见
[2026-08-28-m0-m5-delivery.md](./docs/evidence/2026-08-28-m0-m5-delivery.md)，
分层验收标准见 `docs/evidence/2026-08-28-m{2,3,4,5}-acceptance.md`。
其中的关键决策（含一次 UI 路线反转）见 [early-decisions.md](./docs/decisions/early-decisions.md)。

## 更早的历史

本文件自 2026-09-11 启用。此前没有 changelog，变更流水记在 `docs/research/development-log.md` 里，
与该文件的「现状快照」混在一起。2026-09-11 已按上表完成拆分，原文件只留存根。
完整原文可在 git 历史里找到（拆分提交之前的那一版）。
