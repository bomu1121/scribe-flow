# ScribeFlow

**笔记处理画布流**：把 B 站视频、本地音视频或已有文稿放进画布，用节点编排「转写 → AI 校对 → 观点提炼 / 技术拆解 / 自定义提示词 → 合并」的加工流，运行后得到一份可读、可改、可导出的 Markdown 笔记（跑完自动按工程名存进输出目录）。整个编排保存为工作流工程，运行记录随工程归档。

## 项目状态

**现状权威来源：[docs/status.md](docs/status.md)** —— 里程碑进度、已知缺口、完整文档地图都在那里。

`docs/` 下的方案与验收档案是历史快照，**不代表现状**。下面的数字由 `pnpm docs:gen` 从源码生成，请勿手改。

<!-- docs-gen:numbers:start -->
<!-- 由 `pnpm docs:gen` 生成，请勿手改；改动源码后重新生成即可 -->

| 指标 | 当前值 |
| --- | --- |
| 测试用例（`it(` 声明数） | **453**（shared 155 · server 247 · web 51） |
| UI 冒烟检查项（`pnpm smoke:ui`） | **70**（其中 3 项为恒真占位，净 67） |
| API 自检项 | m2 7 · m3 14 · m4 19 · m6 9 · drill 22 |
| 内置提示词块（`BUILTIN_PROMPT_BLOCKS`） | **16** |
| 文档数（`docs/` 下 `.md`，不含调研原文） | 51 |
<!-- docs-gen:numbers:end -->

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
├─ docs/              # 按生命周期分目录，见下节「文档」
└─ scripts/           # 自研门禁：反 slop / UI 铁律 / 文档 / 冒烟 / API 自检
```

## 本地开发

环境要求：Node.js ≥ 20、pnpm ≥ 10。

```bash
pnpm install
pnpm dev
```

- 前端：http://localhost:5173
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
pnpm test           # 单元测试
pnpm build          # 构建
pnpm lint           # 全部门禁（反 slop + UI 铁律 + 文档）
pnpm lint:slop      # 去 AI 味自检（渐变/玻璃拟态/emoji/辉光等反模式扫描）
pnpm lint:ui        # UI 铁律自检（Portal 全局样式/z-index 令牌/颜色单一来源）
pnpm docs:gen       # 重新生成 README/status.md 里的数字与文档地图
pnpm docs:lint      # 文档门禁（front matter/死链/漂移数字/验收档案冻结/体积预算）
pnpm docs:freeze    # 显式重新冻结验收档案的内容指纹
pnpm smoke:ui       # CDP + 真实 Chrome 的 UI 冒烟（需先 pnpm dev）
pnpm check:api:m2   # M2 API 自检（登录/选择器/上传）
pnpm check:api:m3   # M3 引擎 API 自检（文本链路/SSE/重跑）
pnpm check:api:m4   # M4 API 自检（提示词块 CRUD/运行日志）
pnpm check:api:m6   # M6 API 自检（重试/条件分支/文本工具/章节切分）
pnpm check:api:drill # 知识巩固 API 自检（需真实 AI 密钥）
```

> 改动源码后如果动了用例数、冒烟项数或内置提示词块，请跑一次 `pnpm docs:gen` 并一并提交。

## 文档

想了解怎么用看 **[使用说明](./docs/usage.md)**，想知道每个节点要填什么看 **[节点手册](./docs/nodes.md)**，
想看实现看 **[架构与实现总览](./docs/architecture.md)**，部署看 **[部署说明](./docs/deploy.md)**。

进度与已知缺口在 [docs/status.md](./docs/status.md)。`docs/` 下的方案、计划与验收档案都是
**历史快照，不代表现状**。文档怎么维护（分类、front matter、哪些改动必须同步）见 [AGENTS.md](./AGENTS.md)。

## 设计约定

- UI 文案一律简体中文；源文件 UTF-8。
- 通用组件统一使用 Element Plus（n8n 同款底座）：按钮/输入框/下拉框/对话框/消息/上传/表格等不自研。
- 颜色一律使用 `apps/web/src/styles/tokens.css` 中的设计令牌；Element Plus 通过 `styles/element-theme.css` 的 `--el-*` 变量桥接同一套令牌，禁止页面散写 hex。
- 画布交互不自研：底层 Vue Flow（MIT），交互行为照搬 n8n 编辑器（详见方案文档照搬清单）。
- 多输入汇入语义：转写节点接收多个音频时逐个转写后以空行合并；AI/合并节点接收多个文本时按连接顺序以空行合并；禁止静默丢弃任一输入。
- 运行前预检：范围内存在 AI/ASR 节点但对应密钥缺失时，前后端都会拒绝启动运行并提示先到设置页配置。
- 运行中断恢复：服务重启会把残留 running 状态自动标记为 cancelled；画布与运行详情页提供「强制结束」入口，可中止卡住的运行并允许重跑。
- 运行态不写入工程图：`status / summary / preview` 只在内存与运行记录中保存，工程图只保存工作流定义，避免刷新后节点“卡在 running”。
- 许可证红线：只复用 MIT / Apache-2.0 代码；n8n、Dify 等只复刻交互行为，不复制代码。

## License

[MIT](LICENSE)
