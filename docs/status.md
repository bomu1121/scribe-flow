---
title: 项目现状
class: status
owner: 念前
last_reviewed: 2026-09-29
review_days: 30
---

# 项目现状

> **这是 ScribeFlow 唯一的现状权威来源。**
> 「现在完成到哪、有多少用例、还剩什么没做」一律以本文件与它引用的生成块为准。
> `docs/` 下的方案、实施清单与验收档案都是**历史快照，不代表现状**——尤其 `docs/evidence/*-acceptance.md` 里的数字只对冻结当天成立。
> 文档分类与维护规则见 [AGENTS.md 的文档规则](../AGENTS.md)。

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
| 知识巩固节点 `process.drill` | ✅ 完成（T1–T5） | 文字 → 知识点 + 题目 + 延伸，结果页答题。配置了「联网检索」渠道时，出题前还会按知识点上网找同类练习题作参考（答案与原文依据仍只认原文，参考链接只有本次真检索到的才留在产物里） | 实现清单 `docs/plans/scribe-flow-m-drill.md` §10；联网出题见 [drill-web-search.md](./decisions/drill-web-search.md) |
| 结果页阅读体验 | ✅ 完成 | 多输入分段阅读、右侧分段大纲、tab 滑动墨条与语义化；切换运行不销毁屏上内容（压暗旧内容、就绪后一次性替换），并按运行记住各自的阅读位置 | `docs/decisions/result-viewer-design.md`、`docs/research/segment-navigation-research.md` |
| 素材挑选 `flow.pick` | ✅ 完成 | 多素材链路只加工 / 放行其中几段；段标识穿过「一个输入一份结果」的中间模块，未选中的素材连同其下游一并跳过 | 契约见 `packages/shared/src/segment.ts`；决策记录见 [early-decisions.md](./decisions/early-decisions.md) |
| 内置链路（工作流模板） | ✅ 完成（2026-09-29 重组） | 9 条链路：单线笔记、多路对照、思维导图、Obsidian 笔记、分章笔记、系列综述、选段加工（通用）+ 阴阳师攻略、练一练（垂直）。**链路只描述加工路径，来源在新建时选**（B站链接 / 本地文件 / 粘贴文稿），构建时按来源补齐来源节点与转写节点；同一链路三种来源都能用，不再有「视频版 / 文稿版」成对铺开 | 清单与构建器 `packages/shared/src/templates.ts`；取舍理由与旧→新对照见 [template-set-and-source-axis.md](./decisions/template-set-and-source-axis.md)，本机使用数据见 [template-set-research.md](./research/template-set-research.md) |
| 结果页「对照」视图 | ✅ 完成 | 本次运行有两份以上可比产物时出现（并行分支的链路一定会有）：左右各选一份，三层呈现——① **AI 差异分析**（点一次按钮跑：一句话结论 / 只有左边讲到 / 只有右边讲到 / 两边说法不一致 / 两边都讲到 / 各自更适合什么场景，可复制为 Markdown、可重新分析）；② **指标对比**（字数/行数/段落/标题/列表项/表格行/引用/代码块 + 差值）；③ **逐行差异**（默认收起，删增行数与重合率写在标题上）。默认比链路上最深的一组并行分支，多素材按段展开取同素材的两套加工。判读走 `POST /api/compare`，**按内容指纹缓存**（同一对内容再打开不重复调模型），单侧超 1.6 万字只送头尾并在页面写明；机械统计部分不花钱、可复现 | 判读结构与解析在 `packages/shared/src/compare.ts`，提示词与调用在 `apps/server/src/lib/compareReport.ts`，路由与缓存在 `apps/server/src/routes/compare.ts`（表 `compare_reports`），视图 `apps/web/src/components/CompareView.vue`，配对 `apps/web/src/utils/run-compare.ts`；取舍与边界见 [run-compare-view.md](./decisions/run-compare-view.md) |
| 展示范围（哪些节点放出来） | ✅ 完成 | 设置页新增「展示范围」：逐项开关决定哪些节点不出现在界面里（节点面板、新建工程与快捷新建的链路列表、提示词块库一起收起）。**只影响新建时的可选项**：已有工程里的节点照常显示与运行。链路与提示词块跟着各自的节点联动隐藏（含来源轴补出来的来源/转写节点）。规则集中在 shared 的 `visibility.ts`，非法类型接口层 400、坏数据回落空数组 | 规则 `packages/shared/src/visibility.ts`，设置读写 `apps/server/src/lib/settings.ts`，界面 `apps/web/src/views/SettingsView.vue`；取舍与边界见 [visibility-scope.md](./decisions/visibility-scope.md) |
| 运行记录默认名 | ✅ 完成 | 每条运行落库时带默认名「第 N 次运行」（N 按工程内创建顺序；从某节点重跑时带「· 重跑「节点名」」），用户可改名覆盖，手动清空则只剩时间。编号不因删除而重排；历史记录（name 为空）在打开库时一次性回填，回填标记存 `app_settings`，因此清空过的名字不会被重新命名。顺带修掉「改过名字的运行在结果页刷新后退回『运行结果』」（`engine.detail()` 漏了 `name`） | 命名规则 `apps/server/src/lib/run-name.ts`，回填在 `apps/server/src/db/client.ts` 的 `backfillRunNames`，验收 `apps/server/src/routes/runs.name.test.ts` |
| 快捷新建「粘贴链接建工程」 | ✅ 完成 | 粘一条 B 站链接（或 App 分享文案）即建好工程：工程名=视频标题、来源节点连链接与封面/UP 主/分 P 一起写好、AI 加工预绑提示词块、输出文件名同标题；链路与提示词块记住上次选择，回车即建 | 实例化逻辑 `packages/shared/src/templates.ts`；对话框 `apps/web/src/components/workspace/QuickCreateDialog.vue` |
| 信息溯源 | ✅ 完成 | 三步骤配方产出结构化证据清单 + 结果页溯源阅读器；外部联网核查的检索渠道可切换（智谱 BigModel / Tavily，模版用 `externalCheck` 声明），检索结果按来源权威度分档重排并给出「外部可印证 / 仅非权威来源 / 有反证 / 未找到出处」，设置页可「测试连接」自检。检索渠道是**共用**的（设置页「联网检索」，与练一练同一份配置） | 联网核查方案见 [trace-external-authority.md](./decisions/trace-external-authority.md)，报告与阅读器见 [trace-report-design.md](./decisions/trace-report-design.md)，渠道共用见 [drill-web-search.md](./decisions/drill-web-search.md)；渠道适配层在 `apps/server/src/lib/traceExternal.ts`，权威度分档在 `apps/server/src/lib/sourceAuthority.ts` |
| 数据与工程：本地数据账本 | ✅ 完成 | 设置页「数据与工程」从三个只读格子改成账本：数据目录按六个分区（数据库 / 媒体库 / 上传原件 / 运行中间产物 / 输出文件 / 工程图备份）分别给出文件数与体积、合计占用与按工程的占用排行，以及五类可回收空间（已结束运行 / 孤立媒体资产 / 孤立上传原件 / 盘上孤立文件与目录 / 可回收的工程图备份）——每类都带「多少项、能释放多少字节、按什么规则判定」，可逐项或一键清理，并可在系统文件管理器打开数据目录 | 方案与取舍见 [data-ledger-and-cleanup.md](./decisions/data-ledger-and-cleanup.md)；判定与执行同源在 `apps/server/src/lib/storage.ts`，路由级验收在 `apps/server/src/routes/settings.test.ts` |
| 设置页「常规」：运行与产出的默认策略 | ✅ 完成 | 「常规」从「并发数 + 输出目录」两个孤立输入框扩成三块：**运行**（并发 / 失败自动重试次数 / 重试等待）、**产出**（输出目录支持绝对路径并回显服务端解析后的真实落点，带「打开输出目录」按钮；新的文件名模板 `{project}`/`{date}`/`{time}`/`{node}`）、**运行结束提醒**（系统通知 / 提示音，运行成功与失败时提醒，自己点的停止不提醒）。重试是**节点级优先、全局兜底**；产物目录落在数据目录之外时账本会标注，且相对路径 `..` 外爬被路由显式拒绝。顺带把 `general.outputDir` 的解析在三处落盘与两处读回上统一收口（原 P0「路径校验」的一条），库内路径改为「数据目录内记相对、之外记绝对」，老数据无需迁移 | 方案与取舍见 [general-settings.md](./decisions/general-settings.md)；解析唯一收口点在 `apps/server/src/lib/storage.ts`，落盘与模板渲染验收在 `apps/server/src/lib/engine.general.test.ts`，路由级验收在 `apps/server/src/routes/settings.test.ts` |
| M7 运行体验与自动化 | ⏳ 未开工 | 节点级缓存/断点续跑、定时触发、结构化抽取、第三方导出、运行 diff、来源扩展 | `docs/plans/workflow-module-roadmap.md` §4 |
| M8 其余高级差异化 | ⏳ 未立项 | 子流程、多模型矩阵、人工确认、RAG、自然语言生成流程、webhook、MCP | `docs/plans/workflow-module-roadmap.md` §5 |

## 2. 关键数字

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

## 3. 已知缺口

按优先级排列。每一条都在源码里可复现，修掉后请从本表删除并在 [CHANGELOG.md](../CHANGELOG.md) 记一笔。

### P0 · 安全（自托管场景下用户浏览任意网页即可被接管后端）

- **后端没有应用层认证，CORS 默认 `*`**：`apps/server/src/app.ts:35-41` 是唯一的全局中间件。组合 `PUT /api/settings`（改 `ai.baseUrl`）与 `POST /api/settings/test/ai`（会把已保存的真实 apiKey 发往该 baseUrl）即可外泄密钥。`apps/server/src/routes/settings.ts:110-118`、`apps/server/src/lib/ai.ts:25-30`。修法：加 `AUTH_TOKEN` 环境变量 + 校验 `Authorization` 的全局中间件，`CORS_ORIGIN` 默认收敛为前端源。
- **盲 SSRF**：`apps/server/src/routes/videos.ts:43-54` 对用户传入的任意 URL 直接 `fetch(redirect: "follow")`，无主机白名单、无内网地址拦截。修法：解析后校验 host，拒绝回环与私网段。
- **路径校验可绕过或缺失**：`apps/server/src/routes/media.ts:31-36` 用纯字符串前缀比较（Windows 下 `data-evil\` 能通过）。**`general.outputDir` 这一条已完全收口**（2026-09-28）：`apps/server/src/lib/storage.ts` 的 `resolveOutputRoot` 成为唯一解析点，落盘（`apps/server/src/lib/engine.ts` 的运行收尾与 `process.output`）、删除运行、账本扫描与读写路径全部走它，相对路径 `..` 外爬一律回落默认目录，设置接口还会显式返回 400 并说明该怎么改；产物在数据目录外时库内记绝对路径，读回走 `resolveArtifactPath`。剩余仍未处理：`routes/media.ts` 的前缀比较、`routes/runs.ts` 两处读盘未做包含性校验（这两处的值来自本服务自己的写入，不是外部输入）。
- **用户可控正则可 DoS**：`apps/server/src/lib/engine.ts:387` 用节点数据里的 `pattern`/`flags` 直接 `new RegExp()`，灾难性回溯会挂死事件循环且 cancel 不响应。根因是 `packages/shared/src/schema.ts` 的 `graphNodeSchema.data` 没有字段级校验。修法：补 `data` 的按节点类型判别校验 + pattern 长度与 flags 白名单。
- **错误信息泄漏**：`apps/server/src/app.ts` 的 `app.onError`（约 `:66-69`）把 `err.message` 原样回传，含服务器绝对路径与上游响应片段。
- **密钥明文入库且无法清除**：`apps/server/src/db/schema.ts:120-124`、`:44-51`；`apps/server/src/lib/settings.ts:212-215` 的 `if (!value) return` 使传空串无法清除已保存的密钥。

### P0 · 稳定性

- **未处理的 Promise rejection 会终结进程**：`apps/server/src/lib/engine.ts:511` 是 `void this.runLoop(active)` 且无 `.catch()`，而收尾的三次 `await this.finishRun(...)`（`:664`、`:669`、`:679`）在 try/catch 之外。收尾时 DB 写失败即进程退出，所有在跑的 run 一并丢失。
- **单个节点的基础设施错误会终止整个 run**：`apps/server/src/lib/engine.ts:645` 的 `Promise.race` 会把 `executeNode` 里 `persistInputs`（`:1161`，只有 `finally` 没有 `catch`）的 DB 错误升级成整运行失败（`:662-666`），绕过同文件 `:635-641` 的部分成功降级语义。`resolveInputs` 已在 `:1150-1160` 就地捕获并落节点失败状态。
- **坚果云请求无超时**：`apps/server/src/lib/nutstore.ts:118-157` 的 `davFetch` 没有 `signal`，服务端挂住即永久占用连接。对照 `lib/ai.ts`、`lib/media.ts`、`lib/bilibili.ts` 均有超时。
- **`forceStop` 会篡改已结束的运行**：`apps/server/src/lib/engine.ts:523` 只检查存在性，对 success/error 的 run 也照改 status。
- **SSE 建连竞态**：`apps/server/src/routes/runs.ts:176-227` 在快照与订阅之间 run 若结束，该连接永不 resolve。

### P1 · 工程化

- **CI 不跑冒烟与 API 自检**：`.github/workflows/ci.yml` 只做 typecheck / test / build / lint / `docker build`，`pnpm smoke:ui` 与 `pnpm check:api:*` 仍靠人手跑。代价已经显现过一次：`scripts/m4-api-check.mjs` 的内置块断言曾硬编码为 8，而源码已增到 13，于是长期静默失败——已改为从 `packages/shared/src/prompt.ts` 推导（见 [CHANGELOG.md](../CHANGELOG.md) 2026-09-11）。
- **前端组件、路由层、store 无测试**：`apps/web` 只有两个纯逻辑测试文件；`apps/server/src/routes/` 约 1800 行零测试；`engine.ts` 中 `source.bili`、`process.transcribe`、`process.refine`、`process.chapter`、`process.gameguide`、`process.mindmap`、`process.obsidian`、`process.text`、`flow.if` 被任何测试执行到的次数为零。仓库内不存在 `vitest.config.*`，未装 `@vue/test-utils` / `happy-dom`。
- **没有 ESLint / Prettier**：全仓无相关依赖与配置；`scripts/slop-lint.mjs:11` 的扫描范围不含 `apps/server/src`。缺的是能拦住真实缺陷的规则，最典型的是 `no-floating-promises`（`apps/server/src/lib/engine.ts:511` 那类未捕获的 Promise 本可被它拦住）与 `vue/no-unused-vars`。属**待决策事项**（不是禁止引入），动因见 [AGENTS.md](../AGENTS.md) 硬规则第 8 条。
- **`apps/server` 没有真实构建产物**：`apps/server/package.json` 的 `build` 是 `tsc --noEmit`，`Dockerfile` 用 devDependency `tsx` 转译源码跑生产；单阶段、root 运行、无 `HEALTHCHECK`。
- **没有数据库迁移机制**：无 `drizzle.config.ts`、无 `drizzle-kit`，`apps/server/src/db/client.ts:246-334` 靠手写幂等补列，只能加列。
- **缺索引**：`runs(project_id)`、`runs(status)`、`run_node_results(run_id)`、`run_node_logs(run_id)`、`run_node_inputs(run_id)` 均缺失，而 `apps/server/src/routes/runs.ts:281`、`:300` 是先全量取再在 JS 里过滤。
- **前端首屏关键路径偏大**：以 Element Plus 全量 import 为主因（`apps/web/src/main.ts:18`）；`pnpm docs:lint` 的 R9 已加上体积预算断言防止继续恶化，根治办法是改按需引入。
- **本机 `pnpm dev`（`pnpm --parallel`）起不动后端**：实测（中文 Windows + pnpm 11.7 + Node 22）`pnpm --parallel` 下 `apps/server` 的 `tsx watch` 子进程会静默卡在启动前——既不打印「后端已启动」，也不监听 8787；而同一个脚本用 `pnpm --filter @scribe-flow/server dev` 单独跑就正常（web 侧亦然）。所以根目录 `start-dev.cmd` 与 `scripts/start-dev.mjs` 是**分别**拉起两个包来绕开并行器的，root 的 `dev` 脚本尚未改动，`pnpm dev` 在本机仍不可用。是否改 root 脚本待定：换台机器或换个 pnpm 版本可能不复现，要先定位根因。

### P1 · 功能与文档不一致

2026-09-29 的清理里发现两条**代码与文档对不上**的事实。它们不是清理项（删设置 UI 或补接线都是产品决定），
所以只登记在这里等定夺；两条都在源码与 git 历史里可复核。

- **Obsidian「AI 打标签」从未接线，决策文档却标为「已实施」。** 设置页有「自动打标 / 标签体系 /
  标签数下限 / 上限」四个控件，引擎里 `buildObsidianTags`（基础标签规则 + 受控词表 + AI 补全）也完整存在，
  但**它没有任何调用点**；`git log -S "buildObsidianTags"` 显示自功能提交 `7ff6ff9`（2026-09-03）
  起该符号就只有定义处一处，**从未被调用过**。今天真正写进 frontmatter 的标签只来自节点自己的 `data.tags`
  （`apps/server/src/lib/engine.ts` 的 `process.obsidian` 段）。
  后果：`obsidian.tagTaxonomy` / `tagMinCount` / `tagMaxCount` 改了没有任何效果——它们的唯一读取点就在这个死函数里。
  两条出路：把 `buildObsidianTags` 接进 `process.obsidian`（会改变笔记产出的标签，并带来真实的 AI 调用与花费），
  或把这三个设置项连同死函数一起删掉。
  **注意别把 `autoTagEnabled` 一起当成摆设**：它是活的，控制的是人物/事件/时期提取。
- **`obsidian.autoLinkBidirectional` 全仓 0 个读取点。** 设置页有开关、库里有键、接口有 schema 校验，
  但引擎的自动关联段只读 `autoLinkEnabled` 与 `autoLinkMax`。要么实现「双向链接回填」，要么把这个开关删掉。

### P2 · 清理

- ~~第二真相源~~（**已处理**）：原先放在仓库根的两份提示词模板已移入 `docs/decisions/`，并标注提示词正文以 `packages/shared/src/prompt.ts` 为准。
- **游离脚本**：`apps/server/dbcheck.mjs`、`apps/server/media-smoke.mjs`、`apps/server/video-poc.mjs` 未被任何 `package.json` script 引用；后两个仍被 `docs/evidence/2026-09-10-video-module-acceptance.md` 与 `docs/research/video-module-poc.md` 当作开发期工具引用，`dbcheck.mjs` 无任何引用。
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
- [数据账本与本地数据清理（设置页「数据与工程」）](./decisions/data-ledger-and-cleanup.md)
- [练一练联网找同类题（联网检索渠道去专有化 + 配方步骤级检索）](./decisions/drill-web-search.md)
- [M0–M5 关键决策记录（含用户反馈修正）](./decisions/early-decisions.md)
- [「常规」设置分组：运行与产出的默认策略](./decisions/general-settings.md)
- [历史认知轻量笔记：AI 加工模板](./decisions/history-cognition-template.md)
- [ScribeFlow 观点提炼 v4：期刊式轻排版版](./decisions/insight-v4-note-layout.md)
- [知识巩固节点方案（`process.drill`「练一练」）](./decisions/knowledge-consolidation-module.md)
- [坚果云同步模块（设置页）](./decisions/nutstore-sync.md)
- [阴阳师攻略视频文稿 AI 加工模块](./decisions/onmyoji-guide-processing.md)
- [运行结果展示页设计方案](./decisions/result-viewer-design.md)
- [对照视图：差异在结果页看，不在链路里拼](./decisions/run-compare-view.md)
- [ScribeFlow 方案（v3）：笔记处理画布流](./decisions/scribe-flow-proposal.md)
- [shadcn-vue 官方使用规则（历史，不再执行）](./decisions/shadcn-vue-rules.md)
- [内置链路：改成「加工路径 × 来源」](./decisions/template-set-and-source-axis.md)
- [信息溯源联网核查：来源权威度分级与 v3 模版](./decisions/trace-external-authority.md)
- [信息溯源模块优化方案（结构化核对版 + 报告阅读器）](./decisions/trace-report-design.md)
- [UI 样式框架选型与组件实现调研（代码级，历史，已被 Element Plus 路线取代）](./decisions/ui-framework-selection.md)
- [UI 组件库替换调研（成熟库路线）](./decisions/ui-library-replacement-research.md)
- [展示范围：收起的入口，不是关掉的能力](./decisions/visibility-scope.md)
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
- [开发记录（已拆分，此为存根）](./research/development-log.md)
- [节点结果预览展示调研与方案](./research/node-result-preview-research.md)
- [新功能该加一张卡片，还是加一个提示词](./research/node-vs-prompt-block-boundary.md)
- [全项目审计（2026-09-27）](./research/project-audit-2026-09-27.md)
- [R1 桌面研究报告：市场工作流产品功能地图 v1](./research/r1-desktop-research.md)
- [仓库可读性与过度工程：外部证据与本仓处置建议](./research/repo-legibility-and-over-engineering.md)
- [多视频结果的分组切换：导航模式调研与改造方案](./research/segment-navigation-research.md)
- [结果页 tab 切换：标准依据与实测对照](./research/tab-interaction-research.md)
- [内置链路（模板）调研](./research/template-set-research.md)
- [视频模块 P0 真实视频验证记录](./research/video-module-poc.md)
- [ScribeFlow 视频下载与结果页播放 —— 调研与设计](./research/video-module-research.md)
- [ScribeFlow 功能工作流模块拓展 — 调研方案](./research/workflow-module-expansion-research.md)

**样例**（`docs/samples/`）

- [观点提炼：AI 翻译为何翻不好“口语”？](./samples/insight-v2-layout-sample.md)
- [演示稿：《AI 翻译为何翻不好口语？》](./samples/insight-v4-demo-transcript.md)
- [观点提炼：AI 翻译为何翻不好“口语”？](./samples/insight-v4-layout-sample.md)
<!-- docs-gen:map:end -->
