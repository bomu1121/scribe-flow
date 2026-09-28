---
title: 架构与实现总览
class: status
owner: 念前
last_reviewed: 2026-09-26
---

# 架构与实现总览

这份文档回答「这个项目由哪些部分组成、一次运行在代码里怎么走、数据存在哪里、对外暴露什么接口」。
它描述**今天**的实现，不描述方案沿革（那是 `docs/decisions/` 的事，其中的数字与结论只对当时成立）。

配套阅读：[nodes.md](./nodes.md) 讲每个节点要填什么、产出什么；[status.md](./status.md) 是唯一的进度与缺口权威
来源；[deploy.md](./deploy.md) 讲部署与备份。本文件里的接口清单与节点总表由 `pnpm docs:gen` 从源码推导。

## 1. 三个包与各自的职责

| 位置 | 是什么 | 关键入口 |
| --- | --- | --- |
| `apps/web` | Vue 3 单页应用（画布、结果页、设置） | `src/router.ts`、`src/layouts/AppLayout.vue` |
| `apps/server` | Hono + Drizzle + SQLite 的本地服务端 | `src/app.ts`（装配）、`src/index.ts`（启动）、`src/lib/engine.ts`（运行引擎） |
| `packages/shared` | 前后端共用的类型与纯逻辑契约 | `src/graph.ts`、`src/schema.ts`、`src/run.ts`、`src/segment.ts`、`src/recipe.ts`、`src/prompt.ts` |
| `scripts` | 自研门禁与自检（无独立测试框架） | `docs-gen.mjs` / `docs-lint.mjs` / `slop-lint.mjs` / `ui-lint.mjs` / `cdp-ui-smoke.mjs` / `*-api-check.mjs` |

`packages/shared` 是**契约唯一来源**：节点类型与端口、Zod 图模型、运行状态与 SSE 事件、段标识规则、配方与断言、
内置提示词块、工程模板、各领域（drill / trace / media / video / bili / nutstore / docs）的类型都在这里。
前端与后端都依赖它，因此「改契约」总是从它开始。

## 2. 技术栈与许可证实况

许可证一列是**从 `node_modules` 里实读的**（不是凭印象），因为仓库有一条许可证红线（只复用 MIT / Apache-2.0 代码）。

| 端 | 依赖 | 用途 | 许可证 |
| --- | --- | --- | --- |
| Web | `vue` · `vue-router` · `pinia` | 框架与状态 | MIT |
| Web | `@vue-flow/core` · `/background` · `/controls` · `/minimap` | 画布引擎（n8n 同源） | MIT |
| Web | `element-plus` | 通用组件底座（按钮/输入/对话框/表格…） | MIT |
| Web | `reka-ui` | 少量无样式原语 | MIT |
| Web | `tailwindcss` | 语义 utility（映射到设计令牌） | MIT |
| Web | `marked` · `dompurify` | Markdown 渲染与净化 | MIT · MPL-2.0 OR **Apache-2.0** |
| Web | `markmap-lib` · `markmap-view` | 思维导图渲染 | MIT |
| Web | `elkjs` | 「整理画布」自动布局（动态 import） | **EPL-2.0 OR GPL-3.0-or-later** |
| Web | `diff-match-patch-es` | 运行结果对比 | Apache-2.0 |
| Web | `lucide-vue-next` · `@phosphor-icons/vue` | 图标 | **ISC** · MIT |
| Web | `@vueuse/core` | 组合式工具集 | MIT |
| Web | `@fontsource/geist-sans` · `@fontsource/geist-mono` | 自托管字体 | **OFL-1.1**（字体自身的许可，允许随软件分发） |
| Server | `hono` · `@hono/node-server` | HTTP 框架 | MIT |
| Server | `drizzle-orm` · `better-sqlite3` | ORM 与 SQLite 驱动 | Apache-2.0 · MIT |
| Server | `zod` | 请求与图模型校验 | MIT |
| Server | `tsx` | 直接运行 TypeScript（生产镜像也用它） | MIT |
| Server | `qrcode` | B 站扫码登录二维码 | MIT |
| 构建 | `vite` · `vitest` · `typescript` · `vue-tsc` | 构建与测试 | MIT（TypeScript 为 Apache-2.0） |

**三处需要留意**：`elkjs`（EPL-2.0 / GPL-3.0-or-later）、`lucide-vue-next`（ISC）与两份 Geist 字体（OFL-1.1）
都不在仓库红线的「MIT / Apache-2.0」白名单字面范围内。它们都是作为**未修改的依赖或字体资产**引用的，
不是拷贝其源码：OFL 明确允许随软件分发、ISC 与 MIT 等效，而 `elkjs` 的 GPL-3.0 分支若被采用则需单独评估。
`dompurify` 是双许可，取 Apache-2.0 分支即可。

## 3. 一次运行在代码里怎么走

```
POST /api/projects/:id/runs
  └─ createRun                      校验工程/范围、拒同工程并发、密钥预检、插入 runs 行（status=running, 图快照）
       └─ engine.start              算本次 nodeIds、拓扑序 order、建 ActiveRun 放入内存 → void runLoop（不 await）
            └─ runLoop              并发窗口调度 → 逐个 executeNode → 收尾标记未执行节点 → finishRun
                 └─ executeNode     读重试策略 → 写 running → resolveInputs → persistInputs
                                    → 重试循环里 runNode（巨型 switch，按节点类型分支）
                                    → 合并产物/算 delta → 写终态 + emit 事件
```

### 3.1 运行范围（scope）

| scope | 含义 | nodeIds |
| --- | --- | --- |
| `all` | 整图 | 全部节点 |
| `fromNode` | 从某节点开始 | 该节点 + 沿出边闭包的全部下游 |
| `node` | 只跑某节点（结果页「重跑」用的就是它） | 仅该节点 |

范围外的上游不会被重跑，而是从**最近一次成功结果**里取数（`previousOutputs`），并连同素材段标识一起还原。
所以单节点重跑的花销只在于这一节点自身。

### 3.2 调度与并发

并发数是设置项 `general.concurrency`（默认 2，写入与读取都夹取在 1–4）。调度循环每轮做三件事：
筛出「范围内的、未完成的、期望输入边已尘埃落定且至少一路成功」的节点（`isReadyToRun`），在并发窗口内启动它们，
然后用 `Promise.race` 等任一节点结束再进入下一轮。

「期望输入边」会排除**条件分支未命中**的那些边（见 §3.4），所以条件分支的两条支路不会被当成「输入没到齐」而互相拖死。
`runLoop` 有一个死锁出口：若已经没有正在运行的节点但仍有未完成节点，直接跳出并把这些节点统一标记
（上游失败 → `skipped`，已取消 → `cancelled`）。

### 3.3 部分成功与降级

上游失败不一定让下游失败：只要下游还有**可用的输入**，它就会带着提示继续执行，并先推一条
「上游「X」失败，将用其余可用输入继续」的进度事件。这是刻意保留的语义——一个视频下载失败不该让其余七个视频白跑。

### 3.4 状态机与两种 `skipped`

引擎实际写入的节点状态只有 5 个：`running` / `done` / `error` / `cancelled` / `skipped`。`skipped` 的来源有两处：

1. **条件分支未命中**：`flow.if` 把判断结果记在内存（`active.branches`），下游取数时按 `sourceHandle` 过滤边；
   某节点若所有入边都被阻断，就被标记 `skipped`，原因是「条件分支未命中或上游不可用，跳过」。
2. **上游失败导致无输入**：调度循环的收尾统一标记。

注意素材挑选的未选中**不走 `skipped`**：被排除的素材根本不进入下游（过滤发生在 `resolveInputs`），
下游若因此一个输入都没有，是它自己报错（`error`）。两者的界面表现不同，排查时要分清。

### 3.5 重试、状态与产物的落库细节

- 重试的名单、次数、退避与「哪些错误不重试」见 [nodes.md §1.5](./nodes.md)。
- 每个节点结果在 `run_node_results` 里以 `${runId}:${nodeId}` 为主键**幂等 upsert**：开始、每次进度、每次重试、
  终态都写同一行，所以刷新页面总能拿到当前状态。
- 产物文本 ≤ 200,000 字符时内联存 `output_text`，超出只留 `output_path` / `output_size`。
  超长且没写文件的产物（如超大合并稿）只能靠结果页的日志与文件下载查看。
- 输入明细写在 `run_node_inputs`（每个输入一行，含 `itemKey`、`excluded`，以及「该输入处理后」的 `resultText`）；
  日志写在 `run_node_logs`（每条截断 8000 字符，带配方步骤 id 与「第几个输入」的归属信息）。

### 3.6 取消与恢复

| 动作 | 实现 | 效果 |
| --- | --- | --- |
| 停止 | `engine.stop` | 内存标记 `cancelled` + abort 所有在途 HTTP；节点在下一个检查点退出，落 `cancelled` |
| 强制结束 | `engine.forceStop` | 直接把 run 与未完成节点改 `cancelled` 并补发 `run.done`，即使运行已不在内存中 |
| 服务重启 | `recoverInterruptedRuns`（`db/client.ts`，启动时调用） | 把残留的 `running` run 与节点标记为 `cancelled`，错误写「服务重启，运行已中断」 |

**没有断点续跑**：中断后要么整体重跑、要么用结果页的「重跑」按节点重跑。同工程同时只允许一个运行；
运行中禁止删除工程与运行；坚果云恢复前也要求没有在跑的运行。

## 4. SSE：运行事件的唯一推送通道

服务端通过 `GET /api/runs/:id/events` 推 `data:` 帧，**帧里只有 JSON，没有 SSE 事件名**，
客户端按 JSON 里的 `type` 分派。事件契约定义在 `packages/shared/src/run.ts`：

| 事件 | 携带 | 谁发 |
| --- | --- | --- |
| `run.started` | `run` 元信息 | 路由在连接/重连时补发快照 |
| `node.started` | `runId` / `nodeId` | 引擎（以及重连快照补发 running 节点） |
| `node.progress` | `progress` / `message` | 引擎（含「上游失败，用其余输入继续」提示） |
| `node.retry` | `attempt` / `maxRetries` / `error` | 引擎 |
| `node.skipped` | `reason` | 引擎 |
| `node.done` | `summary` / `preview?` / `delta?` | 引擎 |
| `node.error` | `error` | 引擎 |
| `node.step.done` | `stepId` / `index` / `total` / `summary?` | 引擎（配方步骤） |
| `node.step.error` | `stepId` / `index` / `total` / `error` | 引擎（配方步骤） |
| `run.done` | `status` | 引擎；收到后流的生命周期结束 |

连接时先补一份**当前快照**（`run.started` + 每个已结束节点的 `node.done`/`node.error` + running 节点的 `node.started`），
这一设计是为了让「刷新页面后重新订阅」也能立即看到正确状态；如果连接时运行已结束，补完 `run.done` 就关闭流。
引擎的事件广播是纯内存的、**没有重放缓冲**，所以快照补发是必需的而不是锦上添花。

前端 `apps/web/src/lib/sse.ts` 用 `EventSource`，断线 2 秒重连，收到 `run.done` 主动关闭。除 SSE 之外还有两层兜底：
布局层每 5 秒轮询运行列表，编辑器在发现「本地认为在跑、但全局列表里已经没有」时主动拉一次运行详情核对，
运行结束后再补一次最终快照。

## 5. 数据模型

单个 SQLite 文件（`<数据目录>/scribe-flow.sqlite`，WAL 模式），共 12 张表：

| 分组 | 表 | 关键字段 |
| --- | --- | --- |
| 工程 | `projects` | `graph_json`（工作流定义）、`folder_id` / `position`（工作台树与排序）、`schema_version` |
| 工程 | `folders` | 多级文件夹树（`parent_id` / `position`） |
| 运行 | `runs` | `status` / `scope` / `node_id` / `graph_json`（**运行时快照**）/ 耗时与摘要 |
| 运行 | `run_node_results` | 主键 `${runId}:${nodeId}`；`status` / `attempts` / `output_kind` / `output_text` / `output_path` |
| 运行 | `run_node_inputs` | 每个输入一行；`item_key`（段标识）/ `excluded` / `result_text` |
| 运行 | `run_node_logs` | `kind`（input / ai-request / ai-response / info / error）/ `step` / `input_index` |
| 配置 | `app_settings` | KV（键名形如 `ai.apiKey`、`nutstore.password`），密钥明文存库 |
| 配置 | `prompt_blocks` | 自定义提示词块；`builtin` 标记与 `recipe`（配方 JSON） |
| 登录 | `bili_sessions` · `bili_cookies` | 扫码会话状态；Cookie 固定单行 `id=1`（单用户设计） |
| 媒体 | `media_assets` | `content_key`（唯一，内容寻址）、`file_path`、`status`、`meta_json`（B 站溯源信息） |
| 媒体 | `run_media` | 某次运行的某节点用了哪个媒体资产（`run_id`+`node_id`+`source_index` 唯一） |

**迁移只有「手写幂等补列」**：`db/client.ts` 先跑一串 `CREATE TABLE IF NOT EXISTS`，再对每张表读
`PRAGMA table_info` 并按缺列 `ALTER TABLE ADD COLUMN`。只能加列、没有回滚、语句之间没有事务包裹，
任一步抛错会让进程启动失败。这一条与缺索引的问题一起记在 [status.md](./status.md) 的缺口清单里。

**`position` 回填规则**：只有当表里**所有** `position` 都为空/0 时才按名称与创建时间重排一遍；
只要有一行非 0 就整体跳过。混有历史数据的库因此不会被打乱，但也可能继续存在 `position` 为空的行。

**没有外键约束**：连接上开了 `foreign_keys=ON`，但 schema 里没有声明任何 `references`，
所以级联删除靠代码（如删工程时按 `project_id` 清理运行与产物）。

## 6. 媒体库（视频模块的底子）

- **内容寻址**：`content_key = sha1("bili:" + bvid + ":" + cid + ":" + qn)` 或 `sha1("file:" + 相对路径)`，
  列上有唯一约束；重复下载同一视频会命中已有资产（插入冲突时回读同一行兜底）。
- **落地位置**：B 站资产写到 `<数据目录>/media/<assetId>.mp4`（先下到临时目录、成型后 rename）；
  本地文件若本身就是 h264 的 mp4，**直接引用 `uploads/` 里的原件（零拷贝）**，否则转码归一化后进 `media/`。
- **流式播放**：`GET /api/media/:assetId/stream` 支持 `Range`——无 Range 返回 200 + `Accept-Ranges`，
  合法 Range 返回 206 + `Content-Range`，越界返回 416（带 `bytes */size`），文件不在本地返回 404 并带上缺失状态。
- **缺失与重下**：assets 只在元数据里而文件不在了（换机、恢复备份），结果页会显示缺失态；
  B 站来源可一键重下（`POST /api/media/:assetId/restore` 起一个进程内任务、用 `GET /api/media/restore-jobs/:jobId` 轮询），
  本地文件来源只能重新上传。重下任务表在内存里，重启即丢。
- **不入备份**：坚果云备份只传数据库（含媒体**引用与元数据**），不含视频文件本体。

## 7. 对外部世界的三处依赖

**B 站**（`lib/bilibili.ts`、`lib/media.ts`）：扫码登录用 `passport.bilibili.com` 的
`qrcode/generate` + `qrcode/poll`，登录态用 `api.bilibili.com/x/web-interface/nav` 校验；
只读取收藏夹（`x/v3/fav/folder/created/list-all` + `x/v3/fav/resource/list`）、稍后再看（`x/v2/history/toview`）、
观看历史（`x/web-interface/history/cursor`）、我的合集/系列（`x/polymer/web-space/seasons_series_list` + `seasons_archives_list`）
与播放地址（`x/player/playurl`）。统一带 Chrome UA 与 `Referer`，常规接口 12 秒超时。
B 站返回 `-101`（未登录/失效）会统一映射成 401。Cookie 存 `bili_cookies` 单行，退出登录即删；
二维码的 `qrcode_key` 只在内存里存活 180 秒，不落库。

**坚果云 WebDAV**（`lib/nutstore.ts`）：默认 `https://dav.jianguoyun.com/dav/`，Basic 认证（**应用密码**，不是登录密码）。
单次目录列表上限 750 条，达到即标 `truncated`，递归场景下直接报错以免漏读；429/502/503/504 按 `Retry-After` 退避重试（上限 5 秒、2 次）。
写文件前逐级 `MKCOL` 建父目录。两个用途分开：**Obsidian 笔记同步**（只同步 `.md`，按修改时间判断，冲突跳过不覆盖较新的那份）
与**整库备份**（在线快照 + `backup.json`）。恢复流程是：有运行中直接 409 → 校验备份目录 → **先自动把当前库备份到云端**（后悔药）
→ `integrity_check` + 补齐表列 + 清残留 running → 在 `ATTACH` 后的单事务里逐表替换，失败自动回滚。

**AI / ASR**（`lib/ai.ts`）：AI 走 OpenAI 兼容的 `POST {baseUrl}/chat/completions`（`temperature` 0.3，300 秒超时）；
ASR 支持两种引擎——MiMo 走 `input_audio` data URL（超过 7MB 自动切段），OpenAI 兼容走 `/audio/transcriptions`。
外部溯源是在 `builtin.trace.v2` 且配置了 Tavily 密钥时才启用的联网核查，失败只记日志、保留内部溯源结果。

## 8. 接口面

<!-- docs-gen:api:start -->
<!-- 由 `pnpm docs:gen` 从 app.ts 与 routes/*.ts 生成，请勿手改 -->

共 **75** 条接口。路径即挂载后的完整路径，可直接调用（Hono 会把子应用的 `/` 合并为前缀本身，故无尾斜杠）；
本服务**没有任何认证中间件**，CORS 默认放开，仅适合自托管或本机使用。

| 方法 | 路径 | 实现 |
| --- | --- | --- |
| POST | `/api/auth/qr` | `routes/auth.ts` 的 `authApi` |
| GET | `/api/auth/qr/:qrId` | `routes/auth.ts` 的 `authApi` |
| GET | `/api/auth/status` | `routes/auth.ts` 的 `authApi` |
| POST | `/api/auth/logout` | `routes/auth.ts` 的 `authApi` |
| GET | `/api/bilibili/fav/folders` | `routes/bilibili.ts` 的 `bilibiliApi` |
| GET | `/api/bilibili/fav/folders/:id/videos` | `routes/bilibili.ts` 的 `bilibiliApi` |
| GET | `/api/bilibili/seasons` | `routes/bilibili.ts` 的 `bilibiliApi` |
| GET | `/api/bilibili/collections/:id/videos` | `routes/bilibili.ts` 的 `bilibiliApi` |
| GET | `/api/bilibili/collected/:id/videos` | `routes/bilibili.ts` 的 `bilibiliApi` |
| GET | `/api/bilibili/watch-later` | `routes/bilibili.ts` 的 `bilibiliApi` |
| GET | `/api/bilibili/history` | `routes/bilibili.ts` 的 `bilibiliApi` |
| GET | `/api/docs` | `routes/docs.ts` 的 `docsApi` |
| GET | `/api/docs/file` | `routes/docs.ts` 的 `docsApi` |
| POST | `/api/files/upload` | `routes/files.ts` 的 `filesApi` |
| GET | `/api/folders` | `routes/folders.ts` 的 `foldersApi` |
| POST | `/api/folders` | `routes/folders.ts` 的 `foldersApi` |
| PUT | `/api/folders/order` | `routes/folders.ts` 的 `foldersApi` |
| PATCH | `/api/folders/:id` | `routes/folders.ts` 的 `foldersApi` |
| DELETE | `/api/folders/:id` | `routes/folders.ts` 的 `foldersApi` |
| GET | `/api/health` | `routes/health.ts` 的 `health` |
| GET | `/api/media/:assetId/stream` | `routes/media.ts` 的 `mediaApi` |
| GET | `/api/media/:assetId/download` | `routes/media.ts` 的 `mediaApi` |
| GET | `/api/media/:assetId/probe` | `routes/media.ts` 的 `mediaApi` |
| POST | `/api/media/:assetId/restore` | `routes/media.ts` 的 `mediaApi` |
| GET | `/api/media/restore-jobs/:jobId` | `routes/media.ts` 的 `mediaApi` |
| GET | `/api/nutstore/status` | `routes/nutstore.ts` 的 `nutstoreApi` |
| POST | `/api/nutstore/test` | `routes/nutstore.ts` 的 `nutstoreApi` |
| GET | `/api/nutstore/list` | `routes/nutstore.ts` 的 `nutstoreApi` |
| GET | `/api/nutstore/folders` | `routes/nutstore.ts` 的 `nutstoreApi` |
| GET | `/api/nutstore/read` | `routes/nutstore.ts` 的 `nutstoreApi` |
| POST | `/api/nutstore/sync/push` | `routes/nutstore.ts` 的 `nutstoreApi` |
| POST | `/api/nutstore/sync/pull` | `routes/nutstore.ts` 的 `nutstoreApi` |
| GET | `/api/nutstore/backups` | `routes/nutstore.ts` 的 `nutstoreApi` |
| POST | `/api/nutstore/backup` | `routes/nutstore.ts` 的 `nutstoreApi` |
| POST | `/api/nutstore/restore` | `routes/nutstore.ts` 的 `nutstoreApi` |
| GET | `/api/projects` | `routes/projects.ts` 的 `projectsApi` |
| POST | `/api/projects/import` | `routes/projects.ts` 的 `projectsApi` |
| GET | `/api/projects/:id/export` | `routes/projects.ts` 的 `projectsApi` |
| GET | `/api/projects/:id/graph` | `routes/projects.ts` 的 `projectsApi` |
| PUT | `/api/projects/:id/graph` | `routes/projects.ts` 的 `projectsApi` |
| POST | `/api/projects` | `routes/projects.ts` 的 `projectsApi` |
| GET | `/api/projects/:id` | `routes/projects.ts` 的 `projectsApi` |
| PUT | `/api/projects/order` | `routes/projects.ts` 的 `projectsApi` |
| PATCH | `/api/projects/:id` | `routes/projects.ts` 的 `projectsApi` |
| DELETE | `/api/projects/:id` | `routes/projects.ts` 的 `projectsApi` |
| POST | `/api/projects/:id/duplicate` | `routes/projects.ts` 的 `projectsApi` |
| GET | `/api/prompts` | `routes/prompts.ts` 的 `promptsApi` |
| POST | `/api/prompts` | `routes/prompts.ts` 的 `promptsApi` |
| PATCH | `/api/prompts/:id` | `routes/prompts.ts` 的 `promptsApi` |
| DELETE | `/api/prompts/:id` | `routes/prompts.ts` 的 `promptsApi` |
| POST | `/api/projects/:id/runs` | `routes/runs.ts` 的 `projectRunsApi` |
| GET | `/api/runs` | `routes/runs.ts` 的 `runsApi` |
| GET | `/api/runs/:id` | `routes/runs.ts` 的 `runsApi` |
| GET | `/api/runs/:id/events` | `routes/runs.ts` 的 `runsApi` |
| POST | `/api/runs/:id/stop` | `routes/runs.ts` 的 `runsApi` |
| POST | `/api/runs/:id/force-stop` | `routes/runs.ts` 的 `runsApi` |
| POST | `/api/runs/:id/nodes/:nodeId/retry` | `routes/runs.ts` 的 `runsApi` |
| PATCH | `/api/runs/:id` | `routes/runs.ts` 的 `runsApi` |
| DELETE | `/api/runs/:id` | `routes/runs.ts` 的 `runsApi` |
| GET | `/api/runs/:id/logs` | `routes/runs.ts` 的 `runsApi` |
| GET | `/api/runs/:id/outputs/:nodeId` | `routes/runs.ts` 的 `runsApi` |
| GET | `/api/runs/:id/outputs/:nodeId/content` | `routes/runs.ts` 的 `runsApi` |
| GET | `/api/runs/:id/outputs/:nodeId/download` | `routes/runs.ts` 的 `runsApi` |
| GET | `/api/settings` | `routes/settings.ts` 的 `settingsApi` |
| PUT | `/api/settings` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/settings/test/ai` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/settings/ai/models` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/settings/test/asr` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/settings/test/search` | `routes/settings.ts` 的 `settingsApi` |
| GET | `/api/settings/obsidian/folders` | `routes/settings.ts` 的 `settingsApi` |
| GET | `/api/settings/data` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/settings/prune` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/settings/reveal-data-dir` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/settings/reveal-output-dir` | `routes/settings.ts` 的 `settingsApi` |
| POST | `/api/videos/preview` | `routes/videos.ts` 的 `videosApi` |
<!-- docs-gen:api:end -->

除生成清单外，几个与安全边界有关的事实（改动时不要误以为有保护）：

- **唯一全局中间件是 CORS**，默认 `origin: *`，可用 `CORS_ORIGIN` 收敛；**没有任何认证**。
- 请求体基本都过 Zod 校验（`@hono/zod-validator`）；唯一例外是设置接口的分组字段各自校验。
- 未匹配路径返回 JSON `{"error":"接口不存在"}`；但启用 `STATIC_DIR` 后，未匹配的 GET 会落到 SPA 的 `index.html`。
- `app.onError` 会把 `err.message` 原样回给客户端（含绝对路径与上游响应片段），这是一条已记录的缺口。
- `bilibili` 子应用有独立错误处理：B 站未登录映射 401，其余 400。
- 只读的文档阅读接口读的是**仓库里的 `docs/` 目录**（`DOCS_DIR`，默认仓库根 `docs/`）；
  Docker 镜像没有 COPY `docs/`，所以容器里它返回 `available: false`，前端给出「当前部署未包含文档目录」的提示。
- `GET /api/docs` 默认只回列表：`listDocs` 每个文件只读前 4096 字节（front matter + 首个 H1 够用），
  头部不足以得出结论时退回整读——所以省 I/O 不影响结果，`apps/server/src/lib/docs.test.ts` 有一条
  「只读头部 vs 整读」的对拍测试锁住这一点（实测 5.77 → 4.69 ms，读取字节 643 → 301 KB）。
- `?body=1` 连正文一起返回（全仓约 680 KB），阅读器用它把「取列表 + 逐篇取正文」并成一次请求。
  这是拿首屏换后续：列表可见 25 → 66 ms，而正文可读 81 → 66 ms、切换文档 19 → 8.7 ms
  （控制变量实测，连 `127.0.0.1:5173` 以排除连接停顿）。开发环境里**新建 TCP 连接**要等约 205 ms
  （见 [status.md](./status.md) 的 P1 条目），所以「一次请求」省下的不只是往返。文档体量再涨一个
  数量级时，这个选择要重新评估。

## 9. 前端结构

**4 条路由 + 一条兜底**：`/` 冷启动入口（有工程则跳到最近打开的工程）、`/project/:id` 画布编辑器、
`/project/:id/run/:runId` 运行结果页、`/settings` 设置页。`RouterView` 以路由名作 key，
因此同路由内切换工程/运行不会重建组件，由视图自己监听参数重载。

**布局不是「顶栏 + 侧栏」**：`AppLayout` 是「左侧活动条 + 一个可收起的单面板 + 主区」。活动条上方三个按钮
切换同一个面板的内容（工程树 / 运行记录 / 节点库），下方两个按钮打开**浮层**（项目文档阅读器 / 设置）。
面板开合与当前 tab 持久化在 localStorage。

| store | 职责 |
| --- | --- |
| `projects` | 工程与文件夹树、当前工程、图保存与导入导出 |
| `runs` | 全局最近运行（供计数与「上次结果」）、按工程缓存 |
| `settings` | 设置读写、Obsidian 目录、AI/ASR/坚果云测试与同步；密钥草稿存 sessionStorage |
| `prompts` | 内置块与自定义块的合并列表 |
| `auth` | B 站登录态与扫码轮询 |
| `ui` | 浮层开关、面板状态、**节点添加总线**（面板写入、画布消费） |

**运行态不进工程图**：`status` / `summary` / `preview` 只存在内存与运行记录里，工程图只保存工作流定义。
画布节点状态由 SSE 事件（或重连快照）在视图内维护，切工程/刷新后按运行记录重新计算。
这条约束换来的好处是「刷新后不会看到节点卡在 running」，代价是画布必须自己实现快照恢复逻辑。

## 10. 关键契约一览（改动前先看这几条）

1. **运行态不写入工程图**；工程图只存工作流定义。
2. **端口 4 类型 + 单向 `canConnect`**；动态端口用 `accepts` 做同型透传。
3. **段标识**只在来源节点产生、沿「一个输入一份产物」的节点透传，压平节点终止身份。
4. **图模型校验在 `packages/shared/src/schema.ts`**：按节点类型分支校验 `data`，并校验节点/连线 id 唯一、
   连线引用的节点与端口存在、不能自连。`PUT /api/projects/:id/graph` 覆盖前把上一版留档到 `data/graph-backups/`（每工程 20 份）。
5. **密钥只写不读**：`GET /api/settings` 只回 `hasKey` / `hasPassword`；`PUT` 时空字符串表示「不修改」，
   因此**无法通过接口清空已保存的密钥**。
6. **同工程单运行**；运行中禁止删工程、删运行、恢复备份。
7. **产物文本超过 20 万字符不内联**，只能靠文件下载或日志查看。
8. **AI/ASR 密钥预检只覆盖部分节点**（详见 [nodes.md §1.6](./nodes.md)），其余节点在运行时兜底报错。

## 11. 已知的架构级缺口

下面这些是**行为事实**，逐条修法与优先级维护在 [status.md](./status.md) 的「已知缺口」一节，这里不重复细节、
也不重复它的文件行号（那些引用会漂）：后端无应用层认证、盲 SSRF、路径校验可绕过、用户可控正则、
错误信息泄漏、密钥明文入库、`engine.ts` 里有未捕获的 Promise、基础设施类 DB 错误会升级成整个运行失败、
坚果云请求无超时、`forceStop` 会改写已结束的运行、SSE 建连存在竞态、`apps/server` 没有真实构建产物、
没有迁移工具与缺索引、前端首屏偏大、`routes/` 与前端组件无测试、没有 ESLint/Prettier。
