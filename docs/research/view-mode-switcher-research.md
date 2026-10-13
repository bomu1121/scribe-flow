---
title: 设置页「显示样式」三选一：形态、摆放、标签与无障碍的公开依据
class: research
---

# 设置页「显示样式」三选一：形态、摆放、标签与无障碍的公开依据

> 触发：③ 词库块上方那个「彩色标记 / 单色 / 清单」切换器，第一版是没查任何东西就做出来的，
> 用户看到后说「没让你调研这个切换，你就给我乱做是吧」。
> 这份文档把依据补上，并把当时一起暴露出来的一个真 bug 记在这里。
> 落地位置：`apps/web/src/views/SettingsView.vue` 的 `.sf-tag-toolbar`、
> `apps/web/src/styles/element-theme.css` 的 `.el-radio-button` 段。

## 0. 先说那个真 bug（跟审美无关，是"本该有样式的地方一点样式都没有"）

第一版渲染出来是一排没有外壳的圆点加文字。实测原因不是我的 CSS 写错，是
`apps/web/src/main.ts` **少了一个样式入口**：

| 事实 | 值 |
| --- | --- |
| 导入的是 | `element-plus/es/components/radio/style/css.mjs` |
| 它实际带进来的 | `el-radio.css`（只有 `el-radio`） |
| 它**不带** | `el-radio-button.css`（`radio-button` 是并列的另一个入口） |
| 缺样式时的实测计算值 | `.el-radio-button__inner` 的 `padding: 0px`、`border: 0px`、`display: inline` |
| 补上后 | `padding: 5px 11px`、两端 `border-radius: 6px`、控件宽 162px |

同一行修复顺带修好了另一处一直坏着的控件：`NewProjectDialog.vue` 的「来源」四选一
（`el-radio-group` + `el-radio-button`）用的是同一个组件，之前也是无外壳状态。补完实测：
选中的「B站链接」底 `rgb(240,241,243)`、`padding: 5px 11px`、两端 `border-radius 6px`。

## 1. 形态：三个选项 + 文字标签的分段控件，这个选对了

| 依据 | 原句 | 我们的情形 |
| --- | --- | --- |
| GitLab Pajamas | "Contain 2 or 3 options and should not go beyond 5." / "When there are more than 5 options, use a select or dropdown instead to avoid overcrowding the UI." | 3 个 ✓ |
| GitHub Primer | "A SegmentedControl should have 2–5 choices with text labels or up to 6 icon-only segments." | 3 个文字标签 ✓ |
| Apple HIG | "Aim for no more than about five to seven segments in a wide interface…" | 3 个 ✓ |
| Ant Design | 适用前提是"切换选中的选项时，关联区域的内容跟着变" | 切换的正是下面那棵标签树的呈现 ✓ |

## 2. 那行说明文字：删掉，它本来就是错的

第一版我在切换器右边写了一行 `一级一个色相：色点 + 淡底，二级继承；一眼看出分组`。

- **Apple HIG 原句**："A segmented control that displays text labels doesn't need introductory text."
  （我自己复核过原文，取的是 Apple 的 JSON 端点：
  `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/segmented-controls.json`）
  HIG 只有在**纯图标**分段时才建议补引导文字。
- 它还只解释了三个选项里的一个，另外两个没有对应说明——三个选项的说明**不对称**。
- 后半句「一眼看出分组」是卖点论证，那是文档和引导页的文案，不该常驻在控件旁边。

去向：三个模式各是什么，写进 [docs/tagging.md](../tagging.md)（用户会读文档的地方）；
每个选项保留一条 `title`，鼠标停一下还能看到 `TAG_VIEW_MODES[].hint`。

## 3. 缺的东西：一个可见标签

- **GitLab 原句**："Ensure the segmented control has an associated visible or accessible label so
  users understand what the options control."；并给了退路："aria-label can be used instead to
  create an accessible (non-visible) label."（这两句我也复核过原文）
- 所以最终两样都给了：可见的「显示样式」四个字（复用页面已有的 `.sf-field-label`），
  外加 `el-radio-group` 上的 `aria-label="显示样式"`。
- **Element Plus 的一个坑**（源码事实，不是推断）：`el-radio-group` 模板里写的是
  `"aria-label": !isLabeledByFormItem ? __props.ariaLabel || "radio-group" : void 0`——
  不传 `aria-label`，读屏念的是英文 **"radio-group"**；同族的 `el-segmented` 默认念 **"segmented"**。
  另外它只透传 `aria-label`，`aria-labelledby` 只有包在 `el-form-item` 里才会被用上。

## 4. 摆放：在被控内容正上方、和该内容的左边缘对齐

Carbon Design System 的三条原句（转述自调研，未逐条复核原文）：

1. "Place the content switcher **above the content area** to create a clear hierarchy for the section
   that the switcher controls."
2. "It can be aligned to the **left or right** side of the content area but **should never be centered**."
3. "Do **not** flush align the switcher to the edges of containers."

实测：切换器所在工具行的左边缘 = 词库树的左边缘 = **552px**（同一列），没有居中，也没有贴卡片边。

**为什么没放进「③ 词库」那行分隔标题的右侧**：设置页一共 13 个 `.sf-settings-divider` 标题行，
**没有一行**带右侧控件。单独把 ③ 改成带回动作的标题行，会破坏页面自己的既有节奏——
这是仓库约定压过外部习惯的一处，记在这里以免下次又被"顺手改"。

## 5. 三段等宽，以及选中态必须有达标的边界（这条是量出来的，不是看出来的）

**等宽**：Apple HIG 原句 "In general, keep segment size consistent. When all segments have equal
width, a segmented control feels balanced."（复核过）
实测做法：`min-width: 72px`（最长的「彩色标记」= 4 个汉字 @12px = 48px + 左右各 11px 内边距 = 70px，取 72 留余量），
内层自带 `box-sizing: border-box`，实测三段都是 **72 / 72 / 72**，都没有文本截断。

**选中态**：第一版只有一层淡灰底。用 WCAG 相对亮度公式在页面里现算：

| 元素 | 实测值 | 对比 |
| --- | --- | --- |
| 选中段底色 `#f0f1f3`（`--color-ink-soft`）对白底 | **1.13:1** | 远低于 WCAG 1.4.11 要求的 3:1 |
| 三段 `border-width` / 真正画的 `outline` | **0px** / 1px，三段同色 `#cdd3da` | 选中态等于没有可见边界 |

（这里我自己踩过一次测量的坑：先量 `borderColor` 得到 `#8a929e`，差点当成"选中态描边已达标"——
但 `border-width` 是 0，`border-color` 的初始值是 `currentColor`，那个值是文字色染上去的，**根本没画出来**。
补量 `outline*` 才发现三段是同色的。）改法是两层：

- 选中那一段的 `outline-color` 提到 `--color-text-tertiary`（`#8a929e`，对白底实测 **3.14:1**，
  对选中底 2.78:1——它要对比的是相邻的白底，够了）。这个令牌正是仓库给输入框 hover / focus 用的描边色。
- 字重：选中 500、未选中 **400**。EP 的 `--el-font-weight-primary` 本身就是 500，
  所以**基础档不显式写 400 的话，"选中加粗"是个空操作**（实测三段同 500）。

改完的三档差异与文字对比度：

| 档 | 实测 |
| --- | --- |
| 选中：底 / 描边 / 字重 | `#f0f1f3` 1.13:1 / `#8a929e` 3.14:1 / 500 |
| 未选中：底 / 描边 / 字重 | `#ffffff` / `#cdd3da` 1.5:1 / 400 |
| 文字：选中 `#16181d` 压淡底 | **15.71:1** |
| 文字：未选中 `#545b66` 压白底 | **6.85:1** |

与仓库既有语言的关系：设置页左栏导航 `.sf-settings-nav-item.active` 就是
「`--color-ink-soft` 底 + 正文色 + 500 字重」，未选中是次要色——这次只是把同一套照搬过来，
**多加了一条达标描边**，因为分段控件的"当前是哪个"就是它的全部信息量。

## 6. 为什么没用 `el-segmented`（调研确实建议过）

调研的建议原文是「直接用 `el-segmented`……它更接近 Finder/Trello 这类视图切换的观感」。没采纳，三条实测理由：

1. **2.14.5 里没有 `el-segmented-item` 子组件**（`es/components/segmented/src/` 下只有
   `segmented` 与 `types`），也就是每个分段塞不进图标或单独的 tooltip，只能吃 `options` 的纯文字。
2. **容器+胶囊那套观感需要一条中灰轨道**：调色板里最浅的三档是 `#ffffff`（surface）、
   `#f7f8f9`（surface-muted）、`#f0f1f3`（ink-soft），做不出「白胶囊压中灰轨道」的对比；
   要做得另造一档色阶，而仓库规定色值只能来自 `tokens.css`。
3. **仓库已有的分段语言是"灰底 + 描边 + 字重"**（节点卡片 `.sf-node-advanced-qn.is-active`），
   换过去等于在同一个产品里出现第三套分段外观。

这是一处**主动的取舍**，不是没看到建议。要换随时能换，代价是上面第 2 条那一档新颜色。

## 7. 键盘与无障碍：能验的都验了，验不了的说清楚

- 结构前提（实测）：三个 `input[type=radio]` 共用同一个 `name`（`el-id-1485-51`），可以聚焦
  （`focus()` 后 `document.activeElement.type === "radio"`）。这是原生方向键切换的前提。
- **方向键本身在本环境无法验证**：合成按键驱动不了原生 radio 的方向键默认行为。
  我做了对照实验——往页面上插一组最朴素的原生 radio（同 `name`、无任何框架），
  用同样两种按键方式驱动，它**也不动**。所以这条记为**无法验证**，既不是通过也不是失败。
- 鼠标路径实测通过：点「清单」→ 树变 `sf-tag-tree--list`；点回「彩色标记」→ 变回 `--color`。
- hover 态同样受环境限制（合成事件触发不了 CSS `:hover`），只做了级联推导：
  未选中段 hover 时文字由 `#545b66` 转到 `--el-color-primary`（本仓库即墨色），不产生第二段底色变化。

## 8. 参考来源

我**亲自复核过原文**的：

- Apple HIG · Segmented controls（正文经其 JSON 端点取得）
  <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/segmented-controls.json>
- GitLab Pajamas · Segmented control（选项数量、可见/可访问标签）<https://design.gitlab.com/components/segmented-control/>

以下来自本次调研 pass 的转述（带了 URL，但我没有逐条复核原文）：

- GitHub Primer · SegmentedControl <https://primer.style/product/components/segmented-control/guidelines>
- Carbon · Content switcher <https://carbondesignsystem.com/components/content-switcher/usage/>
- Material/Flutter · SegmentedButton <https://api.flutter.dev/flutter/material/SegmentedButton-class.html>
- Ant Design · Segmented <https://ant.design/components/segmented>
- 同仓库既有调研：[多视频结果的分组切换](segment-navigation-research.md)（早就引过同一份 Apple HIG 的段数上限）

## 9. 诚实清单

- **方向键与 hover 这两项没验成**，原因是对照组说明的环境限制；见 §7。不要把这两条当成通过。
- **§4 的 Carbon 三条、§1 的 Primer/Material/Ant，我没有逐条复核原文**，是调研 pass 的转述。
  §2、§3、§5 里引的 Apple HIG 与 GitLab 原句我复核过。
- **没实机看过 macOS Finder / Google Drive**（本机 Windows），所以「成熟产品把 View 按钮放工具栏左边还是右边」
  这类细节在本文里没有当作依据使用。
- **`el-segmented` 的取舍（§6）是判断，不是规范要求**：三条理由里第 1、3 条是实测/代码事实，第 2 条是调色板事实，
  但"因此不换"这一步是我的决定。
- **未做的事**：没给这个控件加快捷键（调研里所有快捷键都属于"全局高频视图"——Finder `⌘1..4`、
  Drive `V`、Linear `Shift V`，没有一个是为设置面板里的分段控件配的）。
- **持久化**：`tagView` 存在服务端设置里（用户级偏好），不写进工程图；与仓库既有约定一致。

## 10. 追加（2026-10-13，第二次返工：默认改单色、形态改图标按钮）

> 本节**取代 §5 的形态部分**（文字等宽的三段拼接 → 三个分开的图标按钮）；
> §5 里量出来的数字（3.14:1 的描边、字重 400/500 那两条）依然成立，只是现在长在图标按钮上。
> 触发是用户看完上一版后的两句原话：「1、改成默认单色　2、你这个实现有问题，**右侧线是浅的**，
> 你要么就改成图标模式，反正你这种胶囊设置很土，实现还出问题了」，附了一张选中格右侧线发浅的截图。

### 10.1 那条"浅线"的根因（§5 的解释不准确，这里改掉）

我在 §5 里把选中态的描边说成"达标边界"，但没说清为什么右边会浅。真实机制是**邻居那一格的背景盖住了它**：

- EP 的 `.el-radio-button__inner` **本身就是 `position: relative`**（编译后的 CSS，不是我们加的），
  所以拼接在一起的每一段都是**定位元素**，彼此的绘制顺序按 DOM 先后。
- 相邻两段的盒紧挨着，而 outline 画在盒**外侧**：选中段的右描边落在它自己盒外那 1px，
  而邻居的**背景盒**正好覆盖这同一像素；邻居在 DOM 里靠后，**它整块（背景 + 描边）后画**，于是把选中段的右描边压掉了。
- 左边为什么没事：左邻居先画。所以症状必然是"左侧深、右侧浅"，与用户的截图完全一致。

**像素级对照实验**（打开「新建工程」对话框，同一像素，只切 `z-index`，其余不动）：

| 采样点（选中段「B站链接」） | 撤掉 `z-index`（复现改前） | 有 `z-index: 1`（改后） |
| --- | --- | --- |
| 右边缘外侧 | `rgb(244,245,247)` **浅** | `rgb(161,167,177)` **深** |
| 左边缘外侧 | `rgb(165,171,180)` 深 | `rgb(165,171,180)` 深（对照：未变） |
| 右边缘内侧（填充） | `rgb(236,237,240)` | `rgb(241,242,244)` |

左边缘两组完全相同，是这次实验的内部对照——证明我改的确实是右边缘那一条（不是把整块都改了）。

（数值不是纯 `#8a929e` 是因为边缘落在小数像素上：那一格右边界在 `355.77px`，
样本像素约 77% 被描边覆盖、23% 是邻居底色，所以是 161–177 的混色。）

### 10.2 三处修复

1. **设置页的切换器改成三个分开的图标按钮**（4px 间隙）：结构上就不存在共边，也就没有这条缝。
   形状照抄同一块里的 `.sf-tag-icon-btn`（24×24、透明底、hover 淡灰、圆角 5px），
   24×24 同时是 WCAG 2.5.8 的目标尺寸下限。图标：调色板（彩色标记）/ 黑白圆（单色）/ 三行线（清单）。
2. **全局那一份也修**：`styles/element-theme.css` 给选中段加 `position: relative; z-index: 1`，
   把它的整块抬到邻居之上。**拼接式**分段控件（「新建工程」的「来源」四选一，以及以后的用法）都吃这一条。
   EP 自己的 `:focus-visible` 规则就是这么干的（`z-index: 2`），我们是同一个手法。
3. **补第三个漏掉的样式入口**：`element-plus/es/components/radio-group/style/css.mjs`
   —— `radio/style/css.mjs` 既不带 `radio-button` 也不带 `radio-group`。少了它，分组容器没有
   `display: inline-flex / font-size: 0`（实测补上后 `font-size: 0px`、`flex-wrap: wrap` 生效）。
   和 §0 那条是同一类疏漏，一并记在这里。

### 10.3 默认改成单色

`DEFAULT_TAG_VIEW`（`packages/shared/src/obsidian.ts`）从 `"color"` 改成 `"plain"`，
服务端那条断言同步改（`apps/server/src/routes/settings.test.ts` 的「默认是 plain（单色）」）。
理由：仓库整体的克制风格本来就是一档灰，彩色标记是给"想一眼看出分组"的人额外准备的可选项。

### 10.4 本轮诚实清单

- **点击是用 `evaluate` 里的 `.click()` 验证的，不是真指针**：这个浏览器面板里 Playwright 的真鼠标
  `click()` 会超时（连 `role=radio` 和可见的 24×24 按钮都点不中，元素矩形量得到、就是点不中），
  所以切换与保存走的是同一套 DOM 事件路径、但不是真实指针事件。
- **"新装默认是单色"没有真去清库验证**：只由服务端测试覆盖（无记录时回落到 `DEFAULT_TAG_VIEW`）；
  实测到的 `plain` 是我在这个页面里点「单色」+「保存设置」写进去的，那是"保存生效"的往返验证，不是默认值验证。
- **键盘方向键仍然无法验证**（原因见 §7 的对照实验）。图标按钮这段的焦点环只做了 CSS 层叠推导：
  2px `--color-text` 环 + 1px offset，间隙 4px 大于 1+2，所以环不会碰到邻居。
- **改前/改后的像素对比是在「新建工程」对话框上做的**，不是设置页那个控件：设置页已经是分开的按钮，
  结构上已经不存在共边，所以那边没有"改前"可以复现。

## 11. 追加（2026-10-13，第三次返工：「选中之后的异常黑边动效」）

> 用户原话：「选中之后的异常黑边动效，让人难受，**你就不能好好调研一下别人这种样式切换怎么做的么**」。
> 这一轮既查了别人怎么做，也**推翻了我自己上一轮的两句话**（下面 11.1）。
> 落地：`apps/web/src/views/SettingsView.vue`（图标按钮那三条规则）、`apps/web/src/styles/element-theme.css`（全局那份）。

### 11.1 先纠正我自己说错的两处

1. **焦点环不是元凶**（上一轮我把它列为怀疑对象）。实测：**Chrome 里鼠标点击 radio 根本不命中 `:focus-visible`**
   （本机 Chrome 154，两轮：合成页 + 真实应用，返回 `radioFocus: true, radioFocusVisible: false`）。
   原因是 Blink 的判定要求「键盘事件模态」，而 radio 不属于「可能唤起虚拟键盘的输入」（`IsEditable` 为假），
   label 上的可信点击走的是 `FocusType::kMouse`。按 `:focus-visible` 的既定意图，它本来就是"作者只改外观、
   何时显示交给 UA"——所以**不要**去抑制它，抑制会直接破坏 WCAG 2.4.7。
2. **"对白底 3.14:1 达标"这句话用在设置页是错的**。设置页正文的真实底色是 `--color-bg` `#f4f5f6`
   （在运行中的应用里顺着背景链量到的：`el-radio-group → sf-tag-toolbar → sf-settings-form → sf-settings-body → sf-settings = rgb(244,245,246)`），
   不是白。按真实相邻色重算：`--color-text-tertiary` `#8a929e` 对它只有 **2.877:1**，**低于 3:1**；
   换成 `--color-text-secondary` `#545b66` 是 **6.276:1**（内侧对自己那层淡灰底 6.062:1）。两个数我都复算过。

### 11.2 那条"黑边的动效"到底是什么

**成因**：EP 给 `.el-radio-button__inner` 的默认是 `transition: all .3s`（`--el-transition-all: all .3s cubic-bezier(.645,.045,.355,1)`），
它把 **outline 也一起动画**了；而基态我写的是 `outline: none`，它的 computed 颜色是 `currentColor`
——悬停时 `color` 已经是正文色（近黑 `#16181d`）。于是点下去的一瞬间先冒出一条**近黑**描边，
再用约 250ms 褪成灰色。**动的不是宽度，是颜色。**

**实测时间线**（真实应用，真 hover + 真点击，CDP 采计算值）：

| 时刻 | `outline` |
| --- | --- |
| 悬停 | `none 0px rgb(22,24,29)` |
| 点击后 0ms | `solid 0px rgb(22,24,29)` |
| 40ms | `solid 1px rgb(26,29,34)` |
| 80ms | `solid 1px rgb(42,45,51)` |
| 150ms | `solid 1px rgb(121,128,139)` |
| 250ms | `solid 1px rgb(138,146,158)` ← 最终色 |

**修法**：把 `transition-property` 收窄到只过渡底色与图标色
（`transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)`）。
修复后同一实验：点击后 **40ms 就是终值** `solid 1px rgb(84,91,102)`，再不变化。
全局那份（`.el-radio-button`，拼接式的「新建工程 / 来源」也吃它）同样收窄。

### 11.3 别人怎么做（本轮调研的结论，来源见下）

| 系统 | 选中态怎么表达 | 那圈"边" | 过渡 |
| --- | --- | --- | --- |
| Material 3（outlined segmented button） | 填 `secondary-container` | token 里**只有**未选中/容器边界色，**没有 `selected.outline.*`** | state layer 透明度；勾选动画单独用 keyframes |
| Carbon content switcher | `::after` 色块 `scaleY(0) → 1` | 只有组级 1px 外框，选中项自身不加 | **整个文件没有任何 `transition`** → 瞬时 |
| GitHub Primer SegmentedControl | 滑块 + `border: 1px` | 有 1px 边 | 滑块 `transition: inset …` 且**包在 `prefers-reduced-motion: no-preference` 里** |
| GitLab Pajamas | 选中按钮：底色 + **`box-shadow: inset 0 0 0 2px`** | 用 inset 阴影画的常驻 2px | **列举式**：`color, background-color, border-color, box-shadow, …` |
| Ant Design Segmented | 白色滑块 + 阴影 | 无描边 | 容器 `transition: all 0.2s`（是的，它也用 `all`） |

一句总结：**给选中项加边是有先例的（Primer / Pajamas），但边宽常驻不变、变的只是颜色；
"边从 3px 收到 1px"或"边从近黑褪到灰"没有先例。** Pajamas 文档还有一句正对本题：
"Behavior: Results are effective and visible immediately."（<https://design.gitlab.com/components/segmented-control/>）

来源：M3 token `_md-comp-outlined-segmented-button.scss`、Carbon `_content-switcher.scss`、
Primer `SegmentedControl.module.css`、Pajamas `button.scss` + `variables.scss`、
antd `components/segmented/style/index.ts`（都在各自 GitHub/GitLab 仓库里）；
`transition: all` 的反对意见能拿到原文的来自 eslint-plugin-unicorn 的 `no-transition-all`
（默认进 recommended）："Using `all` can transition properties added or changed later, making transitions
less predictable and potentially less efficient. List the properties that should transition instead."

### 11.4 为什么你可能一直没看见这个动效

仓库 `tokens.css` 里有全局兜底：`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important } }`。
开了"减少动效"的用户看不到它，报障的人用的是默认设置——所以它只在默认设置下复现。

### 11.5 本轮诚实清单

- **我自己复测过的**：描边时间线（上面那张表，真实应用真鼠标）、设置页真实底色链、
  `--color-text-secondary` / `--color-text-tertiary` 对页底的两个对比度（与调研给的数一致）。
- **没查清的**：`outline: none` 的 computed `outline-width`，我在静态读数里量到 `0px`、调研在合成页量到 `3px`
  （`medium`）。差异原因没追下去；**它不影响结论**——观感来自颜色的 250ms 渐变，而且宽度在我这里 0→1px 是瞬时的。
- **没验证的**：Firefox / Safari 的 `:focus-visible` 判定（本机 Windows，无实机）；
  也没在带界面的 Chrome 里复测过（两轮都是 CDP 驱动的同一套 Blink 逻辑）。
- **`transition: all` 没有"官方文件明确反对"**这一说成立与否：CSS Transitions 规范里我没找到反对原文，
  能引的是工具链（unicorn 规则）的观点；antd 自己就用了 `all 0.2s`。所以这条的落脚点是"它会把你不想要的
  属性一起动画"，而不是"`all` 本身违规"。
