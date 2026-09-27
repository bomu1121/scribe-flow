# AGENTS.md

给在这个仓库工作的 AI agent（以及人）看的说明。
**先读「这是什么」，再读「别踩的坑」**——其余都是细节，用时再查，不用背。

本文件只放**不随时间变化**的信息。进度、用例数、缺口这类会变的事实不属于这里：
数字由 `pnpm docs:gen` 从源码生成，整体进度看 [docs/status.md](./docs/status.md)。

---

## 这是什么

ScribeFlow 是一个**把视频和文稿加工成笔记**的网页工具。用户不写代码，
而是在一张画布上拖节点、连线，然后点运行。

一次典型的运行长这样：

1. 放一个**来源**节点：B 站链接、本地音视频文件，或者直接粘一段文稿。
2. 接**转写**节点：音频被下载下来、FFmpeg 转码、交给 ASR，出一份文稿。
3. 接**加工**节点：AI 校对、观点提炼、技术拆解、自定义提示词、章节切分、思维导图、
   练一练（把文稿变成知识点和题目）。
4. 接**合并**再**输出**：多份产物拼成一份 Markdown，可以读、改、导出。

编排本身保存成一个「工作流工程」，每次运行留一条运行记录，结果在结果页按段阅读。
另有一类**素材挑选**节点，挂在多素材链路上，只放行其中几段继续往下走。

界面上就四块：

- **项目列表** —— 工程的增删改查、导入导出
- **画布编辑器** —— 左边画布、右边是选中节点的配置；支持撤销重做与自动布局
- **运行详情 / 结果页** —— 节点状态与日志、失败重跑、结果按段读（视频可在页内播放）
- **设置页** —— AI 密钥与模型、B 站扫码登录、坚果云同步

技术上分三个包：

| 包 | 是什么 |
| --- | --- |
| `apps/web` | Vue 3 + Vite 单页应用（Pinia、Element Plus、Vue Flow 画布） |
| `apps/server` | Hono + Drizzle + SQLite：运行引擎、B 站/ASR/AI 调用、SSE 推送 |
| `packages/shared` | 类型、Zod 图模型校验、内置提示词块、工程模板 |

## 怎么跑

```bash
pnpm dev            # 同时起前后端（web :5173，server :8787）
pnpm typecheck      # 全仓类型检查
pnpm test           # vitest（shared / server / web 三个包）
pnpm build          # 前端真实构建；server 的 build 只是 tsc --noEmit
pnpm lint           # 全部门禁（自研检查 + knip + depcruise）
pnpm check:prose    # 中文散文检查，需要系统装 vale；本机可能没装，也不在 CI 里
pnpm smoke:ui       # 真实 Chrome 冒烟，需先 pnpm dev
pnpm check:api:m2|m3|m4|m6|drill   # 分层 API 自检，需先 pnpm dev
```

改动源码后必须跑：`pnpm typecheck && pnpm test && pnpm lint`。
另外，动了**用例数、冒烟项数、内置提示词块、节点类型或接口路由**时，要再跑一次 `pnpm docs:gen`
并一并提交，否则 CI 会红。

## 改之前先看这几处

| 文件 | 是什么 | 改它的连带影响 |
| --- | --- | --- |
| `packages/shared/src/graph.ts` | 节点类型联合与 `NODE_TYPE_LABELS` | 新增节点必改，画布与引擎都会跟着动 |
| `packages/shared/src/schema.ts` | Zod 图模型校验，`nodeDataByType` 按类型分别校验 `data` | 边界：个别字段只有类型校验（如文本工具的 `pattern`/`flags` 没有长度与白名单限制） |
| `packages/shared/src/prompt.ts` | 内置提示词块与配方（`BUILTIN_PROMPT_BLOCKS`） | 改了要重跑 `docs:gen` |
| `apps/server/src/lib/engine.ts` | 运行引擎。单文件很大，`runNode` 是一个巨型 switch | 运行链路的改动都在这里，注意未捕获的 Promise |
| `apps/web/src/components/canvas/` | `FlowCanvas.vue` 管交互；`ScribeNode.vue` 是唯一注册的节点外壳，卡片按类型分派 | 新增节点要在这里加一条分派 |
| `apps/web/src/styles/tokens.css` | 颜色令牌的唯一来源 | 页面里不许散写色值 |

## 别踩的坑

这些是**当前行为的说明**，不是待办：

- **后端没有应用层认证，CORS 默认放开。** 不要把服务暴露到不可信网络。
- **`apps/server` 的 `build` 只是 `tsc --noEmit`**，没有编译产物；Dockerfile 用 `tsx` 直接跑 TS 源码。
- **server 的 dev 不要改回 `tsx watch`。** pnpm 跑多包时会把子进程 stdin 换成
  「打开但永不写入的管道」，`tsx watch` 在该条件下会静默挂住——进程活着、不监听端口、不打日志，
  表现成「前端能开、后端连不上」。单包运行不复现，所以只在 `pnpm dev` 这条路径上翻车。
  现在用的是 `node --watch --import tsx`。
- **数据库没有迁移工具。** `apps/server/src/db/client.ts` 是手写幂等补列，**只能加列**。
- **`engine.ts` 里有多处未捕获的 Promise**，改运行链路时留意 `runLoop` 的收尾与 `executeNode`。
- **`knip` 固定在 5.x，不要升到 6**：6.x 换用 oxc-parser，要分配约 6 GiB 的单个 `ArrayBuffer`，
  超过 V8 的 4 GiB 上限，本机实测必崩。升级前先复测，理由记在 [status.md](./docs/status.md)。
- 开发时用 `http://127.0.0.1:5173` 打开，别用 `localhost:5173`（每次新连接会多等约 200ms）。
  **不要**因此把 Vite 改成监听所有网卡，那会把无认证的服务暴露到局域网。

## 必须守住的规矩

前几条不是偏好，是产品或法律约束；只有推断不出来的才写在这里。

1. **UI 文案一律简体中文**，源文件 UTF-8。
2. **颜色只能用 `apps/web/src/styles/tokens.css` 的令牌**。Element Plus 通过
   `styles/element-theme.css` 的 `--el-*` 桥接同一套令牌；页面里禁止散写 hex/rgb/hsl，
   z-index 走令牌不写裸数字。`pnpm lint:ui` 会拦。
3. **通用组件不自研**：按钮、输入框、下拉框、对话框、消息、上传、表格一律用 Element Plus。
4. **画布交互不自研**：底层是 Vue Flow，交互行为照搬 n8n（**只复刻行为，不复制代码**）。
5. **许可证红线**：只复用 MIT / Apache-2.0 的代码。
6. **运行态不写进工程图**：`status / summary / preview` 只存在内存与运行记录里，
   工程图只保存工作流定义，否则刷新后节点会「卡在 running」。
7. **多输入不静默丢弃**：转写、校对、AI 加工、文本工具这类节点「一个输入一份结果」；
   合并、输出、章节切分这类压平型节点才按连接顺序以空行合并成一份。
   两类的分界与理由见 [docs/nodes.md](./docs/nodes.md) §1.2。

要加新的检查，就往 `scripts/*.mjs` 里加，别为了「更正规」顺手引新工具链——
ESLint / Playwright 这类属于待决策事项，动因记在 [status.md](./docs/status.md) 的已知缺口里。

## 文档

改代码时**只有两处是强制的**：`docs/status.md`（现状变了）与
[CHANGELOG.md](./CHANGELOG.md)（在 `## [Unreleased]` 里加一条，与代码同一个提交）。

`docs/` 按用途分目录，改到哪块就跟着改哪块：

- `nodes.md` / `architecture.md` / `usage.md` / `deploy.md` —— 现状说明，要反映今天
- `decisions/` —— 拍过板的方案与选型。**永不删除**；要改就写新的并双向 supersede
- `plans/` `evidence/` —— 计划和验收快照，文件名带日期，**只对当天成立，别当现状引用**
- `research/` —— 调研，只追加

两条硬要求，其余交给门禁：

- **易漂移的数字不要手写**，放进 `<!-- docs-gen:... -->` 生成块，由 `pnpm docs:gen` 维护。
- 新建 `docs/` 下的文档要写 front matter（字段照抄相邻的同类文档即可）。
  `pnpm docs:lint` 会校验 front matter、死链、漂移数字与验收档案的冻结指纹。
  规则细节在 `scripts/docs-lint.mjs` 顶部的注释里，不用背，报错时去看。
