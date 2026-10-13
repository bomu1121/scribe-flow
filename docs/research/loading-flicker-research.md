---
title: 按钮"忙碌态"的闪烁：为什么"改文字"是最差的那种，以及延迟与最短显示的阈值
class: research
---

# 按钮"忙碌态"的闪烁：为什么"改文字"是最差的那种，以及延迟与最短显示的阈值

> 触发：设置页「先看要动多少（不花钱）」按钮点击时抖动。第一版修掉了面板塌陷（`relatedPlan = null` 那次
> 131px 的塌一下再弹回来），用户复测后说：「确实正常了点，但是感觉这个闪动还是很僵硬，
> **文字还是从有到无**，也就是从大抖动变成小抖动而已，调研这种抖动如何处理，然后再继续完善这里的效果」。
> 结论落在 `apps/web/src/utils/busy.ts`（`useDelayedBusy`）与 `SettingsView.vue` 里所有带忙碌态的按钮。

## 0. 结论先行

**保留按钮文字，只把左侧 14px 图标位换成同尺寸转圈；并且延迟 200ms 才显示、显示后至少留 400ms。**
三个数字/做法各有出处：

| 做法 | 依据 |
| --- | --- |
| 慢于 **200ms** 才显示转圈 | Mozilla Acorn（Firefox 设计系统）："Don't show a spinner animation if the wait time for the action will be less than 200ms. Any animation under 200ms can be seen as a quick flash and potentially confuse users." |
| 显示后至少 **400ms** | 同上："We recommend 400ms minimum display time."（它是唯一同时给出两个数字的浏览器厂商级来源） |
| **保留文字、只换图标** | GitHub Primer："the spinner replaces only that visual slot, and the button label remains visible."；Vercel Geist 明确反对换标签："Pass `loading` instead of swapping in a spinner so the button stays focusable and announces the busy state to assistive tech."；Ant Design 与 Element Plus 的源码都是保留标签、只动图标位 |

NN/g 的口径支持"快请求不需要反馈"，但它没有给出延迟阈值：
"For delays of more than 1 second, indicate to the user that the computer is working on the problem."、
"Normally, no special feedback is necessary during delays of more than 0.1 but less than 1.0 second"、
"For anything that takes less than 1 second to load, it is distracting to use a looped animation."

## 1. "改文字"为什么是最差的一种

改文字这件事同时动了三样东西：

1. **观感**：长文案 → 短文案 → 长文案，即使盒子宽度被撑住（我们原来的 `StableText` 就是干这个的），
   文字本身仍然"从有到无"再"从无到有"——这正是用户描述的那句。
2. **可访问名在动作中途变化**：按钮的可访问名就是它的文字。Geist 的文档把它列为要避免的做法。
3. **它把一个瞬时状态渲染成了两次阶跃**：点一下、20ms 后回来，等于给用户看了两帧不同的画面。

对照：只换图标时，文字与宽度都不动，变化的只有一个 14px 的图形——即使真的闪，也只是一小块在转。

## 2. 各家对"忙碌按钮"的规定（调研 pass 抓到的原句）

| 系统 | 标签 | 延迟 |
| --- | --- | --- |
| GitHub Primer | 保留（"label remains visible"） | 无（但它用 `aria-disabled` + 常驻 live region 通告） |
| Vercel Geist | 保留，明文反对换 spinner | 无 |
| Ant Design | 保留（源码里 label 恒渲染） | **有**：`loading={{ delay: n }}` |
| Element Plus | 保留（`.el-button.is-loading` 只加遮罩，不隐藏文字） | 无 |
| Shopify Polaris | **隐藏**（`color: transparent`，占位不变） | 无 |
| Salesforce Lightning | — | **有**：`.slds-spinner_delayed` = 300ms；"Use stencils when data takes longer than 300 ms to retrieve. For less than 300 ms, just show the data." |
| Atlassian | 替换标签 | **有**：spinner 的 `delay` prop；默认靠 150–200ms 淡入挡掉瞬闪 |
| Carbon | 换成状态标签 + 禁用 | 无（官方文档只说 "a few seconds"，没有毫秒数） |

## 3. 无障碍：两个要避开的坑（我们没踩，记下来）

- **别用 `disabled` 去表达"正在忙"**：它会把按钮从 Tab 序列里移除。Primer/GOV.UK/Geist 都建议 `aria-disabled`。
  我们的取舍：**只读操作**（自检、预估、读列表）的禁用被延迟，并且处理器开头加了防重入守卫——快请求时
  按钮连灰都不灰，也就不存在"被移出 Tab 序列"的窗口；写操作（回补、备份、恢复、清理）保持立即禁用，
  因为它们跑几秒、且重复提交有真实代价。
- **`aria-busy` 加在容器上、不要加在按钮上**：MDN 说它是全局态可用于任何角色，但 Polaris 的官方 issue #1212
  记录了"加在按钮上"引发的读屏冲突并建议别用。我们把它留在结果面板（容器）上。
  （另：**结果本身没有播报**——要播报得加一个常驻的 `role="status"` / `aria-live="polite"` 区域，
  这是 Primer 的 `AriaStatus` 做法。本仓库目前没有，属于已知缺口，不在这轮范围内。）

## 4. 落地的两条规则（`useDelayedBusy`）

1. 开始后 `delay`（200ms）内结束 → **全程不显示**（连禁用都不做）；
2. 一旦显示，**至少显示 `minDuration`（400ms）**，否则 200–300ms 的请求会得到一个转了几十毫秒的图标，
   比不显示更像故障。

数字从**它出现那一刻**起算（不是从点击那刻）——这条在写单测时被自己的期望值绊了一次，见 §6。

**实测（真实应用，逐帧采样）**：

| 场景 | 结果 |
| --- | --- |
| 真实后端（约 70ms 返回） | 按钮全程只有 2 次状态记录，差异**只在下方表单高度**（结果面板出现，3232 → 3364）；文案、图标、`disabled`、`opacity` **全程不变** |
| 人为把请求拖到 900ms | 点击后 **+250ms** 出现转圈并置灰（延迟生效），转圈持续约 **700ms** 后随结果消失（≥400ms 最短时长生效）；置灰是约 120ms 的淡入，不是硬切 |

仓库里本来已有一份同类内联实现（库路径自检的"180ms 后才转圈"，注释写着"闪现一下比不显示更烦"）——
这轮把它也换成了同一个工具，全页只有一套规则。

## 5. 参考来源

调研 pass 抓到原文的（我本人**未逐条复核**，URL 由调研给出）：

- Mozilla Acorn · Motion：<https://acorn.firefox.com/latest/foundations/styles/motion-YsUZhS6a>
- NN/g · Response Times: The 3 Important Limits：<https://www.nngroup.com/articles/response-times-3-important-limits/>
- NN/g · Progress Indicators：<https://www.nngroup.com/articles/progress-indicators/>
- GitHub Primer · Button / Button accessibility：<https://primer.style/components/button>
- Vercel Geist · Button：<https://vercel.com/geist/button>
- Shopify Lightning (SLDS) · Spinners / Loading：<https://v1.lightningdesignsystem.com/guidelines/loading/>
- Atlassian Design System · Spinner：<https://atlassian.design/components/spinner/examples>
- Ant Design Button 源码（`loading.delay`）：<https://unpkg.com/antd@5/es/button/button.js>
- Polaris issue #1212（`aria-busy` 加在按钮上的读屏冲突）：<https://github.com/Shopify/polaris/issues/1212>

我自己实测的是：本仓库两条路径的逐帧行为（上表），以及 `useDelayedBusy` 的四条单测
（`apps/web/src/utils/busy.test.ts`）。

## 6. 诚实清单

- **外部来源一律是调研 pass 的转述**（附原句与 URL），我没有逐条打开核对；其中 **Apple HIG 一个字都没核到**
  （developer.apple.com 与 archive.org 在该网络下都超时），所以本文**没有引用 Apple 的任何要求**。
  Material 3 的「Instant(<200ms) 不显示指示器」也标为二手（m3.material.io 是 SPA，抓不到正文）。
- **写单测时我自己的期望值错过一次**：我按"从点击那刻起算 400ms"写期望，实现是"从**它出现那刻**起算"。
  测试红了，改的是期望而不是实现（后者才是对的：用户看到的是那个转圈，不是点击时刻）。
- **置灰用的仍是 `disabled`**：只读操作的禁用被延迟 200ms，配合处理器里的防重入守卫；
  没有按 Primer/GOV.UK 的建议换成 `aria-disabled`——那会改动更多按钮的既有行为，不在这轮范围内。
- **没有播报**：结果面板的更新没有 live region，读屏用户不会被告知"预估完成了"。已知缺口。
- **没有验证读屏器**（本机 Windows，无 NVDA 实机测试）：§3 里所有读屏相关结论都来自公开文档与 issue，不是我实测的。
- **忙碌态的其它按钮没有逐个点过**：这轮把 16 处「改文字」统一改成「保留文字 + 图标换转圈」，
  但只在两个预估按钮上做了逐帧实测；其余按钮的"点一下"行为只过了类型检查与 lint。
