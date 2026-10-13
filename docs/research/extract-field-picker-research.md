---
title: 「抽取哪些属性」选择控件：成熟做法调研与四个候选方案
class: research
---

# 「抽取哪些属性」选择控件：成熟做法调研与四个候选方案

> 触发：用户质疑设置页里这个多值字段的排列与交互——「很难想象目前这些可选内容是以这么蹩脚和不清晰的方式排列的」，
> 并明确要求：**不要凭空捏造选择交互，去调研已有项目的成熟设计**，且要「多找几个作为 demo 供选择」。
>
> 交付物：同目录的 `extract-field-picker-demos.html` —— 可点的静态原型，含现状对照与 4 个候选方案，
> 每个方案都标了出处、好处与代价。本文是它的依据与结论。
>
> 测量口径：结构问题来自读实现（`apps/web/src/views/SettingsView.vue`）；占位高度是浏览器实测
> （视口 1040px，演示区按设置页真实表单宽度 460px 显示）；Element Plus 的能力核实是**读本仓库装的
> 2.14.5 源码**（§5）；外部产品的做法**全部带 URL**，我没能直连核实的单条都在 §7 里列出。

## 1. 现状：问题在哪（读代码得到的事实）

设置页 Obsidian 组「② 笔记里有什么」里的那个字段，四处问题：

1. **下拉是空的**——候选列表就是它自己的当前值：`el-option v-for="field in form.obsidianExtractFields"`。
   点开只能看到已经选中的那三个，等于没有建议。这是最实质的一处：控件长得像"可挑选"，实际只能盲打。
2. **预设的语义是覆盖**：文案写「换成：」，点了直接替换整个数组；而 `EXTRACT_FIELD_PRESETS` 里
   `history`（人物/事件/时期）同时是 `DEFAULT_EXTRACT_FIELDS`，也就是产品默认值——用户说的
   「连默认的都是指定历史笔记」。
3. **层级不统一**：② 这一段是「开关 → 从属块（字段 + 预设行 + 提示）→ 笔记预览」，而下面
   「每篇最多关联几篇」「属性回补」「深度重扫」散在 ③ 词库的标题前后；两个「回补」块长得一样，
   但一个受 `form.obsidianAutoLinkEnabled` 控制、一个常驻。
4. **依赖关系只用散文表达**：这组字段有两个下游——写进 front matter 的列表、以及「相关笔记」的比对依据
   （`engine.ts` 的 `process.obsidian` 分支与 `related-notes.ts`）。这条依赖现在写在字段下方的提示里，
   结构上看不出来。

## 2. 调研：预设与自定义，成熟产品怎么放

结论先说：**成熟产品里几乎不存在「预设被套用后保持选中态、用户改完内容这个态还有意义」的设计。**
它们把预设建模成两种东西之一——**一次性套用的模板**（stamp），或**值本身**（选项）。这正好解释了
现状那个「换成：历史笔记 / 通用 / 不抽」为什么别扭：它两头不靠，既能覆盖值，又想表达"我现在用的是哪套"。

四种形态（各有代表）：

| 形态 | 代表 | 预设与自定义的关系 | 套用后怎么显示 |
| --- | --- | --- | --- |
| 同列表并列 + 就地新建 | Notion Select、Airtable 单选、Linear label | 并列：自定义＝在列表尾部新建一个值 | 就是普通值，没有「使用模板 X」这个态 |
| 同一字段 + 下拉快选 | GitLab pipeline schedule、n8n Schedule Trigger | 预设只是往同一个字段填一个值 | 字段里是值，不是预设名 |
| 自定义作为预设的**生成器** | Sentry TimeRangeSelector | 输入即生成选项 | 与选了预设等价 |
| 两种语义并列成模式 | AWS EventBridge Scheduler | 平级选择：Rate-based / Cron-based | 两者语法不同，不可互转 |

- **Notion**：Select 里直接输入新名字、回车即创建（[database-properties](https://www.notion.com/help/database-properties)）；模板挂在 `New` 按钮旁，
  套用到新页面（[database-templates](https://www.notion.com/help/database-templates)）。它的 **API 建模很值得抄**：
  `template.type` 有 `none` / `default` / `template_id` 三态，`default` 表示"用数据源自己的默认模板"
  （[post-page](https://developers.notion.com/reference/post-page)）——默认值是数据模型里的一等公民，不是字段初值。
- **GitLab** 的原文是「Select one of the preconfigured intervals, or enter a custom interval in cron notation.」
  （[schedules](https://docs.gitlab.com/ci/pipelines/schedules/)）：一个字段，预设往里填值。n8n 同构：
  下拉列出 Seconds…Months **以及 Custom (Cron) interval**，选 Custom 才出现表达式输入框
  （[Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/)）。
- **Sentry TimeRangeSelector** 是最值得抄的一条：输入框不是过滤固定列表，而是**从输入生成选项**——
  打 `5` 给出 Last 5 seconds / minutes / hours / days / weeks，打 `5d` 直接收敛成 Last 5 days
  （[PR #36624](https://github.com/getsentry/sentry/pull/36624)）。自定义于是不是另一条分支，而是预设的生成器；
  预设同时承担了"教用户这个字段怎么写"的职责。
- **反面对照 Stripe metadata**：纯自由 key/value，零预设（[docs.stripe.com/metadata](https://docs.stripe.com/metadata)）。
  上限倒是写得清清楚楚（50 对、key 40 字符）。它说明了一件与现状相关的事：**全自由 = 用户不知道业界通用的名字叫什么**，
  这正是"要有建议"的理由。
- **Airtable 的 Default option** 明写「只影响新建记录、只有一个、静态」
  （[single-select-field](https://support.airtable.com/docs/single-select-field)）——这是"默认值"该有的措辞强度，
  和本仓库上一轮改掉的那句「笔记会写进『未分类』」是同一类问题。

**如果一定要保留"当前用的是哪一套"这个状态**，唯一有官方文档写明随内容变化的规则来自 Figma 的变量模式：
显式指定过的会一直跟着它（即使它不再是默认），而 Auto/Default 会跟随新的默认
（[Modes for variables](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)）。
方案 C 的「已改」标记就是照这条做的。

## 3. 调研：默认值怎么表达，才不会被读成"决定值"

上一轮那个「笔记会写进『未分类』」的坑，成熟产品里有六类现成手段：

| 手段 | 产品 | 原文/做法 |
| --- | --- | --- |
| 标签贴在**值**后面 | Stripe | 「Your account's default API version shows the label **(Default)**… **(Latest)**」（[api-versions](https://docs.stripe.com/api-versions)） |
| 括号表示兜底值 + 给对象挂来源标记 | Figma | 回落到集合默认模式时「shown in parentheses」；指到非默认模式时「a tag with the mode icon and mode name will appear next to the layer name」 |
| 字段下方一句陈述 + 重置动作 | Windows Terminal | 覆盖了基层的控件下方写「Overrides Base layer.」，旁边是 Reset（仓库内设计规格 `cascading-settings.md`） |
| 左侧色条（像 diff） | VS Code | 「the colored bar on the left of the setting, similar to modified lines in the editor」，另有 `@modified` 过滤（[settings](https://code.visualstudio.com/docs/configure/settings)） |
| 「别处也改了」的降级文案 | VS Code | 指示器叫 **Modified elsewhere**；只有一个其他作用域改过时不显示，退回「Modified in / Also modified in」（[vscode#153351](https://github.com/microsoft/vscode/issues/153351)） |
| 干脆改名 | macOS | 菜单项就叫 **Default web browser**（[Apple 102362](https://support.apple.com/en-us/102362)） |

可落地的三条规则：

1. **只有当确实存在更高优先级来源时，"默认"才需要视觉标记；否则改名就够了。** macOS 那条只有一个来源，
   所以只用词；VS Code 有多个作用域，才有色条与 Modified elsewhere。对应到本仓库：设置页那个目录是默认值、
   卡片能覆盖，所以**需要**标记——现在写的「只是默认值」注记方向是对的。
2. **标签贴在值上，不贴在字段上。** Stripe 的 `(Default)` 和 Figma 的括号都是值级标注；字段级徽标说不清
   "哪个值才是默认的"。
3. **提供"从默认值生成一份自定义"的动作，并让来源标签随之切换**，同时保留一条"恢复跟随默认"的路——
   这就是 Figma「显式锁定 / Auto 跟随」在表单上的落地。

## 4. 四个候选方案

原型都在 `extract-field-picker-demos.html`（可直接双击打开；页面顶部有"按设置页真实宽度显示"开关，
默认开启，按 `apps/web/src/views/SettingsView.vue` 里 `.sf-settings-form` 的 `max-width: 460px` 渲染）。

| 方案 | 结构 | 在 460px 下的占位（实测） | 出处 |
| --- | --- | --- | --- |
| 现状 | 字段 + 「换成：」行 + 提示 | 206px | 当前实现 |
| **A 全部收进下拉** | 一个 creatable 多选；下拉＝建议（分组）＋「创建「X」」；「常用组合」固定在**下拉页脚** | **121px** | §2 的形态② + Sentry 的生成器思路 |
| B 属性表 | 每行一个属性：名字 + 它会抽什么的说明 + 删除；空列表给起点 | 196px | Notion / Airtable 字段列表；VS Code 的来源标注与重置 |
| C 模板两级 | 三张模板卡（卡里写明会抽哪几个字段）→ 套用后可编辑，手改后标「已改」 | 259px | Notion 模板 + Airtable Default option + Figma 的显式/自动规则 |
| D 选维度 | 不问字段名，勾「你想按什么把笔记串起来」，落成字段名 | 149px | Sentry 的生成器原则 + Stripe metadata 的反面；**具体控件形态是我构造的，无直接对应** |

几个设计要点：

- **A 的「常用组合」放在下拉页脚**，不跟着建议列表滚：这样它既不会像现在那样常驻占一行（省下 85px），
  又不会在建议多的时候被挤出去。这一条是看原型时发现的——第一版放在滚动区底部，展开后根本看不见。
- **A 的"建议"分两组**：一组是**你库里已经出现过的属性名**（带"库里 N 篇用过"），一组是常用名。
  前者要做一小段新代码，不是白捡的：`related-notes.ts` 里现成的 `scanVaultNotes` 会遍历全库并解析
  front matter，但 `pickFields(file.content, fields)` 只取**传入的那几个字段名**；要枚举"库里出现过哪些属性名"
  得改成读全部键并按篇数计数。成本是本地 IO，与设置页现有的库自检同一量级——不调模型、不花钱。
- **B 的每行说明**解决的是"属性名由你定"这句话现在无法落到具体字段上的问题：
  「人物」到底会从正文里抽什么，只有写在这一行才说得清。
- **C 的「已改」是我的折中**，不是抄来的：调研显示成熟产品干脆不保留这个态。保留它的理由是——
  这个字段的默认值曾经"沉默地压住"用户的期望（上一轮那个坑），把来源显式标出来能解释"这些词是哪来的"。
  但按 §2 的结论，更干净的做法是：套用即 stamp，之后不再提模板。

## 5. 落地可行性：本地读源码核实（比查文档更硬的一条）

方案 A 能不能不做自定义下拉就实现，直接看本仓库装的 element-plus 源码即可——版本 2.14.5，
证据是 `node_modules/.pnpm/element-plus@2.14.5_*/node_modules/element-plus/es/components/select/`：

| 问题 | 核实结果 | 证据 |
| --- | --- | --- |
| 下拉里能不能放自定义内容 | **能**：`select2.mjs`（`ElSelect` 的实现）渲染 `$slots.footer`，包成 `.el-select-dropdown__footer`；`header` 同理 | `select/src/select2.mjs` 里 `$slots.footer` 那一段 |
| 建议能不能分组 | **能**：`el-option-group` 是官方组件 | `select/index.mjs` 导出 `ElOptionGroup` |
| 多选 + 可创建 | `allowCreate` 是 `ElSelect` 的 props 之一 | `select/src/select.mjs` |
| chip 太多怎么收 | `maxCollapseTags` / `collapseTagsTooltip` 都在 | `select/src/select.mjs` |
| 有没有官方 tag input | **有**：`el-input-tag`，但它是纯输入框——props 只有 `modelValue / trigger（默认回车）/ delimiter / tagType` 等，插槽只有 `prefix / suffix / tag`，**没有任何下拉或建议能力**（源码里搜 popper/dropdown 命中 0） | `components/input-tag/src/input-tag.mjs` |

结论：**方案 A 可以完全用 Element Plus 现成能力实现**——`el-select multiple filterable allow-create`
＋ `el-option-group` 分组建议 ＋ `#footer` 放常用组合，不需要自研下拉。`el-input-tag` 这条路排除，
因为它给不了建议，而"点开有东西可选"正是这次要解决的核心问题。

### 5.1 落地时要记住的四条（都有出处，实现时别踩）

1. **`allow-create` 必须同时给 `filterable`，否则静默失效、没有任何警告。**
   官方文档写的是「To use this, `filterable` must be true」（[select.md](https://github.com/element-plus/element-plus/blob/dev/docs/en-US/component/select.md)）；
   源码里就是一句 AND 短路：`showNewOption = filterable && allowCreate && inputValue !== '' && …`。
   漏了不会报错，只会"创建不了"。
2. **创建过的值不会回到候选列表**——这是本次唯一的真缺口（
   [issue #11892](https://github.com/element-plus/element-plus/issues/11892) 仍 open，修复
   [PR #24917](https://github.com/element-plus/element-plus/pull/24917) 还在 Needs Review）。
   对"自定义字段名"这种场景意味着：用户删掉「时空」之后想再加回来，只能重新手打。三种都在规范内的补法：
   ①**业务层回填**——`@change` 里把新出现的值 push 进自己的建议数组（最小、不碰组件、不加库）；
   ②换 `el-select-v2`——它的官方测试**断言过创建值会留在 `filteredOptions` 里**，正好命中这个需求，
   代价是必须改用 `:options` + `props` 映射、不能再写 `<el-option>` 子节点；
   ③等 #24917 合入（在能钉版本之前不算方案）。**原型按①的行为做**，所以下拉里会出现「你自己加过的」这一组。
3. **`#footer` 是有官方示例的现成能力**，不是我们拼出来的：插槽自 **2.4.3** 起
   （release notes：`[select] add header and footer slot (#14876)`），官方文档里就有
   「Footer of the dropdown」示例，内容正是"在页脚放按钮 + 输入框来加东西"。方案 A 的常用组合照抄这个骨架。
4. **中文输入法下要实测回车行为。** `default-first-option` 的含义是「回车选中第一个匹配项」，
   历史上有一条 IME 相关的报告（[#13850](https://github.com/element-plus/element-plus/issues/13850)，
   中文选字时按回车会误选第一项；已关闭）。这个仓库的字段名全是中文，**必须在真实输入法下试一遍
   "打拼音 → 选字 → 回车"到底是创建还是误选**，别只看英文环境的表现。

另外两条与实现相关的现状事实（不用改，知道就行）：创建项没有长度/格式校验，也没有 `maxlength`
（[#3277](https://github.com/element-plus/element-plus/issues/3277)）——但这个仓库的
`sanitizeExtractFields` 已经在服务端做了收口（去 `:#\r\n\t`、限 12 字、去重、最多 8 个），
所以漏网的坏值不会落库；自定义 chip 外观需要 `tag` 插槽，而用了它
`collapse-tags / max-collapse-tags / collapse-tags-tooltip` 会**全部失效**（两个 select 文档的 Custom Tag 一节都写明），
所以别为了改 chip 样子顺手把折叠能力弄没。

## 6. 推荐

> **实施记录（2026-10-13）**：用户选了方案 A，已按它落地到设置页——下拉三组建议（你自己加过的 / 你库里出现过的 /
> 常用属性名）＋ 页脚「套用一组」，新增 `GET /api/settings/obsidian/fields`（扫 front matter 的键并统计篇数）。
> 与本文的差异有两处，都记在 CHANGELOG 里：① 原型画的「＋ 创建「X」」行在真组件上渲染不出来
> （Element Plus 把创建行固定成输入文本），② 建议里"库里出现过的"那一组需要有笔记才看得到，
> 当时那个库 0 篇，所以这一组只在测试里验过数据、没在界面上看见。取舍与实测见 CHANGELOG 的 2026-10-13。

**主推 A**，理由是三条实测/可核实的好处：占位从 206px 降到 121px（实测，460px 视口）；
一个控件同时给出建议、创建与常用组合，点开有东西可选（现状是空的）；键盘可全程操作。
它与 §2 里 GitLab / n8n / Notion 的做法同族，不引入新概念。

两点配套：

1. **默认值不该指向「历史类」。** 现在 `DEFAULT_EXTRACT_FIELDS` 就是历史笔记那三个词。
   建议改成空数组（不抽）或中性的「通用」。这是独立于控件形态的一个决定，需要你点头。
2. **A 落地不需要自研下拉**：`el-select` 的 `#footer` 插槽与 `el-option-group` 已在本仓库装的 2.14.5 里核实
   （见 §5）。所以这一版的风险不在组件能力，在"建议从哪来"——见下条。

**备选**：C 适合"你希望用户明确知道自己选了哪套"的场景，但它是四版里最高的（259px），
且按调研结论，"保持选中态"本身就不是主流做法。**B** 只在需要给每个字段单独写说明时才值得。
**D** 是最像产品级重构的一版，但它没有直接出处，建议单独评估而不是和上面三版并列比较。

## 7. 诚实清单

- **§5.1 第 2 条（创建过的值不回候选）来自 issue、open 的修复 PR 与源码阅读，没有做运行时实测**——
  调研时子代理环境里浏览器不可用，本仓也没装 jsdom/@vue/test-utils，无法跑组件级测试。
  落地前应花两分钟在真机上验一次：创建一个新词 → 删掉 → 看它还在不在下拉里。
- **§5.1 第 4 条（中文输入法回车）是历史 issue，未在本仓的 element-plus 2.14.5 上复测**，
  但它直接影响构建这一版的方式（`default-first-option` 用不用），所以列在实现注意事项里。
- **§5 的结论钉在 element-plus 2.14.5 上**：升级该依赖后 `#footer` 插槽、`allowCreate`、`el-input-tag` 的能力
  都要重新核实（`package.json` 一旦动，这一节就过期）。
- **这一页的四个原型都是我手写的静态原型，不是 Element Plus 的真实渲染。** 落地的视觉细节（chip 的圆角、
  下拉的阴影、键盘高亮）会与原型有差异；460px 下的占位数字是原型实测，实现后应重新量。
- **没有做可用性测试**：四个方案都没有找真实用户点过，判断依据是调研到的成熟做法 + 结构分析。
- **我只做了文字调研，没有打开任何一个被引用产品的真实界面。** 所有视觉细节的判断都来自文档正文，
  涉及"看起来像"的部分属于推断。
- **未直连核实的条目**（来自调研过程）：Linear 的 `docs/labels` 页直连 404；Notion「Set as default」模板入口
  与「Create option」这个字面串未能证实；Sentry 的 `tags[name]:value` 语法未在官方页正文核到；
  Windows Terminal 的文案来自仓库内设计规格而非发布版逐字；macOS 的「Managed by your organization」无 Apple 官方页。
- **方案 D 没有可直接对应的成熟设计**，它是按 §2 的两条原则构造的，属于提案而非复刻。
- **本页没有改动任何产品代码**：现状那一段是复现现有行为（包括那个空下拉），不是修好后的样子。
