# UI 组件库替换调研（成熟库路线）

> 背景：现有 `components/ui` 自封装（shadcn-vue 复制件 + 设计令牌手工映射）在输入框、下拉框等通用控件上观感不达标。用户要求放弃自设定样式路线，改用在同类产品中被广泛采用、更现成更成熟的样式/组件库。
> 调研时间：2026-08-28。结论先行：**采用 Element Plus 2.14.x 作为通用组件底座，Tailwind 仅保留布局与画布样式，设计令牌映射到 Element Plus CSS 变量。**

---

## 1. 本次调研了什么（调研维度清单）

要把「统一 UI 样式」换库，调研必须覆盖以下 6 个维度，缺一不可：

| # | 维度 | 为什么必须查 | 本次结论摘要 |
|---|---|---|---|
| 1 | **同类产品在用库**（n8n / Dify / Langflow / Flowise） | 用户要求"别的类似网站都采用的成熟样式库"，这是选型最强证据 | n8n（与本项目同框架同画布引擎）用 **Element Plus** |
| 2 | **候选库成熟度**（版本、维护频率、npm 周下载、License） | "成熟"必须用数据衡量，不能凭印象 | Element Plus 2.14.5、周下载 67.7 万、MIT、持续发版 |
| 3 | **与现有技术栈兼容性**（Vue 3.5 / Vite 7 / TS / Vue Flow 节点卡片内嵌用） | 换库不能引发构建与画布回归 | Element Plus peer 要求 `vue ^3.3.7`，无 Vite 版本锁死；n8n 证明其可在 Vue Flow 自定义节点内正常使用 |
| 4 | **组件覆盖度**（对照 M2–M4 需求清单逐项核对） | 避免换完库发现上传/表格/分页/消息还是要自研 | 输入、下拉、弹窗、表单、上传、表格、分页、消息、进度、开关、标签等全部覆盖 |
| 5 | **主题定制能力**（能否映射现有 `tokens.css`，而非再来一套色板） | 保留 ScribeFlow 品牌蓝 `#00AEEC` 等令牌 | Element Plus 全部样式走 `--el-*` CSS 变量，可全局覆盖，暗色模式变量现成 |
| 6 | **迁移成本与风险**（现有使用点清单、Tailwind preflight 冲突、弹层规范） | 决定是一次性替换还是渐进替换 | 使用点集中在 6 个文件 + 26 个组件文件；冲突有标准解法；浮层样式铁律反而简化 |

---

## 2. 同类产品采用什么（直接代码证据）

通过各仓库 `package.json` 实际核对（2026-08-28）：

| 产品 | 技术栈 | 通用 UI 组件来源 | 证据 |
|---|---|---|---|
| **n8n**（本项目交互母本） | Vue 3 + Vue Flow | **element-plus + reka-ui** | `packages/frontend/@n8n/design-system/package.json` 依赖 `element-plus` 与 `reka-ui ^2.5.0`；`editor-ui` 同时依赖 `@vue-flow/*`（core 1.48.0、background 1.3.2、controls 1.1.3、minimap 1.5.4，与本项目版本几乎一致） |
| Dify | React + React Flow | 自建设计系统 `@dify/design-system` + Base UI + Tailwind（非第三方全家桶） | `web/package.json`：`@base-ui/react`、`tailwindcss`、`class-variance-authority` |
| Langflow | React + React Flow | shadcn-ui + Radix UI 全家 + Tailwind | `src/frontend/package.json`：`shadcn-ui`、`@radix-ui/react-*` 十余项 |
| Flowise | React | MUI（Material UI 5/6） | `packages/ui/package.json`：`@mui/material`、`@mui/x-data-grid` |

关键事实：**唯一一个与 ScribeFlow 同为「Vue 3 + Vue Flow 画布流」的主流产品 n8n，用的就是 Element Plus**，而且 n8n 的 Vue Flow 版本号与本项目当前版本几乎完全相同（core 1.48.x 同代）。这意味着 Element Plus 在这个精确的嵌入场景（画布 + 自定义节点卡片内表单）已经被大厂验证过，不是推测。

本项目的交互母本本来就是 n8n（见方案文档 15 条照搬清单），把 UI 底座也对齐 n8n 是同一决策的自然延伸。

---

## 3. 候选库对比

| 候选 | 最新版 | 周下载 | License | 与 n8n/同类相关性 | 与本项目契合度 | 结论 |
|---|---|---|---|---|---|---|
| **Element Plus** | 2.14.5 | 67.7 万 | MIT | n8n 在用 | Vue 3 peer `^3.3.7`；CSS 变量换肤；中文生态第一梯队；上传/表格/分页/表单齐全 | ✅ **采用** |
| Naive UI | 2.45.3 | 17.2 万 | MIT | 无同类产品直接证据 | 现代但"库感"主题；table 等复杂组件成熟度弱于 EP | ❌ 无同类产品背书，换肤体系另起一套 |
| Ant Design Vue | 4.2.6 | 22.1 万 | MIT | 无同类产品直接证据 | 设计语言偏后台系统；社区维护节奏弱于 EP | ❌ 无同域产品证据 |
| PrimeVue | 5.0.1 | 79.4 万 | 部分组件收费条款需注意 | 无同类产品直接证据 | 主题体系强但生态文档中文化弱 | ❌ 无同域产品证据 |
| Vuetify | 4.1.12 | 104.9 万 | MIT | 无同类产品直接证据 | Material 视觉与"纸面工作台"不符 | ❌ 视觉不匹配 |
| shadcn-vue 复制件（现状） | — | — | MIT | Langflow 用其 React 同源 | 源码可改但本项目已证明维护不出成熟度 | ❌ 用户已否定 |

> 说明：n8n 的依赖里同时有 `element-plus` 和 `reka-ui`，说明两者不是互斥关系——n8n 用 Element Plus 做成熟通用件，reka-ui 补无样式语义件。本项目若个别组件（如右键菜单精细行为）仍需要 reka-ui 保留即可，不冲突。

---

## 4. Element Plus 与现有令牌的映射方案

Element Plus 的样式几乎全部暴露为 CSS 变量，可把 `tokens.css` 继续作为唯一值源：

```css
:root {
  /* ScribeFlow 设计令牌（保持不变） */
  --color-brand: #00AEEC;
  --color-ink: #16181D;
  --color-canvas: #F4F5F6;
  --color-paper: #FFFFFF;

  /* Element Plus 主题桥接 */
  --el-color-primary: var(--color-brand);
  --el-color-primary-light-3: color-mix(in srgb, var(--color-brand) 70%, white);
  --el-color-primary-light-5: color-mix(in srgb, var(--color-brand) 50%, white);
  --el-color-primary-light-7: color-mix(in srgb, var(--color-brand) 30%, white);
  --el-color-primary-light-8: color-mix(in srgb, var(--color-brand) 20%, white);
  --el-color-primary-light-9: color-mix(in srgb, var(--color-brand) 10%, white);
  --el-color-primary-dark-2: color-mix(in srgb, var(--color-brand) 80%, black);

  --el-text-color-primary: var(--color-ink);
  --el-text-color-regular: var(--color-text-secondary);
  --el-border-color: var(--color-border);
  --el-border-color-hover: var(--color-brand);
  --el-border-radius-base: var(--radius-md);
  --el-font-family: var(--font-sans);
  --el-font-size-base: 14px;

  /* 浮层层级：对齐现有 z 令牌，替代散写 */
  --el-popup-z-index: 2000;
}
```

这样仍是「一套令牌，一个值源」：`tokens.css` 定义品牌与中性色，Element Plus 组件消费同一变量，不再有第二色板。

## 5. 组件覆盖度核对（M2–M4 需求）

| 即将开发的功能 | 需要的通用控件 | Element Plus 是否覆盖 |
|---|---|---|
| B 站扫码登录弹窗 | Dialog、Loading、Message；二维码图本身用 `qrcode` 类小库（叶组件，不属通用样式层） | ✅ 弹窗/反馈全覆盖 |
| 快捷选视频弹窗 | Dialog、Tabs、Input（搜索）、Table/虚拟列表、Pagination、Checkbox 多选、Empty | ✅ 全量覆盖 |
| 本地上传 | Upload（拖拽/文件选择）、Progress、Message | ✅ 全量覆盖 |
| 文本节点 | Input（textarea） | ✅ |
| 设置页（AI/ASR/提示词块库） | Form、Input、Select、Switch、Button、Popconfirm、Alert | ✅ 全量覆盖 |
| 运行详情/运行记录 | Tabs、Table、Pagination、Tag/Badge、Progress、Skeleton、Empty | ✅ 全量覆盖 |
| 节点卡片内表单 | Input、Select、Radio/Toggle、Tooltip | ✅（n8n 同场景已验证） |
| 全局反馈 | Message、MessageBox（确认）、Notification | ✅ |

对比现状：本项目当前自封装只有 Button/Input/Select/Toggle/ToggleGroup/Dialog/AlertDialog/DropdownMenu/Popover/Badge/Tabs，未来每个新里程碑都要继续手抄维护。换 EP 后新增控件基本是「引入即用」。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| Tailwind v4 preflight 与 Element Plus 样式冲突（button 默认背景、边框等） | Element Plus 样式以 class 选择器声明，优先级高于 preflight 元素选择器；全局样式导入顺序定为「tailwind → element-plus 主题覆盖」；冲突点写进回归清单逐项检查 |
| 弹层 Portal 样式规则失效 | Element Plus 弹层样式本身是全局 CSS，天然符合项目「Portal 必须全局样式」铁律；`ui-lint.mjs` 相应改为检查 `--el-*` 变量与 z-index 令牌 |
| 引入整包体积 | 使用 `unplugin-vue-components` + `ElementPlusResolver` 按需自动引入；或按页面手动引入，不全局注册 |
| 视觉"库感" | 通过第 4 节 CSS 变量把品牌色/圆角/字号/边框调回 ScribeFlow 令牌；n8n 本身就是 EP 换肤后的观感证明 |
| 节点卡片内样式（Vue Flow 自定义节点） | n8n 同版本 Vue Flow + Element Plus 已验证；卡片内用小尺寸 `size="small"` 控件并给 `.sf-node` 作用域微调 |
| 现有 shadcn 组件与 reka-ui 的去留 | 按 n8n 方式保留 reka-ui 依赖（右键菜单等无样式语义件），shadcn 复制件逐个退役 |

## 7. 建议的替换范围（迁移顺序）

1. **基础设施**：安装 `element-plus`、按需引入插件；`app.css` 写入 `--el-*` 令牌桥接；全局样式导入顺序调整。
2. **通用表单控件**（本次痛点）：`Input / Select / Radio / Switch / Checkbox / Button` → `el-input / el-select / el-radio-group / el-switch / el-checkbox / el-button`；统一 size 与聚焦规则（EP 自带 hover/focus/disabled/error 全套状态，不再自写）。
3. **弹层与反馈**：`Dialog / AlertDialog / DropdownMenu / Popover / Tabs / Badge` → `el-dialog / el-popconfirm / el-dropdown / el-popover / el-tabs / el-tag`；`Message / MessageBox` 引入为全局反馈。
4. **M2 增量**：`Upload / Table / Pagination / Empty` 随快捷选择器与上传功能直接采用，不再新增自封装。
5. **清理**：`components/ui` 下 shadcn 复制件退役；`ui-framework-selection.md` 与 `shadcn-vue-rules.md` 标记为历史决策；`ui-lint.mjs` 规则改为「浮层样式全局 + z-index 令牌 + EP 变量禁止散写 hex」。
6. **回归验收**：全仓 `typecheck/test/build/lint` + CDP 重跑 M1 15 条画布交互清单（画布行为不动，只换卡片内控件与弹窗）。

## 8. 结论

- 换库方向正确：同类产品中，**与本项目技术栈完全同源的 n8n 就是 Element Plus 用户**，这是"别的类似网站都在用"的硬证据，且版本组合（Vue Flow 1.48.x + Vue 3 + EP）与本项目当前依赖一致。
- 建议：**Element Plus 2.14.x 作为通用组件唯一底座；Tailwind 保留布局与画布层；现有设计令牌通过 `--el-*` 变量继续作为唯一值源；reka-ui 按 n8n 方式保留补位。**
- 等待确认后即可按第 7 节顺序实施。
