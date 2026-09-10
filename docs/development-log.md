# ScribeFlow 开发记录与项目文档

> 最后更新：2026-08-28
> 仓库：https://github.com/bomu1121/scribe-flow.git
> 状态：M0–M5 全部完成。ScribeFlow 里程碑开发收官。

---

## 1. 当前状态

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 仓库骨架 | ✅ 完成 | pnpm 单仓、CI、设计令牌、应用外壳、UI 原语、反 slop/浮层样式自检 |
| M1 工程与画布 | ✅ 完成 | 工程 CRUD、Vue Flow 画布、节点/连线/撤销重做/自动布局/自动保存、导入导出、CDP 全量验收 |
| M2 来源节点 | ✅ 完成 | B 站链接输入即解析、扫码登录（Cookie 仅存服务端）、收藏夹/我的合集/稍后再看/B站历史快捷多选、本地音视频上传、文本校验 |
| M3 运行引擎 | ✅ 完成 | 运行数据模型/启动/停止/重跑/删除/产物、DAG 并发执行、SSE、节点状态与控制台、运行记录页、设置页；B站下载/FFmpeg/MiMo ASR/AI 节点全部真实端到端验收通过 |
| M4 输出与运行记录 | ✅ 完成 | 提示词块库服务端持久化 + 设置页管理、运行日志弹窗、重跑失败节点、复制/下载、运行记录页筛选、数据与工程清理 |
| M5 打磨发布 | ✅ 完成 | Element Plus 按需引入与分包、响应式移动端、a11y、节点数量防御、深色令牌预留、Docker 部署与 CI |

## 2. 仓库结构

```
scribe-flow/
├─ apps/
│  ├─ web/            Vue 3 + Vite + TS + Pinia + vue-router + Tailwind CSS 4 + Reka UI + Vue Flow
│  └─ server/         Node 22 + Hono + Drizzle + SQLite
├─ packages/shared/   图模型、工程模板、提示词块、预览类型、zod 校验
├─ docs/              方案、实施清单、UI 选型、shadcn 规则、本开发记录
└─ scripts/           slop-lint.mjs、ui-lint.mjs
```

## 3. 已实现功能清单

### 工程（Project）
- 工程列表：新建（空白/4 个工作流形状模板）、复制、改名、删除、导入导出 `.scribe-flow.json`
- 模板只描述加工路径，不预绑提示词块
- 后端 `projects` SQLite 表 + 完整 CRUD API；graph 自动保存接口

### 画布编辑器（Vue Flow）
- 左节点库（来源/转写/AI 加工/组织与输出），点击添加 + HTML5 拖入
- 画布：平移/缩放/框选/Shift 多选/8px 吸附/小地图/缩放控件/适应视图
- 连线：端口类型校验（audio/transcript/noteBlock/noteDoc），非法连接拒绝，Delete 删除连线
- 节点卡片内操作（无右侧面板）：名称内联编辑、URL/文稿/ASR/提示词块/输出名/模型覆盖/文件名表单
- 卡片按内容自适应：B站来源 380px、文件 320px、文本 340px、AI 加工 320px、输出 320px、小卡 224px
- 右键菜单：运行此节点（M3）/从此节点运行（M3）/复制/复制输出（M3）/删除
- 撤销/重做（50 步快照）、Ctrl+D 复制、空白双击搜索节点
- elkjs 懒加载自动布局（分支层级布局）
- 500ms 防抖自动保存 + 顶栏保存状态

### B 站来源节点（M2 全部）
- `POST /api/videos/preview`：解析 BV/av 号、b23.tv 短链重定向、B 站 view 接口、5 分钟缓存、中文错误
- 卡片内输入链接防抖 500ms 解析，展示封面/标题/UP 主/时长/分 P 数，自动保存 pageInfo

### B 站登录与快捷选择（M2 新增）
- 扫码登录：`POST /api/auth/qr` 生成二维码 → `GET /api/auth/qr/:qrId` 轮询（waiting/scanned/success/expired）；登录成功后 Cookie 只存服务端 SQLite `bili_cookies`，前端只拿账号摘要
- 侧边栏账号：未登录显示「未登录 B 站」+ 400px 扫码弹窗；已登录显示头像/昵称，下拉退出（Cookie 同步清除）
- 快捷选择器（520px）：收藏夹（文件夹 → 视频，搜索/分页）、我的合集（官方 `seasons_series_list` 接口）、稍后再看、B站历史（游标分页）；ElTable 多选
- 多选生成节点：当前节点为空时第一个填充当前节点，其余自动生成来源节点（垂直错开 160px），graph 只存 `url + pageInfo`
- 只读接口：`/api/bilibili/fav/folders`、`/fav/folders/:id/videos`、`/seasons`、`/collections/:id/videos`、`/watch-later`、`/history`

### 本地文件与文本校验（M2 新增）
- `POST /api/files/upload`：multipart 上传，校验扩展名/MIME/大小（`MAX_UPLOAD_MB`，默认 2048MB），存 `data/uploads`，graph 只存相对路径
- 本地文件节点：el-upload 拖拽/点击上传，成功后显示文件名
- 文本节点：空文稿报「文稿不能为空」，超 50000 字报过长，实时字数计数

### 提示词块
- 内置多个提示词块：观点提炼 v2（旧版 v1 保留）、技术文案提炼、知识科普提炼、信息溯源、概念演进摘要（CASCADE）
- 自定义块 localStorage 持久化（store 已实现，设置页 M4 接入编辑界面）
- AI 加工节点卡片内下拉选择提示词块（不预绑）

### 运行引擎（M3 主体）
- 数据模型：`runs` / `run_node_results` / `app_settings`；启动（all/fromNode/node）、停止、重跑、删除、节点产物查询与下载
- DAG 拓扑执行：并发 1-4 可配；失败上游自动 skipped；单节点/局部运行从最近一次成功结果复用输入
- 节点实现：`source.bili`（playurl 音轨下载→FFmpeg 16k wav）、`source.file`（转码）、`source.text`、`process.transcribe`（MiMo input_audio / OpenAI 兼容 transcriptions）、`process.refine/prompt`（OpenAI 兼容 chat）、`process.merge`、`process.output`（写 Markdown）
- SSE：`run.started / node.started / node.progress / node.done / node.error / run.done`，断线重连补发快照
- 前端：运行按钮/右键单节点与局部运行/停止；节点状态点+蓝色摘要条；底部控制台实时进度；`/runs` 运行记录页；`/project/:id/run/:runId` 节点结果表 + Markdown 预览与下载
- 设置页：AI 模型（DeepSeek/OpenAI/自定义）、语音识别（MiMo/OpenAI 兼容）、并发与输出目录；密钥只存服务端，测试连接接口
- 验收脚本：`pnpm check:api:m3`（14 项）、`pnpm smoke:ui`（30 项）；分层标准见 `docs/m3-acceptance.md`

### 输出与运行记录（M4 完成）
- 提示词块库：`prompt_blocks` 表 + `/api/prompts` CRUD；内置块只读并支持按模板系列/版本筛选，自定义块服务端持久化；设置页新增/编辑/删除，节点下拉实时同步
- 运行日志：`run_node_logs` 表；引擎记录输入文稿/AI 请求/AI 响应/输出文件；运行详情 640px 日志弹窗，可按节点过滤
- 运行详情完善：失败节点「重跑」按钮（单节点运行）、输出 Markdown 复制与下载
- 运行记录页：工程筛选 + 状态筛选、产出摘要、删除
- 数据与工程设置页：数据目录/运行记录数/输出文件数展示，清理已结束运行
- 验收脚本：`pnpm check:api:m4`（12 项）、`pnpm smoke:ui`（34 项）；分层标准见 `docs/m4-acceptance.md`

### 打磨发布（M5 完成）
- Element Plus 按需引入：移除全量 `app.use`，`ElConfigProvider` 中文 locale + `v-loading` 指令单独注册；Vite 分包 element-plus/vue-flow/reka-ui；主入口 1130KB → 124.6KB（gzip 42KB）
- 响应式：≤768 侧栏收起 + 底部导航；≤1024 画布只读提示与节点库隐藏
- a11y：图标按钮 aria-label、底部控制台 `aria-live`、全局 focus-visible 回归
- 大图防御：节点数量达到 200 拒绝继续添加并提示拆分
- 深色预留：`element-theme.css` 提供 `html.dark` 变量骨架，v1 不启用
- 部署：`Dockerfile`（node:22-slim + ffmpeg + 单容器静态托管）、`.dockerignore`、`docs/deploy.md`、CI docker build job；`STATIC_DIR` 支持 SPA fallback
- 验收标准：`docs/m5-acceptance.md`；`pnpm smoke:ui` 37/37

### UI 组件体系（2026-08-28 升级：Element Plus 底座）
- 通用控件全部使用 Element Plus 2.14：按钮/输入框/下拉框/分段控件/对话框/消息确认/下拉菜单等，不自研、不手抄样式
- 选型证据：n8n（本项目交互母本，同为 Vue 3 + Vue Flow）的 `@n8n/design-system` 依赖 `element-plus`；详见 `docs/ui-library-replacement-research.md`
- `styles/element-theme.css` 把 ScribeFlow 设计令牌桥接为 `--el-*` 变量：品牌蓝、语义色、控件描边（强档）、圆角、字体、阴影、遮罩单一值源
- reka-ui 保留补位（节点右键菜单），与 n8n 依赖组合一致；已删除 shadcn-vue 复制件与 cva/tw-animate-css/clsx/tailwind-merge 依赖
- `pnpm lint:ui` 铁律：Portal 浮层必须全局样式、z-index 只用 `--z-*` 令牌、颜色只能定义在 tokens.css / element-theme.css
- `pnpm smoke:ui`：CDP + 真实 Chrome 无头冒烟（列表页按钮/新建对话框 Esc/画布节点/ElSelect 下拉选中/ElSegmented 切换）

## 4. 设计令牌

应用令牌在 `apps/web/src/styles/tokens.css`；Tailwind 语义映射在 `apps/web/src/styles/app.css`。

关键色：品牌蓝 `#00AEEC`、墨色 `#16181D`、画布灰 `#F4F5F6`、纸面白 `#FFFFFF`。
关键半径：sm 6 / md 8 / lg 10 / xl 14。
浮层层级：overlay 1000 / dialog 1010 / select 1120 / popover 1130 / dropdown 1150 / context 1300。

## 5. 关键决策记录（含用户反馈修正）

1. 产品定位：笔记处理画布流，工程 = 工作流 + 运行记录；不做旧历史页/星标。
2. 画布底座：Vue Flow（MIT，n8n 同源），交互行为照搬 n8n，不自研。
3. B 站收藏是来源步骤的快捷选视频，不是独立收藏模块。
4. 工程模板与提示词块归属分离：新建工程只给工作流形状，提示词在 AI 加工节点选择。
5. 画布去掉右侧检查器，操作全部进节点卡片，卡片按内容自适应大小。
6. 链接输入即解析（用户明确要求的检查点）。
7. UI 原语最终改为 shadcn-vue registry 1:1 复制；修复过 Portal 弹层 scoped 样式失效、全局 focus outline 双层边框、focus ring 过重、节点选中背景色等问题。
8. 输入框/下拉聚焦态最终规范：**无 ring、无 outline，仅 1px 品牌蓝边框，颜色过渡包含 border-color**；节点选中只 1px 边框 + 中性阴影，无背景色。
9. 通用 UI 路线反转（2026-08-28）：自设定样式连续不达标，调研确认 n8n 等同类产品采用 Element Plus；废弃 shadcn-vue 复制件，通用控件全部改用 Element Plus，设计令牌通过 `--el-*` 变量桥接；遮罩加深至 0.55、控件描边用强档令牌、节点阴影分级。
10. 「订阅合集」口径（2026-08-28）：B 站「订阅/收藏别人的合集」无稳定公开接口；经用户确认改为「我的合集」，走官方 `x/polymer/web-space/seasons_series_list` 稳定接口。
11. UI/交互主力参考（2026-09 用户确认）：**n8n、Langflow、ComfyUI** 为后续视觉/交互设计主参照系与验收基准；ComfyUI 仅借鉴交互行为（节点操作/状态/预览/运行语义），不采用暗色霓虹视觉，浅色纸灰方向不变。详见 [scribe-flow-proposal.md](./scribe-flow-proposal.md) §3.1/§3.2。
12. 节点结果预览交互（2026-10 用户方向确认）：删除选中内联预览（不再撑高卡片），改为以底部右侧 delta 变化徽标为热区的悬停/点击弹出“下拉同款”全内容预览浮层（含输出/导图，懒加载最近运行完整文本），整条摘要栏保持朴素无选中态，详见 [node-result-preview-research.md](./node-result-preview-research.md) §6。

## 6. 验证方式与结果

- `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint` 全部通过
- CDP + 真实 Chrome 验证：
  - 4 模板创建（5/6/6/4 节点）
  - 画布渲染 5 节点 4 连线，控制台 0 错误
  - 平移/缩放/节点拖动/Shift 多选/框选/连线/删线/复制/撤销/右键菜单/双击搜索
  - 卡片输入 B 站链接 → 封面与标题展示 → pageInfo 保存
  - 下拉选中「观点提炼（内置）」正常回显
  - ElSegmented 切换 ASR 引擎 → 后端保存 `openai-compatible`
- M2 分层验收（2026-08-28）：
  - L0 全绿：typecheck/test（6 用例）/build/lint
  - L1 `pnpm check:api:m2` 7/7：二维码生命周期、未登录 401、上传成功/拒绝、登出幂等
  - L2 `pnpm smoke:ui` 23/23：登录入口/扫码弹窗/未登录拦截/上传控件/文本校验 + M1 回归
  - L3 bsk 真实 Chrome：登录弹窗二维码视觉复核通过
  - L4 真实 B 站账号（薄暮轻阴）：扫码登录成功；收藏夹/稍后再看/历史真实数据与翻页通过；我的合集为空态（账号无合集）；多选生成 2 节点、垂直 160px、刷新持久化通过；退出后服务端 `loggedIn=false`
- M3 分层验收（2026-08-28）：
  - L0 全绿：typecheck/test（9 用例）/build/lint
  - L1 `pnpm check:api:m3` 14/14：设置、文本链路、SSE 快照+实时、列表、重跑、停止、删除
  - L2 `pnpm smoke:ui` 30/30：画布点运行全部→SSE 3 节点 done→运行记录页→设置页
  - L3 bsk 真实 Chrome：AI 链路（80字→81字→786字→797字）节点摘要与运行详情 Markdown 预览
  - L4 真实外部能力：B站音轨下载+FFmpeg（40min→77MB wav，10.9s）、MiMo-V2.5 真实 ASR（196字/6.3s）、DeepSeek AI 真实 Key；模板一「B站 2:23 视频→转写→校对→观点提炼→输出」全链路 success，总耗时 11.1s，输出 207 字 Markdown
- M4 分层验收（2026-08-28）：
  - L0 全绿：typecheck/test（9 用例）/build/lint
  - L1 `pnpm check:api:m4` 12/12：提示词块 CRUD、运行日志、按节点过滤、数据信息
  - L2 `pnpm smoke:ui` 34/34：运行详情日志弹窗、提示词块库、数据与工程页
  - L3 bsk 真实 Chrome：提示词块库 UI 新增自定义块「会议纪要提炼」成功
- M5 分层验收（2026-08-28）：
  - L0 全绿；L1 主包 1130KB→124.6KB；L2 `pnpm smoke:ui` 37/37（新增移动端 3 项）；L3 生产静态托管 `/` 与 SPA fallback 200；L4 `docker build -t scribe-flow:ci .` 成功，CI 增补 docker job
- UTF-8 乱码扫描通过；UI 文案简体中文

## 7. 未完成 / 下一步

- M0–M5 里程碑已全部完成。后续可选事项：深色模式启用、Playwright 冒烟、drizzle-kit 迁移、按需引入 element-plus CSS（当前全量 CSS 360KB，gzip 48KB）

## 8. 本地运行

```bash
pnpm install
pnpm dev
```

- 前端 http://localhost:5173
- 后端 http://localhost:8787（`/api/health`）
- 数据目录 `apps/server/data/scribe-flow.sqlite`（git 忽略）

## 9. 视频下载与结果页播放模块（M9 候选，2026-09-09）

- 调研与设计：[video-module-research.md](./video-module-research.md)（决策点 D1–D7；四项方向已与用户对齐并评审通过：原生播放器自研封装 / B站+本地视频 / 媒体缓存库+引用且默认不进备份 / 调研先行）
- P0 实测：[research/video-module-poc.md](./research/video-module-poc.md)：游客实际流 ≤480P、登录（非大会员）可达 1080P AVC；m4s `-c copy +faststart` 秒级合成；Range 206 + Chrome 起播/seek 通过
- P1 存储与引擎：`media_assets`/`run_media` 表与幂等迁移、`lib/media-store.ts`（内容寻址去重/GC/restore）、engine `source.bili`/`source.file` keepVideo 分支、`routes/media.ts` Range 流式与恢复任务；删除运行引用归零即 GC（uploads 原件保留）
- P2 结果页：`components/media/MediaPlayer.vue` 自研播放器（进度条自有 DOM，为将来区间选择预留）、RunDetailView「链路输入播放 + 素材视频兜底 + 缺失重下」、来源节点高级设置内的 keepVideo 开关与清晰度段选（紧凑两行、中性墨色选中态）
- 依据用户两次反馈收敛（2026-09-09）：① 只放来源节点的运行结果页不得是莫名“空输出” → 补结果页指引文案；② **默认不保存视频**（用户明确要求）→ 撤销此前“独立运行自动下载”规则，仅来源节点高级设置显式开启「保留可播放视频」才下载保存；结果页无视频时提示开启后重跑
- 验收：[video-module-acceptance.md](./video-module-acceptance.md) L0–L4（真实 B站 1080P 全链路 + 真实 Chrome 截图复核）
- 待办：`pnpm build` 回归、既有 `smoke:ui` 全量回归与播放器自动化用例补录、durl/仅 HEVC 样本补测

## 10. 观点提炼 v4：期刊式排版版（2026-09-09）

- 背景：用户反馈「观点提炼」输出文档排版丑——小标题层级堆叠（H1+8×H2+每观点 H3+嵌套列表）、脚手架占位多（逐条「未提及」）；要求在信息不缺失前提下按同类笔记产品排版调研重做一版。
- 调研与设计：[insight-v4-note-layout.md](./insight-v4-note-layout.md)（通义听悟 / 飞书纪要 / NotebookLM / NoteKing / bili-note / 卡片笔记工作流 / 中文排版规范）；版式样例（用户已确认）：[v4 期刊式](./samples/insight-v4-layout-sample.md) vs [v2 现状](./samples/insight-v2-layout-sample.md)，同稿演示稿见 [demo](./samples/insight-v4-demo-transcript.md)。
- 用户拍板：新增 v4 并接管推荐位；配方 4 步核对版；期刊式轻排版；空槽省略 + 文末「原文未覆盖」汇总。
- 实现：`packages/shared/src/prompt.ts` 新增 `PROMPT_GUANDIAN_V4`（单次形态，作 v4 的 prompt 字段）与 `RECIPE_INSIGHT_V4`（scan 增 oneLiner 根键、draft/finalize 执行期刊式母版、audit 增版式核对 layoutIssues、finalize 带禁 `###` 硬门）；新增内置块 `builtin.insight.v4`（recommended=true），v2 让出推荐位但保留为单次快版。
- 测试：`prompt.test.ts`（版本集合 v1–v4 / 推荐位 / 版式断言）、`recipe.test.ts`（v4 配方 zod 校验）、`engine.recipe.test.ts`（v4 四步全流程 + `###` 违规触发步骤级错误）。
- 自检：`pnpm -r typecheck / test / build`、`pnpm lint:slop`、`pnpm lint:ui` 全绿；`engine.recipe.test.ts` 7/7（含 v4 全流程与 `###` 版式硬门用例）；v2/v4 样例同稿渲染并排截图视觉复核通过（无 H3 堆叠、导读引用块与表格渲染正常）。
- 待办：真实 Key L2 抽测（视环境另行安排）。


## 11. 多输入分段阅读：多视频结果不再首尾相接（2026-09-10）

- 背景（用户第二次反馈）：多个视频经过同一个转写节点时，结果页、画布预览浮层把 8 份结果直接拼接，难以定位；用户把结果页当笔记反复阅读。
- 现场取证（真实运行 8 个视频 · run_a0bc492d）：转写主输出 111,917 字（8 段用 `---` 相接）、AI 加工 57,629 字、输出笔记 57,643 字；而每个视频的文本在 `run_node_inputs` 里本就分 8 行独立存储并带 position——**拆分数据一直在，问题只在展示层**。
- 方案（用户确认：四处入口全覆盖 + 默认第 1 段 + 可切全文）：新增 `apps/web/src/utils/run-segments.ts` 作为唯一分段来源（转写/校对/AI 加工/攻略加工取输入行的 `result_text ?? text`，输出/合并/分支取汇入段落，文本工具取交付下游的多份内容；标签沿链路回溯到视频标题，真分 P 才补 P 号），新增 `components/SegmentTabs.vue` 选择器（full / chips 两种变体）。
- 落地范围：① 结果页输出文档、② 结果页「链路输入」中间节点正文（原 `modules` 堆叠改为分段切换）、③ 画布结果预览浮层（顶部紧凑选择器，只渲染选中段）、④ 运行日志弹窗（`run_node_logs` 新增 `input_index`/`input_total`，每条日志标注所属输入并可按输入筛选；旧运行无字段时按（节点/类型/步骤）分组条数==分段数顺序推断）。
- 联动：复制/下载/目录跟随当前分段（文件名带段号与标题）；`?focus=<中间节点>&seg=N` 直达该节点自己的产物并定位到第 N 段；SSE 刷新不打断当前分段；重复点同一节点不再重置分段。
- 自检：`pnpm -r typecheck / test` 全绿（web 新增 `run-segments.test.ts` 8 用例）；`pnpm lint` 通过。
- 真实数据回归（bsk + Playwright DOM 断言，未改动用户数据）：结果页 9 个胶囊默认停在第 1 段（8,297 字，仅视频 1 的笔记），切「全文」回到 50,912 字整篇；链路输入点「转写」显示第 1/8 段 17,540 字；画布浮层只渲染 17.5k（原为 111.9k）且切段/深链跳转正确；日志弹窗 65 条中 64 条带输入标签、按「AI 加工」筛选出 24 条并按输入筛选到 1 条。
- 文档：`docs/result-viewer-design.md` 增补 §3.1 与支持度矩阵。
- 待办：分段感知的编辑（当前编辑只针对整篇）；`pnpm smoke:ui` 全量回归。

## 12. 多输入分段导航重做：从「8 个横向胶囊」到「右侧分段大纲」（2026-09-10）

- 用户反馈（第三次迭代）：第一版分段切换是 8 个横向胶囊按钮，「很低级」，要求先充分调研再优化。
- 调研（`docs/segment-navigation-research.md`）：横向胶囊本质是**标签页/分段控件**，三条硬规则都不满足——① Apple HIG：分段控件窄界面 ≤5、宽界面 5–7 段，「段太多难以解析、切换耗时」；② Material 3：**标签只用于并列内容，不能用于顺序内容**（8 个视频是同一条链上的顺序产物）；③ NN/g：选项一多横排就退化成**轮播**，被隐藏项更难发现、还要次级控件去翻，「标签越少越好」。结论：**用错了控件类型**，顺序内容应当用列表导航。
- 方案对照稿 `docs/samples/segment-nav-options.html`（+ `.png`）：A 右侧分段大纲栏 / B 阅读器式标题行+下拉 / C 左栏树内嵌套；用户选定 **A（结果页）+ 单行标题+下拉（画布浮层）**。
- 实现（结果页）：`.rv-main` 内新增右侧 `rv-rail`（268px，可折叠，工具条加 `PanelRight*` 开关）；行 = 序号（等宽）+ 两行标题 + 字数/时长；当前段墨色左侧标记；顶部「全文（N 段合并）」入口；段数 > 12 出现标题筛选框；底部常驻 `‹ 3 / 8 ›` 翻页与 `↑↓ 切段` 提示；键盘 ↑↓ / j k / Home / End 支持，焦点跟随，当前项只滚动大纲容器（避免 `scrollIntoView` 触发整页跳动，已过 slop-lint）。
- 实现（窄屏 <1280px 与移动端）：大纲栏隐藏，工具条下方出现单行标题 + `ElSelect`（选项含字数）+ ‹ › 翻段；与画布浮层形态一致。
- 实现（画布浮层 360px）：删除横向胶囊，改为单行 `03 / 08 标题 ▾` + 内联展开列表（9 项含「全文（N 段合并）」）+ ‹ › 翻段；列表绝对定位在浮层内部、不嵌套 Portal（避免二级浮层互相关闭），实测不越出浮层边界。
- 清理：`components/SegmentTabs.vue` 两个使用方全部替换后删除，避免死代码。
- 自检：`pnpm -r typecheck / test / build`、`pnpm lint`、`pnpm smoke:ui` 全绿（45/45）。
- 真实数据 DOM 断言（8 视频运行，未改数据）：大纲 9 行默认停第 1 段（8,297 字），点第 4 行 → `4 / 8` 且正文=视频 4 的笔记；`↑`/`↓` 与 `‹`/`›` 正常；「全文」→ 50,912 字整篇；收起/展开正常；1200px 下大纲隐藏、下拉 9 项可用（切到第 7 段生效）；`?focus=n_asr&seg=3` 直达转写节点第 4 段（16,254 字）；段数 > 12 的筛选框与空态提示经临时改动阈值验证通过后已还原；正文滚动与页面滚动互不影响。
- 文档：`result-viewer-design.md` §3.1 与支持度矩阵同步更新；调研结论与出处落在 `segment-navigation-research.md`。

## 13. 结果页 tab 切换交互重做（2026-09-10）

- 用户反馈：「结果 / 节点流水」切换太生硬。
- 问题定位：切换是 3 个按钮各自带 `border-bottom` 下划线，激活态由浏览器瞬时切换（下划线「跳」而不是移动）；面板用 `v-show` 直接显隐、无过渡；没有 hover / 按压 / 焦点反馈；语义上是个 tab 控件却只有 `<nav> + button`，键盘不可用。
- 实现（`RunDetailView.vue`，只动这一处交互）：
  - **滑动墨条**：单个 `.rv-tabs-ink` 绝对定位元素，按当前按钮实测位置平移（`transform` + `width` 过渡 `--dur-3` / `--ease-out`），首次测量前 `opacity: 0` 避免进场滑一下；窗口 resize、字体加载、`思维导图` tab 出现/消失都通过 `ResizeObserver` + watcher 重新测量。
  - **内容淡入**：切 tab 后给新面板挂 220ms `rv-pane-in`（只动 opacity）；继续用 `v-show` 而不是 `v-if`，**保留正文滚动位置与表格状态**（实测滚动 600px 来回切换不丢）。
  - **反馈**：hover 用 `--color-ink-soft-glass` 淡墨底、按压加深、`:focus-visible` 键盘焦点环；颜色全部走令牌。
  - **语义与键盘**：`role="tablist"/"tab"/"tabpanel"` + `aria-selected` + `aria-controls/labelledby` + roving tabindex；`←/→/Home/End` 在 tab 间移动并同步焦点。
  - **状态提示**：`节点流水` 在有失败节点时显示红点（`--color-error`）并把数量写进 `aria-label`（如「节点流水，1 个节点失败」）。
  - `setActiveTab()` 成为唯一入口（含 `?tab=mindmap` 深链与「思维导图」入口），重复点当前 tab 不触发动画；全局 `prefers-reduced-motion` 规则已把动画时长压到 0.01ms。
- 自检：`pnpm -r typecheck / test / build`、`pnpm lint` 全绿；DOM 断言覆盖 2 tab 与 3 tab 两种形态——墨条中心与激活 tab 中心逐次对齐（39 / 118 / 210 px）、同一时刻只有一个面板可见、动画类按预期出现与消失、键盘 ←/Home 生效且焦点跟随、失败运行显示红点与 aria-label、切换保留滚动位置。
  说明：本轮视觉预算耗尽，未做截图复核；墨条「渲染位置」在无头标签页里因过渡不推进而滞后，故用「inline style 目标值 + 关闭过渡后的实测几何」两种方式交叉验证。
- 顺带修掉 smoke 的一处时序抖动：`工程树渲染出工程行（≥1）` 原先只等「任意树行」，文件夹行先渲染时会误判；改为等工程行本身出现（45/45 稳定）。
