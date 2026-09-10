# 结果页 tab 切换：标准依据与实测对照

> 触发：用户质疑「你调研过吗，别人的 tab 也是这种样式？」。
> 诚实结论：**第一版（滑动墨条 + 内容淡入）是我按经验改的，没查依据**。本文补齐调研，并把与主流不一致的部分改掉。
> 测量方式都可复现：Element Plus 读本地 `node_modules` 的 CSS，Ant Design 读其线上站点真实 `getComputedStyle`，M3/NN/g 读官方文档正文。

## 1. 实测对照

| 参考 | 指示器（选中态） | 切换时内容 | hover / 状态 | 备注 |
|---|---|---|---|---|
| **Element Plus `el-tabs`**（本项目在用的库） | `.el-tabs__active-bar`：`height:2px`、`background: var(--el-color-primary)`、`transition: width / transform 0.3s ease-in-out-bezier` | **无动画**，面板直接显示 | `.el-tabs__item:hover{color:brand}`；`:focus-visible{box-shadow: 0 0 2px 2px brand inset; radius:3px}` | 宽度按标签实测宽度滑动 |
| **Ant Design**（ant.design 线上） | `.ant-tabs-ink-bar`：`height:2px`、`transition-property: width,left,right`、`transition-duration: 0.3s`、`timing: ease`；墨条宽度=标签宽度（实测 35px = 35px） | 官方 `animated` 默认 **`{ inkBar: true, tabPane: false }`** —— **内容不动画** | 无背景洗色，仅文字色变化 | — |
| **Material 3 · Tabs** | 「To differentiate an active tab from an inactive tab, **apply an underline and color change** to the active tab's text and icon」→ 两条线索 | — | 「The inactive and active states of a tab can inherit a **hover, focus, and pressed** states」 | — |
| **Material 3 · Transitions** | — | 「Lateral transitions use a sliding motion…, but it **does not use a fade** or parallax effect. A lateral transition is used when tapping or swiping a **Tab** component」→ tab 用横向滑动、**明确不要 fade** | — | — |
| **NN/g · Tabs, Used Right** | 「Lines. Include a horizontal line to underline the selected tab… **Do not use thin, single-pixel strokes or poor-contrast colors**」；「**Use at least two selection indicators**… critical when there are only two tabs」 | 未规定 | 未规定 | 反面案例是「下划线自动轮播切换」，不是「下划线有过渡」 |
| **本项目既有范式 A**：`WorkspacePanel .wp-seg`、`SourcePickerDialog .sp-tabs` | **分段滑块**：轨道 `--color-ink-soft`，选中项白底 + `--shadow-xs`（`.wp-seg-btn.active`），无滑动动画 | 无动画 | `.sp-tab:hover{ background: ink-soft; color: text }` | 用于「面板内视图切换」 |
| **本项目既有范式 B**：结果页原 tab | 2px **墨色**下划线（`border-bottom-color: var(--color-text)`） | 无动画 | 无 | 本次改造的起点 |

## 2. 结论与落地

1. **滑动指示器 = 主流，保留。** Element Plus（本项目在用）、Ant Design 都是 2px 指示条滑动；M3 的 tab 动效是横向滑动；NN/g 要求「下划线 + 至少第二条线索」。→ 保留 `.rv-tabs-ink`，并保持**墨色 + 文字颜色变化**两条线索（激活 `--color-text`、未激活 `--color-text-secondary`，对比度足够）。
2. **内容淡入 = 我自加的、与主流相反，已删除。** Ant 默认 `tabPane:false`、Element Plus 无内容动画、M3 明确说 tab 不用 fade。→ `setActiveTab()` 现在只切面板 + 滑墨条；面板仍用 `v-show`，保留正文滚动位置与表格状态。
3. **hover / pressed / focus 状态是标准要求，保留**（M3 明说 tab 应继承 hover/focus/pressed；改动前完全没有）。hover 洗色沿用房内 `.sp-tab` 的做法（`--color-ink-soft` 系），而不是 EP/Ant 的「只变文字色」，因为房内两处 tablist 都是洗色，保持一致。
4. **颜色用墨色而不是品牌蓝**：房内令牌规定「B 站蓝只用于交互信号；墨色用于导航/强标题」，且该处下划线改造前就是墨色。EP/Ant 用品牌色是它们的设计系统选择，本项目跟随自己的令牌。
5. **时长用房内令牌**：`--dur-3`（240ms）+ `--ease-out`，而不是 EP/Ant 的 0.3s ease-in-out；`--ease-out`（减速曲线）更适合「指示条抵达目标」，且全站动效统一由令牌驱动。

## 3. 仍然可以选的两条路（如果视觉上还不满意）

| 选项 | 依据 | 代价 |
|---|---|---|
| 换成房内**分段滑块**（`wp-seg` / `sp-tabs` 那套：ink-soft 轨道 + 白底选中块） | 本项目另外两处 tablist 就是这个形态，全站更统一 | 与「结果页是文档阅读面」的调性不同；轨道色块比下划线重 |
| 按 M3 做**横向滑动**（内容随 tab 左右平移、无 fade） | M3 对 tab 的推荐动效 | 正文面板可达数万像素高，横向 transform 会为大面积元素建合成层，有性能与滚动位置风险；不适合文档型长面板 |

## 4. 复现方式

```powershell
# Element Plus：读项目自己安装的 theme-chalk
Select-String -Path node_modules/.pnpm/element-plus*/node_modules/element-plus/theme-chalk/el-tabs.css -Pattern 'active-bar|tabs__item'
```

```js
// Ant Design / M3 / NN/g：在真实页面上读计算样式与正文
getComputedStyle(document.querySelector('.ant-tabs-ink-bar')).transitionDuration; // "0.3s, 0.3s, 0.3s"
getComputedStyle(document.querySelector('.ant-tabs-ink-bar')).transitionProperty; // "width, left, right"
```
