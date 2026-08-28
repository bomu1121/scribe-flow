# UI 样式框架选型与组件实现调研（代码级）

> ⚠️ **历史文档（2026-08-28 起不再执行）**：本方案（shadcn-vue 复制件）已被用户否决。当前通用 UI 底座为 **Element Plus**，详见 [docs/ui-library-replacement-research.md](ui-library-replacement-research.md)。本文仅保留作决策过程归档。
>
> 背景：Select / Input 的样式与交互不达标。本文记录对主流 Web 样式方案的实际代码调研、选型结论，以及落地到 ScribeFlow 的技术细节。
> 结论摘要：**采用 shadcn-vue new-york-v4 + Reka UI + Tailwind CSS v4 的 utility-first 组件层**；ScribeFlow 自身设计令牌保持不变，只作为 Tailwind 主题变量的值源。

---

## 1. 候选方案对比

| 方案 | 许可证 | 代码可用性 | 与当前栈契合 | 结论 |
|---|---|---|---|---|
| shadcn-vue (new-york-v4) + Reka UI | MIT | 组件源码在 repo registry，可直接复制并改造 | 我们已用 Vue3 + Reka UI + Tailwind v4，零迁移成本 | ✅ 采用 |
| Naive UI | MIT | 完整组件库 | 需全套 themeOverrides 换肤；弹层/表单自带实现但与设计令牌两套体系 | 不采用（库感强，与“纸面工作台”难贴合） |
| PrimeVue (unstyled) | MIT | 无样式模式 + 主题包 | 需要 Pass-through 大量配置；社区 Vue 3 生态但不如 shadcn 轻 | 备选 |
| Nuxt UI v3 | MIT | 依赖 Nuxt | 项目是纯 Vite SPA，引入 Nuxt 成本高 | 不采用 |
| Element Plus / Vuetify | MIT | 完整组件库 | 外观默认感强、定制成本高；不适合画布工具气质 | 不采用 |

选型依据不是“哪个库更大”，而是**哪个方案允许我们逐行掌握组件实现**。shadcn-vue 的 registry 就是源码，且底层 Reka UI 的行为语义（键盘、typeahead、焦点管理）不需要自己实现。

参考源码：
- shadcn-vue v4 registry：https://github.com/unovue/shadcn-vue/tree/dev/apps/v4/registry/new-york-v4/ui
- Reka UI Select 实现：https://github.com/unovue/reka-ui/tree/v2/packages/core/src/Select

---

## 2. 代码级调研结论

### 2.1 Input（shadcn-vue `registry/new-york-v4/ui/input/Input.vue`）

关键实现：

- 用 `@vueuse/core` 的 `useVModel(props, 'modelValue', emits, { passive: true, defaultValue })`，使 Input 同时支持受控与非受控。
- 样式全部是 Tailwind utility，而不是自定义类：
  - 基础：`h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs`
  - 占位：`placeholder:text-muted-foreground`
  - 禁用：`disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`
  - 焦点：`focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3`
  - 错误态：`aria-invalid:border-destructive aria-invalid:ring-destructive/20`
  - 只过渡 `color, box-shadow`，不做无意义动画。
- 语义标记：`data-slot="input"`。

落地映射：我们保留相同结构，主题色映射到自己的令牌（`border-input → --color-border`、`ring → --color-brand`、`muted-foreground → --color-text-secondary`）。

### 2.2 Select（shadcn-vue registry + Reka UI 源码）

shadcn-vue 的 Select 不是单个组件，而是 6 个可组合件：

| 组件 | 必须实现的细节 |
|---|---|
| `SelectTrigger` | `role=combobox`、`data-state=open/closed`、`aria-expanded`、左键打开逻辑、Space/Enter/ArrowUp/ArrowDown 打开、typeahead 搜索；`SelectIcon as-child` 放箭头 |
| `SelectValue` | 内部读取 `optionsSet` 中 `SelectItemText` 的 textContent 显示选中项；无值时显示 placeholder 并打 `data-placeholder` |
| `SelectContent` | `position=popper` 模式；尺寸依赖 Reka 注入的 CSS 变量 `--reka-select-content-available-height`、`--reka-select-trigger-width/height`；上下滚动按钮 |
| `SelectItem` | `role=option`、`data-highlighted`（键盘/指针焦点）、`data-state=checked/unchecked`、`data-disabled`；`pointermove` 聚焦项、`pointerup` 选择、触摸设备特殊处理 |
| `SelectItemText` | 注册到 optionsSet，供 `SelectValue` 与 typeahead 使用 |
| `SelectItemIndicator` | 仅在选中项上渲染，右侧对勾 |

Reka UI `SelectItem.vue` 源码中的行为细节（决定“交互是否僵硬”）：

- 选择键：`[' ', 'Enter']`；打开键：`[' ', 'Enter', 'ArrowUp', 'ArrowDown']`。
- 键盘输入字符触发 typeahead 搜索（`useTypeahead`），可直接跳到匹配项。
- `pointermove` 会 `focus({ preventScroll: true })` 到当前项——所以 hover 和键盘高亮共用 `data-highlighted`。
- 指针按下与抬起位移 ≤10px 时防止误选；触摸设备在 pointerup 打开。
- `SelectValue` 的选中文案来自 item text，不依赖组件使用者拼字符串。

shadcn-vue 的样式同样是 utility：
- 触发器：`flex ... items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs`、`focus-visible:ring-3`、`data-[size=sm]:h-8 data-[size=default]:h-9`。
- 内容：`bg-popover text-popover-foreground ... rounded-md border shadow-md`、`max-h-(--reka-select-content-available-height)`、`min-w-[8rem]`；popper 模式加 `data-[side=...]` 位移动画。
- 选项：`relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm`、`data-[highlighted]:bg-accent`、`data-[state=checked]:text-primary`。

### 2.3 Tailwind v4 主题桥接

Tailwind v4 用 `@theme inline` 把语义色映射到设计令牌，组件层只写语义 utility（`bg-background`、`text-muted-foreground`），色值单一来源仍是 `tokens.css`：

```css
@theme inline {
  --color-background: var(--color-bg);
  --color-foreground: var(--color-text);
  --color-popover: var(--color-surface);
  --color-primary: var(--color-brand);
  --color-muted-foreground: var(--color-text-secondary);
  --color-input: var(--color-border);
  --color-ring: var(--color-brand);
  ...
}
```

这样不会出现“组件一套色、令牌一套色”的第二色板。

---

## 3. ScribeFlow 落地改动

1. **全盘照搬 shadcn-vue new-york-v4 registry**：`components/ui/input/Input.vue`、`components/ui/button/*`、`components/ui/select/*`（Select / SelectTrigger / SelectValue / SelectContent / SelectItem / ScrollUp / ScrollDown）除 import 路径与图标包（`lucide-vue-next`）外，类名与结构 1:1 复制。
2. `styles/app.css`：按 shadcn-vue v4 官方方式补齐 `@import "tw-animate-css"`、`@theme inline` 语义色映射、`@layer base { * { border-border outline-ring/50 } body { bg-background text-foreground } }`。
3. 依赖补齐：`class-variance-authority`（Button variants）、`tw-animate-css`（弹层进出动画）。
4. 节点卡片内所有输入框改用统一 `Input` 组件；下拉全部走统一 `Select` 组件。
5. 聚焦样式采用「单层规则」：组件自己有 `focus-visible` 环（`data-slot` 组件），全局基线只给自定义元素提供 outline，并显式排除 `input/button/select-trigger/select-item`，避免组件环 + 全局 outline 的双层粗边框。

---

## 4. 组件层规范（后续所有表单组件执行）

- 优先复制 shadcn-vue registry 的实现结构，而不是自创封装。
- 必须保留 Reka 语义组件：`ItemText` / `ItemIndicator` / `Icon` / Scroll 按钮。
- 必须覆盖：hover / active / focus-visible / disabled / data-state 开合动画。
- Portal 组件样式必须全局（`ui-lint` 已强制）。
- 颜色只用 Tailwind 语义 utility，语义 utility 只映射设计令牌，禁止散写 hex / rgb。
