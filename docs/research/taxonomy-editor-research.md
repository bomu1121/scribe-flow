---
title: ③ 词库编辑器：现状实测、三个候选方案与外部依据
class: research
---

# ③ 词库编辑器：现状实测、三个候选方案与外部依据

> 触发：用户看设置页「③ 词库」这块两级标签编辑器，说「逻辑排版、选择时的交互排版有没有能优化的地方？
> 很难想象目前这些可选内容是以这么蹩脚和不清晰的方式排列」，并要求**调研成熟设计、不要凭空捏造、多方案**。
>
> 交付物：同目录的 `taxonomy-editor-demos.html` —— 现状照抄 + 3 个候选方案，都能真的增删改，
> 宽度按真机 454px、数据用真机上的真实词库（6 个一级 / 24 个二级）；另有两个开关
> （**手风琴：同时只展开一组**、**顶部搜索框**）用来比状态。
>
> 测量口径：真机数值在运行中的应用里量（Chrome 146）；三个方案的高度在对照页里量，
> 且对照页的**基准尺寸照抄真机**（组卡 padding 10/12、chip 22px、输入框 32px、间距 6/8px）——
> 只有结构这一个变量在变，否则"省了多少"没法比。

## 1. 现状实测

| 指标 | 实测 |
| --- | --- |
| 整块高度 | **880px**（只这一块就一屏多） |
| 一级组数 / 二级标签数 | 6 / 24 |
| 每组高度 | 122 ~ 150px |
| 常驻输入框 | **7 个**（每组一个 + 底部新增一级一个） |
| 可聚焦按钮 | **67 个**（每个 chip 两个：名字 + ×） |
| 可折叠 / 可重命名 | 都不能 |

每组固定三行：组头（名字 + 「N 个二级」+ 删除一级）→ 二级 chip → 「新增二级」输入框 + 添加按钮。问题逐条：

1. **新增入口常驻**：6 组就是 6 个输入框常驻在页面上，占的是"最常读的那块地方"，而真实使用频率是"偶尔维护一次"。
2. **键盘停靠点 67 个**：每个 chip 里两个按钮，24 个 chip 就是 48 个停靠点。
3. **每组头尾各一行 chrome**：6 个组头 + 6 个输入行，正好把"看标签"这件事挤散。
4. **chip 上重复父级名**（`来源/B站`），而组头已经写着「来源」——信息冗余，chip 更长也更容易折行。
5. **不能折叠、不能重命名、不能排序**；「删除一级」与「添加」等重，误点代价高。

## 2. 三个候选方案 + 实测对照

同一页面上量（原型；现状一列同时给出真机值）：

| | 展开态高度 | **手风琴态高度** | 可聚焦按钮 | 常驻输入框 |
| --- | --- | --- | --- | --- |
| 现状 | 854px（真机 **880px**） | —— | 61（真机 **67**） | 7 |
| **A 紧凑分组 + 按需新增 + 可折叠** | 542px | **364px** | 43 | 0 |
| **B 一个输入台管全部** | **523px** | —— | **24** | 1 |
| C 树 + 行内编辑 | 636px | **233px** | 36 | 0 |

- **A + 手风琴**：880 → **364px（省 59%）**——除正在编辑的那一组，其余 5 组各只占一行组头。
- **B** 不用折叠就已经是最省的结构：整块只有 1 个输入框，其余是只读 chips。
- C 折叠后最矮（233px），代价是"归属关系"只剩缩进这一条线索。

## 3. 三个方案各是什么

**A 紧凑分组 + 按需新增 + 可折叠**（推荐）
- 「新增二级」收成 **`+ 添加` 幽灵按钮、并进 chip 行的末尾**；点了才变输入框，
  **回车提交后输入框保持打开**（连续录入）、Esc 收起。
- 组头的「删除一级」收进**指向才出现的 ⋯ 菜单**（复制搜索串 / 重命名 / 删除一级）。
- 二级 chip **去掉重复的父级前缀**，删除按钮**指向才出现**。
- 组头可点**折叠**；chip **双击改名**。
- 配套两个开关：**手风琴（同时只展开一组）** 与 **顶部搜索框**（命中的组自动展开）。

**B 一个输入台管全部**
- 顶部一个输入框 + 「加到哪个一级」的选择；**直接打 `话题/平台抽成` 也会自动归组、必要时建一级**。
- 下面那棵树只负责"看和删"，没有任何多余按钮；竖向与键盘都最省（24 个停靠点）。
- 代价：一级的改名/删除没有入口（可补 ⋯），且"打路径"这个能力需要先知道语法。

**C 树 + 行内编辑**（Anki / Zotero 那种）
- 每行一个标签，层级用缩进 + 折叠三角；**双击行内改名**，行尾指向时出现 `+`（加二级）与 `×`。
- 改名/整理标签时最顺手；代价是"归属关系"退化成缩进，第一眼看不出一级与二级的关系。
- **拖拽移动这一版原型没有实现**（成熟实现见 Anki / Zotero）；真做要引入拖拽库。

## 4. 推荐

> **v2 补充（见 §7）**：v1 的三版只改了结构，用户反馈「还是很丑、交互奇差」。**结构仍然推荐 A**，
> 但视觉与手势按 §7 重做，推荐 **v2 的 V1 彩色标记版**：高度 695px（真机现状 880）、
> 一级上色做标记、删除与改名都改成可见入口、每个标签带用量、组内可拖拽。

**A**：结构改动最小、收益已经很大（展开 880 → 542，手风琴 **880 → 364**），
停靠点 67 → 43，且**不丢任何现有能力**，改名还从"没有"变成有。B 更省但牺牲一级的可编辑性；
C 更适合"标签多到需要整理"的形态，而这块的场景是"偶尔维护一次的两级词库"。

采纳 A 时，建议把这五点一起做掉（都在原型里试过；括号里是 §5 的依据）：

1. **`+ 添加` 放在列表末尾、点了才出现输入框，回车后保持打开**（Primer《Create》的就地新建 + Trello checklist 的「Add an item」）。
2. **手风琴默认开**：同时只展开一组。这是把高度从 542 压到 364 的唯一原因。
3. **chip 的删除入口"指向才出现"，且可访问名要带标签名**——现在 `el-tag` 的关闭按钮
   aria-label 是统一的「关闭此标签」，24 个一模一样，屏幕阅读器读不出删的是哪个（见 §5）。
4. **改一级/二级的名字**：我们在数据层存的是树（不是"标签名里的路径"），改名只改一行；
   旧笔记上的标签由既有的「词库改了，回补旧笔记」把它换掉——**这一点是相对 Obsidian 的实质优势**
   （Obsidian 任何版本都不能原生批量改标签名，只有社区插件）。
5. **键盘**：一屏 40+ 个 chip 不该要求 Tab 走完。按 W3C APG Toolbar 的做法把每一组收成**一个** Tab 停靠点，
   组内用方向键移动；**本仓库已经依赖 `reka-ui`**（`^2.10.4`），它自带 `RovingFocusGroup`，
   不必手写（Fluent v9 明确警告手写 roving tabindex 会把项从方向键导航里漏掉）。

## 5. 外部依据（逐条给出处）

**新增入口的形态**

- **GitHub Primer《Create》**：原文「Create inline when a field or two is all it takes, or when the new item joins
  a list already on the page, like adding a label, so nothing interrupts the flow.」；
  反例「Don't: Open a dialog or a new page for a one-field action that could happen in place.」；
  并有焦点规则「When creation happens in place, move focus to the new item.」
  —— https://primer.style/product/scenario-patterns/create/
- **Element Plus 自己的动态表单示例**（我们正在用的组件库）：N 行内容各带自己的删除按钮，
  而**新增按钮只有一个、在列表末尾**（`New domain` 与 Submit/Reset 同排）
  —— https://element-plus.org/en-US/component/form.html
- **Trello**：「Select the **Add an item** button below any checklist」→ 输入 → 回车保存
  —— https://support.atlassian.com/trello/docs/adding-checklists-to-cards/
- **Notion**：「Click **+ New at the bottom** to add a new item.」 —— https://www.notion.com/en-gb/help/intro-to-databases
- **Airtable**：`Edit field` → **Add option** —— https://support.airtable.com/docs/single-select-field
- **"每行一个常驻输入框"没有任何官方禁令**，但三条代价都能查到出处：
  NN/g 的渐进披露（主视图不该被次要内容占满，https://www.nngroup.com/articles/progressive-disclosure/）；
  **DWP 的实测**——把条目都摊在一屏再统一提交会有校验与性能问题（引 MOJ 的研究，
  https://design-system.dwp.gov.uk/patterns/add-another-thing/design-notes/），
  且**重复控件必须逐个补唯一的可访问名**（同站 accessibility 页）。
  **修正两处我原先的假设**：GitHub 的 Labels 页其实是「New label 按钮 → 表单」，不是"列表末尾一行"；
  GitHub Topics 的输入框也不是常驻的（要先点齿轮才出现）。

**两级结构**

- **Anki**：层级靠名字里的 `::` 或拖拽（「either name them with double colons between each level, or drag and drop
  them within the deck list」），排序只有字母序，改名/删除走每行的齿轮
  —— https://docs.ankiweb.net/studying.html ；折叠是把牌组拖进一个 Unused 牌组再看减号（FAQ）。
- **Zotero**：「Collections are sorted alphabetically」；删除分「Delete Collection」与
  「Delete Collection and Items」**两种语义**；子集的条目**默认不聚合到父集**（View 菜单有开关）
  —— https://www.zotero.org/support/collections_and_tags
- **Linear 的 label groups**：组是**单选维度**（「labels within groups are exclusive…
  only one label from each group may be applied」），每组上限 250 —— https://linear.app/changelog/2022-11-10-label-groups
- **WordPress 的分类管理页**（拿到了整页原文）：两栏 = 左边 Add New Category 表单（含 **Parent 下拉**）、
  右边 Categories 表格；层级是**缩进 + 长破折号前缀**；表里有 **Posts 计数列，计数可点**；
  悬停行出现 Edit / Quick Edit / Delete，而 **Quick Edit 不能改父级**（移动只在完整编辑页里）
  —— https://wordpress.org/documentation/article/posts-categories-screen/
  它的两栏是给 1280px 后台设计的，**454px 的窄栏放不下**，这是没有把它做成方案的原因。
- **Shopify collections** 是"集合包含集合"的语义（手动/条件两种入选方式），与"分类法父子"不同构
  —— https://help.shopify.com/en/manual/products/collections

**Obsidian 自己的标签（对我们最重要的一条）**

- 官方 help 的 Tags 页**完全没有**"改名/移动标签"这回事；论坛的功能请求挂了多年，原话
  「a global search and replace FR has been ignored for a long time (4 years)?」
  —— https://forum.obsidian.md/t/global-mass-vault-wise-search-replace/4395/10 ，
  社区唯一的做法是插件 **Tag Wrangler** —— https://github.com/pjeby/tag-wrangler
- 对照我们的模型：层级存在**数据里的父子关系**（一级是分类字段），改名 = 改一行；
  而 Obsidian/Anki 把层级存在**名字里的路径**（`/`、`::`），改名 = 全库重写 N 个字符串。
  这是我们相对它们的实质优势——**但前提是把「回补旧笔记」这个既有能力摆到明面上**（见 §4 第 4 条）。

**键盘与可达性**

- **W3C APG – Toolbar Pattern**：「Implement focus management so the keyboard **tab sequence includes one stop
  for the toolbar**」；并给了数量门槛「Use toolbar as a grouping element only if the group contains
  **3 or more controls**」 —— https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
- **W3C APG – Developing a Keyboard Interface**：roving tabindex 的步骤（活跃项 `tabindex="0"`、其余 `-1`，
  导航时先改再 `element.focus()`） —— https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- **Fluent UI v9 的警告**：不要手写 roving tabindex（会让项从方向键导航里消失）—— 用它的 hook/Tabster
  —— https://storybooks.fluentui.dev/react//llms/concepts-migration-from-v8-components-focuszone-and-focustrapzone-migration.txt
- **reka-ui 的 `RovingFocusGroup`**（本仓库已依赖 `reka-ui: ^2.10.4`）：自述实现的正是 roving tabindex
  —— https://reka-ui.com/docs/utilities/roving-focus
- **chip 的删除按钮该有几个停靠点**：MUI Chip、Gmail、GitHub Primer Token 三家都是
  **每个 chip 一个停靠点 + Backspace/Delete 删除**（MUI 源码里 `isDeleteKeyboardEvent`；
  Primer 的 Token 文档写「clicks the remove button, or keys Backspace or Delete when focused on the token」）；
  PatternFly 则给每个关闭按钮一个停靠点，但把 `closeBtnAriaLabel` 标为 **Required**。
  —— https://primer.style/product/components/token/ 、https://www.patternfly.org/components/chip/accessibility/
- **Element Plus 的现状**（我们的栈）：`el-tag` 的关闭按钮是 `<button :aria-label="t('el.tag.close')">`，
  中文语言包里这个串是**统一的「关闭此标签」**——所以 24 个 chip 的关闭按钮**可访问名完全相同**，
  屏幕阅读器读不出删的是哪一个。这正是 DWP 那条"重复控件必须逐个补上下文"要修的问题。
- **WCAG 2.2 SC 2.5.8（AA）**：靶标至少 **24×24 CSS px**；更小的靶标要满足间距例外
  （每个靶标外接 24px 直径圆且互不相交） —— https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## 6. v2：视觉语言重做（结构不动）

> 触发：用户看完 v1 的三个方案后说「**还是很丑**……现在交互感觉**奇差**」。
> v1 的错在哪，我自己的复盘是三条：
> ① **只改了结构、没改视觉**——还是"白卡片 + 灰胶囊"，和现状同一套皮，所以看起来没变；
> ② **把删除与改名藏进隐藏手势**（hover 出 ×、双击改名），我把它当"降噪"，代价是**操作不可发现**——
> 这就是"奇差"的来源；
> ③ **没有判断依据**：不知道该删哪个标签，只能凭感觉。
>
> 交付物：同目录的 `taxonomy-editor-demos-v2.html`。结构沿用 v1 的 A（紧凑分组 + 按需新增 + 折叠 + 手风琴），
> 只重做视觉与手势的可见性，出三版对照：**V1 彩色标记版**（Notion/Linear 取向）、**V2 单色版**（贴仓库现在的克制风格）、
> **V3 清单版**（GitHub Labels 取向）。

### 6.1 实测对照（含 v1），以及每一件"更好用"的价格

| | 高度 | 可聚焦按钮 | 相对上一行 |
| --- | --- | --- | --- |
| 现状（真机） | 880px | 67 | —— |
| v1-A（结构版：紧凑 + 按需新增 + 折叠） | 542px | 43 | **−338px** |
| + 颜色（色点 + 淡底 + 同族描边） | 635px | 55 | +93px（颜色本身不占位，是多了组头那三个常显图标 + 换行位置变了） |
| + 每个标签的用量 | 695px | 55 | **+60px**（数字让每行少放一个 chip） |
| + 拖拽把手槽位（16px 常驻、淡显） | 730px | 55 | **+35px** |
| + 空组改成行内提示（去掉独立那行） | **705px** | 55 | −25px |
| v2-V2 单色 + 用量 | 705px | 55 | 与 V1 同结构，只是不上色 |
| v2-V3 清单版 | **1043px** | 60 | **比现状还高 19%** |

**结论**：把这四样（结构 / 颜色 / 用量 / 可拖）都做上，高度是 **705px**——比现状省 20%，比只做结构多花 163px。
**每一件都明码标价**：用量 60px、把手 35px。用量做成了页面上的开关，你可以关掉看差别；
如果你觉得 705 还是高，最划算的一刀是砍把手（改用菜单排序，见 §6.4）。

**数据从哪来**（用量）：现有 `GET /api/settings/obsidian/fields` 已经在遍历全库、解析 front matter，
同一次扫描里多解析一次 `tags`（`note-markdown.ts` 的 `parseNoteTags` 已有）即可，成本与库自检同级（本地 IO、不花钱）。

**V3 清单版在 454px 窄栏里是错的形状**：24 行 × 行高 = 1043px，比现状还高。GitHub Labels 是一整页，
不是窄栏里的一块设置。留它在页面上只为让你看清"信息密度最高"的形态长什么样，**不建议采用**。

### 6.2 视觉决策，每条都有实测数字

**先把"丑"的病根量出来**（这是这一轮最重要的一组数字，用 WCAG 的相对亮度公式算）：

| 量 | 值 | 含义 |
| --- | --- | --- |
| 现状 chip 字 `#545b66` / chip 底 `#f7f8f9` | 6.44:1 | 文字清晰度**合格**——"丑"不是对比度不够 |
| 现状 chip 底 `#f7f8f9` / 白卡 `#ffffff` | **1.06:1** | **chip 作为形状几乎不存在**，24 个叠在白卡上就是"一片灰" |
| 任意两个不同色相的**浅底**之间 | 1.00–1.03:1 | **浅底承载不了色相**——换什么浅底都分不出来 |
| 成熟色板（GitHub Primer 19 色）的 字/底 | 4.94–5.19:1 | 人家把对比度**工程化**到 ≈5:1 |

**推论**：色相必须落在**文字**与**色点**上；浅底只提供 1.2:1 的"这里有东西"暗示；一级必须有**不依赖浅底**的身份信号。

- **两条配色路，做成了开关让你比**：
  - **灰字版**（默认）：chip 文字用次要色（压淡底实测 6.05–6.23），色相只由色点 + 淡底 + 同族描边承担。
    好处是**完全用仓库现有令牌**；代价是 24 个 chip 的文字仍是一片灰。
  - **Primer 色板版**：浅底 + **深字**，每对从 GitHub Primer（**MIT**）取，实测 **4.94–5.15**（全部过 AA 小字）。
    观感明显"有色"；代价是要往 `tokens.css` 引入 6×3 个新色值（这是**一次调色板扩充**，不是改个样式）。
- **现状 chip 的字号是 11px，低于我们自己定的 12px 下限**（`--text-help-size`，上一轮排版工作的结论）。
  v2 改成 12px。这条是"丑"的第二个来源：11px 的灰字在白卡上本来就模糊。
- **删除按钮从三级灰改成次要色。** 三级灰压在彩色淡底上实测只有 **2.86:1**，**低于 WCAG 1.4.11
  对 UI 组件要求的 3:1**；换成次要色后是 **6.23:1**。（这一条同时适用于上一轮「抽取哪些属性」那边的 chip。）
- **× 的靶标 20×20px，靠"间距例外"合规。** WCAG 2.2 SC 2.5.8 要求 24×24，但允许不达标的靶标在
  "每个靶标外接 24px 直径圆互不相交"时豁免。实测相邻 × 的**最小中心距 76px**（竖向也 ≥29px），豁免成立。
  要用真 24×24 就得把 chip 抬到 26–28px 高，那是另一个取舍。
- **取色规则：可用色相只有 5 个**（蓝 / 靛 / 绿 / 橙 / 粉）。仓库调色板里有**两个蓝**（brand 与 info），
  按顺序取色会撞——第一版原型里「来源」和「概念」看起来一模一样，我是看图才发现并改掉的。
  第 6 个起用中性灰；**自动维护的组固定中性**（`UP主名称` 由入库时自动写，不该和人维护的组一样有声有色）。
- **"组要有身份，不是每个标签一个色"**：GitHub 一个仓库 76 个 label 各自一个色，结果是一片彩点、看不出分组；
  Linear 的做法是**给组一个身份**（它的组图标是"子标签色点聚成的簇"）。我们取"一级一个色相、二级继承"——
  配色工作量从 24 次降到 6 次，也更符合"一级是分类"的语义。
- **chip 造型的数值带**（各家源码/线上 CSS 里抓的）：高度集中在 **18–24px**；**浅底深字的 chip 不需要边框**
  （GitHub 的边框几乎总是透明、shadcn 干脆 `border-transparent`）；hover 主流是**背景加深一档**；
  圆角**别混**——现在 chip 是胶囊（999px）而输入框是 4px，两套圆角在同一块里并存。
- **空状态**：成熟产品**不写"暂无标签"这类文案**，而是把"创建第一个"作为该组唯一的内容
  （Airtable 的空组里就是一行 `Add option`）；GitHub / Linear 更彻底——**用默认标签把空态消灭掉**。
  我们本来就有默认词库，所以空组只该是"一行创建入口"。v2 已按这条改掉（顺带省了 25px）。
- **组头的信息排布**：**色点最左 → 名称 → 计数（弱化）→ 右侧操作**；"加二级"的入口上移到组头右侧。
  现在把计数紧贴名称放左边，等于让次要信息占了身份位。
- **落地时的三条仓库约束**：
  1. 色值必须进 `tokens.css`（页面里散写颜色会被 `pnpm lint:ui` 拦）。
  2. **颜色不能进标签字符串**：`TagTaxonomy` 是 `Record<string, string[]>`，标签会被写进 Obsidian frontmatter，
     `一级/二级` 里的 `/` 是语义。色相是**设置层的视觉属性**，要存成枚举/色名（如 `"blue"`）而不是 hex，
     这样也为暗色模式留了路（Notion / Tana 都是亮暗两套值）。
  3. chip 若有可点击/可关闭语义，优先用 `el-tag`（`effect="light"` 就是浅底深字），
     只在需要"每组分色"时用令牌覆写，而不是新写一个 chip 组件。

### 6.3 手势的可见性（v2 的第二个重点）

| 动作 | v1（藏起来的） | v2（改成的） | 依据 |
| --- | --- | --- | --- |
| 改名 | 双击（零提示） | **单击标签名** + **F2** | F2 是事实标准（Windows 资源管理器 / Excel / VS Code / Nautilus；macOS 用 Return），
但**没有一家把双击写成唯一入口**——Notion 是 hover 的 `•••`、Airtable 是常显下拉里的 Edit field、GitHub 是行上常显的 Edit |
| 删除 | hover 才出现 × | **常显 ×**（次要色，hover 变红）+ **Delete/Backspace** 删聚焦项 | Material 的 input chip 规范：尾部移除控件是**必需且必须常显**；Airtable / GitHub 也都是常显；
MDC 的 deletable chip 约定 Delete/Backspace 删除 |
| 新增 | hover 才看到「+ 添加」 | **常显虚线按钮**，组头也有一个 ＋ | Airtable 的 Add option、Notion 的「+ New at the bottom」 |
| 排序 | 没有 | 拖拽（整块可拖 + **16px 常驻把手槽位**，淡显、指向变实） | Atlassian 的拖拽指南：次操作用 hover 显形 + **compact 16×16**、别留大缝；落点线规格 **2px**、
原位元素降到 **40% 不透明度**（都照抄了） |
| 归属 | —— | 色点 + 淡底 + 同族描边 + 组头计数（`5 个 · 191 篇用过`） | 见 §6.2 |
| 复制搜索串 | 组名可点（自造手势、无提示） | 组头一个**常显图标按钮** | 成熟产品里点击 chip 本体的语义 **6/6 都是"用它"**（筛选 / 打开 / 跳转），
**没有一家是复制**；复制应该放在独立图标或菜单项里 |

**关于"hover 才出现"到底违不违规，我原来记错了，这里纠正两处**：

1. WCAG 2.2 **SC 1.4.13 Content on Hover or Focus** 管的是 hover 触发的**内容**（要求 Dismissible / Hoverable /
   Persistent），**并没有禁止"只在 hover 时才出现的功能"**；真正卡住它的是 **SC 2.1.1（键盘）**——凡是能用指针
   操作的，必须能用键盘操作。所以 hover 才出现的 × 必须**在键盘聚焦时也可见**（`opacity:0` 要配 `:focus-visible`
   或 `:focus-within`），否则键盘用户会 Tab 到一个看不见的按钮上。（上一轮「抽取哪些属性」那边已经这么做了。）
   顺带一条**差点被我引错的**：搜索里会冒出一个 **SC 3.2.7 Visible Controls**，看着完美契合这个问题，
   但它**没有进入 WCAG 2.2 正式版**（草案阶段被删）——不能拿它当依据。
2. **触屏上 hover 不存在**（MDN 对 `@media (hover: none)` 的定义原文：主输入机制**不能或不便悬停**），
   所以"hover 才出现的删除"在触屏上等于"点两下或点不到"。

### 6.4 拖拽的"不用拖拽"路径：**已按方案 A 落地**

WCAG 2.2 **SC 2.5.7 Dragging Movements** 原文要求：所有用拖拽完成的功能，都要能用**单指针不拖拽**完成；
Understanding 给的官方示例就是**"可排序列表提供上移/下移控件"**。

用户在这三个折中里选了 **A**，已实现：

- **每个二级标签带一个「上移 / 下移」控件**，**只在指针指向它、或焦点落在它里面时浮现**；
  第一个的上移、最后一个的下移自动 `disabled`（不是点了没反应）。
- **这两个按钮故意不给 Tab 停靠点**（`tabindex="-1"`）：键盘路径是 `Alt+↑/↓`，
  指针路径是"指向这一项 → 按钮浮现 → 点一下"。这样整块的可用停靠点**一个都没多**——
  若给它们停靠点，会从 55 涨到 79（比现状 67 还多，等于把刚省下来的又还回去）。
- 实测（真机）：指向第一个 chip → 两个按钮浮现（`↑` 因是首项而禁用、`↓` 可点）；
  点 `↓` 让「文稿」下移一位 ✓；`Alt+↑` 让「本地视频」上移一位 ✓。

原本列出的 B（组级"排序模式"）与 C（每项一个 ⋯ 菜单）都没有采用：B 多一层模式切换，
C 会把按钮数顶得比现状还多。


## 7. 诚实清单

- **v2 的三版交互我都在浏览器里点过**：单击标签名改名、**F2 改名**、**Delete 删掉聚焦项**、
  改名后删除（这条**第一次是坏的**——闭包里捕获的是旧名字，改名后按旧名去过滤什么也删不掉；
  是自动化点测抓出来并修掉的）、组头 ＋ 添加、拖拽交换两项、用量开关切换、手风琴。
  还有一次是**我改错了作用域**：把 chip 的键盘处理插到了组级函数里，整页脚本直接抛错、什么都没渲染出来——
  浏览器里的"页面空白"就是它，已修正。
- **v2 的用量数字是编的**（`B站 128` 这类），真机要先做那个接口（§7.1 说了怎么复用现有扫描）。
- **颜色按索引分配，用户不能自己选**。Notion 的做法是随机分配 + 在那个 `•••` 菜单里改；
  "让用户给一级挑颜色"是后续可加的一项（要引入一个调色板 UI 与一份稳定映射，存进词库）。
- **排序没有"不用拖拽"的等价路径**（SC 2.5.7），这是 v2 最大的缺口，三个补法见 §6.4。
- **拖拽的落下确认没做**：Atlassian 规格里还有"落下后约 700ms 闪一下"，原型没实现。
- **V3 清单版不建议采用**（比现状还高 19%），留在页面上只为看形态。
- **两路手势/视觉调研各有一条局限**（来自调研过程本身）：NN/g 那篇《Drag-and-Drop》**三次抓取都是 503**，
  只有搜索索引摘要、没有原文；Material 3 的 chips 页面是 JS 渲染，也只拿到索引摘要。这类引文我在 §7.3 里
  都没当"原文"用。
- 以下三条是 v1 那轮的遗留说明，仍然成立：

- **三个方案的交互我都在浏览器里点过**：A 的折叠 / 按需新增（回车后计数 +1）/ chip 双击改名 / 手风琴 / 搜索
  （打「历史」只剩「领域」组）；B 的打字归组（打 `话题/平台抽成` 会自动建「话题」一级）；C 的双击改名与折叠。
- **C 的拖拽移动没有实现**：原型只做了改名/折叠/增删。真做需要拖拽库；仓库里已有 Vue Flow，
  但那是画布用的，是否复用要先评估。
- **高度是"原型里量"的**：基准尺寸照抄真机后，实测现状 854px vs 真机 880px（差 3%，来自组间距与
  「暂无二级」那行提示）。三个方案的数字可以直接比，**但落地后要复测**。
- **调研的两条已知局限**（来自调研过程本身）：Linear 的 docs 正文三次直抓都 404（引用的是官方 changelog 与索引摘录）；
  Gmail 的 chip 键盘行为只有第三方转述、没有 Google 官方文档；Material 3 的 chips 可达性页抓不到（SPA），
  所以 chip 部分引的是 MUI / PatternFly / Primer。
- **"为什么不要每行一个输入框"的三条代价是调研的综合判断**，没有任何官方文档逐字禁止；
  最接近的三条出处已在 §5 列出。
- **搜索框现在只装在方案 A 上**（B、C 没有），是为了让对比干净；真做时三者的树都可以装。
- **24px 目标尺寸这一条现状不达标**：现在的 chip 删除按钮约 14×16px（与「抽取哪些属性」那边同一处问题），
  落地时要么放大到 24×24、要么按 WCAG 的间距例外处理。
