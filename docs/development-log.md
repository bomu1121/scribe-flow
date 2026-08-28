# ScribeFlow 开发记录与项目文档

> 最后更新：2026-08-28
> 仓库：https://github.com/bomu1121/scribe-flow.git
> 状态：M0/M1/M2/M3 全部完成（模板一「B站视频→观点笔记」真实端到端跑通）；下一步 M4。

---

## 1. 当前状态

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 仓库骨架 | ✅ 完成 | pnpm 单仓、CI、设计令牌、应用外壳、UI 原语、反 slop/浮层样式自检 |
| M1 工程与画布 | ✅ 完成 | 工程 CRUD、Vue Flow 画布、节点/连线/撤销重做/自动布局/自动保存、导入导出、CDP 全量验收 |
| M2 来源节点 | ✅ 完成 | B 站链接输入即解析、扫码登录（Cookie 仅存服务端）、收藏夹/我的合集/稍后再看/B站历史快捷多选、本地音视频上传、文本校验 |
| M3 运行引擎 | ✅ 完成 | 运行数据模型/启动/停止/重跑/删除/产物、DAG 并发执行、SSE、节点状态与控制台、运行记录页、设置页；B站下载/FFmpeg/MiMo ASR/AI 节点全部真实端到端验收通过 |
| M4 输出与运行记录 | ⏳ 未开始 | 合并/输出、文档阅读、运行详情、提示词块库、运行记录页 |
| M5 打磨发布 | ⏳ 未开始 | 响应式、a11y、大图性能、深色预留、Docker 部署 |

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
- 内置 3 个：观点提炼 / 技术文案提炼 / 信息溯源
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
- UTF-8 乱码扫描通过；UI 文案简体中文

## 7. 未完成 / 下一步

- M4：输出预览增强、运行详情完善、提示词块库设置页、清空运行记录
- M5：响应式、a11y、深色模式、Docker 部署、Element Plus 按需引入（当前全量引入有 chunk >500KB 警告）

## 8. 本地运行

```bash
pnpm install
pnpm dev
```

- 前端 http://localhost:5173
- 后端 http://localhost:8787（`/api/health`）
- 数据目录 `apps/server/data/scribe-flow.sqlite`（git 忽略）
