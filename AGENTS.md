# AGENTS.md

给在本仓库工作的 AI agent（以及人）的项目说明。**本文件只放不随时间变化的信息**——
进度、用例数、包体积这类会变的事实一律去 [docs/status.md](./docs/status.md)，不要在这里写，也不要凭记忆回答。

## 项目是什么

ScribeFlow：笔记处理画布流。把 B 站视频、本地音视频或已有文稿放进画布，用节点编排
「转写 → AI 校对 → 观点提炼 / 技术拆解 / 自定义提示词 → 合并 → 输出」，运行后得到一份
可读、可改、可导出的 Markdown 笔记。编排保存为工作流工程，运行记录随工程归档。

## 命令

```bash
pnpm dev            # 同时起前后端（web :5173，server :8787）
pnpm typecheck      # 全仓类型检查
pnpm test           # vitest（shared / server / web 三个包）
pnpm build          # 前端真实构建；server 的 build 只是 tsc --noEmit
pnpm lint           # lint:slop + lint:ui + docs:lint
pnpm docs:gen       # 重新生成 README / docs/status.md 的生成块（改源码后必跑）
pnpm docs:lint      # 文档门禁；--strict 时新鲜度也失败
pnpm docs:freeze    # 显式重新冻结验收档案（docs/m*-acceptance.md）的内容指纹
pnpm smoke:ui       # CDP + 真实 Chrome 冒烟（需先 pnpm dev）
pnpm check:api:m2|m3|m4|m6|drill   # 分层 API 自检（需先 pnpm dev）
```

改动源码后**必须**跑：`pnpm typecheck && pnpm test && pnpm lint`。动了用例数、冒烟项数或内置
提示词块，还要跑 `pnpm docs:gen` 并一并提交，否则 CI 的 `docs:lint` 会红。

## 目录

```
apps/web/          Vue 3 + Vite + Pinia + Element Plus + Vue Flow
apps/server/       Hono + Drizzle ORM + SQLite（node:22，tsx 直接跑 TS）
packages/shared/   类型、Zod 图模型、内置提示词块与配方、工程模板
docs/              见下方「文档规则」；目录与文档 class 一一对应
scripts/           自研门禁：slop-lint / ui-lint / docs-gen / docs-lint / docs-freeze / cdp-ui-smoke / *-api-check
                   scripts/lib/docs-shared.mjs 是文档三脚本的共享工具，语义只在那里定义一份
```

`docs/` 按**生命周期**分目录，目录名就是分类信号：

```
docs/status.md      现状（唯一权威来源）
docs/deploy.md      现状（部署）
docs/decisions/     决策：方案 / 选型 / 架构
docs/plans/         计划：实施清单 / 路线图
docs/evidence/      证据：验收档案，文件名带冻结日期
docs/research/      调研（research/raw/ 是抓取原文存档，豁免 front matter）
docs/samples/       样例稿（豁免 front matter）
```

几个经常要动的地方：

- `packages/shared/src/graph.ts` —— 节点类型联合与 `NODE_TYPE_LABELS`，新增节点必改。
- `packages/shared/src/schema.ts` —— Zod 图模型校验（注意：`data` 目前没有字段级校验）。
- `packages/shared/src/prompt.ts` —— 内置提示词块与配方（`BUILTIN_PROMPT_BLOCKS`）。
- `apps/server/src/lib/engine.ts` —— 运行引擎，单文件很大，`runNode` 是一个巨型 switch。
- `apps/web/src/styles/tokens.css` —— 颜色令牌的唯一来源。

## 硬规则

1. **UI 文案一律简体中文**，源文件 UTF-8。
2. **颜色只能用 `apps/web/src/styles/tokens.css` 的令牌**。Element Plus 通过
   `styles/element-theme.css` 的 `--el-*` 桥接同一套令牌。页面里**禁止散写 hex / rgb / hsl**，
   `pnpm lint:ui` 会拦。z-index 走令牌，不写裸数字。
3. **通用组件不自研**：按钮/输入框/下拉框/对话框/消息/上传/表格一律 Element Plus。
4. **画布交互不自研**：底层 Vue Flow，交互照搬 n8n。
5. **许可证红线**：只复用 MIT / Apache-2.0 代码；n8n、Dify 等只复刻交互行为，不复制代码。
6. **多输入不静默丢弃**：转写节点多个音频逐个转写后以空行合并；AI/合并节点多个文本按连接顺序
   以空行合并。
7. **运行态不写进工程图**：`status / summary / preview` 只存在内存与运行记录里，工程图只保存
   工作流定义。
8. **门禁优先加在自研脚本里**：本仓库的检查是 `scripts/*.mjs`，要加规则就往里加，
   不要为了让检查"更正规"而顺手引入新的工具链。
   **但这不等于禁止引入**：ESLint / Prettier / Playwright 等属于**待决策事项**，
   动因与现状记在 [status.md](./docs/status.md) 的已知缺口里（缺 `no-floating-promises` 这类规则、
   冒烟仍是自研 CDP 脚本）。要引入先在那个清单上讨论并更新它，不要在顺手改别的功能时夹带。

## 文档规则（重要）

本仓库的文档按**生命周期**分四类，混用是历史上所有文档事故的根源。每份文档的 front matter
声明自己的类：

```yaml
---
title: 文档标题
class: status | decision | plan | evidence | research
status: proposed | accepted | superseded | deprecated | done   # decision / plan 需要
owner: 念前
last_reviewed: YYYY-MM-DD        # status / decision / plan / research 需要；改动该文档时同步改成当天
review_days: 30                  # 可选，覆盖 class 的默认复核阈值
frozen_at: YYYY-MM-DD            # evidence 需要：验收实际发生的日期
content_hash: <16 位十六进制>     # evidence 需要：正文指纹，由 pnpm docs:freeze 写入，不要手改
supersedes: <仓库相对路径>            # 可选，形如 docs 斜杠分类斜杠文档.md
superseded_by: <仓库相对路径>         # 可选，必须与对方双向对应
---
```

`supersedes` / `superseded_by` 写**仓库相对路径**（以 `docs/` 开头），不要写成「相对 docs/」或
「相对本文件」——目录重排时这两种写法会产生歧义。

`docs/samples/` 与 `docs/research/raw/` 是产物存档（样例稿、抓取原文），不需要 front matter，
但仍要能被 `status.md` 的文档地图覆盖、不做死链。

| 类 | 是什么 | 铁律 |
| --- | --- | --- |
| `status` | 现状 | 只有 `docs/status.md` 与 `docs/deploy.md`。必须反映今天；数字只能来自 `docs-gen` 生成块 |
| `decision` | 一次拍板的方案/选型/架构 | 日期不可变。**永不删除**；要改就写新文档并双向 supersede |
| `plan` | 实施清单、路线图 | 落地时把 `status` 改成 `done`，并补一份 `evidence` 验收档案 |
| `evidence` | 冻结快照：验收档案、竣工清单 | **永不修改**。数字只对冻结当天成立，不得当作现状引用。可用 `pnpm docs:freeze` 显式重冻 |
| `research` | 调研、抓取存档 | 只追加；结论过时就在新决策里 supersede |

四条最容易犯的错：

1. **不要把验收档案里的数字当现状写进 README 或 status.md。** 想看现在的数字跑 `pnpm docs:gen`。
2. **不要把易漂移的数字手写进 README / docs/status.md。** `docs:lint` 的 R7 会拦；数字要放进
   `<!-- docs-gen:numbers:start -->` 块里由脚本生成。
3. **废弃的文档不能只改标题。** 标了 `status: deprecated` 就必须把正文里的「按此执行/按此实现」
   之类祈使句删掉或改成指向替代文档，否则 `docs:lint` 的 R5 会拦。
4. **什么时候必须同步文档**：改代码时只有两处是强制的——`docs/status.md`（现状变了）与
   [CHANGELOG.md](./CHANGELOG.md)（在 `## [Unreleased]` 里加一条，**与代码同一个提交**，
   不要事后补）。验收档案在验收当天写完后就不许再动。

验收档案被改动时 `docs:lint` 会报 `content_hash` 不匹配且**不会自动修复**——否则"改了验收结论"
就被静默合法化了。确需改动必须显式跑 `pnpm docs:freeze <文件>`，这一步的摩擦是刻意保留的。
允许的例外只有一种：**文档搬家导致档案里的链接路径失效**。这种情况要重写链接并显式重新冻结，
提交里会留下一处 `content_hash` 变化，审阅时一眼能看出"只动了路径"。

文档门禁共十二条规则，全部在 `scripts/docs-lint.mjs` 顶部有注释说明。最容易踩的是：

- `R8` 查 markdown 链接，`R10` 查源码注释与正文里以 `docs/` 形式写的路径——**两者都要保**，
  所以移动文档后别只改 `.md` 里的链接，`apps/`、`packages/`、`scripts/` 里的注释路径也要跟。
- `R11` 要求 `class` 与所在目录一致（目录名即分类信号）。判错 class 本身机器管不了，
  但把文档放错目录会红。
- `R12` 校验文档里 `路径:行号` 形式的代码引用至少能解析（文件存在、行号在范围内）。
  **注意它的边界：它不判断那一行是否仍是所引用的内容。** 所以写文档时行号只作线索，
  真正的契约是文件路径与符号名（如「`app.ts` 的 `createApp`」而不是「`app.ts:31`」）。
- 移动/重命名文档后跑 `pnpm docs:gen` 更新文档地图，否则 `R3` 与 `R4` 会红。

已知的边界（不要误以为门禁能兜住）：

- `R3` 的用例数是静态数 `it(` 声明。有人改用 `it.each(...)` 时口径就失效了，
  所以另有一条守卫：出现 `.each(` 直接失败，逼你换计数方式。
- `R11` 只能发现「class 与目录不符」，发现不了「这份文档本来就归错类了」——那需要人判断。

## 已知坑（这些不是 TODO，是当前行为的说明）

- **后端没有应用层认证**，CORS 默认放开。不要把服务暴露到不可信网络。
- **`apps/server` 的 `build` 只是 `tsc --noEmit`**，没有编译产物；Dockerfile 用 `tsx` 跑 TS 源码。
- **数据库没有迁移工具**，`apps/server/src/db/client.ts` 里是手写幂等补列，只能加列。
- **`engine.ts` 里有多处未捕获的 Promise**，改动运行链路时留意 `runLoop` 的收尾与
  `executeNode` 的 `resolveInputs`/`persistInputs`。
- 文档门禁是**全量强制**的：`docs/` 下所有 markdown 都必须有合法 front matter，只有
  `docs/samples/` 与 `docs/research/raw/` 作为产物存档豁免。新建文档请照上面的 schema 写。
- **文档地图里刻意没有「最后修改日期」**：有日期的话任何一份文档被改动都会让生成块过期，从而每次
  改文档都要重跑 `docs:gen`。新鲜度交给 `docs-lint` 的新鲜度规则（`last_reviewed` + `review_days`）。
