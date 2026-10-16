---
title: 每次调 API 的用量与费用能做到什么程度：服务商侧与现成项目侧的调研
class: research
---

# 从「只记 token」到「尽量接近账单」：能拿到什么、成熟项目怎么解

> 触发：用户问「如果价格是不可估计，那就至少能拿到 token？还是说具体情况都要根据具体的服务商来？
> 对于这些服务商的每次服务调用相关信息、计价面板、用量统计是否有办法尝试去做？」
> 并要求「不要凭空捏造，最好是能调研出已有项目的成熟设计」。
> 日期：2026-10-16。
> 交付物：本文件 + 六套做法的可切换原型 [`api-usage-cost-demos.html`](./api-usage-cost-demos.html)
> + 逐套截图 `api-cost-*.png`；实现见 CHANGELOG 同日条目。

---

## 1. 先回答那个问题：是的，token 一定拿得到；金额要分三种情况

调研后的准确结论是**三段式**，不是「能 / 不能」：

| 段 | 拿什么 | 谁支持 | 性质 |
| --- | --- | --- | --- |
| **① 用量**（token / 音频秒数） | 厂商在响应里报的 `usage` | **所有**我们支持的服务商 | **实测** |
| **② 金额** | 厂商在响应里直接报的钱 | 只有 OpenRouter（`usage.cost`）这类网关 | **实测**（但口径是 credits，见 §3.5） |
| **②' 金额** | token × 单价 | 其余全部 → 只能这样 | **估算** |
| **③ 对账** | 账户余额 / 账单 | DeepSeek、Moonshot、OpenRouter 有余额接口；OpenAI/Anthropic 只有带 Admin Key 的组织级账单接口 | **实测**（但粒度是账户级，不是请求级） |

所以「价格不可估计」这个前提**只对第二段成立**，而且它有一个真实的解法：
**单价不是让我们猜的，是可以查的**——既可以向用户要（他自己知道走的是哪家、什么套餐），
也可以从公开的机器可读价目表拉一份参考值填进去。§5.3 说的就是后者。

还有一段调研里才发现的：**我们上一轮的实现漏了一整类字段**。见 §2.3。

---

## 2. 我们现在拿到了什么（实测），以及漏了什么

### 2.1 现状

`packages/shared/src/usage.ts` 定义了 `ApiUsage`：`calls / promptTokens / completionTokens /
cachedTokens / audioSeconds`。token 来自厂商响应的 `usage`，音频秒数我们自己从 WAV 头量（`wavDataSeconds`），
金额在设置页填了单价后按 `estimateChatCostYuan` 估算。

### 2.2 已经做对的一条

金额不落库、用**当前**单价现算。这在成熟项目里是**少数派**做法（§4.4 会讲它们的普遍选择是快照），
但它有它的道理：单价是我们让用户自己填的，用户填错了改对了，历史记录就该跟着对。
两条路都有人走，本文 §6.2 给出取舍。

### 2.3 漏的那一类：我们只认 DeepSeek 的缓存字段名

`ai.ts` 里目前**只读** `usage.prompt_cache_hit_tokens`。逐个查证下来，这是 DeepSeek（与 SiliconFlow）的写法，
而**其它家的缓存命中在另一个位置**：

| 服务商 | 缓存命中 token 的位置 | 出处 |
| --- | --- | --- |
| DeepSeek | `prompt_cache_hit_tokens`（顶层）**同时也有** `prompt_tokens_details.cached_tokens` | [api-docs.deepseek.com](https://api-docs.deepseek.com/api/create-chat-completion) |
| OpenAI | `prompt_tokens_details.cached_tokens` | [openai-openapi `CompletionUsage`](https://github.com/openai/openai-openapi) |
| 智谱 BigModel | `prompt_tokens_details.cached_tokens`（官方原文点名这个字段） | [docs.bigmodel.cn 缓存](https://docs.bigmodel.cn/cn/guide/capabilities/cache.md) |
| Moonshot / Kimi | 顶层 `cached_tokens` **与** `prompt_tokens_details.{cached_tokens, cache_write_tokens}` | [platform.kimi.com chat](https://platform.kimi.com/docs/api/chat.md) |
| 阿里 DashScope | `prompt_tokens_details.cached_tokens`（文档写明**包含在** `prompt_tokens` 里） | [help.aliyun.com 上下文缓存](https://help.aliyun.com/zh/model-studio/context-cache) |
| 火山方舟 | `prompt_tokens_details.cached_tokens` | [docs.volcengine.com](https://docs.volcengine.com/docs/82379/1528789) |
| OpenRouter | `prompt_tokens_details.cached_tokens`，另有 `cache_write_tokens` | [openrouter.ai/docs](https://openrouter.ai/docs/use-cases/usage-accounting.md) |

**意思是：除了 DeepSeek，其它家在我们这儿缓存命中一律显示 0。** 这不是"显示不出来"，
是"显示了错的数"——正好是用户在 AGENTS.md 里点名的那个反面案例。

同时还漏了三个字段：

| 字段 | 谁用 | 为什么重要 |
| --- | --- | --- |
| `completion_tokens_details.reasoning_tokens` | OpenAI、DeepSeek、SiliconFlow | **按输出价计费**，漏了会让输出 token 少算 |
| `prompt_tokens_details.cache_write_tokens` | OpenAI、Moonshot、OpenRouter | 显式缓存的写入 token，多数家单独计价 |
| `usage.seconds`（**非** OpenAI 标准字段） | 小米 MiMo 的语音识别 | 厂商**直接报了音频秒数**，比我量 WAV 头更权威 |
| `usage.credits`（需 `include_usage: true`） | Tavily | 检索按 credit 计费，这是我们唯一能拿到的检索用量 |

还有一条重要的：**whisper 的 `/audio/transcriptions` 其实能拿到用量，是我选错了 `response_format`**。
OpenAI 官方 spec 里 `CreateTranscriptionResponseJson`（`json`）与 `CreateTranscriptionResponseVerboseJson`
（`verbose_json`）**都**带 `usage`，后者还多一个 `duration`；usage 有两种形态，
`TranscriptTextUsageDuration{type:"duration", seconds}` 与 `TranscriptTextUsageTokens{type:"tokens", input_tokens}`，
正好对应「按音频时长计费」与「按 token 计费」两类模型。
出处：[openai-openapi](https://github.com/openai/openai-openapi) 的 `CreateTranscriptionResponse*` 与 `TranscriptTextUsage*`。
我上一轮写的注释「`/audio/transcriptions` 在 `json` 下不返回 usage」**下得太满**：那是我只对着自己写的 mock
（只回 `{text}`）测出来的结论，而 spec 声明了两个格式都带 usage。**具体哪个模型实际会填这个字段，我没有逐模型验证过**，
所以现在的实现是先请求 `verbose_json`、不成功再退回 `json`，拿到哪个格式就读哪个的 usage——
不管对面填不填，都不影响转写本身。

---

## 3. 服务商侧：每一家到底能给我们什么

### 3.1 只有 token、没有金额（我们默认的 DeepSeek 就在这里）

字段清单见 §2.3 的表。要点：DeepSeek 的缓存是**成对**的顶层字段
（`prompt_cache_hit_tokens` + `prompt_cache_miss_tokens`，且 `prompt_tokens = 两者之和`），
官方计价页还写着**峰谷价**（off-peak 是 peak 的一半，时间段是 UTC 周一至周五 01:00–04:00 与 06:00–10:00）。

### 3.2 能直接给金额的：只有网关

| 服务商 | 字段 | 性质 |
| --- | --- | --- |
| OpenRouter | `usage.cost` + `cost_details.{upstream_inference_cost, upstream_inference_prompt_cost, upstream_inference_completions_cost, server_tool_cost}` + `is_byok` | 官方文档写 `cost` 是 "The total amount charged to your account"；`cost_details.upstream_inference_cost` 只在 BYOK 请求里有值 |
| LiteLLM 网关（自建） | 响应头 `x-litellm-response-cost`（USD float） | 不是服务商，是网关。存疑：该页我没直接抓取 |

**注意一个坑**：OpenRouter 文档里 `cost` 的口径是 **credits**，我没查到官方明写「1 credit = 1 USD」的原文。
所以拿到这个数也别直接当美元展示。

`usage: {include: true}` 与 `stream_options: {include_usage: true}` 在 OpenRouter 上**已废弃且无任何效果**
（官方原文："are deprecated and have no effect. Full usage details are now always included automatically"）。

### 3.3 能查余额的：三家有，两家要 Admin Key

| 服务商 | 端点 | 权限 | 实测 |
| --- | --- | --- | --- |
| DeepSeek | `GET /user/balance` | API Key | 我无 key 打了一次 → **401 `Authentication Fails (governor)`**，端点存在 |
| Moonshot | `GET /v1/users/me/balance` | API Key | 文档给了完整响应示例（`available_balance` / `voucher_balance` / `cash_balance`） |
| OpenRouter | `GET /api/v1/credits` | **management key**（普通 key 会 403） | 我无认证打 → 401 |
| OpenAI | `/v1/organization/costs`（`bucket_width` **只支持 `1d`**）、`/v1/organization/usage/*` | **Admin Key**，普通 key 不行 | 官方 spec 明确 `AdminApiKeyAuth` |
| Anthropic | `/v1/organizations/analytics/{usage_report,cost_report}`（`beta=true`） | Admin Key | 端点名取自官方 SDK 源码；官方文档页在本机区域被 307 拦掉，**没抓到正文** |
| 智谱 | 官方**明确没有** API，只能上网页看 | — | [faq/fee-issues](https://docs.bigmodel.cn/cn/faq/fee-issues) 原文只讲「财务总览页面」 |

一个值得注意的粒度问题：**余额是账户级的，不是请求级的**。它能回答「这个月花了 37 块」，
不能回答「这一次运行花了多少」。它的正确用法是**对账**：本地累计估了 36.2，余额掉了 37.1，差 2.4%
——这个对比本身就是我们估算准确度的证据。

### 3.4 检索渠道的用量

| 渠道 | 响应里有什么 | 计费单位 |
| --- | --- | --- |
| Tavily | `usage.credits`，**要传 `include_usage: true`** 才返回 | 1 credit / 次（basic），advanced 2；$0.008 / credit |
| 智谱 web_search | 独立 Web Search API 的响应**没有 usage 字段**；走 chat 的 `web_search` 工具时只有 token 用量 | `search_std` 0.01 元/次、`search_pro` 0.03 元/次等 |

我们现在只记了「发了几次请求」（`calls`），这是能拿到的最少值。Tavily 那条可以更准（读 `credits`）。

### 3.5 有没有「不给钱也能查到的价目表」

**有，而且不止一份。** 这是本次调研对「价格不可估计」最直接的回应：

| 数据源 | 规模 | 单位 | 每条有没有溯源 | 谁在用 |
| --- | --- | --- | --- | --- |
| **LiteLLM `model_prices_and_context_window.json`** | 实测下载 **2,869,149 B / 4,180 条** | **per-token**（`gpt-4o` 写 `2.5e-06`） | 有 `source` 字段指回官方定价页（2,825 条有） | aider（每 24h 拉一次）、ccusage（构建期 pin rev 嵌入）、tokencost |
| **OpenRouter `GET /api/v1/models`** | 实测 **777,937 B / 465 个模型**，**无需认证** | **per-token 的 USD 字符串**（`"0.00000015"`），要 ×1e6 才是每百万 | 无 | Roo Code（直接读它建价目）、LibreChat（见 `/models` 带 `pricing` 就建 token 配置） |
| **models.dev `api.json`** | 实测 **5,678,128 B / 230 个 provider** | 数字量级与官方 per-1M 一致（**单位是推断的**） | 有 `doc` 指回官方页 | Cline 的模型目录生成器（写死 `https://models.dev/api.json`）、ccusage 的第二数据源 |
| Helicone `@helicone-package/cost` | 按 author 分目录的 TS 源码，**不是单一 JSON**（我猜的那个路径 404） | 每百万（`prompt: 30, // USD per MILLION tokens`） | 人工逐条对着 API 文档核 | Helicone 自己 |

**但这里有一个必须说清的陷阱**：OpenRouter 的价目是**它的转售价**，不等于各家官方价。
`deepseek/deepseek-chat` 在 OpenRouter 上写 `prompt: "0.0000002574"`（$0.257/百万），
而 DeepSeek 官方当时是 $0.15/百万 off-peak / $0.3 peak。**拿 OpenRouter 的价去算官方 API 的账是错的。**

所以正确的用法不是「拿参考价目自动算账」，而是「**用参考价目把输入框填上，让用户确认**」。
这一步之后，账目仍然是用户确认过的价算的，只是他不用自己去官网抄。

### 3.6 官方计价页的可达性（决定「一键填入」能不能自动化）

| 服务商 | 页面 | 抓取情况 |
| --- | --- | --- |
| DeepSeek | api-docs.deepseek.com/quick_start/pricing | 抓到原文，但价格是**峰谷两档**，没有单一值 |
| OpenAI | openai.com/api/pricing/ | 页面 JS 渲染；`platform.openai.com/docs/pricing` 与 `developers.openai.com/api/docs/pricing` **均 403** |
| 智谱 | docs.bigmodel.cn/cn/guide/start/pricing | 抓到 `.md` 原文，单位「元/百万 Tokens」 |
| MiMo | mimo.mi.com/docs/zh-CN/price/pay-as-you-go | 抓到摘要，ASR 是 **¥0.5/小时**（按输入音频时长） |
| Moonshot | platform.kimi.com/docs/pricing/chat | 抓到摘要，有「缓存命中/未命中/输出」三列 + 缓存写入 TTL 两档 |
| 火山方舟 | docs.volcengine.com/docs/ark/model-pricing | **抓不到**（JS 渲染返回空） |

结论：**逐家爬官方页面不可行**（一半抓不到，抓到的格式还各不相同、还分峰谷/TTL 档）。
用一份维护好的聚合表做「填入参考价」是唯一务实的选择。

---

## 4. 现成项目侧：六个具体问题，它们各自怎么解

### 4.1 单价存什么单位

| 项目 | 单位 | 字段名 |
| --- | --- | --- |
| LiteLLM | **per-token** | `input_cost_per_token` / `output_cost_per_token` / `cache_read_input_token_cost` |
| Helicone | **per-token** | `cost.prompt_token` / `completion_token` |
| Langfuse | **per-token**（UI 可切 per 1K / per 1M 显示） | `prices{usageType: Decimal}` |
| **LibreChat** | **per 1M** | `tokenValues{prompt, completion}`、`cacheTokenValues{write, read}` |
| **Lobe Chat** | **per 1M** | `Pricing.units[].{name, rate, unit: 'millionTokens'}` |
| **Dify** | **per 1M** | 插件 YAML `pricing: {input, output, unit: '0.000001'}` |
| **Cline / Roo** | **per 1M** | `pricing: {input, output, cacheRead, cacheWrite}` |
| **OpenRouter `/models`** | per-token（客户端 ×1e6 变每百万） | `pricing.prompt` / `pricing.completion` |

**给面向用户的输入框，per-1M 是压倒性的选择**——因为各家官网的报价页全是「元/百万 token」，
用户是拿着那个页面来填的。我们上一轮用的 `inputPricePerMillion` 恰好就是这个口径，保留。

### 4.2 缓存 token 怎么计价

四种做法，按细到粗：

1. **每个 usageType 一条独立价**（最细）：Langfuse 的 179 个模型里出现的价键有
   `input_cached_tokens / cache_read_input_tokens / cache_creation_input_tokens /
   input_cache_creation_5m / input_cache_creation_1h / …` 二十多种。
2. **读/写两档并列**：LibreChat（`cacheRead` / `cacheWrite`）、Lobe（`textInput_cacheRead` / `textInput_cacheWrite`）。
3. **不设价、改折算 token 数**：Dify —— `CACHE_WRITE_5M_MULTIPLIER = 1.25`、`CACHE_WRITE_1H_MULTIPLIER = 2.0`、
   `CACHE_READ_MULTIPLIER = 0.1`，把 token 乘倍率后按输入价算。
4. **不处理**：Open WebUI（只透传厂商给的 cost）、n8n（完全没有 cost）。

**缺失时的回退**上，三家独立地给出同一个选择：**回退成输入价（即不打折）**。
LiteLLM：`custom_cost_per_token.get("cache_read_input_token_cost", input_cost_per_token)`；
Helicone：`else if (promptCacheReadTokens > 0) { totalCost += promptCacheReadTokens * cost.prompt_token }`；
LibreChat：`getCacheMultiplier(...) ?? inputMultiplier`。

这里有一个跨项目出现的**硬编码倍率**值得单独说：**Anthropic 的缓存写入价 = 输入价 × 1.25，读取 = × 0.10**。
它在 aider（`cache_write_tokens * input_cost_per_token * 1.25`）、Cline（`cacheWritePrice ?? inputPrice * 1.25`）、
ccusage（`CACHE_CREATE_1H_INPUT_MULTIPLIER: f64 = 2.0` + 5m 用发布值）、Dify 四处**独立地**出现。
**但它只对 Anthropic 成立**——DeepSeek 的缓存命中是 0.1×（我当前实现按输入价算，是偏高而非偏低），
智谱官方写「通常为标准价格的 50%」，DashScope 隐式缓存 20%、显式 10%。
**所以倍率不能内置**，只能让用户填。

### 4.3 模型名匹配不到价目表时怎么办

| 项目 | 行为 |
| --- | --- |
| LiteLLM | **抛异常**：`Model {model} isn't mapped yet. Add it here - <JSON 的 GitHub 链接>` |
| ccusage | 费用返回 **0**，但**另外报出"哪个模型缺价"**（`missing_pricing_model_for_token_total`），且只在 `total_tokens > 0` 时报 |
| aider | **完全不显示金额**（`if not self.main_model.info.get("input_cost_per_token"): self.usage_report = tokens_report; return`） |
| Helicone | 返回 **`null`**，调用方 `?? 0` |
| Roo Code | `|| 0` —— 与真免费模型**不可区分** |
| Cline | 取不到价就返回 **`undefined`**，不编造 |
| LibreChat | 有 `defaultRate = 6`（美元/百万）兜底 —— **唯一一家给默认价的** |

**没有任何一家「按最贵的算」**（我逐仓 grep 过这七家）。共识是：**宁可显示得少，也不显示一个编的数**。
这与我们现在「没填单价就不显示金额」的选择一致。

匹配策略上，ccusage 那套顺序最完整，值得照抄：
`exact → 用户别名 → 内置别名 → 剥日期后缀（-YYYY-MM-DD 与 -YYYYMMDD）→ 分隔符归一（. 和 @ 换成 -）→ 模糊 contains`，
并额外有 `exact_only` 白名单防止模糊匹配把带档位的模型（`claude-opus-5-fast`）算成基础模型价。
LibreChat 更简单：**最长子串匹配**（`findMatchingPattern`）。

### 4.4 改了价格，历史记录怎么办

这是分歧最大的一条，而**四家做价格的项目全部选了快照**：

| 项目 | 做法 | 证据 |
| --- | --- | --- |
| **Langfuse** | cost 在 **ingestion 时**算好写进 ClickHouse（还连"当时用了哪一档价"一起存：`usage_pricing_tier_id/name`） | 官方原话：`"Because inferred costs are calculated at ingestion time, updated defaults apply only to new generations."` |
| **LibreChat** | `transactions` 行里存 `rate`、`rateDetail{input,write,read}`、`tokenValue` | 源码 |
| **Dify** | `messages` 行存 `message_unit_price` + `message_price_unit` + `total_price` | 源码 |
| **Lobe Chat** | `messages.usage->>'cost'`，还给它建了数字表达式索引 | 源码 |

反例只有一个：**Open WebUI 根本不存钱**，只存 token，官方文档让用户自己导出后乘
（`"To estimate costs, multiply the token counts by your provider's pricing"`）。

**四个有价项目都没有「按新价重算历史」的功能**（Langfuse 唯一的历史回填是 2024 年为新增列做的一次性迁移）。

### 4.5 「厂商报的金额」与「算出来的金额」怎么区分

这是 Cline 做得最清楚，我直接抄它的判断顺序（源码注释原文）：

> `Provider-reported billed cost takes precedence over market cost so gateway discounts are reflected in user-facing totals.
> Market cost remains a fallback when no billed cost is available.`

代码里它是三档：`upstream_inference_cost`（上游实际收的）/ `market_cost`（市场价）/ `cost`（网关收的），
再按 `is_byok` 决定要不要相加。**Roo Code 是同一件事的简化版**：`cost: totalCost ?? costResult.totalCost`。

Langfuse 的界面表达是给 cost 记来源：观测详情可解析出 `"provided" | "calculated"`，
另有专门判定「有 token 但没价」的 `isGenerationMissingCost`。

### 4.6 界面上的表述

| 项目 | 表述 |
| --- | --- |
| **Open WebUI** | 官方文档标题就叫 **"Cost Estimation"**，原文 `"To estimate costs, multiply the token counts by your provider's pricing"` |
| **LibreChat** | 钱**默认不显示**（`interface.contextCost` 默认 `false`）；显示时是换算，账本用 credits（`1 credit = $1e-6`） |
| **Lobe Chat** | 表头把钱与用量分列：`spend: "Credits"` 与 `totalTokens: "Token Usage"` |
| **Dify** | 中性词：`detail.tokenCost: "Token spent"`（不叫 bill / charge） |
| **n8n** | token 侧有显式估算标记 `isEstimate`（估算与实测两条通道并存）；钱侧没有 |
| **ccusage** | 用 `--mode` 显式区分：`display`（只用 Claude 写的 `costUSD`）/ `calculate`（只用价目表算）/ `auto`（有则用、无则算），还有 `--debug` 专门列**不一致** |

ccusage 的三档是最值得看的一条，因为它存在的**根本原因**就是「厂商给的价」和「自己算的价」对不上：
官方文档明写 `display` = "Exact Claude billing data when available"、`calculate` = "Consistent methodology across all time periods"。

---

## 5. 结论：我们该照抄哪几条

### 5.1 必做（有明确先例、且直接修掉现有缺陷）

| # | 做法 | 抄谁 | 理由 |
| --- | --- | --- | --- |
| 1 | **usage 解析改成多形状归一**，缓存命中在 `prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens` / 顶层 `cached_tokens` 三处都找 | LiteLLM 的 `cost_per_token` 明确处理了「OpenAI-compatible」与「Anthropic」两种世界 | 不修则除 DeepSeek 外缓存显示 0，是**显示错的数** |
| 2 | 新增 `reasoningTokens` / `cacheWriteTokens`，**计入计费但单列显示** | Langfuse 的独立 usageType、OpenAI spec 的 `completion_tokens_details` | reasoning 按输出价计费，漏了就是少算 |
| 3 | **缓存命中输入单价**给一个选填框，留空＝按输入价 | LiteLLM / Helicone / LibreChat 三家一致的回退口径 | 缓存命中率高的批量任务，这一项对估算影响最大 |
| 4 | 金额**落库快照当时的单价** | Langfuse / LibreChat / Dify / Lobe 四家全选快照 | 「这次花了多少」是历史事实，不该被之后的设置改写 |
| 5 | **区分「厂商报的金额」与「按单价算的金额」** | Cline 的判断顺序（provider-reported 优先）+ Langfuse 的 `provided/calculated` 来源标记 | OpenRouter 用户能拿到真金额，不该和估算混在一起 |
| 6 | 语音识别**优先用厂商报的秒数**（`usage.seconds`），量 WAV 只作兜底 | 直接从官方响应取，比自算权威 | MiMo 官方就是这么报的 |
| 7 | whisper 改用 `verbose_json` 并读 `usage` | 官方 spec 的 `TranscriptTextUsageDuration` / `UsageTokens` | 我上一轮的注释是错的，这个能修 |

### 5.2 必做（用户明确要的「有办法尝试去做」）

| # | 做法 | 抄谁 |
| --- | --- | --- |
| 8 | **「从参考价目填入」按钮**：拉一份公开价目表 → 按当前模型名匹配 → 填进输入框让用户确认 | 数据源抄 **LiteLLM 的 JSON**（aider 每 24h 拉、ccusage 构建期 pin、tokencost 同源）；匹配顺序抄 **ccusage** |
| 9 | **余额对账**：一键查账户余额，与本地累计估算并排显示 | DeepSeek `/user/balance`、Moonshot `/v1/users/me/balance`、OpenRouter `/api/v1/credits` |

### 5.3 刻意不做

| 不做 | 理由 |
| --- | --- |
| 内置一份价目表自动算账 | §3.5 的陷阱：聚合表的价不等于用户实际付的价（OpenRouter 转售 vs 官方；deepseek 有峰谷；智谱/Moonshot 有缓存 TTL 档）。**参考价只能用来填，不能用来算** |
| 内置缓存倍率（1.25 / 0.1 / 0.5） | 只在 Anthropic 成立；DeepSeek 是 0.1×、智谱 50%、DashScope 20%。倍率因家而异，抄一个就是编一个 |
| 「按新价重算历史」的一键功能 | §4.4：四个有价项目都没有。它有它的用处，但会让人分不清屏幕上这个数是哪来的 |
| 用余额 API 反推每次运行的账 | §3.3：余额是账户级的，粒度对不上。它只能用来对账，不能用来分摊 |

---

## 6. 六套做法

见 [`api-usage-cost-demos.html`](./api-usage-cost-demos.html) 与逐套截图 `api-cost-{a,b,c,d,e,f}.png`。
它们要回答两个不同的问题：**设置页上「单价与对账」这一块长什么样**（A/B/C），
与**结果页上「这次花了多少」怎么表述**（D/E/F）。

**尺寸是量出来的**：真 Chrome 无头、1440×1200 视口、把每套单独摆成 560px 单列后读
`getBoundingClientRect().height`（布局 px），与 PNG 同一版式。
量的口径是**台面**（`.stage`，那个模拟的真机块）而不是整张 demo 卡——卡片高会随卡片下方的说明文字变，
台面高只随被演示的 UI 变，所以只有台面是稳定可比的那个数。

| 套 | 回答的问题 | 核心机制 | 台面高 | 相对基线 |
| --- | --- | --- | --- | --- |
| **A 现状·手填两个数** | 最小可用 | 输入/输出单价，留空即不算钱 | 134.5px | — |
| **B 手填 + 一键填参考价** | 消除「抄价」这一步 | 拉 LiteLLM 表 → 按模型名匹配 → 填进框（**不落库、不自动算**） | 345.1px | 比 A **+210.6px（+157%）** |
| **C B + 余额对账** | 估算到底准不准 | 余额接口查一次，与本地累计并排 | 319.5px | 比 B −25.6px（少了「参考价来源」那段说明） |
| **D 结果页·一行 token + 估算** | 最小可用 | 与改动前一致 | 150.6px | — |
| **E 结果页·分来源** | 「厂商报的」vs「算的」分开 | 有 `usage.cost` 时显示真金额并标来源；否则标「估算」+ 单价口径 | 314.6px | 比 D **+164.0px（+109%）**；台面里放了两张卡演示两种来源，单张约 165px |
| **F 结果页·卡片式明细** | 想看细账 | 输入/缓存/输出/音频四行 + 单价 + 小计 | 312.7px | 比 D +162.1px（+108%） |

**推荐 B + E。** 理由：B 是「价格不可估计」的正解且不牺牲诚实性（价还是用户确认的）；
E 是 Cline + Langfuse 共同采用的最小表达，把「真金额」与「估算」分开——而这两者混在一起正是
我们上一轮的问题（OpenRouter 用户本来能拿到真金额，我们却把它当估算一起算了）。

**落地时不做 demo 里那么高**：demo 为了讲清楚把口径说明常显了。实际实现把完整口径收进金额徽标的悬停
（实测那条常显要占 18.4px 页头高度），只常显**承重的那半句**——「按运行时单价 / 按当前单价」。
这一句不能藏：同一个页面上"当时的价"和"今天的价"是两种不同性质的钱，用户必须一眼分得出。

---

## 7. 诚实清单

**关于事实来源：**
- 本文所有服务商字段、端点、单位与项目源码结论，都由三个并行调研 agent 在 **2026-10-16 当天**抓取核验，
  出处 URL 已逐条写在正文里。凡是「我没抓到原始页」的都标了出来。
- **未直接验证的**：火山方舟的完整 usage 字段清单与计价页（JS 渲染抓不到）；Anthropic 官方文档正文
  （本机区域被 307 拦），其端点名取自官方 SDK 源码；OpenRouter 的 credits↔USD 官方换算原文（没查到）；
  LiteLLM 的 `x-litellm-response-cost` 响应头（来自文档站摘要，未直接抓取）。
- **单位是推断的**：models.dev 的 `api.json` 没写单位，是按其数值量级推断为「USD / 百万 token」。
- 三个调研都读的是各仓库 `main` 分支快照，**没有固定 commit SHA**；行号级事实可能随上游变动。
- 我**没有运行**任何被调研的项目实例，「快照 vs 现算」是读源码 + 官方文档得出的判断，
  不是运行验证（只有 Langfuse 有一条官方文档原句直接支持那个结论）。

**关于我上一轮的实现：**
- §2.3 与 §5.1 的第 7 条是**我自己写错的两处**：缓存字段只认了 DeepSeek 的写法、
  whisper 的 usage 注释写反了。前者会让除 DeepSeek 外的所有家显示 0，后者让我白白量了 WAV 头
  （量出来是对的，但厂商本来就报）。
- 「金额现算而不快照」上一轮是当设计讲的，调研后发现四个有价项目全选快照。这一条按 §5.1 第 4 条改掉。

**关于本次交付：**
- 参考价目与余额对账都是**网络功能**，在离线环境下会失败。失败时按「不填 / 不显示」处理，
  不编数——这与 §4.3 里七家项目的共识一致。
- 参考价目表（LiteLLM 的 JSON）是**第三方项目**维护的，不是服务商官方数据。它带 `source` 字段指回官方页，
  但仍有维护滞后。所以填进去之后界面上要写明「参考价，请自行核对」。
