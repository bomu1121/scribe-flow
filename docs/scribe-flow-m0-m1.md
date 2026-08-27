# ScribeFlow 实施清单 M0/M1（仓库初始化 + 工程与画布）

> 状态：**M0 已完成，M1 进行中（2026-08-27 更新）**
> 依据：`docs/scribe-flow-proposal.md` v3；已确认 D1=Vue Flow（MIT），D7=快捷选择范围（收藏夹/订阅合集/稍后再看/B站历史）。
> 工作方式：功能逻辑复用 bili2insight，视觉组件与画布在新仓库重写；UI 文案一律简体中文，源文件 UTF-8，颜色一律走设计令牌。

## 当前进度

- ✅ M0 全部验收：pnpm 单仓、CI、设计令牌、应用外壳、UI 弹窗原语、反 slop 自检；已提交 `e554097` 并推送 `origin/main`。
- 🔄 M1 进行中：
  - ✅ 后端 projects API：列表/新建(模板)/详情/改名/删除/复制/导入导出/graph 自动保存；SQLite 幂等建表。
  - ✅ 工程列表页：卡片网格、模板创建弹窗、导入/导出/复制/删除。
  - ✅ 画布编辑器：Vue Flow 接入（节点/边/Handle/Background/Controls/MiniMap）、节点库拖入与点击添加、空白双击搜索、端口校验、右键菜单、撤销/重做、复制/删除快捷键、拖拽落点、自动布局（elkjs 懒加载）、检查器、500ms 自动保存。
  - ✅ 冒烟验证：真实 Chrome + CDP 验证「视频观点笔记」模板渲染 5 节点 4 连线、控制台无错误；交互验证通过——节点库点击添加、Delete 删除、Ctrl+Z 撤销、双击画布打开节点搜索；修复了三个真实问题（工程异步加载导致空画布、自定义边 path 类型转换、Vue Flow 双击缩放吞事件）。
  - ⏳ 待人工浏览器验证：画布交互照搬清单 1–11 项（结构已实现，仍需真实鼠标/键盘逐项过一遍）。
  - ⏳ M1 收尾：工程复制后跳转、运行记录占位与状态徽章真实数据（M3）。
- 下一步：M2 来源节点真实化（B 站解析/登录快捷选择/本地上传）。

---

## 0. 已确认决策快照

| 项 | 结论 |
|---|---|
| 画布底座 | @vue-flow/core 全家（MIT），不自研画布交互 |
| 交互母本 | n8n 编辑器行为（只复刻交互，不抄代码），15 条照搬清单 |
| LLM 域参考 | Langflow（MIT）、Flowise（Apache-2.0 非 enterprise） |
| 前端栈 | Vue 3 + Vite + TS + Pinia + vue-router + Tailwind CSS 4 + Radix Vue(reka-ui) |
| 后端栈 | Node 22 + Hono + Drizzle + SQLite |
| 快捷选择 | 收藏夹 / 订阅合集 / 稍后再看 / B站历史（无追番追剧） |
| 已移除 | 旧历史页+星标、笔记库、独立收藏模块、短信登录 |

---

## 1. 仓库初始化（M0 第 0 步，约 0.5 天）

### 1.1 Git 与仓库

```bash
git clone https://github.com/bomu1121/scribe-flow.git
cd scribe-flow
# 若仓库为空：git init + 关联 remote
```

- 分支：`main` 为默认；功能分支 `feat/xxx`、修复 `fix/xxx`（不沿用旧仓 codex 分支）。
- `.gitignore`：`node_modules/`、`dist/`、`*.local`、`data/`（SQLite 与上传临时目录）、`.env*`（保留 `.env.example`）。
- `LICENSE`：MIT（本项目代码）；第三方依赖各自遵守其许可证。
- `README.md`：一句话定位 + 架构图 + 本地开发命令（中文）。

### 1.2 Monorepo 结构（pnpm workspaces）

```
scribe-flow/
├─ package.json                 # packageManager: pnpm；scripts 聚合
├─ pnpm-workspace.yaml
├─ apps/
│  ├─ web/                      # 前端
│  └─ server/                   # 后端
├─ packages/
│  └─ shared/                   # TS 类型、Graph Schema、API 契约、模板 fixtures
├─ docs/
│  ├─ scribe-flow-proposal.md   # 总方案（迁入）
│  └─ scribe-flow-m0-m1.md      # 本清单
├─ scripts/
│  └─ slop-lint.mjs             # 反 slop grep 自检
└─ .github/workflows/ci.yml
```

根 `package.json` 脚本：

```jsonc
{
  "scripts": {
    "dev": "pnpm --parallel --filter @scribe-flow/web --filter @scribe-flow/server dev",
    "dev:web": "pnpm --filter @scribe-flow/web dev",
    "dev:server": "pnpm --filter @scribe-flow/server dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint:slop": "node scripts/slop-lint.mjs"
  }
}
```

### 1.3 CI（GitHub Actions）

- 触发：push main / PR。
- 步骤：pnpm install --frozen-lockfile → typecheck → test → build → lint:slop。
- 后续加：Docker build（M5）、Playwright 冒烟（M4 以后）。

---

## 2. M0：骨架与设计系统（约 2–3 天）

**目标**：壳可跑、路由齐全（空页）、令牌落地、反 slop 自检可执行。

### 2.1 packages/shared 起步

| 文件 | 内容 |
|---|---|
| `src/port.ts` | 端口类型：`audio / transcript / noteBlock / noteDoc` |
| `src/graph.ts` | `GraphNodeSpec`（discriminated union：source.bili/file/text、process.transcribe/refine/prompt/merge/output）、`GraphEdgeSpec`、`GraphViewport` |
| `src/project.ts` | `ProjectMeta`、`WorkflowGraph`（schemaVersion=1）、`ProjectTemplate` |
| `src/run.ts` | `RunStatus`、`NodeRunStatus`（先定义，M3 实现） |
| `src/prompt.ts` | `PromptBlock`（内置 3 个的中文提示词，从旧仓 `src/stores/templates.ts` 迁移） |
| `src/templates.ts` | 4 个工程模板 fixture：视频观点笔记 / 技术教程拆解 / 多提示词对照 / 已有文稿加工 |
| `src/zod.ts` | graph 的 zod schema（后端导入校验共用） |

### 2.2 apps/web 脚手架

依赖：
- 运行时：`vue`、`vue-router`、`pinia`、`@vueuse/core`、`reka-ui`（Radix Vue）、`@vue-flow/core` `@vue-flow/background` `@vue-flow/controls` `@vue-flow/minimap`、`lucide-vue-next`、`elkjs`、`clsx`、`tailwind-merge`、`geist` 字体（@fontsource 系，自托管 Latin 子集）。
- 开发：`vite`、`@vitejs/plugin-vue`、`typescript`、`vue-tsc`、`tailwindcss`、`@tailwindcss/vite`、`vitest`。

关键文件：
```
apps/web/src/
├─ main.ts / App.vue / router.ts
├─ styles/tokens.css           # 设计令牌（v3 6.2 草案）
├─ styles/app.css              # Tailwind 入口 + 基础 reset
├─ components/ui/              # button/input/select/tabs/dialog/alert-dialog/dropdown-menu/popover/tooltip/badge
├─ layouts/AppLayout.vue       # 侧边栏 + 顶栏 + 内容区
├─ views/
│  ├─ ProjectListView.vue      # M1 实现
│  ├─ ProjectEditorView.vue    # M1 实现
│  ├─ RunsView.vue             # 占位
│  ├─ RunDetailView.vue        # 占位
│  └─ SettingsView.vue         # 占位（分组导航骨架）
├─ stores/ projects.ts / runs.ts / settings.ts / prompts.ts
└─ lib/ api.ts / sse.ts
```

- 路由按方案 4.2 注册（`/`、`/project/:id`、`/project/:id/run/:runId`、`/runs`、`/settings`、`/settings/prompts/:id?`）。
- Vite dev 代理：`/api` → `http://localhost:8787`。
- 字体：中文系统栈 + Geist Sans（数字/拉丁）+ Geist Mono（ID/耗时/路径）；字号 14px/1.6。

### 2.3 apps/server 脚手架

依赖：`hono`、`@hono/node-server`、`drizzle-orm`、`better-sqlite3`、`zod`、`@hono/zod-validator`。

关键文件：
```
apps/server/src/
├─ index.ts            # 启动：PORT=8787，DATA_DIR=./data
├─ app.ts              # Hono 实例：/api/health、CORS、错误处理（中文错误消息）
├─ db/client.ts        # better-sqlite3 + drizzle 连接
└─ db/schema.ts        # M0 先建 projects；runs/run_node_results/prompt_blocks/bili_* 留注释占位
```

- `GET /api/health` 返回 `{ ok: true, version }`。
- `VITE_API_BASE` 前端可覆盖；服务端默认同源托管 dist（M5 再挂）。

### 2.4 应用外壳

- 侧边栏：工程 `/`、运行 `/runs`、设置 `/settings`；底部 B 站账号状态（占位「未登录」，点击预留）。
- 顶栏：页面标题 + 右侧「运行中 N」胶囊（M3 生效，先占位）。
- 令牌落地：`tokens.css` 按方案 6.2 全量定义（含画布令牌：`--node-radius`、`--edge-color`、`--edge-running`）。
- UI 组件原语用 reka-ui + Tailwind 封装为 `components/ui`，M0 先交付 button/input/dialog/alert-dialog/select/tabs/dropdown-menu/popover/badge 七个。

### 2.5 反 slop 自检脚本

`scripts/slop-lint.mjs`：扫描 `apps/web/src`（排除 mock/示例），命中即失败：

```
linear-gradient(135deg|135deg, #667eea|#764ba2
backdrop-filter: blur(
🚀|✨|📊|🔥
text-shadow.*glow|box-shadow.*0 0.*rgba.*0\.[2-9]
scrollIntoView
Inter|Roboto|Poppins|Fraunces   # 作为 font-family 主字体时
```

### M0 验收

- [ ] `pnpm dev` 一条命令起前后端；`/`、`/runs`、`/settings` 可导航，全部中文占位。
- [ ] `pnpm typecheck/test/build/lint:slop` 全绿；CI 通过。
- [ ] 所有颜色来自 tokens.css；`.tnum` 用于数字。
- [ ] 弹窗原语可用（Esc 关闭、遮罩、焦点圈闭）。

---

## 3. M1：工程与画布编辑器（约 7–10 天）

**目标**：能新建/保存/导入导出工程，画布上可编排一张“死图”，交互全部按 n8n 照搬清单验收。

### 3.1 后端：projects API + SQLite

Schema：

```ts
projects {
  id: text pk            // prj_ + randomUUID 前缀
  name: text not null
  description: text default ''
  graph_json: text not null
  schema_version: int default 1
  created_at / updated_at: integer
}
```

接口（zod 校验 graph）：

```
GET    /api/projects                列表（name、updated_at、节点数、最近运行占位）
POST   /api/projects                新建（空白或模板 graph）
GET    /api/projects/:id
PATCH  /api/projects/:id            改名/描述
DELETE /api/projects/:id
POST   /api/projects/:id/duplicate  复制（名 + “ 副本”）
GET/PUT /api/projects/:id/graph     读取/自动保存 graph（PUT 仅接受合法 graph）
POST   /api/projects/import         导入 .scribe-flow.json（校验 schemaVersion）
GET    /api/projects/:id/export     导出 .scribe-flow.json（不含 Cookie、不含运行记录）
```

### 3.2 前端：工程列表 `/`

- 载入 `/api/projects`；卡片网格 + 新建按钮（下拉：空白 / 4 模板）。
- 卡片 hover：打开/复制/导出/删除；删除用 AlertDialog（文案：`确认删除工程「X」？工程内的运行记录会一并删除。`）。
- 「最近运行」区先显示空态占位（M3 接数据）。
- 空态：`还没有工程。创建一个空白工程，或从「视频观点笔记」模板开始。`

### 3.3 画布编辑器 `/project/:id`（本里程碑主体）

**接入 Vue Flow**
- `FlowCanvas.vue` 组合：`<VueFlow>` + `<Background variant="dots" gap="12">` + `<Controls>` + `<MiniMap>`。
- 自定义边：`EdgeBase`（1.5px、`--edge-color`；数据结构先支持 `data.animated`）。
- 自定义节点：`NodeBase.vue`（白卡片、发丝边框、状态点、左右 Handle、标题行、类型小字、产物摘要 slot）；按类型注册占位节点组件（来源/转写/AI/合并/输出五种外观）。

**节点库（左 200px）**
- 分组：来源 / 转写 / AI 加工 / 组织与输出；顶部搜索；最近使用置顶。
- 添加方式（照搬 n8n 节点创建器行为）：
  - 从节点库拖入画布（HTML5 DnD + `screenToFlowCoordinate` 落点）；
  - 点击节点项 → 添加在视口中心；
  - 画布空白双击 → 弹出节点搜索弹窗（输入即过滤，Enter 添加）。

**连线与端口校验**
- `source.bili/file → audio`，`source.text → transcript`，`process.transcribe: audio→transcript`，`process.refine/prompt: transcript→transcript/noteBlock`，`merge/output` 按端口契约。
- `isValidConnection`：类型不匹配时目标 Handle 灰显 + `cursor: not-allowed`；匹配时蓝色高亮。

**检查器（右 280–320px）**
- 未选中：工程信息 + 默认运行配置（默认 AI/ASR/并发，只读占位，M3 可改）。
- 选中节点：名称/说明 + 类型专属字段骨架；本里程碑完成 B 站节点 URL 输入与本地预览调用占位（M2 接真实解析）、文本节点粘贴、AI 节点提示词块下拉（数据来自 `prompts` store）、输出命名。
- Tab：`属性` / `运行记录`（占位空态）。

**画布操作（15 条照搬清单 1–11 项）**
- 平移/缩放/触控板、多选、框选、吸附：Vue Flow 参数化，不自定义几何。
- 右键菜单（ContextMenu 原语）：运行此节点（置灰提示 M3）/ 从此节点运行（置灰）/ 复制 / 删除 / 复制输出（置灰）。
- 快捷键：`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 重做、`Ctrl/Cmd+D` 复制（+24px 偏移）、`Delete/Backspace` 删除选中、`Ctrl/Cmd+A` 全选、`F` 适应视图（避免与浏览器冲突时改 `Shift+1`）。
- 撤销/重做：graph 快照栈（nodes+edges 深拷贝，上限 50 步）；连线开始/结束记为一步。
- 「整理画布」：elkjs layered 布局；分支节点垂直错开 150–200px（先布局后按层级重排）。
- 自动保存：graph watch → 500ms 防抖 `PUT /api/projects/:id/graph`；顶栏显示 `保存中… / 已保存 HH:mm`；失败转 `保存失败，重试`。

**导入导出**
- 导出：`GET /export` → Blob 下载 `<工程名>.scribe-flow.json`。
- 导入：文件选择（json 后缀校验）→ `POST /import` → 跳转新工程；失败弹窗显示中文原因。

**运行控制台（底部占位）**
- 状态条 + 可展开面板骨架；M3 接 SSE。

### 3.4 测试

- `vitest`：`packages/shared` 的 graph zod 校验（非法端口/孤立边/重复 id）、撤销栈、elkjs 布局输出非空。
- 手动验收脚本（写进 PR 描述）：照搬清单 1–11 逐条截图/录屏。

### M1 验收（对照方案 3.3 的 15 条清单）

- [ ] 1 平移/缩放/触控板（25%–400%）
- [ ] 2 节点拖动/多选/框选/吸附
- [ ] 3 Handle 连线/预览/删除
- [ ] 4 非法端口灰显 + 禁止光标
- [ ] 5 节点库拖入/点击添加/空白双击搜索
- [ ] 6 状态徽章渲染位就绪（running/done/error 的视觉态，M3 接真实数据）
- [ ] 7 产物摘要行渲染位就绪
- [ ] 8 右键菜单五项
- [ ] 9 撤销/重做/复制/删除快捷键
- [ ] 10 自动布局（分支 150–200px 错开）
- [ ] 11 小地图/缩放控件/适应视图
- [ ] 14 自动保存指示
- [ ] 工程 CRUD + 导入导出闭环；刷新后画布不丢
- [ ] 4 个模板均可一键创建
- [ ] 全程中文文案、UTF-8、令牌化颜色、slop-lint 通过

---

## 4. 交付边界（M0/M1 明确不做）

- 不做真实解析/下载/ASR/AI（M2/M3）。
- 不做登录与 B 站快捷选择（M2）。
- 不做运行记录真实数据（M3/M4）。
- 不做移动端画布（只保留桌面，<1024 显示只读提示）。
- 不做深色模式、命令面板、模板市场。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| Vue Flow 自定义节点细节多（Handle 位置、选中态、键盘） | 全部在 `NodeBase` 收敛；先跑官方 examples，再照 n8n 行为清单逐项做 |
| Tailwind 4 + reka-ui 版本适配 | 锁定版本于仓库初始化日验证通过的组合；reka-ui 优先官方 Dialog/Dropdown 示例 |
| elkjs 布局在长链/分支下观感差 | 只提供「整理画布」手动触发，不自动布局；分支规则单独可调 |
| 撤销栈在拖拽/连线高频事件下体积膨胀 | 用“操作级”提交（pointerup 后入栈），不用 move 事件入栈 |
| 自动保存与撤销冲突 | 保存只读 graph，不动栈；保存失败不改本地状态 |

## 6. 下一步（M2 预告）

来源节点真实化：B 站解析/分 P、二维码登录、收藏类快捷选择器（D7 范围）、本地上传、文本节点校验；随后 M3 接运行引擎。
