# ScribeFlow

**笔记处理画布流**：把 B 站视频、本地音视频或已有文稿放进画布，用节点编排「转写 → AI 校对 → 观点提炼 / 技术拆解 / 自定义提示词 → 合并 → 输出」的加工流，运行后得到一份可读、可改、可导出的 Markdown 笔记。整个编排保存为工作流工程，运行记录随工程归档。

## 项目状态

- 当前里程碑：**M0–M5 全部完成** 🎉
- M5 分层验收：[docs/m5-acceptance.md](docs/m5-acceptance.md)（主包 1130KB→124.6KB · smoke 37/37 · Docker 构建通过）
- M4 分层验收：[docs/m4-acceptance.md](docs/m4-acceptance.md)（L0 9 用例 · L1 12/12 · L2 34/34 · L3 bsk 真实浏览器）
- M3 分层验收：[docs/m3-acceptance.md](docs/m3-acceptance.md)（模板一「B站视频→观点笔记」真实端到端跑通）
- 部署说明：[docs/deploy.md](docs/deploy.md)（Docker 单容器 + 环境变量 + 备份迁移）
- M2 分层验收：[docs/m2-acceptance.md](docs/m2-acceptance.md)
- 产品方案：[docs/scribe-flow-proposal.md](docs/scribe-flow-proposal.md)
- 实施清单：[docs/scribe-flow-m0-m1.md](docs/scribe-flow-m0-m1.md)
- UI 组件库替换调研：[docs/ui-library-replacement-research.md](docs/ui-library-replacement-research.md)
- UI 框架选型历史（已由 Element Plus 路线替代）：[docs/ui-framework-selection.md](docs/ui-framework-selection.md)
- 开发记录与完整项目文档：[docs/development-log.md](docs/development-log.md)

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
├─ docs/              # 产品方案与实施清单
└─ scripts/           # 反 slop 自检等工具脚本
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

## 常用命令

```bash
pnpm dev            # 同时启动前后端
pnpm typecheck      # 全仓类型检查
pnpm test           # 单元测试
pnpm build          # 构建
pnpm lint:slop      # 去 AI 味自检（渐变/玻璃拟态/emoji/辉光等反模式扫描）
pnpm lint:ui        # UI 铁律自检（Portal 全局样式/z-index 令牌/颜色单一来源）
pnpm smoke:ui       # CDP + 真实 Chrome 的 UI 冒烟（需先 pnpm dev）
pnpm check:api:m2   # M2 API 自检（登录/选择器/上传）
pnpm check:api:m3   # M3 引擎 API 自检（文本链路/SSE/重跑）
pnpm check:api:m4   # M4 API 自检（提示词块 CRUD/运行日志）
```

## 设计约定

- UI 文案一律简体中文；源文件 UTF-8。
- 通用组件统一使用 Element Plus（n8n 同款底座）：按钮/输入框/下拉框/对话框/消息/上传/表格等不自研。
- 颜色一律使用 `apps/web/src/styles/tokens.css` 中的设计令牌；Element Plus 通过 `styles/element-theme.css` 的 `--el-*` 变量桥接同一套令牌，禁止页面散写 hex。
- 画布交互不自研：底层 Vue Flow（MIT），交互行为照搬 n8n 编辑器（详见方案文档照搬清单）。
- 许可证红线：只复用 MIT / Apache-2.0 代码；n8n、Dify 等只复刻交互行为，不复制代码。

## License

[MIT](LICENSE)
