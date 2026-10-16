# ScribeFlow

**笔记处理画布流**：把 B 站视频、本地音视频或已有文稿放进画布，用节点编排「转写 → AI 校对 → 观点提炼 / 技术拆解 / 自定义提示词 → 合并」的加工流，运行后得到一份可读、可改、可导出的 Markdown 笔记（跑完自动按工程名存进输出目录）。整个编排保存为工作流工程，运行记录随工程归档。

## 技术栈

| 端 | 技术 |
|---|---|
| Web | Vue 3 · Vite · TypeScript · Pinia · vue-router · Tailwind CSS 4 · Element Plus · reka-ui · Vue Flow |
| Server | Node 22 · Hono · Drizzle ORM · SQLite |
| Shared | TypeScript 类型 · Zod 图模型校验 · 工程模板 fixtures |

## 目录结构

```
scribe-flow/
├─ apps/
│  ├─ web/            # 前端单页应用
│  └─ server/         # 后端 API（Hono）
├─ packages/
│  └─ shared/         # 类型、图模型、API 契约、内置模板
├─ docs/              # 现状说明 / 决策 / 调研，见下节「文档」
└─ scripts/           # 自研门禁：反 slop / UI 铁律 / 文档 / 体积预算
```

## 本地开发

环境要求：Node.js ≥ 20、pnpm ≥ 10。

```bash
pnpm install
pnpm dev
```

- 前端：http://127.0.0.1:5173
- 后端：http://localhost:8787（`GET /api/health` 健康检查）

前端开发服务器将 `/api` 代理到后端。

Windows 上可以更省事：双击根目录的 `start-dev.cmd`（桌面快捷方式 `ScribeFlow` 指的就是它）。
它会检查 pnpm、首次运行自动装依赖、分别拉起前后端，等**前后端都**就绪后再打开浏览器（后端比前端慢，
开早了页面只会印满 `/api` 连接失败）；服务已经在运行时只开浏览器、不重复拉起。**关掉那个控制台
窗口即停止服务**，不用再去翻进程。

## 常用命令

```bash
pnpm dev            # 同时启动前后端
pnpm typecheck      # 全仓类型检查
pnpm test           # 单元测试 + 引擎/路由集成测试
pnpm build          # 构建
pnpm lint           # 静态门禁（反 slop + UI 铁律 + 文档 + knip + depcruise）
pnpm docs:gen       # 生成文档地图 / 节点总表 / 接口清单
pnpm docs:lint      # 文档门禁（front matter、生成块、死链、文档路径引用）
pnpm check:size     # 首屏关键路径体积预算（需先 pnpm build）
pnpm check:prose    # 中文散文检查（需系统装 vale，不在 CI 里）
```

下面四条**要手工跑**，因为它们需要真实的外部凭据或真实浏览器：

```bash
pnpm smoke:ui       # CDP + 真实 Chrome 的 UI 冒烟（需先 pnpm dev）
pnpm check:api:bili # B 站二维码生命周期（需联网）
pnpm check:api:drill # 知识巩固链路（需真实 AI 密钥，会真的调用模型）
pnpm check:api:chain # B站 → 校对 → 全部开放提示词分支 → Obsidian（真下载真转写，约 10 分钟）
```

原先按里程碑分层的 m2/m3/m4/m6 自检脚本已经迁进 vitest（`apps/server/src/routes/run-flows.test.ts`、
`auth-upload.test.ts`），不再需要先起服务、也由 CI 每次执行；留在脚本里的只有上面这四条"外部依赖"自检。

## 文档

想了解怎么用看 **[使用说明](./docs/usage.md)**，想知道每个节点要填什么看 **[节点手册](./docs/nodes.md)**，
想看实现看 **[架构与实现总览](./docs/architecture.md)**，部署看 **[部署说明](./docs/deploy.md)**。

改动记在 [CHANGELOG.md](./CHANGELOG.md)；工程约定（含"别踩的坑"）在 [AGENTS.md](./AGENTS.md)。
`docs/` 下只有三类：根目录是现状说明，`decisions/` 是拍过板的不可逆约定，`research/` 是调研。

<!-- docs-gen:map:start -->
<!-- 由 `pnpm docs:gen` 生成，请勿手改 -->

**现状**（`docs/`）

- [架构与实现总览](./docs/architecture.md)
- [ScribeFlow 部署说明](./docs/deploy.md)
- [节点手册](./docs/nodes.md)
- [标签与合集：怎么用](./docs/tagging.md)
- [使用说明：从零到一份笔记](./docs/usage.md)

**决策（拍过板的方案与选型）**（`docs/decisions/`）

- [练一练联网找同类题（联网检索渠道去专有化 + 配方步骤级检索）](./docs/decisions/drill-web-search.md)
- [M0–M5 关键决策记录（含用户反馈修正）](./docs/decisions/early-decisions.md)
- [ScribeFlow 方案（v3）：笔记处理画布流](./docs/decisions/scribe-flow-proposal.md)
- [内置链路：改成「加工路径 × 来源」](./docs/decisions/template-set-and-source-axis.md)
- [信息溯源联网核查：来源权威度分级与 v3 模版](./docs/decisions/trace-external-authority.md)
- [UI 组件库替换调研（成熟库路线）](./docs/decisions/ui-library-replacement-research.md)
- [展示范围：收起的入口，不是关掉的能力](./docs/decisions/visibility-scope.md)

**调研**（`docs/research/`）

- [节点卡片上的「高级设置」怎么排](./docs/research/advanced-settings-card-styles.md)
- [AI 加工节点内部多步链：收益调研与进阶实现方案](./docs/research/ai-node-multistep-research.md)
- [BibiGPT 的视频笔记提示词工程：原文提取、槽位框架与实测对照](./docs/research/bibigpt-note-prompt-engineering.md)
- [视口裁剪的副作用实测：B 站来源卡片「拖出视野再拖回」会重解析一次](./docs/research/canvas-viewport-culling-remount.md)
- [合集选集面板怎么排](./docs/research/collection-picker-research.md)
- [双维度知识库：按「UP」与按「议题」检索](./docs/research/dual-axis-knowledge-base.md)
- [「抽取哪些属性」选择控件：成熟做法调研与四个候选方案](./docs/research/extract-field-picker-research.md)
- [按钮"忙碌态"的闪烁：为什么"改文字"是最差的那种，以及延迟与最短显示的阈值](./docs/research/loading-flicker-research.md)
- [节点结果预览展示调研与方案](./docs/research/node-result-preview-research.md)
- [新功能该加一张卡片，还是加一个提示词](./docs/research/node-vs-prompt-block-boundary.md)
- [Obsidian 笔记排版：现在为什么难看、成熟做法是什么、四套可选方案](./docs/research/obsidian-note-typography.md)
- [全项目审计（2026-09-27）](./docs/research/project-audit-2026-09-27.md)
- [R1 桌面研究报告：市场工作流产品功能地图 v1](./docs/research/r1-desktop-research.md)
- [仓库可读性与过度工程：外部证据与本仓处置建议](./docs/research/repo-legibility-and-over-engineering.md)
- [多视频结果的分组切换：导航模式调研与改造方案](./docs/research/segment-navigation-research.md)
- [设置页说明文字的排版：现状实测与四个候选方案](./docs/research/settings-text-typography-research.md)
- [结果页 tab 切换：标准依据与实测对照](./docs/research/tab-interaction-research.md)
- [③ 词库编辑器：现状实测、三个候选方案与外部依据](./docs/research/taxonomy-editor-research.md)
- [内置链路（模板）调研](./docs/research/template-set-research.md)
- [溯源报告「待核实问题」太挤](./docs/research/trace-uncertain-layout-research.md)
- [溯源模块「联网查找资料」怎么做](./docs/research/trace-web-source-research.md)
- [视频模块 P0 真实视频验证记录](./docs/research/video-module-poc.md)
- [ScribeFlow 视频下载与结果页播放 —— 调研与设计](./docs/research/video-module-research.md)
- [设置页「显示样式」三选一：形态、摆放、标签与无障碍的公开依据](./docs/research/view-mode-switcher-research.md)
- [ScribeFlow 功能工作流模块拓展 — 调研方案](./docs/research/workflow-module-expansion-research.md)

**样例**（`docs/samples/`）

- [观点提炼：AI 翻译为何翻不好“口语”？](./docs/samples/insight-v2-layout-sample.md)
- [演示稿：《AI 翻译为何翻不好口语？》](./docs/samples/insight-v4-demo-transcript.md)
- [观点提炼：AI 翻译为何翻不好“口语”？](./docs/samples/insight-v4-layout-sample.md)
<!-- docs-gen:map:end -->

## 设计约定

UI 文案一律简体中文；通用组件用 Element Plus、画布交互用 Vue Flow，两者都不自研；
颜色只用 `apps/web/src/styles/tokens.css` 的令牌；只复用 MIT / Apache-2.0 的代码。
完整清单与理由见 [AGENTS.md](./AGENTS.md) 的「必须守住的规矩」。

## 已知缺口

都在源码里可复现，修掉后请从本节删除并在 [CHANGELOG.md](./CHANGELOG.md) 记一笔。

**安全**（自托管时，用户浏览任意网页即可被接管后端）：

- **没有应用层认证，CORS 默认放开。** 组合 `PUT /api/settings`（改 `ai.baseUrl`）与
  `POST /api/settings/test/ai`（把已保存的真实 apiKey 发往该 baseUrl）即可外泄密钥；
  `CORS_ORIGIN` 应默认收敛为前端源。
- **盲 SSRF**：`POST /api/videos` 对用户传入的任意 URL 直接 `fetch(redirect: "follow")`，
  无主机白名单、无内网地址拦截。
- **用户可控正则可 DoS**：文本工具的 `pattern` / `flags` 直接进 `new RegExp()`，
  灾难性回溯会挂死事件循环且 cancel 不响应；根因是 `nodeDataByType` 没有字段级白名单与长度限制。
- **密钥明文入库且无法清除**：设置接口在收到空串时直接 `return`，清不掉已保存的密钥。
- **错误信息泄漏**：`app.onError` 把 `err.message` 原样回传，含服务器绝对路径与上游响应片段。

**稳定性**：

- **未捕获的 Promise 会终结进程**：运行收尾的几次数据库写入在 try/catch 之外，
  写失败即进程退出，所有在跑的运行一并丢失。
- **坚果云请求无超时**（对照 AI / 媒体 / B 站调用都有超时）。
- **`forceStop` 会篡改已结束的运行**；**SSE 建连存在竞态**（快照与订阅之间运行结束，该连接永不 resolve）。

**待定夺**（代码与文档不一致，可在 git 历史里复核）：

- **`obsidian.tagMinCount` / `tagMaxCount` 两个设置项没有读取点**：设置页有控件、也会持久化，
  但判定每篇给几个标签时用的是 `apps/server/src/lib/tagging.ts` 里写死的 `MAX_TAGS_PER_NOTE`。
  两条出路：改成读这两个值，或把这两个设置项连同控件删掉。
  （这一条原先写的是「AI 打标签从未接线、`buildObsidianTags` 完整存在」——那个死函数已经不在了，
  打标链路现在真的接在 `process.obsidian` 上；剩下没接的只有这两个数量设置。）

## License

[MIT](LICENSE)
