---
title: 合集选集面板怎么排：现状实测、成熟做法调研与五套原型
class: research
---

# 合集选集面板怎么排

> 触发：反馈「单视频跑过一次之后，下面那个合集列表就应该收起来（可重新展开）——一直展开着很丑，
> 时不时的加载还增加画面抖动；顺带这一块排版也不够完美」，并要求**给几套 demo 供选择**、
> **不要凭空捏造**（要调研已有项目的成熟做法）。
> 日期：2026-10-15。
> 交付物：原型页 [`collection-picker-demos.html`](./collection-picker-demos.html)（五套可切换、可交互，双击即可看）
> + 六张整页图：[现状](./collection-picker-current.png) / [1 折叠加摘要](./collection-picker-v1-fold.png) /
> [2 单轨两模式](./collection-picker-v2-single-track.png) / [3 加长列表工具](./collection-picker-v3-longlist.png) /
> [4 选集浮层](./collection-picker-v4-sheet.png) / [5 海报名片墙](./collection-picker-v5-tiles.png)。
> 本页只回答「哪种排法有依据、代价是什么、数字是多少」；**没有改动产品代码**。

**追加（2026-10-15 当日）：用户选定第 2 套（单轨两模式），已在真机落地并复测。**
落地实现、与原型的三处差异、以及真机测得的改造前后数字见 §8。

**先给结论（三条硬的）。**

1. **现状那张列表同时挂两种选择语义（点行=切换、勾选框=合并），是 Material 3 明文禁止的组合**：
   「A list can have only one selection mode at a time … **can’t be both at once**」（逐字核对过原文）。
   这不是审美问题，是交互模型问题 —— 用户觉得「别扭」是有出处的。
2. **「跑完一次就收起」有官方先例，但不是通用规范**：Android 的上下文操作栏在动作执行完就关闭
   （示例代码原文 `mode.finish() // Action picked, so close the CAB.`）。反面证据同样清楚：
   WinUI 说「自动收起会把控制权从用户手里拿走」、NN/g 说「打开/关闭的状态应由用户决定」。
   所以落地口径取**折中**：默认收起 + 收起头上写摘要 + 用户展开过就记住（Apple HIG 的 Outline views 页原文
   「Retain people’s expansion choices」）。
3. **109 集在现在的 224px 限高里只看得见 6 整行**（真机实测），看完要滚 **16.15 屏**；
   而且当前集在第 **109/109** 位时，面板停在顶部、不定位当前项 —— 底部写着「已勾选 1 集」，
   屏幕上却找不到是哪一集。第三方的 B 站客户端（Pilipala、bv）打开面板都会自动定位当前集。

**推荐 [2 单轨两模式](./collection-picker-v2-single-track.png)**：浏览态**没有勾选框**（点行 = 切换当前来源），
点「多选」才进选择模式、勾选后底部才出现动作条，合并完成自动退出并收成一行摘要。
它同时解决第 1、2、3 条，且是唯一「改完之后一屏里没有 109 个勾选框」的方案。
若只想动最小一步，**[1 折叠加摘要](./collection-picker-v1-fold.png)** 只加一行摘要（收起 −291.3px / −50%），
但列表本身的问题原样保留 —— 这条实测数字要记住。

---

## 1. 现状：问题在哪（读代码 + 真机实测）

实测对象是真的：工程「中美社保对比，有哪些不同？」里的 `source.bili` 节点，链接 `BV1DTWw6UE1y`，
它属于合集《美国时政》**109 集、共 28.91 小时**（合集数据来自 `/api/videos/preview` 的真实响应）。
量法见 §7。

| 量的是什么 | 数值 | 来源 |
| --- | --- | --- |
| 来源节点卡片 | **380 × 588px**（画布 zoom 0.5963） | 真机实测 |
| 其中选集面板 | **320.1px**，占卡片 **54.4%** | 真机实测 |
| 面板内部 | 头 19.2 · 列表 224 · 提示行 15.9 · 底行 26 | 真机实测 |
| 列表 | 限高 **224px**、行高 **31.2px**、gap 2px、**109 行** | 真机实测 |
| 一屏能看见 | **6 整行**（第 7 行只露 79%）；看完要滚 **16.15 屏** | 真机实测 |
| 当前集位置 | 第 **109/109** 集，列表默认停在顶部，**不定位** | 代码 + 实测 |
| 冷加载过程 | 节点先长成 **212.3px**（转圈态）→ **865ms** 后跳到 **588px**（**+375.7px / +177%**） | 真机逐帧 |
| 画布可视高度 | 952px → 这张卡占 **61.8%** | 真机实测 |

**五个问题，都能落到代码或数字上：**

1. **两种选择语义并存**。`ScribeNode.vue` 的模板里，行点击绑 `switchToSeasonEpisode`（单选：换链接），
   行首的勾选框绑 `toggleSeasonEpisode`（多选：待合并）—— 同一行同时是「单选按钮」和「复选框」。
   M3 Lists 规范明确禁止；ARIA APG 的 listbox 模式也不允许选项内部再放勾选框
   （官方原文：listbox 的交互模型 "does not support interacting with elements inside of an option … such as links, buttons, or checkboxes"，要放就得改用 Grid 模式）。
2. **限高与行节律不成整数倍**。224 ÷ 31.2 = **7.18** → 可见 6 整行 + 第 7 行只露 **79%**（少 6.4px），
   看着像渲染被截断，而不是「还有更多」。
3. **同一件事说三遍**。提示行「已勾选 1 集 · 再勾 1 集才能合并」+ 底行「勾选 1 集」+ 禁用按钮的 `title`
   （`seasonMergeHint` 与按钮 `:title` 同一句话）。
4. **不定位当前项**。`applyPreview` 里 `seasonSelected` 默认勾上当前那一集（第 109 集），
   但列表 `scrollTop` 保持 0 —— 「已勾选 1 集」在屏幕上不可见。
   [Pilipala](https://github.com/guozhigq/pilipala) 打开底部 Sheet 会 `jumpTo` 当前集，
   [bv](https://github.com/aaa1115910/bv) 打开面板按 `cid` 自动选中所在小节 —— 两家都定位。
5. **加载抖动**：转圈态把 72px 的预览块换成一行文字（卡片塌到 212.3px），等解析回来再一次性长到 588px ——
   一次 +375.7px 的跳变，且每次冷加载都会发生。
   注：这不是 CLS 意义上的抖动（画布节点是绝对定位，长高不推别的元素；实测 CLS 仅 **0.0008**），
   是**节点自身长高 + 预览块塌陷**。

---

## 2. 调研：这事别人怎么做

置信度分档：**verified-official**（我或复核脚本逐字核对过官方页面原文）／**official-文案**（官方页面可打开、
抄的是原文）／**源码级**（产品自己发布的前端产物或开源实现，可复检）／**二手资料**（只有检索摘要或转述）。

### 2.1 设计系统对「一条列表两种选择语义」的规定（这一节最硬）

| 规范 | 原文（逐字核对） | 出处 | 对我们的意思 |
| --- | --- | --- | --- |
| Material 3 · Lists | 「A list can have only one selection mode at a time. For example, a single-action list can change to a multi-select list, but **can’t be both at once**.」 | [m3.material.io/components/lists/specs](https://m3.material.io/components/lists/specs)（verified-official） | 现状的组合正是它禁止的 |
| Material 3 · Selection | 「On desktop, checkboxes are always visible when selection is **the primary activity**. When selection is secondary, checkboxes (or other indicators) are displayed: **As a single checkbox for that item on hover / For all items after one item is selected**」 | [m3.material.io/foundations/interaction/selection](https://m3.material.io/foundations/interaction/selection)（verified-official） | 我们是「次要选择」却常驻 109 个勾选框 —— 官方列的第三种最差组合 |
| Material 3 · Selection | 「To exit a selection mode, tap each selected item until they’re unselected, **or tap an action on the toolbar**.」 | 同上 | 「动作即退出」有规范背书 |
| Android · 上下文操作栏 | 进入方式：「you usually invoke the contextual action mode when … The user selects a checkbox or similar UI component within the view」；收尾示例代码：`mode.finish() // Action picked, so close the CAB.` | [developer.android.google.cn/…/menus](https://developer.android.google.cn/develop/ui/views/components/menus)（verified-official；.com 域名本机不可达，用的是官方中国镜像） | **「跑完一次就收起」的官方先例** |
| Apple HIG · Disclosure controls | 「**Use a disclosure control to hide details until they’re relevant.**」（此句逐字命中该页；「记住展开选择」那句在另一页） | [disclosure-controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)（verified-official） | 默认隐藏是官方口径 |
| Apple HIG · Outline views | 「**Retain people’s expansion choices.** If people expand various levels … store the state so you can display it again the next time.」 | [outline-views](https://developer.apple.com/design/human-interface-guidelines/outline-views)（verified-official） | 展开过就记住，别每次刷新都收回 |
| Wine／W3C ARIA APG · listbox | 「the interaction model conveyed by the listbox role … **does not support interacting with elements inside of an option** … such as links, buttons, or **checkboxes**. To present a list of interactive elements, see the **Grid Pattern**.」 | [ARIA APG listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)（verified-official） | 落地要么纯 listbox（无勾选框）、要么走 grid 语义，不能混 |

### 2.2 B 站自己与第三方 B 站工具

| 产品／界面 | 形态与关键做法 | 出处（置信度） |
| --- | --- | --- |
| B 站网页播放页右侧「合集/选集」列表 | 播放器右侧一栏的竖排列表；**靠 `max-height` 限高 + 内部滚动**扛住上百集（第三方脚本的全部手段就是改这个值）；**没有多选**（三个互不相关的脚本都自己另造勾选器） | Bilibili-Evolved 与 scriptcat 脚本的 DOM 选择器（源码级） |
| **Bilibili-Evolved · 下载选集面板**（最接近我们场景） | 头部一行：`选集:` + 计数 `(已选/总数)` + 三个按钮 **全选 / 全不选 / 反选**；列表 `max-height: 400px`；**shift 点按做区间选择**（`shiftSelect` + `lastCheckedEpisodeIndex`）；默认勾选前 **32** 条（`maxCheckedItems: 32`，由 `video/batch.ts` 消费） | [EpisodesPicker.vue](https://github.com/the1812/Bilibili-Evolved/blob/master/registry/lib/components/video/download/inputs/EpisodesPicker.vue)（**源码级，逐行复核过**：L11/L19/L27 三个按钮、L84 计数、L100–123 shift、L161 max-height 400、L79 maxCheckedItems 32） |
| ScriptCat #7822「B 站合集/多P字幕批量下载」 | 头部摘要 `合集：{标题}（共 N 个分P）`；按钮行 `全选 / 全不选 / 重新加载分P`；底部动作行 `开始批量下载` + **独立开关 `合并输出：开/关`**，tooltip 原文「勾选后额外生成一个合并文件」 | [scriptcat 脚本页](https://scriptcat.org/zh-CN/script-show-page/7822)（源码级） |
| B 站创作中心「合集管理 → 添加单集」（**B 站自家唯一的多选范式**） | 分步对话框：**搜索框搜稿件 → 勾选 → 下一步**，**一次最多 50 个** | [官方合集操作指南](https://m.bilibili.com/opus/737624392331165747)（official-文案） |
| 观众端工具的「搜索框」 | **翻遍的观众端工具都没有搜索**（BE、#7822、#6837、bilimini、bv、Pilipala）；唯一有搜索的是上面那个官方创作端对话框 | 同上（这条是**否定结论**，来自逐个查证） |
| bv（Android 第三方客户端） | 播放器下方横向分P条 → 点「更多」开 **ModalBottomSheet**：有合集时标题叫「视频选集」、纯多P 时叫「视频分 P」；合集多个小节时上面加横向小节 tab；**按 cid 自动选中当前集** | [VideoPlayerPages.kt](https://github.com/aaa1115910/bv)（源码级） |
| Pilipala（Flutter 第三方客户端） | 底部 Sheet 标题直接写「**合集（N）**」；`ScrollablePositionedList` **虚拟化 + `jumpTo(当前集)`** | [pages_bottom_sheet.dart](https://github.com/guozhigq/pilipala/blob/main/lib/common/pages_bottom_sheet.dart)（源码级） |
| 通用下载器 Open Video Downloader | **不铺列表**，用「起止范围 + 多段范围」表达任意子集，行内汇总 `{count} of {total} items selected`，底部两个按钮 `Download all items` / `Download selected items` | [PlaylistSelectionStep.vue](https://github.com/jely2002/youtube-dl-gui/blob/main/src/components/media-card/steps/PlaylistSelectionStep.vue)（源码级） |
| Plex（多选） | 悬停条目 → 点海报左上角出现的圆圈进入多选，之后可拖拽框选；**多选后额外浮出一批动作**（Edit / Mark as Played / Merge / Delete …） | [Plex 官方支持页](https://support.plex.tv/articles/200392126-using-the-library-view/)（official-文案） |

### 2.3 流媒体 / 媒体服务器的剧集选择器

| 产品 | 关键做法 | 出处（置信度） |
| --- | --- | --- |
| 腾讯视频（Web 选集面板） | `.episode-item` **高 54px + margin 8px**（62px 步距，**宽 54px 来自组件内联样式的默认值**，可被数据 `episodeWidth` 覆盖）；选中态 `background-color: rgba(0,213,211,.1); color: #00d5d3`（**浅底 + 变色文字，不是实心块**）；模块分 `isNormalModule` / `isScrollableModule` / `isInfiniteModule`，另有 `isNeedExpand` 配 **「收起 / 查看全部」** 文案 | 其 CSS/JS 产物 `vfiles.gtimg.cn/tvideo2/video-detail-vue/assets/main-By-GGvtP.css`（**源码级，逐条复核过**） |
| B 站自己的合集列表（带封面那一支） | `.base-video-sections-v1` 的条目是**带封面的卡片式**（`.video-episode-card`），不是纯数字 | Bilibili-Evolved 的样式补丁文件（源码级） |
| Jellyfin（库级剧集列表） | 真分页：`StartIndex` 累加 + 上一页/下一页，**每页默认 100**；列表渲染无虚拟滚动 | `jellyfin-web` 的 `shows/episodes.js`、`listview.js`（源码级） |
| Jellyfin（多选） | **长按 550ms** 进多选 → 卡片出现勾选框 → 顶部**固定命令栏**（左计数、右 ⋮ 动作表）→ 动作执行后 `hideSelections()` | `multiSelect.js` + `multiSelect.scss`（源码级） |
| Trakt | 季内只显示最近 7 集，其余收进带数字的折叠标签 | Trakt 论坛帖（二手资料） |
| Apple TV（下载） | 「选季 → **下载整季 或 下载单个剧集**」两个并列入口 | [Apple 支持页](https://support.apple.com/en-sa/118239)（official-文案） |
| Netflix / Disney+ / Prime Video / 优酷 | 长剧（100+ 集）怎么处理：**四家都没查到一手说明**（netflix.com 对本机 403） | 搜不到 |

### 2.4 长列表工具与「全部/当前」的语义

| 做法 | 原文与出处 |
| --- | --- |
| 过滤输入框是面板标配 | GitHub Primer SelectPanel：「a dialog that allows users to quickly navigate and select one or multiple items from a list. **It includes a text input for filtering**, supports item grouping…」——[primer.style](https://primer.style/product/components/select-panel/)（verified-official） |
| 长列表先给搜索，再谈虚拟滚动 | Apple HIG Outline views：「Consider offering a **search field** to help people find values quickly in a **lengthy** outline view.」——verified-official |
| 「全选」必须交代作用域 | Ant Design 的 locale 里分成 `Select current page` / `Select all data` / `Invert current page` / `Clear all data` 四条，源码里表头勾选框只作用于当前页、下拉里的「全部」作用于过滤后的全量 —— [ant.design](https://ant.design/components/table)（源码级） |
| 选中键要用稳定 ID | TanStack Table：「the row selection state is keyed by row id … you most likely want to use a more useful row identifier」（别用数组下标）—— verified-official |

---

## 3. 「跑完一次就收起」：先例、反面证据与落地口径

| 证据 | 原文 | 出处 |
| --- | --- | --- |
| **支持（最直接）** | `mode.finish() // Action picked, so close the CAB.` —— 批量动作一执行完就关掉操作栏 | Android 官方菜单文档（verified-official） |
| **支持（要显式设置）** | 「Do not specify a `Height` on the Expander. If you do, the control will reserve that space even when the content area is collapsed」——折叠要真的省掉空间，别只是盖住 | WinUI Expander（verified-official） |
| **支持（摘要头）** | 「In this example, you handle the `Collapsed` event and **populate the `Header` with a summary of options that are selected in the `Content`**」 | WinUI Expander（verified-official） |
| **反面：别自动收起** | 「Depending on your app … it might be a convenience to automatically collapse Expander controls when the user expands a different one. **However, this also takes control away from the user.**」 | WinUI Expander（verified-official） |
| **反面：状态由用户决定** | 「**Items that are opened or closed should remain in that state until the user changes it.**」 | NN/g《Accordions Are Not Always the Answer》[nngroup.com](https://www.nngroup.com/articles/accordions-complex-content/)（verified-official） |
| **反面：默认收起要付代价** | 「The panel is hidden by default…」但「accordions **compromise the discoverability of the collapsed content**」 | NN/g《Accordions on Desktop》[nngroup.com](https://www.nngroup.com/articles/accordions-on-desktop/)（verified-official） |
| **折中口径** | 「**Retain people’s expansion choices.**」（展开过就记住） | Apple HIG Outline views（verified-official） |
| 浏览器下载面板那一族 | 曾有过「全部下载完就自动关闭面板」的选项，如今该选项在新版 Firefox 源码里**已经找不到**（`closeWhenDone` 命中 0 次） | 本机 grep `mozilla/gecko-dev`（**否定结论，我实测的**） |

**结论**：用户要的「跑完就收起」不是孤例（Android CAB 就是），但「自动收起」在**通用**设计规范里是被警告的。
两者能同时满足的写法只有一种：**收起是默认态、展开状态被记住、并且收起那一刻头上要写明发生了什么**
（WinUI 的摘要头 + HIG 的记住选择）。这条也是原型页里五个方案共用的收起规则。

---

## 4. 五套原型与数字

原型页：[`collection-picker-demos.html`](./collection-picker-demos.html)。卡片外壳按真机计算样式 1:1 重画，
合集数据是**真的**（109 集标题/时长/封面取自 `/api/videos/preview`，封面是 hdslb CDN 真实 URL）。
所有尺寸是**本页 DOM 自量**（脚本见 §7），与真机对照见第 4 列。

| 方案 | 收起态卡片 | 展开态卡片 | 一屏能看见 | 109 集要滚 | 真机/原型误差 |
| --- | --- | --- | --- | --- | --- |
| 现状（基线） | —（没有收起态） | **584.8px** | 6 整行 | 16.1 屏 | 真机 588px（差 3.2px，0.5%） |
| [1 折叠加摘要](./collection-picker-v1-fold.png) | **296.7px** | 603.6px | 6 整行 | 16.1 屏 | — |
| [2 单轨两模式（推荐）](./collection-picker-v2-single-track.png) | **296.7px** | 526.9px（合并后 335px） | 6 整行 | 16.1 屏 | — |
| [3 加长列表工具](./collection-picker-v3-longlist.png) | 296.7px（同 1） | 612.9px | 6 整行 | 16.1 屏 | — |
| [4 选集浮层](./collection-picker-v4-sheet.png) | **296.7px** | **296.7px**（卡片恒定）+ 浮层 283.2px | 4 整行 | 22.9 屏（浮层里） | — |
| [5 海报名片墙](./collection-picker-v5-tiles.png) | 296.7px（同 1） | 573.9px | **6 列 × 4 行 = 24 格** | **4.7 屏** | — |

**逐套说明（依据 → 数字 → 代价）：**

- **1 折叠加摘要**：WinUI Expander「默认收起 + 把已选摘要写进 Header」+ Apple HIG「默认隐藏 / 记住展开选择」。
  收起 **−291.3px（−50%）**。代价：展开态反而比现状**高 18.8px**（多了一行摘要），列表本身四个问题一个没解决。
- **2 单轨两模式（推荐）**：M3 Lists「一条列表只能一种选择模式」+ M3 Selection「次要选择只在 hover / 选中后才显勾选框」
  + Android CAB「勾选框是入口、动作执行完即退出」。一屏里 0 个勾选框（现状 109 个）；
  合并完成后**当场收成一行**（原型实测：卡片从 526.9px → **335px**）。
  代价：多选从「随手勾」变成「先点一下多选」；`aria` 语义要么纯 listbox、要么 grid，落地是两种写法。
- **3 加长列表工具**：B 站创作中心「添加单集」（搜索 + 勾选 + 上限 50）+ Bilibili-Evolved（全选/全不选/反选 + shift 区间 + 计数）。
  **搜索是真的**：在 109 集真实标题里搜「特朗普」命中 **11 集**、「关税」**5 集**、「中国」**10 集**、「美国」**45 集**
  —— 前三个一屏就看完，「美国」这种宽词照样白搭（这条数字说明搜索有用但有边界）。
  代价：面板头多了一行（展开态 612.9px，最高的一套）；shift 区间只有「浏览态有点行」才成立。
- **4 选集浮层**：腾讯 `choose_panel` + Pilipala/bv 的底部 Sheet（标题写总数、打开定位当前集）+ Primer SelectPanel（内置过滤、关闭时生效）。
  **卡片高度与集数彻底解耦**：9 集和 300 集都是 296.7px。代价：浮层里只放得下 **4 整行**（比就地展开少 2 行），
  要在画布里再高就会盖住下面的说明/邻节点；多一层浮层还要处理「点外面关掉 / Esc / 画布缩放」。
- **5 海报名片墙**：腾讯 `.episode-item` 的 54px 方格 + 8px 间距 + 浅底高亮 + 「查看全部」，配 B 站自己的封面卡片式列表。
  扫描密度 **24 格 vs 6 整行 = 3.3×**，109 集滚 **4.7 屏 vs 16.1 屏**。
  代价：格子里只有序号，标题要靠悬停或下面那行「当前」；**靠封面判断内容对 B 站这种强标题场景不一定够** ——
  腾讯那套是给有分集海报的剧集用的。适合「先扫一遍看哪几集眼熟」，不适合「按标题找一集」。

---

## 5. 推荐与落地代价

**推荐 2（单轨两模式）**，并把 3 的搜索按需并入（109 集这种量级值得有）。落地要点：

1. **默认态**：单视频节点解析出合集后，面板**收起成一行**（`合集《美国时政》· 109 集 · 已选 1 集`）。
   展开态由用户点开、并**记住**（同 `ProjectsPanel` 里 `EXPANDED_KEY` 那套 localStorage 写法）。
2. **浏览态**：点行 = 切换当前来源（保持现有 `switchToSeasonEpisode` 语义），当前项墨色底 + 加粗，
   **不渲染勾选框**；打开时把当前项滚进视野（`scrollTop` 手算，别用 `scrollIntoView`——后者会连带滚画布层面的容器）。
3. **多选态**：由「多选」按钮进入；进入后所有行显勾选框 + 底部动作条（`已选 N 集` + 合并 + 取消）。
   `aria`：浏览态 `role="listbox"` + `aria-selected`，多选态改用 grid/table 语义 —— 不要把两者混在一行上。
4. **收起的时机**：① 合并完成（对应 Android CAB 的 `mode.finish()`）；② 节点跑过一次之后（用户明确要求的那条）。
   「跑过一次」在本仓没有跨刷新信号（`status` 是运行态、按约定不写进工程图），所以落地有两种取法：
   **取法 A**（简单）：收起是默认态，展开过就记住 —— 不区分跑没跑过，行为可预测；
   **取法 B**（更贴原话）：会话内看到 `status === "done"` 时自动收一次，刷新后退回「默认收起」。
   两取法都满足「跑完就收起、随时能展开」，差别只在刷新后是否还自动收。**建议 A**，因为 B 的「这次跑完收、
   下次刷新又不收」更容易让人困惑（且 WinUI 明确警告过自动收起这件事）。
5. **顺带修的两处排版**（与选哪套无关，独立可做）：限高对齐到整数行节律（6 行 = 199.2px，或 7 行留出明显的半行提示）；
   合并提示只留一处（`hint` 与按钮 `title` 二选一）。

**不建议单独做 5（海报墙）**：B 站场景里标题才是判断依据，封面墙的扫描优势换不来「按标题找」的损失。
它可以作为 2/3 的补充视图以后再加。

---

## 6. 诚实清单

- **原型是手写控件，不是 Element Plus 真实渲染**。落地实现必须用 EP 组件，圆角/阴影/键盘态会有差异。
  原型的总高与真机差 **3.2px（0.5%）**（584.8 vs 588），差异来自原型外壳手写与字体度量。
- **当时没有在真机上跑过改造后的实现**：本页所有「收起态 / 展开态」的数字都来自原型页自量，
  只有「现状」那一行是真机实测（`probe-picker-geom.mjs`）。**这一条已在 §8 兑现**——
  落地后真机复测 18/18，改造前后的数字与三处原型差异见 §8。
- **原型页的浮层是「锚定在卡片内」的**（`position: absolute` 于卡片），真机要处理画布缩放的浮层补偿
  （本仓已有 `FlowMenuStyle` 的 `zoom` 方案，见 `ScribeNode.vue` 顶部注释），这部分没做原型验证。
- **第 5 套的封面是真实 CDN 图**：断网时会退化成灰块（原型里已做 `onerror` 兜底），不影响排版判断，
  但它意味着这份原型页**不是完全离线的**。
- **引用复核只覆盖了 8 条关键依据**：M3（Lists / Selection）、Android 菜单、MS Expander、Apple HIG、
  NN/g 两篇、Bilibili-Evolved 的 `EpisodesPicker.vue`、腾讯视频 CSS。其余条目（B 站 App 官方面板形态、
  DownKyi、Netflix/优酷/爱奇艺的面板形态等）**仍是二手或搜不到**，正文里已逐条标注。
  两处复核中发现的偏差已改正：Apple 的「记住展开选择」出自 **Outline views** 而非 Disclosure controls 页；
  腾讯的 54px **宽**来自组件内联样式默认值，不是 `.episode-item` 的 CSS 属性。
- **几条否定结论的性质**：「观众端 B 站工具都没有搜索框」「B 站 App 选集面板是否支持多选」——
  前者是逐个查证过 6 个产品的源码/脚本得出的，后者是**搜不到**（不是「不支持」）。
  「新版 Firefox 已移除下载完成自动关闭面板」是我在本机 grep `mozilla/gecko-dev` 得到的否定结论，
  只说明当前源码里没有这个 pref，不能证明历史上从没有过。
- **「跑完一次就收起」的两种取法没有定论**：§5 建议 A（默认收起 + 记住展开），但这与用户原话
  （「执行了一次之后才收」）有细微差别，最终口径请一起定。
- **原型的交互有自测**（11/11 通过：展开收起、浏览态无勾选框、进多选显勾选框、合并后收起成一行、
  搜索命中 11 集、全选/反选、shift 区间、浮层开合、点格子切换、过滤按钮），但这个自测是**我写的脚本**，
  不是独立第三方验收；脚本本身可能与被测页面共享同一个误解（例如它检查的是 DOM 状态而不是真实用户感受）。

---

## 7. 测量方法与复现

下表的脚本都在 `.tmp-shots/`（临时目录、不进版本库，与上一轮 `.tmp-cdp-styles/` 同样处置）——
本页把口径、前置断言和踩过的坑都写清了，要复现照着这一节重写即可，不依赖那些文件本身。

| 产物 | 脚本 | 说明 |
| --- | --- | --- |
| 现状真机几何 + CLS + 逐帧 | `.tmp-shots/probe-picker-geom.mjs`、`.tmp-shots/probe-picker.mjs` | CDP + 无头 Chrome（无第三方依赖）。前置：后端 8787 在跑、前端在 `http://localhost:5173`（服务端跨站守卫只放行 5173/4173 两个来源，这是踩过的坑）。**尺子自带前置断言**：列表 `clientHeight` 必须等于它的 computed `max-height`、`rect.height / zoom` 必须等于 `offsetHeight` —— 第一版探针把 `clientHeight` 也除了 zoom，得出「列表 375.7px 而 CSS 上限 224px」这种自相矛盾的数（画布里同一元素有两套像素口径）。 |
| 原型页自量 | 页面内 `measure()`，输出在 `window.__demoMetrics()` | `.tmp-shots/shot-picker-demos.mjs` 会把它打印出来 |
| 原型页交互自测 | `.tmp-shots/test-picker-demos.mjs` | 11 项断言，最后一行 `[test-picker-demos] 11/11 项通过` |
| 六张整页图 | `.tmp-shots/shot-picker-demos.mjs` | 逐套只留一个 `.demo`、其余 `hidden`，再整页截图（**不用 clip**：滚动之后 clip 的页面坐标会整体偏移，第一版图每张都少掉约 130px 的顶部） |

---

## 8. 落地：用户选定第 2 套（单轨两模式）

**已实现**（`apps/web/src/components/canvas/ScribeNode.vue` + 新模块 `apps/web/src/utils/bili-picker.ts`）：

- **收起态是默认态**：一行摘要 `合集《X》· 109 集`（攒到 ≥ 2 项时再加「已选 N 集」），点它展开。
- **一行只挂一种语义**：浏览态点行 = 把节点切到那一集（行是 `<button>` + `aria-current`，**行里没有勾选框**）；
  点「多选…」才进选择模式（行变成 `<label>` + 真 `<input type=checkbox>` 的复选框组），底部出现动作条。
  两种模式不再并存（M3 Lists 的硬约束）；旧写法把 `aria-selected` 的 listbox 语义和行内勾选框混在一行，
  是 ARIA APG 明说的反模式，这次一并改了。
- **展开即定位当前集**：滚到列表中间（不用 `scrollIntoView`，它会连带滚动画布容器）。
- **收起规则**：默认收起 + 记住这个节点的展开状态（§5 的取法 A），**外加两个「这件事结束了」的信号**
  ——合并完成、以及这个节点跑完一轮（`status` 进 `done`/`error`）——都收回摘要行。
  状态按「节点 id + bvid + 列表类型」记在模块级 Map：画布会卸载视野外的节点，
  放组件 ref 里的话「拖出视野再拖回来」会把用户刚点开的面板自己关掉。

**真机实测（改造前 → 后，同一个工程、同一个 109 集合集）**

| | 改造前 | 落地后 |
| --- | --- | --- |
| 单视频节点卡片高度 | **588px** | **310.1px**（−277.9px / **−47%**） |
| 展开态卡片高度 | 588px | 574.0px |
| 一屏能看见 | 6 整行 + 第 7 行只露 79% | **7 整行**（限高 224 → **232px**，滚到顶也没有半截行） |
| 浏览态勾选框数 | 109 | **0** |
| 打开面板时的位置 | 停在顶部（当前集在第 109 位，看不到） | 当前集滚进视野（`scrollTop = 3385`，到底） |
| 跑完一轮之后 | 仍然全展开 | **自动收起**（真机跑一次节点，`status: done` 那一刻面板收成 310px 左右） |

**与原型的三处差异**（都记在这，免得日后对不上）：

1. **「已选 N」只在 ≥ 2 项时显示**。原型里收起态一直写「已选 1 集」（因为默认就勾着当前那一集）——
   落地发现它不传递任何信息，而 ≥ 2 才是「攒了一个待合并的选集」这个需要被看见的状态。
2. **列表限高原型里故意保留 224px**（为了 1:1 复刻现状、把「第 7 行只露 79%」这个毛病展示出来）；
   落地改成 232px = 7 整行。
3. **多了一条说明行**：展开后那一行写「点一行 = 换到这一集」并让「多选…」按钮就位——
   原型里这一行是「多选…」按钮单独放着，落地把「点行会发生什么」写出来了（旧版靠 `title` 提示，鼠标不悬停看不见）。

**验证**：`pnpm typecheck && pnpm test && pnpm lint` 全绿；`pnpm smoke:ui` **72/72**；
真机探针 `.tmp-shots/probe-picker-v2.mjs` **18/18**（收起/浏览/多选三态、当前集定位、
无半截行、点行语义、合并后卡片变多集卡、「改选集」直接回到展开态、**真跑一次节点验证跑完自动收起**、
收起后还能重新展开）；新增单元测试 8 条（`apps/web/src/utils/bili-picker.test.ts`，
守的是摘要文案、合并不可用原因、跨重挂载的状态记忆、以及「跑完才收起」的判定）。

**这次落地的诚实清单**

- 只读检查跑在用户自己的工程上（点摘要行、进多选、勾选都不写工程图）；**点行切换**那一步会写工程图，
  所以没在用户工程上做，只在一次性副本上验（副本已删除，连带清掉它产生的 14 份图备份）。
  工程图内容与改造前一致（`url` / `bvid` / `title` / `pageInfo` 未变、没有 `items`），
  但**打开工程本身**会让应用按惯例刷一次 `updated_at` 与图备份。
- 「跑完自动收起」是**真跑了一次节点**验的（跑的是来源节点本身，不调 AI），**但只跑了一次**；
  多节点串行、局部运行、取消这几种情况下会不会重复触发，没有逐个验（判定函数只认 `done`/`error` 两种终态，
  且非 immediate 的 watch 在重挂载时不触发）。
- 三种状态的可视效果见 `collection-picker-landed-collapsed.png` / `-browse.png` / `-multi.png`（真机截图）。
- **多选态半途被卸载**（拖出视野再拖回来）时，选择模式会保住，但勾选集合会按「当前集」重新推导 ——
  这是改造前就有的行为（`applyPreview` 里统一推导），这次没改。
- **分P 列表（多 P 稿件）没有在真机上验过**：测试工程里的那个视频是单 P。两个列表共用同一条模板与状态机
  （同一个 `v-for` + `switchTo` / `togglePick` 按 kind 分派），「页」侧的文案、量词与摘要由单测覆盖，
  但「切到某个分P」「合并多个分P」这两条**只在代码层面成立**，没有真机证据。

### 8.1 返工：交互被认可、视觉被否之后重做的部分

用户的原话：「这部分设计是可以的，但是样式只能说奇丑无比，信息的展示不齐整、冗余，比如顶上的分割线我不喜欢，
然后多选这一行表述很幼稚，左右也没对齐，多选按钮也和主流相距甚远，列表里就更别说了，hover 的时候时间位置改变，
并且还出现切换，你都告诉过用户这是切换了，你为啥还要自以为是再说一遍」。
逐条落到改动上：

| 指出的问题 | 改法 | 真机复算 |
| --- | --- | --- |
| 顶上的分割线 | 删掉 `.sf-node-picker` 的 `border-top`，改用间距分组 | `border-top: 0px` |
| 多选这一行表述幼稚 | **整行删除**（连同「多选…」文字链）：说明文案只留在每行的 `title` 里 | 面板内 `hint` 元素数 = 0 |
| 左右没对齐 | 左边缘统一（标题 / 勾选位），右边缘统一（集数 / 时长 / 箭头 / 动作）；滚动条那 6px 用 `scrollbar-gutter: stable` + 头部 14px 右内边距补掉 | 左 459.4 = 459.4；右 657.4 = 657.4 = 657.4 |
| hover 时时间位置变、还冒出「切换」 | 删掉「切换」；**勾选位常驻 14px 占位**，勾选框平时透明、悬停该行才现 —— hover 不再改变任何东西的位置 | hover 前后时长列左边缘**最大位移 0.00px** |
| 多选按钮和主流相距甚远 | 入口不再是文字链：**第一次点勾选框即进选择模式**（Material 3 次要选择的做法）；动作条用 Element Plus 按钮（墨色主按钮 + 文字取消，与对话框确认键同一套） | `.el-button` ×2，主按钮 `rgb(22,24,29)`、高 26px |
| 列表里「更别说了」 | 行高钉 30px、间距 2px、限高 224px（= 7×32 整除），定位当前集的滚动**吸附到行边界** | 展开与滚到底都**没有半截行**（此前 224px 时第 7 行露 79%，232px 且行高是小数时滚到底会露出上一行的勾选框残影） |

两个坑写在代码注释里，因为它们都不会报错、只会变难看：
① 给行加显式 `height` 后，列向 flex 容器会把 109 行**压扁**到 18px（行距从 32 掉到 20），必须补 `flex: none`；
② 滚动条占 6px 布局宽度，不 `scrollbar-gutter: stable` 的话「有滚动条时的时长」和「没有滚动条时的箭头」差 6px。

**这轮验证**：真机探针 `.tmp-shots/probe-picker-v4.mjs` **20/20**（含上面每一行的复算），
三张证据图 `collection-picker-landed-*.png` 重截（全部在**一次性副本工程**上拍，与用户工程同素材）。

### 8.2 自动化伤到用户工程的两次事故（如实记录）

- **事故一**：探针点了「第 2 行」的勾选框，但那一行在视口之外 —— 坐标落到了别处，触发了「点行 = 切换」，
  工程被切到另一集。
- **事故二**：重写截图脚本时，我在命中校验里写了个「命中到勾选位也算过」的逃生口；勾选框平时
  `pointer-events: none`，于是点击穿过它落到行主体上，同样触发了切换。
- **两次都用应用自己的图备份逐字节恢复**（`data/graph-backups/` 里挑出切换前那一份，`PUT /api/projects/:id/graph`，
  恢复后与备份逐字节一致：`url` / `bvid` / `title` / `cover` / `pageInfo` / 节点数全部相同），
  并在事后复核工程内容与恢复前一致。
- **现在的防护**：① 点击前必须用 `elementFromPoint` 断言命中目标（命中不对就抛错，不瞎点）；
  ② **一切会写工程图的操作只在一次性副本上做**（副本用完即删，连同它产生的图备份）；
  ③ 每次跑完复核用户工程的指纹（探针 A16 / B3 两项断言这一条）；
  ④ 截图的就绪锚点从「URL 变了」改成「左侧探索器的活动项 + 封面标题都对得上」——
  切工程时 URL 先变、画布还挂着上一个工程的图，上一版就是在那个窗口里点的。

### 8.3 第三轮：去掉「悬停才现的勾选框」，改回常驻

用户看完 8.1 那版后的反馈：「**不是，你改成这样，等于在单选情况下每次就会一闪而过左侧的选中情况，到底是为了什么**」。

这条我认。8.1 里我把 Material 3 的「次要选择不该常驻勾选框」当成了必须遵守的规则，于是做了「勾选位常驻占位、
勾选框平时透明、悬停该行才现」——结果是：鼠标划过每一行都闪一下勾选框，而且「哪几项已勾选」变成要悬停才看得见。
**两边都不讨好，纯属自找的视觉噪声。** 回头看，覆盖本场景的成熟产品用的全是常驻勾选框：

| 产品 | 勾选框 |
| --- | --- |
| Bilibili-Evolved 的下载选集面板（同一场景：粘链接 → 列全集 → 勾选要处理的） | **常驻**（条目前一个 checkbox，另有 全选/全不选/反选） |
| Gmail 会话列表 | **常驻** |
| Notion 数据库行 / Ant Design 表格多选列 | **常驻**（Notion 悬停出勾选框，但表格列是常驻） |
| 各家下载器（yt-dlp GUI、B 站下载工具） | **常驻** |

**所以第三轮把这块改回常驻，并把结构一起简化了**：

- 勾选框常驻、可直接点；点行主体仍然只做「换到这一集」，点勾选框只做「攒待合并的选集」。
- **去掉「浏览 / 多选」两态**（不再有模式切换，也就没有「进入/退出」这件事）。
- 底部动作条只在**攒到 ≥ 2 项**时出现（默认只勾着当前这一集，那时没什么可合并的），按钮是「清空」+「合并为一张卡片」。
- 悬停**不改变界面上任何东西** —— 这是这轮唯一的核心验收点。

**真机复算**（`.tmp-shots/probe-picker-v6.mjs`，**20/20**）：
hover 前后时长列最大位移 **0.00px**、勾选框的 opacity 快照与勾选数完全一致、勾选框 109/109 常显且
`pointer-events: auto`、展开后无半截行、三处右边缘对齐（657.4 / 657.4 / 657.4）、
动作条是 Element Plus 按钮（墨色主按钮、高 26px）、点行主体确实只切换（副本上验，预览标题跟着变）且不顺带勾选。

**验证脚本再收紧**：这一轮起，探针与截图脚本**连用户工程都不打开** —— 整份复制成一次性副本、
所有点击都在副本上、用完即删；锚点从接口读（不写死视频名）；用户工程只做一次只读指纹比对。
（背景见 8.2：前两轮的误点是我造成的，虽然都恢复原状，但这种风险不该再有。）
