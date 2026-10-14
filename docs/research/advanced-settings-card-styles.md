---
title: 节点卡片上的「高级设置」怎么排：成熟做法调研与五套原型
class: research
---

# 节点卡片上的「高级设置」怎么排

> 触发：反馈「高级设置这个模块在我们卡片整体的排版、样式需要优化，感觉目前不是很好看」，
> 并要求给出**多套可选**的样式 demo、**不要凭空捏造**。
> 日期：2026-10-14。
> 交付物：原型页 [`advanced-settings-card-demos.html`](./advanced-settings-card-demos.html)（可切换/可放大，双击即可看）
> + 整页图 [`advanced-settings-card-styles-overview.png`](./advanced-settings-card-styles-overview.png)。
> 本页只回答「哪种排法有依据、代价是什么、数字是多少」；**没有改动产品代码**。

**追加（2026-10-14 当日）：用户选定 B，已在真机实现并复测**——落地差异见 §6.1。

**先给结论。** 调研覆盖 10 个画布/工作流产品 + 7 套设计系统之后，只有一条结论是硬的：
**本仓现在这种「卡片里再套一个带边框的小盒子 + 它自己的 × 」的写法，在调研范围内找不到第二家。**
n8n / Node-RED 的卡片上只有标题与副标题（配置全在节点详情视图或对话框里），
Dify / Langflow / Tines 把配置放右侧面板，ComfyUI 是唯一把设置放进画布卡片的（放的是主参数，不是高级参数）。
推荐 **[B 行式（文案左、控件右）](./advanced-settings-card-demos.html)**：它有 Windows 11、libadwaita 两套系统级依据，
把卡片高度从 **512.2px 压到 396px**（−116.2px），且天然消掉嵌套盒子。
若只想动最小一步，**[C 轻量内联](#6-五套原型与数字)** 保留现有字段排法、只去掉盒子——但**高度几乎不降**，这条实测要记住。

---

## 1. 现状：问题在哪（读代码 + 真机实测）

| 事实 | 来源 |
| --- | --- |
| 高级设置是卡片内的**嵌套边框盒子**：`1px solid var(--color-border)` + `background: var(--color-surface-muted)` + `radius 8px` + `padding 10px 12px`，自己还有一行标题与「×」 | `apps/web/src/components/canvas/ScribeNode.vue` 的 `.sf-node-advanced` |
| 盒子里的字段是「标签在上、控件在下」；**字段内部间距 6px，字段与字段之间 0px** | 同上 `.sf-node-field { gap: 6px }`；已改为 12px（见 CHANGELOG 2026-10-14） |
| 四字段的 Obsidian 卡片：**卡片总高 525.1px、高级区 339.2px**（真机 Chrome，设计像素） | 探针脚本量真机（见 §7 的测量说明） |
| 同结构在原型的 1:1 复刻里是 **512.2 / 339.2px**，与真机差 12.9px（原型外壳手写，误差来源已列在诚实清单） | 原型页自量 |

「0 的字段间距」这一条已经在本轮修掉（改成 12px）；本页讨论的是**结构本身**，不是那条间距。

## 2. 调研：画布类产品怎么放节点设置

十款，逐条给「在哪 / 怎么露出来 / 字段怎么排 / 来源 / 置信度」。**这一节的关键结论：卡片内嵌套盒子没有先例。**

| 产品 | 设置放在哪 | 「高级」怎么露出来 | 来源与置信度 |
| --- | --- | --- | --- |
| **n8n** | 不在卡片上：卡片只有名字 + subtitle；配置在节点详情视图 NDV | ① 参数 tab 内的 `collection` → 「**Add Option**」按钮追加行（官方原文 "Select **Add Option** to view and select these options."）；② 单独一个 **Settings tab**（官方原文："The node settings under the **Settings** tab allow you to control node behaviors and add node notes."），装 Always Output Data / Execute Once / Retry On Fail / On Error / Notes | 官方节点文档（`collection` / node settings）；NDV 的多 tab 结构来自源码导出的二手资料 —— **official / 二手混合** |
| **Node-RED** | modal 编辑对话框 | 官方原文：对话框「contains three tabs」——Properties / Description / **Appearance**；追加行靠 `editableList` 的 `addButton`（`true`→按钮写 "Add"，字符串→自定义文案，`false`→不显示），官方点名 "Used by the core Switch and Change nodes" | 官方 node 创建指南 —— **verified-official** |
| **Dify** | 节点配置面板（二手资料称右侧） | 官方 LLM 文档**只按顺序列小节**（Model Selection and Parameters / Prompt Configuration / … / Memory and File Processing / Vision Configuration / Jinja2 Template Support / Streaming Output / Error Handling），**全页没有 "Advanced Settings" 字样**；「高级设置」这个分组名只见于中文二手资料 | 官方 LLM 节点文档 —— **official（不含"高级设置"四个字）／折叠行为未能证实** |
| **Langflow** | 右侧面板 | 官方原文：「a component inspection panel appears **on the right side**」，且「displays all of a component's parameters, **including hidden or advanced parameters**」；「By default, components show only **required and common** options」 | 官方 concepts / components 文档 —— **verified-official** |
| **ComfyUI** | **参数就在画布卡片里**（widget），节点可拖角缩放 | 官方只证实概念（"Usually, a property can be converted from widget to input and vice versa"）；「Convert widget to input」右键项与 Properties 面板只有社区 wiki —— **卡片里放的是主参数，高级动作走菜单/面板** | 官方 properties / nodes 页 —— **official（概念）／右键项二手** |
| **Make** | 模块设置 | 「To open the advanced settings, switch on the **Show advanced settings toggle**」——**一个总开关**全显/全隐 | 官方页经搜索索引（直连 403）—— **二手** |
| **Tines** | 「**properties panel on the right of the storyboard**」 | 「You can access these options by clicking on the **add option button at the bottom of the properties panel**」 | 官方 actions/configuration（源站 403，经索引）—— **二手** |
| **Flowise** | 节点（弹窗，形态未证实） | 官方文档正文出现 "Click **Additional Parameters** on ChatOpenAI node"——存在一个叫 Additional Parameters 的折叠元素 | 官方文档 —— **official（文案）／形态二手** |
| **Windmill** | 每个 step 的 **Advanced 菜单**（弹层） | 官方 retries 页证实 Advanced 里有两个 toggle（Constant retry / Exponential backoff）+ "Continue on error…" | 官方 retries 文档 —— **official（内容）／菜单形态二手** |
| **Retool** | 官方 IDE 页只列 Canvas / Left panel / Status bar / Toolbar，**没有 "Inspector" 一词**；workflow block 的 Settings 是**平铺**的超时/重试字段（无高级折叠） | — | 官方 IDE 与 block 参考页 —— **二手** |

**两条直接可用的观察**：

1. **卡片上的设置越少越好**：n8n / Node-RED 的卡片只承担「一眼看出这是什么节点」；
   ComfyUI 是唯一把参数放进卡片的，而它把「高级动作」全部移出卡片（右键菜单 + Properties 面板）。
2. **「高级」的四种成熟形态**：追加行（n8n `Add Option` / Tines `add option` / Node-RED `Add`）、
   一个总开关（Make `Show advanced settings`）、折叠区（Flowise `Additional Parameters`）、
   独立 tab 或菜单（n8n `Settings` tab / Windmill `Advanced`）。
   **没有一种是「在卡片里再套一个带边框的盒子」。**

## 3. 调研：揭示模式本身的设计规则

| 系统 | 规则（原文） | 对我的意义 | 来源 |
| --- | --- | --- | --- |
| **GOV.UK Design System** | Details 组件的 summary **写主题**（示例 `Help with nationality`），官方**没有** Show/Hide 的措辞要求；「Use the details component instead of tabs or an accordion **if you only have 1 section of content**」；「**Do not use** the details component to hide information that **the majority of your users will need**」；Accordion 页：「**Do not put accordions within accordions**」「Avoid using any of these components within one another」（Accordion / Tabs / Details）；用户研究里有一条：「some users avoid clicking the link to show more details」 | ① 我们的高级设置正好是**单块**内容 → 用 Details 式 summary 有依据；② **禁止把揭示组件互相嵌套**，而现在正是「卡片里再放一个可展开的盒子」；③ summary 文案要写主题（我们是「高级设置」，合规） | 官方 components/details、components/accordion（**verified-official**） |
| **Apple HIG** | 「Provide a **descriptive label** when using a disclosure triangle… like "**Advanced Options**"」；「**Use no more than one disclosure button in a single view**」；「Place controls that people are most likely to use at the top… **with more advanced functionality hidden by default**」；Settings：「Minimize the number of settings you offer」 | 「一屏最多一个 disclosure 按钮」直接质疑当前卡片（选中条一个入口 + 盒子里的 × + 盒子的边框）多入口并存 | 官方 disclosure-controls / settings（**verified-official**） |
| **NN/g** | Progressive disclosure：主/次功能的切分要准、**从主到次的路径要显然**；「designs that go beyond **2 disclosure levels** typically have low usability」；Accordion 的适用条件是「people need only a few key pieces of content」，并提醒「When content is hidden, people might ignore information」，建议允许多段同时展开 | 我们的路径是「画布 → 卡片高级设置」= 1 层，安全；但若在卡片里再嵌一层，就逼近上限 | 官方 progressive-disclosure / accordions（**verified-official**） |
| **Material（M1/M2 expansion panel，官方归档）** | 「a lightweight container that may either stand alone or be connected to a larger surface, **such as a card**」；规格：上下 padding **16dp**、左右 **24dp**、展开图标 **24×24dp**、label 15sp、secondary text 12sp | 说明「卡片内的展开面板」本身是被官方承认的形态（≠嵌套盒子）：**面板是卡片的一部分，不是卡片里的另一个盒子** | m1.material.io（**verified-official**）；M3 列表为 SPA 抓不到（二手） |
| **Polaris / Zapier / GitHub** | Polaris 迁移示例即 `<summary>**Advanced settings**</summary>`，且要求「content **immediately after the button**」、「Don't use to hide error messages or critical information」；Zapier：「Under Settings, click **Advanced** to expand the section」；GitHub/Primer 的 `Details` 就是原生 `<details>` 的样式化 | 「Advanced settings」这个**英文措辞**有出处；「内容紧跟按钮」是排版要求 | shopify.dev（**二手**）、help.zapier.com（**official**）、primer.style（**official**） |
| **Element Plus** | 折叠面板：`accordion` 默认 `false`；**没有 `ghost`/`bordered` 属性**（这点与 antd 不同）；默认 `--el-collapse-header-height: 48px`、内容 `padding-bottom: 25px`、字号 13px；官方**未文档化嵌套** | 落地别指望 EP Collapse：**48px 的 header + 25px 的下内边距在 300px 卡片里太重**；嵌套折叠无官方支持，属未文档化行为 | 官方 collapse 文档 + dist CSS 实测（**verified-official**） |
| **Ant Design** | Collapse 有 `ghost`（"Make the collapse borderless and its background transparent"，4.4.0）与 `bordered`；**官方文档里有 Nested panel 示例** | 若将来换 antd 系，ghost 折叠是可选项；当前不用 | ant.design/components/collapse（**verified-official**） |

## 4. 调研：窄面板（260–320px）里的字段几何

这一节是为了**不靠感觉定值**——每套原型的间距都能落到一个出处或一条实测上。

| 事实 | 数值（原文） | 来源 |
| --- | --- | --- |
| Ant Design 的 horizontal 表单**自己在 575px 以下堆叠** | "By default, `horizontal` stacks labels above controls when the viewport width is `575px` or less" | ant.design/components/form（**official**） |
| Ant 的垂直表单：标签与控件间距只有 **8px**、项间距 **24px**；控件高 32 / small 24 | `verticalLabelPadding` = `0 0 8px`、`itemMarginBottom` = 24、`controlHeight` 32 / `controlHeightSM` 24 | antd 源码 style/index.ts（**official**） |
| Carbon：默认「标签在输入框**上方**」；输入尺寸 32/40/48px；表单项之间 32px | `$spacing-01..10` = 2/4/8/12/16/24/32/40/48/64px | carbondesignsystem.com form usage / spacing overview（**official**） |
| SLDS：**标签在上更好读**，「Use horizontal labels **only if** you need to save vertical real estate and have **fewer than 10 fields**」 | — | SLDS Data Entry 指引（经索引，**二手**） |
| Windows 11：设置行=文案左、**控件右对齐**；「**12epx** between control and label」「**16epx** between surface and edge text」；expander：「Controls should be right-aligned with **16epx** between the control and expander button」；「**Avoid nesting expanders deeper than one level**」 | 见左 | learn.microsoft.com guidelines for app settings（**official**） |
| VS Code 设置行：断点 700px（`TOC_RESET_WIDTH 200 + EDITOR_MIN_WIDTH 500`），**窄了只隐藏目录、设置行仍不堆叠**；行内 `padding: 12px 14px 18px`、`.setting-item-value { margin-top: 9px }`；控件宽度写死（text 420px / select 320px / number min-width 200px） | 见左 | VS Code 源码 settingsEditor2.css 等（**official 源码**） |
| libadwaita：`AdwActionRow` = 标题 + 副标题 + 前缀/后缀控件；`AdwExpanderRow` = **开关常驻头部行 + chevron 展开更多**；`AdwPreferencesGroup` = 组标题 + 说明 + 若干行 | 无 px（libadwaita 不文档化像素） | GNOME 官方类文档（**official**） |
| Material 3 列表：一行 56dp / 两行 72dp / 三行 88dp | — | m3.material.io Lists（经索引，**二手**） |

**这些数字落在我们的 300px 卡片上的结论**：左标签右控件在 320px 宽里**没有任何一家设计系统的文档支持**
（Ant 干脆在 575px 就堆叠、VS Code 700px 以下也不堆叠、SLDS 给的门槛是「字段少于 10 个」且明确说「只为省垂直空间才用」）。
但我们这个面板刚好满足 SLDS 的两个条件——**字段只有 4–5 个、且卡片高度是真金白银**——
所以 B 方案是**有依据的例外**，而不是照抄：原文的 12/16epx 间距是给 1000px 宽设置页的，
我们在卡片里取 **8px**，属于有意偏离，已写进原型注释。

## 5. 结论：五套原型

原型页 [`advanced-settings-card-demos.html`](./advanced-settings-card-demos.html)（静态 HTML，可切换单套、可放大 1.6×）。
五套共用同一张 Obsidian 卡片、同一组设置（4 个三态下拉 + 1 个开关），只换高级区的排法。

## 6. 五套原型与数字

| 方案 | 高级区呈现 | 卡片总高 | 高级区高 | 依据（可查证） |
| --- | --- | --- | --- | --- |
| **A 现状** | 卡内嵌套小盒子 + 自己的「×」 | 512.2px（真机 525.1px） | 339.2px（真机同） | —（基线；**调研范围内无第二家**） |
| **B 行式**（推荐） | 分隔线 + 行式：文案左、控件右 | **396px** | **217px** | Windows 11 SettingsExpander / libadwaita AdwActionRow |
| **C 轻量内联** | 一句 summary（`高级设置（5 项）`）+ 无框字段 | 515.5px | 301.2px | GOV.UK Details / Polaris `<summary>Advanced settings</summary>` |
| **D 侧栏 Inspector** | 配置搬出卡片，右侧面板分两组 | 163px（卡片）+ 面板 475.4px | —（无高级区） | Langflow 官方右侧 inspection panel / Dify / Tines |
| **E 卡片内 Tab** | 「参数 / 高级」分段控件二选一 | 338.2px（高级 tab）· 263.8px（参数 tab） | — | n8n NDV 的 Parameters / Settings 分 tab；Node-RED 对话框三 tab |

### 6.1 B 落地后的复测（真机 Chrome，设计像素）

| 项 | 改前（盒式） | 改后（行式） |
| --- | --- | --- |
| Obsidian 卡片·高级区 | 339.2px | **247.8px**（−27.0%） |
| Obsidian 卡片·整张卡片 | 525.1px | **431.7px**（−17.8%） |
| 字段行高 | 标签在上：标签 16.8 + 6 + 控件 32 = 54.8px | **32px**（一行一个设置） |
| 行距 | 12px（字段之间） | **6px**（`--stack` 整行字段前后 10px） |
| 控件列 | 全宽 | **128px** 定宽、右对齐；文本输入吃掉剩余宽度 |
| 面板外观 | 1px 边框 + 浅底 + 圆角 8 | **只有一条上边线**（无边框/无底色/无圆角） |

**落地时与原型不一致的三处（都是原型的手画控件盖住的真实约束，实测后改的）**：

1. **「抽取哪些属性」没有进行式**：它是 `multiple` 的 `el-select`，取值是 chips——塞进 148px 会换行成两三行；
   而且默认态占位文案「跟随设置：人物 / 事件 / 时期」有 11 个字，窄格子里会被截掉关键信息。
   原型里那格是手画的普通下拉，看起来能塞下，**是原型不忠实**。实现里给它 `--stack` 修饰类：整行、标签在上、控件全宽。
2. **控件列 104px 不够**：最长选项「自动（4-7 个）」在 104px 下被截成「自动(4-7 …」（实测），改成 **128px**。
   顺带加了一条断言：控件里的文字也不许被截断。
3. **重试两项（最大重试 / 退避间隔）也改成了行式**（`RetryFields.vue`）：否则它们紧跟「失败重试」小标题，
   与上面的行走两种节奏。
4. 另外两处实现细节记在代码注释里：标签必须用 `flex: 0 1 auto`（用 `1 1 auto` 时它会和「吃剩余宽度」的输入框
   互相抢，实测「导图标题（可选）」被压到 71px 截尾）；`--stack` 那段是纵向 flex，要显式把行式那套
   `align-items: center` 还原成 `stretch`，否则标签会被水平居中。

**验收**：一次性 CDP 探针在真机跑 **14/14 通过**（Obsidian 与思维导图两张卡：行式方向、行高 32、行距 6/10、
标签不被截断、控件文字不被截断、面板无边框无底色、多选字段仍是整行且控件 ≥200px），并逐张看图对过。
**仍然没有独立视觉验收**（见 §8 第一条：judge 额度用尽）。

数字口径：**原型页在 1:1 下由脚本实测**（`getBoundingClientRect`，脚本跑完删），A 另有**真机 Chrome** 实测值可对照。
中途修过的原型缺陷（标题与副标题挤在一行、ⓘ 漂在标签与控制之间、D 的面板被 flex 压扁、E 漏掉 ⓘ、表格空值印成 `nullpx`）已全部修掉并重渲染。

**推荐顺序与理由**

1. **B（推荐）**：唯一同时满足「有系统级依据」「高度大幅下降（−116.2px ≈ 22.7%）」「消掉嵌套盒子」的方案；
   代价是长标签会被截断（用 `text-overflow: ellipsis`），需要给最长的「抽取哪些属性」留更宽的下拉。
2. **C（最小改动）**：保留现有字段排法与全部交互，只去掉盒子、把入口收成一句 summary。
   **但它不省高度**（515.5 vs 512.2）——省的是视觉重量。适合「暂时不想动结构，只想让它不那么重」。
3. **D（方向上最彻底）**：跟着多数被调研产品的做法走，卡片最干净、设置空间不受限。
   代价是新增常驻面板与选中联动，是五套里改动最大的；建议作为「节点配置继续变长」时的长期方向，而不是这一次。
4. **E**：解决「两组设置挤在一起」，但多一次点击，且参数与高级不能同屏；卡片内分段控件的 28px 也是成本。
5. **A**：不建议继续用；若要留，至少按 §2 的规则做减法（去掉盒子里的 ×，只由选中条入口开合）。

### 6.2 后续反馈：「高级设置与上方常规设置之间的分界线有点丑」

**这条线的性质，按官方措辞就是错的层级。** Material 的分隔线文档（m3 正文在 SPA 里取不到，引的是官方仓库 material-components-android 里
[Divider 组件文档](https://github.com/material-components/material-components-android/blob/master/docs/components/Divider.md) 转述的 M3 措辞）：

| 原文 | 说的是哪一类 |
| --- | --- |
| `"separate larger sections of unrelated content"` / `"separate interactive areas from non-interactive areas"` | **满宽（full-bleed）** 分隔线的用途 |
| `"separate related content within a section"`，且默认 `"equally indented from both sides"`（`insetStart/insetEnd` 默认 0dp） | **内缩（inset）** 分隔线的用途 |

我们这条线是**满宽、画在同一张卡片的表单区中间、两边都是同一组设置**——按上表它属于「分隔无关的大段落」，
用在卡片内部属于用错了层级（这也是它读起来像「切断」而不是像「新段落」的原因）。
另有 Carbon 的同类告诫：`"The divider should not be used to separate every switcher item."`（Switcher divider 页）

**四个候选（真机渲染：往运行中的应用注入 CSS，未改仓库代码；画布缩放 3.31，即用户放大后的视角）**

| 候选 | 做法 | 面板高 | 卡片高 | 依据 |
| --- | --- | --- | --- | --- |
| V1 现状 | 满宽 1px 线，上 16 / 下 8 | 247.8px | 431.7px | —（Material 定义里这是「分隔无关大段落」） |
| **V2 只留白 + 小标题** | 去掉线，间距 16 → **24px**，靠 11px/600 的「高级设置」标签分组 | **238.8px** | **430.7px** | Windows 11 官方 `SettingsPageExample`：区块标题就是「`Margin="1,30,0,6"` + 小标题」且注释写明 "following the correct Windows 11 design specifications"；GNOME HIG「each list can be given a heading」；libadwaita `AdwPreferencesGroup` 有 title + description |
| V6 内缩细线 | 线保留、两侧各内缩 16px | 251.8px | 441.7px | Material 的 inset 分隔线正是「同一段落内的相关内容」那一类 |
| V5 浅底分组 | 无线，整段加 `--color-surface-muted` 底 | 258.8px | 446.7px | libadwaita `.boxed-list`（"each row as a separate card instead of the whole list being a single card with separators"）；Windows `SettingsCard` |
| （V4 标题下划线） | 线不横贯，压在「高级设置」这行下面 | 247.8px | 437.7px | `el-divider` 的 `content-position="left"` / antd `titlePlacement="start"` 有 API，但两家的文档把该用途限定在「文章章节 / 行内文字」，**不支持**用在设置组 |
| （V3 现状淡化） | 同位置，颜色混到 55% 深度 | 251.8px | 441.7px | 仍是满宽 → 层级问题没解决 |

**顺带记两条 Element Plus 的事实**（官方文档 + 已发布 CSS 实测）：`el-divider--horizontal` 是
`border-top: 1px var(--el-border-color); margin: 24px 0`——**24px 的上下 margin 在这种卡片里太占地方**；
带文字的 `el-divider` 用 `.el-divider__text { background-color: var(--el-bg-color); padding: 0 20px }`
**用底色块盖住线**，卡片不是纯白时那处会露一块补丁。

**可切换看的对照页**：[advanced-settings-divider-demos.html](./advanced-settings-divider-demos.html)
（六套各一张**真机卡片截图**，按设计像素裁在分界处，画布缩放 3.31；切按钮即换图，旁边是这个候选的做法、
间距、面板高 / 卡片高与出处）。

**结论：用户选定 V2，已落地**（2026-10-14）。落地的三处取值：`margin-top: 16px`（+ body 的 8px gap = 上间距 24px）、
`padding-top: 0`、删掉 `border-top`；小标题与行式排法不动。

- **实测（真机 Chrome，设计像素）**：高级区 **247.8 → 238.8px**、整张卡片 **431.7 → 430.7px**；分界上方间距 **16 → 24px**；
  思维导图卡片同步 **406.9 → 405.9px**。验收：一次性 CDP 探针真机 **10/10 通过**
  （无边框无底色、上间距 24px、面板/卡片高与对照页数字一致、小标题仍在、行式与「不截断」全部回归通过）。
- 若将来想保留一个显式的「新段落」信号，替代项是 **V6（内缩线）**——那才是 Material 给「同一段落内的相关内容」的工具。

## 7. 落地清单（选 B 或 C 时）

- **组件不自研**：下拉/开关一律 Element Plus；**不要用 `el-collapse`**——它没有无边框变体、
  header 固定 48px、content 有 25px 下内边距，在 300px 卡片里过重（数值见 §3）。
- **令牌**：12px 标签、`--color-text-secondary`、`--control-height-sm`（32px）、`--radius-sm`（6px）都已在令牌里，
  新样式不许散写色值（`pnpm lint:ui` 会拦）。
- **间距**：B/E 的行距取 6px、行高 32px；字段间 12px（本轮已落地的值）。若改回「标签在上」，则字段内 6px、字段间 12px 这条关系不要破。
- **可访问性**：summary/chevron 要有 `aria-expanded`；图标按钮要有 `title` + `aria-label`（卡内已有先例）。
- **需要动的类名**：`.sf-node-advanced`（盒子）及其标题行/关闭按钮；`.sf-node-field`（若走 B 则新增行式类）。
  具体差量在选定方案后按实现来，本页不预设代码。

## 8. 诚实清单

- **视觉验收不是我该自己做的**：按用户级约定，视觉产出应交给独立 judge。这次两次派发
  `visual-judge` 都失败——**账号额度用尽（提示 2026-10-15 09:12 重置）**，不是产物有问题。
  因此本页与原型页的视觉检查是**我自己逐图看的**，不算独立验收；重置后应补一次。
  我修掉的是自查发现且肉眼可判的问题（文本重叠/裁切、图标漂移、面板被压扁、`nullpx` 这类硬错）。
- **原型不是 Element Plus 的真实渲染**：控件（下拉、开关、ⓘ）是手画的，尺寸照真机计算样式重画
  （卡片 300 宽、padding 10/12/12、控件高 32、圆角 4、字号 12、开关 30×16）。落地的阴影、焦点环、
  键盘态会有差异；**高度数字应按真实组件重新量**。
- **原型复刻真机有 12.9px 误差**（A：512.2 vs 525.1），来源是手写的卡片外壳（标题图标、上下内边距的细微差别），
  不影响「B 比 A 矮」这个相对结论，但绝对值别当精确值用。
- **数字都是「设计像素」**：真机是在画布缩放 0.5622 下量的屏幕像素再折算，折算系数取自
  `.vue-flow__transformationpane` 的 transform。
- **调研的置信度已逐条标注**，其中**二手**的几条（Make 的 "Show advanced settings toggle"、
  Tines 的 "add option button"、Dify 的面板位置与「高级设置」措辞、Retool 的 Inspector、
  ComfyUI 的右键项、M3 的列表高度、SLDS 的 33/66%）没能在源站逐字核实，
  引用时请按二手对待。**n8n 的 NDV 多 tab 结构与「label 在上还是左」未在官方页证实**。
- **没有做可用性测试**：五套都没有找真实用户点过；推荐依据是调研到的成熟做法 + 结构分析 + 高度实测。
- **没测的**：深色模式、更窄/更宽的卡片（本页只覆盖 300px 宽的 Obsidian 卡片与 240px 的 D 变体）、
  键盘操作路径、以及 B/E 在长标签（超过 8 个汉字）下的截断表现。
- **本轮已落地的两处改动**（卡片组间距 12px、高级设置改手动关闭）与本次选型**无关但相邻**，
  它们只改了间距与开合行为，没有动结构；选型落地时它们会被一起替换或保留，见 CHANGELOG 2026-10-14。
