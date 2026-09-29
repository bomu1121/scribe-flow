# AGENTS.md

给在这个仓库工作的 AI agent（以及人）看的说明。**只写推断不出来的东西**——能从 `package.json`、
源码、测试或 CI 报错里查到的一律不在这里重述。写每一条之前先问那一句：
**删掉它，agent 会不会在它自己发现不了的地方失败？** 不会就删。

## 这是什么

ScribeFlow 把视频与文稿加工成笔记：用户不写代码，而是在画布上拖节点、连线、点运行，
产物在结果页按段阅读，运行结束按工程名落到输出目录。

三个包：

| 包 | 是什么 |
| --- | --- |
| `apps/web` | Vue 3 + Vite 单页应用（Pinia、Element Plus、Vue Flow 画布） |
| `apps/server` | Hono + Drizzle + SQLite：运行引擎、B 站/ASR/AI 调用、SSE 推送 |
| `packages/shared` | 类型、Zod 图模型校验、内置提示词块、工程模板 |

产品怎么用看 [docs/usage.md](./docs/usage.md)，每个节点要填什么看 [docs/nodes.md](./docs/nodes.md)，
实现总览看 [docs/architecture.md](./docs/architecture.md)。

## 怎么跑

```bash
pnpm dev        # 同时起前后端（web :5173，server :8787）
pnpm typecheck  # 全仓类型检查
pnpm test       # vitest（shared / server / web 三个包）
pnpm lint       # 自研检查 + knip + depcruise
pnpm build      # 前端真实构建；server 的 build 只是 tsc --noEmit
```

**改动源码后必须跑：`pnpm typecheck && pnpm test && pnpm lint`。**
动了**节点类型 / 端口 / 接口路由 / 内置提示词块**时，再跑一次 `pnpm docs:gen` 并一并提交，
否则 CI 会红（生成块与源码不一致）。

加新检查时：**先问已有测试或已有工具能不能覆盖**；能就别新建脚本。自研门禁脚本的总行数
**只降不升**——这个仓库曾经把 3000 行预算花在自研检查上，其中一半从不在 CI 运行，
而真正能拦住缺陷的一条 `no-floating-promises` 反而缺席。

Windows 上可以直接双击根目录的 `start-dev.cmd`（内部跑 `scripts/start-dev.mjs`）：
它检查环境、首次运行装依赖、等前后端**都**就绪再打开浏览器，关掉那个窗口即停服务。

## 改之前先看这几处

| 文件 | 是什么 | 改它的连带影响 |
| --- | --- | --- |
| `packages/shared/src/graph.ts` | 节点类型联合与 `NODE_TYPE_LABELS` | 新增节点必改，画布与引擎都会跟着动 |
| `packages/shared/src/schema.ts` | Zod 图模型校验，`nodeDataByType` 按类型分别校验 `data` | 边界：个别字段只有类型校验（如文本工具的 `pattern`/`flags` 没有长度与白名单限制） |
| `packages/shared/src/prompt.ts` | 内置提示词块与配方（`BUILTIN_PROMPT_BLOCKS`） | 改了要重跑 `docs:gen` |
| `apps/server/src/lib/engine.ts` | 运行引擎。单文件很大，`runNode` 是一个巨型 switch | 运行链路的改动都在这里 |
| `apps/web/src/components/canvas/` | `FlowCanvas.vue` 管交互；`ScribeNode.vue` 是唯一注册的节点外壳，卡片按类型分派 | 新增节点要在这里加一条分派 |
| `apps/web/src/styles/tokens.css` | 颜色令牌的唯一来源 | 页面里不许散写色值（`pnpm lint:ui` 会拦） |

## 别踩的坑

这些是**当前行为的说明**，不是待办：

- **`apps/server` 的 `build` 只是 `tsc --noEmit`**，没有编译产物；Dockerfile 用 `tsx` 直接跑 TS 源码。
- **server 的 dev 不要改回 `tsx watch`。** pnpm 跑多包时会把子进程 stdin 换成
  「打开但永不写入的管道」，`tsx watch` 在该条件下会静默挂住——进程活着、不监听端口、不打日志，
  表现成「前端能开、后端连不上」。单包运行不复现，所以只在 `pnpm dev` 这条路径上翻车。
  现在用的是 `node --watch --import tsx`。
- **数据库没有迁移工具。** `apps/server/src/db/client.ts` 是手写幂等补列，**只能加列**。
- **`knip` 固定在 5.x，不要升到 6**：6.x 换用 oxc-parser，要分配约 6 GiB 的单个 `ArrayBuffer`，
  超过 V8 的 4 GiB 上限，本机实测必崩。理由也记在 `knip.jsonc` 里。
- 开发时用 `http://127.0.0.1:5173` 打开，别用 `localhost:5173`（每次新连接会多等约 200ms）。
  **不要**因此把 Vite 改成监听所有网卡，那会把无认证的服务暴露到局域网。
- **后端没有应用层认证，CORS 默认放开。** 不要把服务暴露到不可信网络（收口计划见 README 的已知缺口）。

## 必须守住的规矩

这几条不是偏好，是产品或法律约束；只有推断不出来的才写在这里。

1. **UI 文案一律简体中文**，源文件 UTF-8。
2. **通用组件不自研**：按钮、输入框、下拉框、对话框、消息、上传、表格一律用 Element Plus。
3. **画布交互不自研**：底层是 Vue Flow，交互行为参考 n8n。
4. **许可证红线**：只复用 MIT / Apache-2.0 的代码；n8n / Dify 这类只复刻交互行为，不复制代码。
5. **运行态不写进工程图**：`status / summary / preview` 只存在内存与运行记录里，
   工程图只保存工作流定义，否则刷新后节点会「卡在 running」。
6. **多输入不静默丢弃**：转写、校对、AI 加工、文本工具这类节点「一个输入一份结果」；
   合并、输出、章节切分这类压平型节点才按连接顺序以空行合并成一份。
   两类的分界与理由见 [docs/nodes.md](./docs/nodes.md) §1.2。

颜色与 z-index 只能用令牌这件事由 `pnpm lint:ui` 机器强制，不在这里重述——违反时报错信息会直接告诉你该怎么做。

## 文档

**唯一强制的文档动作**：改动用户可见行为时，在 [CHANGELOG.md](./CHANGELOG.md) 的
`## [Unreleased]` 里加一条，与代码同一个提交。

`docs/` 只有三类，目录即分类：

- 根目录 —— 现状说明（`nodes` / `architecture` / `usage` / `deploy`），要反映今天
- `decisions/` —— 拍过板的方案与选型，**只放不可逆的长期约定**；过时就删掉（git 历史可查）
- `research/` —— 调研，只追加

三条硬要求，其余交给门禁：

- front matter 只有**三个字段**：`title` / `class`（`decision` 另加 `status`）。字段照抄相邻的同类文档即可。
- **引用文档或代码时写文件路径与符号名，不写行号。** 行号必然腐烂，而门禁只能验"文件存在、行号不越界"。
- **结构性内容不要手写**：文档地图、节点总表、接口清单由 `pnpm docs:gen` 生成。
  文档里不写易漂移的数字指标——需要知道"这次过没过"，看脚本自己最后那行汇总
  （`[cdp-ui-smoke] N/N 项通过` 这类），不要拿别处的静态计数代替。

`pnpm docs:lint` 会校验 front matter、生成块同步、文档地图覆盖、死链、废弃文档里的祈使句、
以及源码注释与正文里写的文档路径是否存在。规则细节在 `scripts/docs-lint.mjs` 顶部注释里，不用背，报错时去看。
