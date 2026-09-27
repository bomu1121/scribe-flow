---
title: 项目现状
class: status
owner: 念前
last_reviewed: 2026-09-27
review_days: 30
---

# 项目现状

> **这是 ScribeFlow 唯一的现状权威来源。**
> 「现在完成到哪、有多少用例、还剩什么没做」一律以本文件与它引用的生成块为准。
> `docs/` 下的方案、实施清单与验收档案都是**历史快照，不代表现状**——尤其 `docs/evidence/*-acceptance.md` 里的数字只对冻结当天成立。
> 文档分类与维护规则见 [AGENTS.md 的文档规则](../AGENTS.md)。
>
> 与「现状」并列的另外三份说明性文档（本文件负责进度与缺口，它们负责「怎么用」与「怎么实现」）：
> [节点手册](./nodes.md)、[架构与实现总览](./architecture.md)、[使用说明](./usage.md)、[部署说明](./deploy.md)。

## 1. 里程碑

| 里程碑 | 状态 | 内容 | 证据 |
| --- | --- | --- | --- |
| M0 仓库骨架 | ✅ 完成 | pnpm 单仓、CI、设计令牌、应用外壳、反 slop / 浮层样式自检 | `docs/evidence/2026-08-28-m0-m5-delivery.md`（M0–M5 交付清单） |
| M1 工程与画布 | ✅ 完成 | 工程 CRUD、Vue Flow 画布、撤销重做、自动布局、导入导出 | 同上 |
| M2 来源节点 | ✅ 完成 | B 站链接解析、扫码登录、收藏夹/合集/稍后再看/历史多选、本地上传、文本输入 | `docs/evidence/2026-08-28-m2-acceptance.md` |
| M3 运行引擎 | ✅ 完成 | DAG 并发、SSE、节点状态、重跑/停止、B 站下载 + FFmpeg + ASR + AI 全链路 | `docs/evidence/2026-08-28-m3-acceptance.md` |
| M4 输出与运行记录 | ✅ 完成 | 提示词块库、运行日志弹窗、失败节点重跑、数据与工程清理 | `docs/evidence/2026-08-28-m4-acceptance.md` |
| M5 打磨发布 | ✅ 完成 | Element Plus 底座、响应式、a11y、Docker 部署与 CI | `docs/evidence/2026-08-28-m5-acceptance.md` |
| M6 基础件补全 | ✅ 完成 | 失败重试、条件分支 `flow.if`、文本工具 `process.text`、章节切分 `process.chapter` | 类型与端口见 `packages/shared/src/graph.ts`；决策记录见 [early-decisions.md](./decisions/early-decisions.md) |
| M8-1 AI 节点配方化 | ✅ 完成（阶段 A 试点） | Recipe 原语、断言门、步骤日志；跨阶段提前落地。阶段 B/C 未做 | `packages/shared/src/recipe.ts`；决策边界见 [early-decisions.md](./decisions/early-decisions.md) |
| M9 视频下载与结果页播放 | ✅ MVP（P0–P2 验收通过） | 内容寻址媒体库 + 引用、Range 流式、缺失重下、自研播放器 | `docs/evidence/2026-09-10-video-module-acceptance.md` |
| 知识巩固节点 `process.drill` | ✅ 完成（T1–T5） | 文字 → 知识点 + 题目 + 延伸，结果页答题 | `docs/plans/scribe-flow-m-drill.md` §10 |
| 结果页阅读体验 | ✅ 完成 | 多输入分段阅读、右侧分段大纲、tab 滑动墨条与语义化 | `docs/decisions/result-viewer-design.md`、`docs/research/segment-navigation-research.md` |
| 素材挑选 `flow.pick` | ✅ 完成 | 多素材链路只加工 / 放行其中几段；段标识穿过「一个输入一份结果」的中间模块，未选中的素材连同其下游一并跳过 | 契约见 `packages/shared/src/segment.ts`；决策记录见 [early-decisions.md](./decisions/early-decisions.md) |
| M7 运行体验与自动化 | ⏳ 未开工 | 节点级缓存/断点续跑、定时触发、结构化抽取、第三方导出、运行 diff、来源扩展 | `docs/plans/workflow-module-roadmap.md` §4 |
| M8 其余高级差异化 | ⏳ 未立项 | 子流程、多模型矩阵、人工确认、RAG、自然语言生成流程、webhook、MCP | `docs/plans/workflow-module-roadmap.md` §5 |

## 2. 关键数字

<!-- docs-gen:numbers:start -->
<!-- 由 `pnpm docs:gen` 生成，请勿手改；改动源码后重新生成即可 -->

| 指标 | 当前值 |
| --- | --- |
| 测试用例（`it(` 声明数） | **193**（shared 71 · server 108 · web 14） |
| UI 冒烟检查项（`pnpm smoke:ui`） | **50**（其中 3 项为恒真占位，净 47） |
| API 自检项 | m2 7 · m3 14 · m4 12 · m6 9 · drill 22 |
| 内置提示词块（`BUILTIN_PROMPT_BLOCKS`） | **13** |
| 文档数（`docs/` 下 `.md`，不含调研原文） | 43 |
<!-- docs-gen:numbers:end -->

## 3. 已知缺口

按优先级排列。每一条都在源码里可复现，修掉后请从本表删除并在 [CHANGELOG.md](../CHANGELOG.md) 记一笔。

### P0 · 安全（自托管场景下用户浏览任意网页即可被接管后端）

- **后端没有应用层认证，CORS 默认 `*`**：`apps/server/src/app.ts:31-37` 是唯一的全局中间件。组合 `PUT /api/settings`（改 `ai.baseUrl`）与 `POST /api/settings/test/ai`（会把已保存的真实 apiKey 发往该 baseUrl）即可外泄密钥。`apps/server/src/routes/settings.ts:84-92`、`apps/server/src/lib/ai.ts:25-30`。修法：加 `AUTH_TOKEN` 环境变量 + 校验 `Authorization` 的全局中间件，`CORS_ORIGIN` 默认收敛为前端源。
- **盲 SSRF**：`apps/server/src/routes/videos.ts:44-55` 对用户传入的任意 URL 直接 `fetch(redirect: "follow")`，无主机白名单、无内网地址拦截。修法：解析后校验 host，拒绝回环与私网段。
- **路径校验可绕过或缺失**：`apps/server/src/routes/media.ts:31-36` 用纯字符串前缀比较（Windows 下 `data-evil\` 能通过）；`apps/server/src/routes/runs.ts:312`、`:325` 完全无校验；`general.outputDir` 只剥尾部斜杠（`apps/server/src/lib/settings.ts:193`），配 `apps/server/src/lib/engine.ts:1501` 的 `join` 可写出数据目录之外。修法：统一改用 `path.relative` 判包含性，`outputDir` 拒绝 `..`。
- **用户可控正则可 DoS**：`apps/server/src/lib/engine.ts:377` 用节点数据里的 `pattern`/`flags` 直接 `new RegExp()`，灾难性回溯会挂死事件循环且 cancel 不响应。schema 里 `data` 是有按节点类型校验的（`schema.ts` 的 `nodeDataByType`），但文本工具的 `pattern` / `flags` 只有类型校验，缺长度上限与 flags 白名单，这才是可被利用的口子。修法：补 pattern 长度与 flags 白名单（并考虑在 `data` 上补通用的大小上限）。
- **错误信息泄漏**：`apps/server/src/app.ts` 的 `app.onError`（约 `:64-67`）把 `err.message` 原样回传，含服务器绝对路径与上游响应片段。
- **密钥明文入库且无法清除**：`apps/server/src/db/schema.ts:113-117`、`:44-51`；`apps/server/src/lib/settings.ts:168-171` 的 `if (!value) return` 使传空串无法清除已保存的密钥。

### P0 · 稳定性

- **未处理的 Promise rejection 会终结进程**：`apps/server/src/lib/engine.ts:501` 是 `void this.runLoop(active)` 且无 `.catch()`，而收尾的三次 `await this.finishRun(...)`（`:654`、`:659`、`:669`）在 try/catch 之外。收尾时 DB 写失败即进程退出，所有在跑的 run 一并丢失。
- **单个节点的基础设施错误会终止整个 run**：`apps/server/src/lib/engine.ts:635` 的 `Promise.race` 会把 `executeNode` 里 `persistInputs`（`:1155`，只有 `finally` 没有 `catch`）的 DB 错误升级成整运行失败（`:652-656`），绕过同文件 `:625-631` 的部分成功降级语义。`resolveInputs` 已在 `:1144-1154` 就地捕获并落节点失败状态。
- **坚果云请求无超时**：`apps/server/src/lib/nutstore.ts:120-159` 的 `davFetch` 没有 `signal`，服务端挂住即永久占用连接。对照 `lib/ai.ts`、`lib/media.ts`、`lib/bilibili.ts` 均有超时。
- **`forceStop` 会篡改已结束的运行**：`apps/server/src/lib/engine.ts:513` 只检查存在性，对 success/error 的 run 也照改 status。
- **SSE 建连竞态**：`apps/server/src/routes/runs.ts:180-231` 在快照与订阅之间 run 若结束，该连接永不 resolve。

### P1 · 工程化

- **CI 不跑冒烟与 API 自检**：`.github/workflows/ci.yml` 只做 typecheck / test / build / lint / `docker build`，`pnpm smoke:ui` 与 `pnpm check:api:*` 仍靠人手跑。代价已经显现过一次：`scripts/m4-api-check.mjs` 的内置块断言曾硬编码为 8，而源码已增到 13，于是长期静默失败——已改为从 `packages/shared/src/prompt.ts` 推导（见 [CHANGELOG.md](../CHANGELOG.md) 2026-09-11）。
- **前端组件、路由层、store 无测试**：`apps/web` 只有两个纯逻辑测试文件；`apps/server/src/routes/` 约 1800 行零测试；`engine.ts` 中 `source.bili`、`process.transcribe`、`process.refine`、`process.chapter`、`process.gameguide`、`process.mindmap`、`process.obsidian`、`process.text`、`flow.if` 被任何测试执行到的次数为零。仓库内不存在 `vitest.config.*`，未装 `@vue/test-utils` / `happy-dom`。
- **开发环境用 `localhost:5173` 时，每条新 TCP 连接要等约 205 ms**：`apps/server` 监听 `::`（双栈），`localhost` 解析到 `::1` 直连只要 0.98 ms；而 Vite 只监听 IPv4 `127.0.0.1`，客户端连 `localhost:5173` 时对 `::1` 的尝试要等约 205 ms 才回落到 `127.0.0.1`（`curl -w '%{time_connect}'` 实测 205 ms，与请求大小无关；连 `http://127.0.0.1:5173` 则 connect 5.3 ms、总耗时 19.7 ms）。Chrome 会自己缓存地址族、通常只在需要新建连接时才付这笔钱，curl 每次新进程都付。已排除的三种解释都是**上游那一跳**、与本题无关：代理目标换成 `127.0.0.1`、显式 keep-alive agent、socket `setNoDelay(true)`（三者都仍是 205 ms）。绕开办法是开发时用 `http://127.0.0.1:5173` 打开；**不要**因此把 Vite 改成监听所有网卡（`host: true`）——那会把无认证的开发服务暴露到局域网。文档阅读器已通过「把两次请求并成一次」绕开落在第二个请求上的那一次连接停顿（见 [CHANGELOG.md](../CHANGELOG.md) 2026-09-26）。
- **没有 ESLint / Prettier**：全仓无相关依赖与配置；`scripts/slop-lint.mjs:11` 的扫描范围不含 `apps/server/src`。缺的是能拦住真实缺陷的规则，最典型的是 `no-floating-promises`（`apps/server/src/lib/engine.ts:501` 那类未捕获的 Promise 本可被它拦住）与 `vue/no-unused-vars`。属**待决策事项**（不是禁止引入），动因见 [AGENTS.md](../AGENTS.md) 硬规则第 8 条。
- **死代码检测已引入 `knip`（固定在 5.x，不要升 6）**：配置见 [knip.jsonc](../knip.jsonc)，已接进 `pnpm lint`。它补的是自研门禁的盲区——原有 22 条规则没有发现 `apps/web/src/styles/explorer.css` 612 行从未被加载，knip 一条命令就找到了。**不要升级到 knip 6**：6.x 换用 oxc-parser 做解析，其 raw transfer 需要分配约 6 GiB 的单个 `ArrayBuffer`（`BLOCK_SIZE 2147483632 + BLOCK_ALIGN 4294967296`），超过 V8 的 ArrayBuffer 4 GiB 上限，本机实测 4/4 崩溃（`RangeError: Array buffer allocation failed`）；5.x 不依赖 oxc-parser，本机连跑 5 次全部成功。当前 knip 只把「未使用文件 / 依赖」设为 error，41 处未使用导出与类型仍是 warning，未清。
- **依赖方向约束已引入 `dependency-cruiser`**：配置见 [.dependency-cruiser.cjs](../.dependency-cruiser.cjs)，已接进 `pnpm lint`（四条规则：禁循环、`packages/shared` 不得反向依赖 `apps`、跨包禁深层 import、孤儿模块告警）。它靠根目录的 [tsconfig.depcruise.json](../tsconfig.depcruise.json) 拿到 `@/*` 别名的路径映射，**去掉这个文件会把 5 个在用的文件误报成孤儿**。首次运行即检出并修掉 `graph.ts` ↔ `segment.ts` 的一处类型循环依赖。
- **中文散文检查已引入 `Vale`（`pnpm check:prose`，刻意不进 `pnpm lint`）**：配置见 [.vale.ini](../.vale.ini)，规则在 `.vale/styles/ScribeFlow/`。**不进 lint 链的原因**：CI 里没有 vale 这个二进制，接进去会让 CI 直接红，与 `smoke:ui` / `check:api:*` 同属「需要额外环境的手动检查」。另需注意它**没启用内置英文风格包**——本仓文档是中文，`Vale.Spelling` 在 61 个文件上误报 675 条技术词拼写；现只有两条自定义正则规则（破折号密度棘轮、套话连接词），两者当前全仓 0 命中，属预防性护栏而非在修问题。Vale 抓不到「文档结构膨胀」（标题/表格/仪式化小节过多），那类只能靠人判断。
- **`apps/server` 没有真实构建产物**：`apps/server/package.json` 的 `build` 是 `tsc --noEmit`，`Dockerfile` 用 devDependency `tsx` 转译源码跑生产；单阶段、root 运行、无 `HEALTHCHECK`。
- **没有数据库迁移机制**：无 `drizzle.config.ts`、无 `drizzle-kit`，`apps/server/src/db/client.ts:178-262` 靠手写幂等补列，只能加列。
- **缺索引**：`runs(project_id)`、`runs(status)`、`run_node_results(run_id)`、`run_node_logs(run_id)`、`run_node_inputs(run_id)` 均缺失，而 `apps/server/src/routes/runs.ts:269`、`:288` 是先全量取再在 JS 里过滤。
- **前端首屏关键路径偏大（根因已定位，未修）**：`apps/web/src/main.ts:18` 的全量 import 是一条原因，但更主要的是 `apps/web/vite.config.ts` 的 `manualChunks` 给 element-plus 强制分块，实测**破坏了 tree-shaking**——受控实验（同一组 18 个组件、同样 external、同样压缩设置，只改这一个变量）下该产物体积膨胀到 **2.6 倍**，且产物里混进 19 个从未 import 的组件（carousel / tabs / tree / form / pagination 等）。项目级首屏 gzip 体积在 R9 口径下可降约 **37%**（只去掉该分块）或 **52%**（完全去掉 `manualChunks`）；原配置距 R9 失败线只剩约 **7%** 的余量。**未修的原因**：去掉分块会让缓存粒度变粗（改业务代码连带重下组件库），是个取舍。另外两个尚未处理的按需 chunk：点一次「自动布局」会下载 `elkjs` 全量包，其体积超过首屏关键路径的七成，而项目只用 layered 一种算法（可评估 `elkjs-native` / `d3-dag`，**未做 spike**）；Element Plus 样式改按需引入可省约 **52%** 的样式体积，但需先验证 `element-theme.css` 的桥接是否仍生效。原始字节数、实验口径与复现命令见 [sharing/README.md](../sharing/README.md)（体积数字按 R7 规定不写进本文件）。

### P2 · 清理

- ~~第二真相源~~（**已处理**）：原先放在仓库根的两份提示词模板已移入 `docs/decisions/`，并标注提示词正文以 `packages/shared/src/prompt.ts` 为准。
- ~~游离脚本~~（**已处理**）：`apps/server/dbcheck.mjs`、`media-smoke.mjs`、`video-poc.mjs` 原先未被任何 `package.json` script 引用，现已在 `apps/server/package.json` 分别接入为 `db:check` / `smoke:media` / `poc:video`；`knip.jsonc` 把 `*.mjs` 纳入 `apps/server` 的分析范围，它们再漂成死文件会有信号。
- **未做**：深色模式启用、Playwright 化冒烟、坚果云超时后的告警、`docs/research/raw` 的体积治理。
- **配方化阶段 B/C 未做**：步骤级断点续跑与缓存依赖 M7 的缓存指纹（`packages/shared/src/recipe.ts` 已留位）。
- **配方改版的 A/B 盲评闸门未执行**：v4 与知识巩固直接转正；做法值得保留，但没有留下评测集产物。

## 4. 文档地图

<!-- docs-gen:map:start -->
<!-- 由 `pnpm docs:gen` 生成，请勿手改 -->

**现状**（`docs/`）

- [架构与实现总览](./architecture.md)
- [ScribeFlow 部署说明](./deploy.md)
- [节点手册](./nodes.md)
- [使用说明：从零到一份笔记](./usage.md)

**决策（方案 / 选型 / 架构）**（`docs/decisions/`）

- [ScribeFlow Obsidian 笔记 AI 打标签设计](./decisions/ai-tagging-design.md)
- [CASCADE：概念演进型科普视频摘要模板](./decisions/cascade-video-summary-template.md)
- [M0–M5 关键决策记录（含用户反馈修正）](./decisions/early-decisions.md)
- [历史认知轻量笔记：AI 加工模板](./decisions/history-cognition-template.md)
- [ScribeFlow 观点提炼 v4：期刊式轻排版版](./decisions/insight-v4-note-layout.md)
- [知识巩固节点方案（`process.drill`「练一练」）](./decisions/knowledge-consolidation-module.md)
- [坚果云同步模块（设置页）](./decisions/nutstore-sync.md)
- [阴阳师攻略视频文稿 AI 加工模块](./decisions/onmyoji-guide-processing.md)
- [运行结果展示页设计方案](./decisions/result-viewer-design.md)
- [ScribeFlow 方案（v3）：笔记处理画布流](./decisions/scribe-flow-proposal.md)
- [shadcn-vue 官方使用规则（历史，不再执行）](./decisions/shadcn-vue-rules.md)
- [信息溯源模块优化方案（结构化核对版 + 报告阅读器）](./decisions/trace-report-design.md)
- [UI 样式框架选型与组件实现调研（代码级，历史，已被 Element Plus 路线取代）](./decisions/ui-framework-selection.md)
- [UI 组件库替换调研（成熟库路线）](./decisions/ui-library-replacement-research.md)
- [工作流运行态恢复方案（离开页面后重新进入）](./decisions/workflow-run-resume.md)

**计划（实施清单 / 路线图）**（`docs/plans/`）

- [ScribeFlow 实施清单：知识巩固节点 `process.drill`（练一练）](./plans/scribe-flow-m-drill.md)
- [ScribeFlow 功能工作流模块拓展路线图（R5 定稿）](./plans/workflow-module-roadmap.md)

**证据（验收档案，冻结快照）**（`docs/evidence/`）

- [M0–M5 交付清单与验证记录（冻结快照）](./evidence/2026-08-28-m0-m5-delivery.md)
- [M2 验收标准（分层）](./evidence/2026-08-28-m2-acceptance.md)
- [M3 验收标准（分层）](./evidence/2026-08-28-m3-acceptance.md)
- [M4 验收标准（分层）](./evidence/2026-08-28-m4-acceptance.md)
- [M5 验收标准（分层）](./evidence/2026-08-28-m5-acceptance.md)
- [视频模块（下载与结果页播放）验收（分层）](./evidence/2026-09-10-video-module-acceptance.md)

**调研**（`docs/research/`）

- [AI 加工节点内部多步链：收益调研与进阶实现方案](./research/ai-node-multistep-research.md)
- [画布性能优化（200 节点实测）](./research/canvas-performance-optimization.md)
- [开发记录（已拆分，此为存根）](./research/development-log.md)
- [节点结果预览展示调研与方案](./research/node-result-preview-research.md)
- [全项目审计（2026-09-27）](./research/project-audit-2026-09-27.md)
- [R1 桌面研究报告：市场工作流产品功能地图 v1](./research/r1-desktop-research.md)
- [仓库可读性与过度工程：外部证据与本仓处置建议](./research/repo-legibility-and-over-engineering.md)
- [多视频结果的分组切换：导航模式调研与改造方案](./research/segment-navigation-research.md)
- [结果页 tab 切换：标准依据与实测对照](./research/tab-interaction-research.md)
- [视频模块 P0 真实视频验证记录](./research/video-module-poc.md)
- [ScribeFlow 视频下载与结果页播放 —— 调研与设计](./research/video-module-research.md)
- [ScribeFlow 功能工作流模块拓展 — 调研方案](./research/workflow-module-expansion-research.md)

**样例**（`docs/samples/`）

- [观点提炼：AI 翻译为何翻不好“口语”？](./samples/insight-v2-layout-sample.md)
- [演示稿：《AI 翻译为何翻不好口语？》](./samples/insight-v4-demo-transcript.md)
- [观点提炼：AI 翻译为何翻不好“口语”？](./samples/insight-v4-layout-sample.md)
<!-- docs-gen:map:end -->
