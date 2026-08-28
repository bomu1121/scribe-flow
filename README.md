# ScribeFlow

**笔记处理画布流**：把 B 站视频、本地音视频或已有文稿放进画布，用节点编排「转写 → AI 校对 → 观点提炼 / 技术拆解 / 自定义提示词 → 合并 → 输出」的加工流，运行后得到一份可读、可改、可导出的 Markdown 笔记。整个编排保存为工作流工程，运行记录随工程归档。

## 项目状态

- 当前里程碑：M2（B 站来源节点：链接解析已上线，登录快捷选择/本地上传进行中）
- 产品方案：[docs/scribe-flow-proposal.md](docs/scribe-flow-proposal.md)
- 实施清单：[docs/scribe-flow-m0-m1.md](docs/scribe-flow-m0-m1.md)
- UI 框架选型调研：[docs/ui-framework-selection.md](docs/ui-framework-selection.md)
- shadcn-vue 官方使用规则：[docs/shadcn-vue-rules.md](docs/shadcn-vue-rules.md)

## 技术栈

| 端 | 技术 |
|---|---|
| Web | Vue 3 · Vite · TypeScript · Pinia · vue-router · Tailwind CSS 4 · reka-ui · Vue Flow |
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
pnpm lint:ui        # 浮层样式铁律自检（Portal 组件必须使用全局样式与 z-index 令牌）
```

## 设计约定

- UI 文案一律简体中文；源文件 UTF-8。
- 颜色一律使用 `apps/web/src/styles/tokens.css` 中的设计令牌，禁止页面散写 hex。
- 画布交互不自研：底层 Vue Flow（MIT），交互行为照搬 n8n 编辑器（详见方案文档照搬清单）。
- 许可证红线：只复用 MIT / Apache-2.0 代码；n8n、Dify 等只复刻交互行为，不复制代码。

## License

[MIT](LICENSE)
