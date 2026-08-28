# ScribeFlow 开发记录与项目文档

> 最后更新：2026-08-27
> 仓库：https://github.com/bomu1121/scribe-flow.git
> 状态：M0/M1 完成，M2 部分完成（B 站链接即时解析已上线）；样式系统按 shadcn-vue registry 与官方 forms 规则落地。

---

## 1. 当前状态

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 仓库骨架 | ✅ 完成 | pnpm 单仓、CI、设计令牌、应用外壳、UI 原语、反 slop/浮层样式自检 |
| M1 工程与画布 | ✅ 完成 | 工程 CRUD、Vue Flow 画布、节点/连线/撤销重做/自动布局/自动保存、导入导出、CDP 全量验收 |
| M2 来源节点 | 🔄 部分完成 | B 站链接输入即解析（封面/标题/UP 主/时长/分 P + pageInfo 保存）已上线；收藏类快捷选择、登录、本地上传未做 |
| M3 运行引擎 | ⏳ 未开始 | 下载/FFmpeg/云 ASR/AI 节点、DAG 执行、SSE |
| M4 输出与运行记录 | ⏳ 未开始 | 合并/输出、文档阅读、运行详情、提示词块库、运行记录页 |
| M5 打磨发布 | ⏳ 未开始 | 响应式、a11y、大图性能、深色预留、Docker 部署 |

## 2. 仓库结构

```
scribe-flow/
├─ apps/
│  ├─ web/            Vue 3 + Vite + TS + Pinia + vue-router + Tailwind CSS 4 + Reka UI + Vue Flow
│  └─ server/         Node 22 + Hono + Drizzle + SQLite
├─ packages/shared/   图模型、工程模板、提示词块、预览类型、zod 校验
├─ docs/              方案、实施清单、UI 选型、shadcn 规则、本开发记录
└─ scripts/           slop-lint.mjs、ui-lint.mjs
```

## 3. 已实现功能清单

### 工程（Project）
- 工程列表：新建（空白/4 个工作流形状模板）、复制、改名、删除、导入导出 `.scribe-flow.json`
- 模板只描述加工路径，不预绑提示词块
- 后端 `projects` SQLite 表 + 完整 CRUD API；graph 自动保存接口

### 画布编辑器（Vue Flow）
- 左节点库（来源/转写/AI 加工/组织与输出），点击添加 + HTML5 拖入
- 画布：平移/缩放/框选/Shift 多选/8px 吸附/小地图/缩放控件/适应视图
- 连线：端口类型校验（audio/transcript/noteBlock/noteDoc），非法连接拒绝，Delete 删除连线
- 节点卡片内操作（无右侧面板）：名称内联编辑、URL/文稿/ASR/提示词块/输出名/模型覆盖/文件名表单
- 卡片按内容自适应：B站来源 380px、文件 320px、文本 340px、AI 加工 320px、输出 320px、小卡 224px
- 右键菜单：运行此节点（M3）/从此节点运行（M3）/复制/复制输出（M3）/删除
- 撤销/重做（50 步快照）、Ctrl+D 复制、空白双击搜索节点
- elkjs 懒加载自动布局（分支层级布局）
- 500ms 防抖自动保存 + 顶栏保存状态

### B 站来源节点（M2 部分）
- `POST /api/videos/preview`：解析 BV/av 号、b23.tv 短链重定向、B 站 view 接口、5 分钟缓存、中文错误
- 卡片内输入链接防抖 500ms 解析，展示封面/标题/UP 主/时长/分 P 数，自动保存 pageInfo

### 提示词块
- 内置 3 个：观点提炼 / 技术文案提炼 / 信息溯源
- 自定义块 localStorage 持久化（store 已实现，设置页 M4 接入编辑界面）
- AI 加工节点卡片内下拉选择提示词块（不预绑）

### UI 组件体系
- Input / Button / Select / Toggle / ToggleGroup 按 shadcn-vue new-york-v4 registry 1:1 复制，仅改 import 与令牌映射
- Reka UI 语义组件完整保留（SelectItemText/Indicator/Icon/ScrollButtons）
- Tailwind v4 `@theme inline` 将语义色映射到设计令牌；`tw-animate-css` 弹层动画
- 浮层样式铁律：Portal 组件弹层样式必须全局，z-index 只用 `--z-*` 令牌；`pnpm lint:ui` 强制
- 反 slop 自检：`pnpm lint:slop` 扫描渐变/玻璃拟态/emoji/辉光等反模式
- 表单控件选型遵循官方 forms 规则：2 选项用 ToggleGroup（ASR 引擎），预定义选项用 Select（提示词块）

## 4. 设计令牌

应用令牌在 `apps/web/src/styles/tokens.css`；Tailwind 语义映射在 `apps/web/src/styles/app.css`。

关键色：品牌蓝 `#00AEEC`、墨色 `#16181D`、画布灰 `#F4F5F6`、纸面白 `#FFFFFF`。
关键半径：sm 6 / md 8 / lg 10 / xl 14。
浮层层级：overlay 1000 / dialog 1010 / select 1120 / popover 1130 / dropdown 1150 / context 1300。

## 5. 关键决策记录（含用户反馈修正）

1. 产品定位：笔记处理画布流，工程 = 工作流 + 运行记录；不做旧历史页/星标。
2. 画布底座：Vue Flow（MIT，n8n 同源），交互行为照搬 n8n，不自研。
3. B 站收藏是来源步骤的快捷选视频，不是独立收藏模块。
4. 工程模板与提示词块归属分离：新建工程只给工作流形状，提示词在 AI 加工节点选择。
5. 画布去掉右侧检查器，操作全部进节点卡片，卡片按内容自适应大小。
6. 链接输入即解析（用户明确要求的检查点）。
7. UI 原语最终改为 shadcn-vue registry 1:1 复制；修复过 Portal 弹层 scoped 样式失效、全局 focus outline 双层边框、focus ring 过重、节点选中背景色等问题。
8. 输入框/下拉聚焦态最终规范：**无 ring、无 outline，仅 1px 品牌蓝边框，颜色过渡包含 border-color**；节点选中只 1px 边框 + 中性阴影，无背景色。

## 6. 验证方式与结果

- `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint` 全部通过
- CDP + 真实 Chrome 验证：
  - 4 模板创建（5/6/6/4 节点）
  - 画布渲染 5 节点 4 连线，控制台 0 错误
  - 平移/缩放/节点拖动/Shift 多选/框选/连线/删线/复制/撤销/右键菜单/双击搜索
  - 卡片输入 B 站链接 → 封面与标题展示 → pageInfo 保存
  - 下拉选中「观点提炼（内置）」正常回显
  - ToggleGroup 切换 ASR 引擎 → 后端保存 `openai-compatible`
- UTF-8 乱码扫描通过；UI 文案简体中文

## 7. 未完成 / 下一步

- M2：B 站登录（扫码）+ 收藏夹/订阅合集/稍后再看/B 站历史快捷选择器；本地文件上传/拖拽
- M3：下载/FFmpeg/云 ASR/AI 节点执行、DAG 运行引擎、SSE、节点运行状态
- M4：输出预览、运行详情、提示词块库设置页、运行记录页
- M5：响应式、a11y、深色模式、Docker 部署

## 8. 本地运行

```bash
pnpm install
pnpm dev
```

- 前端 http://localhost:5173
- 后端 http://localhost:8787（`/api/health`）
- 数据目录 `apps/server/data/scribe-flow.sqlite`（git 忽略）
