---
title: 溯源模块「联网查找资料」怎么做：成熟项目核实、本机实测与分步方案
class: research
---

# 溯源模块「联网查找资料」怎么做

> 触发：反馈「观点笔记和溯源基本就是两篇 Ob 笔记关联的事情……但首要的是把这个溯源功能本身做好」，
> 并要求**不要凭空捏造**、**调研已有项目的成熟系统设计**，特别提出「简单调用模型可能找不到最新的资料」。
> 日期：2026-10-15。
> 交付物：本文件 + 原始实测数据 [`trace-source-finding-measured.json`](./trace-source-finding-measured.json)
> + 可复跑实验脚本 [`trace-source-finding-experiments/`](./trace-source-finding-experiments/)（四个 `run*.mjs`）。

---

## 0. 结论先行

1. **你担心的方向对，但瓶颈标错了位置。** 找不到最新资料，不是模型「不会搜」，而是本仓现在**根本不抓网页正文**——
   `traceExternal.ts` 只用检索接口返回的 `title/url/snippet(≤500 字)`，从不 fetch 页面。snippet 是搜索引擎自己截的，
   它既可能断章取义、也可能是转述文章的片段。所以现在的「外部核查」能给「疑似有来源」，给不出
   「这句话出自哪个页面的哪一段」。**这是溯源模块当前最大的功能缺口。**

2. **成熟系统（Cherry Studio / LangChain `open_deep_research` / GPT-Researcher / STORM）在四件事上高度一致**，
   这四条是它们几十年工程踩出来的，不是风格偏好：
   - **「检索」与「抓正文」是两个独立能力，各有自己的 provider 与降级链**（Cherry 的注册表把
     `searchKeywords` 与 `fetchUrls` 分开；STORM 支持十种检索器）；
   - **进模型之前先做 URL 去重 + 按来源质量重排**，不是把检索结果直接灌进去；
   - **「引用」是结构化对象（被引原文片段 + URL + 定位），不是正文里写 `[1]`**——Anthropic 官方 SDK 类型可直接核实；
   - **每一条链路都有硬预算**（检索轮数、单次条数、token 上限），预算写死，不靠模型自觉。

3. **「不捏造」在工程上只有一种可靠保证：引用片段必须能在「实际抓到的正文」里逐字命中。**
   本仓已经有这条原语（配方断言 `citationsInOriginal`），但它现在只用在「引用视频转写稿」上；
   外部来源一侧完全没有逐字校验。**补上这一条，比换任何模型都更值得做。**

4. **中文源的现实（本机实测，12 条样本）**：技术博客/云厂商社区/知乎专栏文章可抓；
   **知乎问题页（403）、百度百科（403）抓不到**；**微信公众号能下到 HTML，但通用算法抽不出正文**
   （3.5 MB HTML → 25/40/45 字，改用 `#js_content` 选择器才有 717/1037/781 字）；
   微信与百度百科**连第三方抽取服务也过不去**。境内可用的免费正文抽取兜底是 **`r.jinaai.cn`（无需 key）**，
   它甚至抓到了本机 403 的知乎问题页（8755 字）。

5. **别指望 UP 主在简介里列好来源。** 实测：全站热门 Top50 只有 **10%**、科技区 Top50 只有 **16%** 的简介
   含「来源/参考/文献/据…报道」类字样，含外链的各只有 **2 条 / 0 条**。所以溯源必须走
   「从转写稿抽主张 → 外部检索」这条路。（例外见 §3.4：新闻汇编类视频简介里逐条列了来源媒体与日期。）

---

## 1. 本仓现状：溯源已经做到哪、差在哪

现状不是从零开始。已有的部分（改之前必须知道，避免重复造）：

| 层 | 已具备 | 位置 |
| --- | --- | --- |
| 数据契约 | `TraceReport / TraceItem / TraceEvidence{quote,locator,source} / TraceExternalCheck / TraceSourceAuthority`，宽松解析器与 Markdown 导出 | `packages/shared/src/trace.ts` |
| 提示词与配方 | `builtin.trace.v3` 抽取步同时产出 `verify{needed,queries}`；铁律 `TRACE_EXTRACT_RULES`（禁止编造引用、attribution 不许伪装）+ `TRACE_VERIFY_RULES`（要求把论文编号/标准号/年月日写进检索词） | `packages/shared/src/prompt.ts` |
| 机械门 | 配方断言 `citationsInOriginal { field, maxMiss, minCount }`：引用必须逐字命中原文，否则**同一步带失败原因重问一次**，仍不过则节点失败 | `packages/shared/src/recipe.ts` |
| 检索 | 智谱 `web_search`(search_std) 与 Tavily 两家；多检索词合并候选池 → 按域名权威度分档重排 → 同主机最多 2 条 | `apps/server/src/lib/traceExternal.ts`、`sourceAuthority.ts` |
| 触发 | `PromptBlock.externalCheck` 声明式触发，没密钥就跳过并记日志 | `apps/server/src/lib/engine.ts` |
| 阅读器 | 逐条展示核查状态、检索词、来源徽章与 snippet、过滤框 | `apps/web/src/components/TraceReportViewer.vue` |
| 已有的「引用真伪校验」先例 | 练一练的 `externalRef{title,url}` 必须命中本次检索结果，编造的剥掉并记日志 | `apps/server/src/lib/drill.ts` |

缺口（这是本文件要解决的）：

1. **没有正文**：`TraceExternalSource` 只有 `title/url/snippet/publisher/authority`，没有 `quote`，也没有正文。
   比对提示词只能拿 snippet 判断，因此**无法逐字校验**，前端也只能展示 snippet。
2. **没有时间维度**：检索不带时间窗，也不用视频的 `pubdate`（数据其实已经在库里）。
3. **一轮到底**：一条 claim 一次检索，没有「拆子问题 → 合并 → 补检索」的多轮；
   本仓 AI 客户端（`apps/server/src/lib/ai.ts`）只有 `system+user` 两条消息、**没有 `tools`/function calling**。
4. **不抓网页**：全仓没有任何对搜索结果页面的 fetch。

> 顺带一处文档偏差：`docs/architecture.md` 与 `docs/usage.md` 仍写「外部溯源是 v2 且配置 Tavily 密钥时才启用」，
> 与现码（`externalCheck` 声明式、v2/v3 都支持、默认渠道智谱）不符。

---

## 2. 外部方案核实（逐个打开源码/类型定义核对，非二手转述）

### 2.1 Cherry Studio —— 你提到的那一个，52.6k★，**AGPL-3.0**

许可证先说清楚：**AGPL-3.0，按本仓红线（只复用 MIT/Apache-2.0）只能学设计，不能抄代码**。
它的联网搜索是本文件最重要的参照，因为它是**面向国内网络环境**做的，踩的坑和你要踩的相同。

**① 两层能力拆开，各自有注册表与降级链**（`src/main/services/webSearch/providers/registry.ts`）

```
searchKeywords 与 fetchUrls 是两个独立 capability，各自挑选 provider：
  zhipu / tavily / searxng / exa / exa-mcp / bocha / querit / serply / parallel / duckduckgo   ← 只做检索
  fetch(自建) / jina / firecrawl / crawl4ai / querit                                          ← 能做抓正文
降级链（shared/data/presets/webSearchProviders.ts）：
  searchKeywords 失败 → exa-mcp
  fetchUrls    失败 → fetch（自建 HTTP + readability）→ jina
```

**② 自建抓正文的实际做法**（`readableContent/ReadableContentService.ts`、`utils/fetchContent.ts`）
= `jsdom` + `@mozilla/readability` + `turndown` + `turndown-plugin-gfm`，跑在 worker 线程，
`PQueue` 并发 3、单次解析超时 10 s；浏览器 UA；抓到空内容时回退到检索接口给的 snippet
（`getFallbackResult`）——**「正文优先、snippet 兜底」，而不是二选一**。

**③ 结果压缩**（`postProcessing.ts`）：`DEFAULT_WEB_SEARCH_CUTOFF_LIMIT = 2000` tokens，
按结果条数均分（`cutoffLimit / results.length`），用 `tokenx.sliceByTokens` 截断。**这就是「正文塞进上下文」的预算控制**。

**④ 黑名单**（`utils/blacklist.ts`）：用户可配域名/URL 模式（`<all_urls>`、`*://*.domain/*`、`/正则/`），
命中即从结果里剔除。

**⑤ 站点适配的例子**：SearXNG provider 先读 `/config` 拿「启用的 general 引擎」再检索，
检索完**逐条抓正文**，抓不到才回退 snippet；DuckDuckGo provider 是抓 `html.duckduckgo.com/html/`
再用 cheerio 解析（**无需 key，但会遇见 challenge 页**——代码里专门用「解析到 0 条」来判拦截）。

**⑥ 给你我最有参考价值的一条**：Jina provider 里写着
「Jina serves a China-accessible mirror for users whose global endpoints are blocked」，
`r.jina.ai` → `r.jinaai.cn`、`s.jina.ai` → `s.jinaai.cn`，并按地区自动切换；
且**`r.jina.ai` 的 Reader 不需要 key（限速），搜索 `s.jina.ai` 需要 key**。
这条我在 §3.4 做了实测。

### 2.2 LangChain `open_deep_research`（MIT，12.7k★）

这是研究型检索最完整的开源实现，有几个数值值得直接抄作业：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `max_researcher_iterations` | 6 | 主管 agent 反思并追加子研究的次数上限 |
| `max_react_tool_calls` | 10 | 单个研究 agent 的工具调用上限 |
| `max_concurrent_research_units` | 5 | 并行子研究数 |
| `max_content_length` | 50000 | **网页正文进模型前先截断到 5 万字符** |
| `max_structured_output_retries` | 3 | 结构化输出重试 |
| `max_results` | 5 | 每个 query 取 5 条（配合**多 query 并行**） |

**关键机制（这才是它「引用可信」的原因）**，都可在 `src/open_deep_research/utils.py` 与 `state.py` 核实：

1. Tavily 调用带 `include_raw_content=True`、`topic`（general/news/finance）——**要正文，不要靠 snippet**；
2. **按 URL 去重**（同一条结果被多个 query 命中只处理一次）；
3. 每条来源用**便宜模型单独摘要**，但结构化 schema 强制返回两个字段：
   `Summary { summary: str, key_excerpts: str }`——**`key_excerpts` 就是「逐字摘出的原文片段」**；
4. 提示词里反复强调「verbatim / 不许改写 / 不许丢来源」（`prompts.py`：*"don't rewrite it, don't summarize it, don't paraphrase it"*）；
5. 最终报告的引用规则：每个唯一 URL 一个编号、**编号连续无缺口**、末尾统一 Sources 列表；
   并明确「优先一手来源」——官方站点/厂商页面优先于聚合站，**论文原文优先于综述**，人物优先个人主页。

### 2.3 GPT-Researcher（Apache-2.0，30.1k★）

分层是「技能（Skills）+ 动作（Actions）+ Provider」。对你有两点直接价值：

- **来源排序是一个独立环节**（`gpt_researcher/skills/curator.py`，`SourceCurator`）——与本仓 `sourceAuthority.ts`
  的思路一致，区别是它交模型排、本仓按域名清单机械排。本仓「权威度不采信模型自报」的做法更硬，不要改回去。
- **检索器里有四个免密钥的学术源**：`arXiv`、`Semantic Scholar`、`PubMed Central`、`OpenAlex`（均无需 API key）。
  溯源里「论文/研究指出」这类主张，可以零成本拿到一手出处。它同样内置了 **BoCha（博查）** 检索器，
  说明中文搜索在英文项目里也已被接纳。

### 2.4 STORM（MIT，31.6k★，Stanford OVAL）

四模块：知识策展 → 大纲 → 成文 → 润色；两阶段（pre-writing 先检索+出大纲，writing 带引用成文）。
方法论上只有一条对你重要：

**多视角提问（perspective-guided question asking）+ 模拟对话**——不是「一条 query 打天下」，
而是先假定几个视角（当事人/专家/批评者/统计口径），每个视角问一串问题去检索，再把结果汇总。
本仓 v3 现在是「每条 claim 1-2 条 query」，这正是它下一步可以借的东西。

### 2.5 「引用」的工业标准形态：Anthropic Citations（从官方 TS SDK 类型核实）

官方文档站点在当前网络环境不可达，所以我去核了官方 SDK 的类型定义
（`anthropics/anthropic-sdk-typescript`，`src/resources/messages/messages.ts`），一手证据：

```ts
interface CitationCharLocation { cited_text; document_index; document_title;
                                 start_char_index; end_char_index; type: 'char_location' }
interface CitationPageLocation { ... type: 'page_location' }          // PDF 用页码
interface CitationContentBlockLocation { ... }                        // 按内容块
interface CitationsWebSearchResultLocation { cited_text; title; url;  // ← 联网检索结果专用
                                             encrypted_index; type: 'web_search_result_location' }
```

要点与限制：

- **引用是结构化对象，`cited_text` 是被引的原文**，由此能渲染出「这句话来自这个页面的这一段」，
  而不是从正文里解析 `[1]`（官方文案的说法是摆脱「靠复杂提示词要求引用、结果不一致」）；
- **`document`/检索结果被当作「数据而非指令」**，作为对提示词注入的部分防线；
- **与严格结构化输出不兼容**（引用要求文本与引用块交错，和 strict JSON schema 冲突）——
  这一条对本仓很关键：**溯源报告本身就是 JSON**，所以「引用结构化」不能靠模型原生能力，
  只能靠「让模型在 JSON 字段里填被引片段 + 服务端机械校验」这条路。这与本仓现有做法一致，方向是对的。

### 2.6 引用质量必须被测量（ALCE），以及它的诚实边界

ALCE（Gao et al.）是第一个可复现的「带引用生成」评测基准，定义了两个指标：
**citation recall**（每句陈述是否被其引用来源支持，用 NLI entailment 判定）
与 **citation precision**（每条引用是否相关且必要，惩罚冗余/无关引用）；
未被引用支持的句子在协议下直接判 0 分。

**它的边界必须一起说**：有研究指出 NLI 自动判定与人类判断的相关性偏低（信息寻求类场景约 0.35，
而 attributed QA 场景要高得多），且会**依赖字面相似度**，可能把不支持的陈述归到字面相近的文档上。
**这个约 0.35 是二手来源（论文摘要与综述页面），我没有核到原文**，写在这里只作方向性提醒。
结论方向不变：**自动校验能拦住「引文对不上」，拦不住「引对了但结论错」。**

模型级幻觉检测（作为参考，本仓当前用不上）：LettuceDetect（MIT，615★，ModernBERT）、MiniCheck（Apache-2.0，229★）。
两者都是 Python/PyTorch 生态，Node 侧要用只能走 ONNX 或 API，**不建议现在引入**。
关于 LettuceDetect 的指标，这里刻意只写我一手核到的官方 README 口径，**因为我在检索摘要里先看到了一个
「79.22% F1」——它与 README 现在的数字根本不是同一个量**（一个是例级 F1、一个是 span-F1），
属于本仓踩过的「同一个量出现两个值」的同类陷阱：
README 当前给出的是 **span-F1**，统一 v2 测试集（10,698 例）Qwen-2B **0.689** / mmBERT-base **0.642**；
**RAGTruth 切片**上 Qwen-2B **0.574** / mmBERT-base **0.528**，且 README 明确警告两者不可混用。
**口径不同的数字不比大小**——这也是本文件里所有数字都注明来源与条件的原因。

### 2.7 各项目许可证（照本仓红线核对）

| 项目 | 许可证 | 能否复用代码 |
| --- | --- | --- |
| Cherry Studio | **AGPL-3.0** | **否**，只能学设计 |
| langchain-ai/open_deep_research | MIT | 可以 |
| assafelovic/gpt-researcher | Apache-2.0 | 可以 |
| stanford-oval/storm | MIT | 可以 |
| KRLabsOrg/LettuceDetect | MIT | 可以（但是 Python） |
| Liyan06/MiniCheck | Apache-2.0 | 可以（但是 Python） |

拟引入的 Node 依赖也已核实：`jsdom`(MIT)、`@mozilla/readability`(**Apache-2.0**)、`turndown`(MIT)、
`turndown-plugin-gfm`(MIT)、`tokenx`(MIT)——**全部在红线内**。

---

## 3. 本机实测（2026-10-15，原始输出见 measured.json）

方法：本机 Git Bash 直接发真实请求；抓正文用与 Cherry 同款的
`fetch → jsdom → @mozilla/readability → turndown` 链路（脚本见实验目录）。**没有用任何 API Key**。

> **怎么复跑**：`cd docs/research/trace-source-finding-experiments && npm install && node run.mjs`
> （`run2/3/4.mjs` 同理）。依赖版本已钉在目录内的 `package.json`。
> 注意 `run3.mjs` 会打 B 站公开接口取实时榜单，**今天的比例数字明天可能不同**——这正是它的用途：
> 「简介自带来源」这条结论应当可被重新测量，而不是被当成常量。

### 3.1 正文抽取链的成败分布（12 条样本）

| 样本 | HTTP | 抽出正文字数 | 备注 |
| --- | --- | --- | --- |
| 知乎**问题**页 | **403** | 35 | 未登录被拒 |
| 知乎**专栏**文章 | 200 | **16323** | ✔ |
| 百度百科 | **403** | 0 | 页面标题是「百度安全验证」 |
| 中文维基 | — | 0 | 21 s 超时失败（见 §3.5） |
| **B 站视频页** | 200 | 1042 | ✔ 且正文里就是简介（含来源清单） |
| 腾讯云社区 | 200 | 20000 | ✔ |
| 阿里云开发者社区 | 200 | 9007 | ✔ |
| 华为云社区 | 200 | 7048 | ✔ |
| **微信公众号** | 200 | **45** | ✘ HTML 有 3.5 MB，算法失效（见 §3.2） |
| arXiv abs | 200 | 2429 | ✔ |
| GitHub 仓库页 | 200 | 21584 | ✔（首次 20 s 超时，复跑成功） |
| 英文维基 | — | 0 | 21 s 超时失败 |

汇总：**中文/国内样本 9 条，抓到正文（≥500 字）5 条**。

### 3.2 微信公众号：能下 HTML，但通用算法抽不出正文（3 样本一致）

| 文章 | HTML 体积 | readability 抽出 | `#js_content` 抽出 |
| --- | --- | --- | --- |
| 律协论坛 | 3.50 MB | 45 字 | **717 字** |
| 律协通知 | 3.54 MB | 40 字 | **1037 字** |
| braincog 安装 | 3.50 MB | 25 字 | **781 字** |

两条结论：**① 必须为微信加站点选择器**（正文在 `#js_content`）；
**② 页面体积 3.5 MB 而正文不足 1 KB**——所以「按 token 预算截断」不是优化项，是必需品。

### 3.3 百度百科：恒定 403，换请求头无效

补上 `Referer: https://www.baidu.com/` 与完整 `Accept` 后**仍是 403 + 「百度安全验证」**（两次结果字节数完全相同，2529 B）。
**这是风控而非 UA 问题**，抓取路线基本可以放弃，只能依赖检索接口返回的摘要。

### 3.4 Jina Reader：全球站不可达，**国内镜像可用且能绕过部分风控**

| 目标 | `r.jina.ai`（全球） | `r.jinaai.cn`（国内镜像） |
| --- | --- | --- |
| 知乎问题页（本机 403） | fetch failed | **200，8755 字，标题「RAG是什么？ - 知乎」** |
| 百度百科（本机 403） | fetch failed | 200，0 字（「百度安全验证」） |
| 微信文章（算法失效） | fetch failed | 200，86 字（「环境异常，完成验证后即可继续访问」） |
| B 站视频页 | fetch failed | 200，17635 字 |
| 腾讯云（对照，本机也能抓） | fetch failed | 200，17574 字 |

**同一条请求，全球站 5/5 失败（每次约 10.5 s 全部超时），国内镜像 5/5 返回 200。**
即：境内可用的**免费、无 key** 正文抽取兜底是 `r.jinaai.cn`——它救回了本机抓不到的知乎；
但**微信与百度百科的风控它也过不去**。
另：`s.jinaai.cn`（搜索）**需要 key**，未带 key 实测返回 `401 AuthenticationRequiredError`。

### 3.5 「不可达」与「超时」必须分开（这是我本次差点写错的结论）

第一次跑完，我把 `github.com` 记为不可达——**错了**，那是 20 s 超时。分开复核后的真实情况：

| 目标 | 结果 |
| --- | --- |
| zh.wikipedia.org / en.wikipedia.org | **21 s 超时失败**（多次）→ 更像被阻断 |
| `r.jina.ai` | 21 s 超时失败 → 阻断 |
| google.com | 21 s 超时失败 |
| bing.com | 302 正常 |
| raw.githubusercontent.com | 首次失败、复跑 **1.78 s 成功** → 抖动，非阻断 |
| api.github.com | 一直正常 |

**结论：本机（无代理）环境下，Google/维基/境外 Jina 稳定超时，GitHub 慢但可达。**
凡是要依赖境外服务的环节，都必须有境内替代或降级，否则用户机器上会直接失败。

### 3.6 B 站：元信息能拿到什么、拿不到什么（决定溯源的信息底座）

实测公开接口（无需登录）：

| 数据 | 接口 | 实测结果 |
| --- | --- | --- |
| 标题/简介/分区 `tname`/UP/发布日/时长/分P | `x/web-interface/view` | ✔ 全部返回 |
| **标签** | `x/tag/archive/tags?bvid=` | ✔ **无需登录**，返回真实标签（如 `科普,美国,人文,知识`） |
| **字幕列表** | `x/player/v2?bvid=&cid=` | ⚠️ 返回 `code 0` 但 `subtitles: []`（未登录）——**是否登录后可见，未验证** |
| 视频页正文（含简介来源清单） | 直接抓 HTML | ✔ 200，抽出 1042 字 |

**「简介自带来源线索」的量化结果**（正则同时统计外链、`BV` 号引用、`来源/参考/文献/据…报道` 字样）：

| 榜单 | 样本 | 含外链 | 含来源类字样 | 至少一种 | 简介为空 |
| --- | --- | --- | --- | --- | --- |
| 全站热门 Top50 | 50 | 2 条（4%） | 2 条（4%） | 5 条（**10%**） | 11 条 |
| 科技区排行 Top50 | 50 | 0 条 | 7 条（14%） | 8 条（**16%**） | 12 条 |

**这个数字与直觉相反，而且它否决了一条看起来省事的设计**：不能「先从简介里抠来源，抠不到才检索」。
简介普遍是宣传语/更新说明，不是参考文献表。

**但有一个高价值例外**：新闻汇编类视频的简介会**逐条列出「事件 — 媒体 — 日期」**。实测案例
`BV1nyJ66PEPQ`（泽连斯基相关）的视频页简介就是：

> 本视频提及事件以及信息来源如下：《俄称若乌大选可在选举日停火…》来自：钱江晚报，2026-10-12 19:33发布；
> 《泽连斯基与多个欧洲国家领导人通话》来自：新华网…

这类视频**几乎不需要检索**，直接把简介里的来源与转写稿里的对应段落对齐即可。
「识别并优先使用这类自带来源的视频」应当是一条独立策略（详见 §4 步 4）。

---

## 4. 落地实测（2026-10-15 当天做的第一次实现）

本文件的建议随后落地了第 1、2 步（外部来源带逐字引文 + 服务端机械门；抓正文能力），
用指定案例验证——真实视频《中美社保对比，有哪些不同？》（BV1DTWw6UE1y）的校对稿，
真实模型，真实抓网页。智谱余额补足后又跑了**真实检索**那一轮，下表是那一轮的数字
（早一轮因额度耗尽用的是返回真实 URL 的本地桩，只验了抓取与引文两段）。

| 指标 | 真实检索那一轮 |
| --- | --- |
| 待核查条目 | 15 条 |
| 结论分布 | `verified` 10 · `weak_source` 3 · `not_found` 2 |
| 证据力度 | `verbatim`（有原文引证）**10** · `snippet`（无原文引证）5 |
| **检索召回** | 候选池 598 条里有 **46 条权威档 + 2 条参考档**；15 条主张里只有 2 条的池子里一条权威/参考都没有 |
| 来源与抓取 | 引用来源 36 条，**抓到正文 26 条（72%）**；未抓到的三类：本轮没去抓 7 · 无链接 2 · 真失败 1（`HTTP 412`） |
| 逐字引文 | **22 处**，来自中国政府网站（含县级人社局/政府网）、IRS、congress.gov、investor.gov、usa.gov、国家统计局发布页 |
| 耗时 | 208 秒（检索是真调用；抓正文 30 页/上限 80） |
| **引文独立复核** | **22/22 逐字命中**——重新发请求、重新抓取、重新校验，不复用管线自己的正文 |

**抓取上限是受控调过的**：把「每条主张最多抓 2 条来源」改成 3 条（其余配置不动），
引用来源 40→36、抓到正文 19→**26**、逐字引文 17→**22**、有原文引证的条目 9→**10**，
耗时没变长。改的依据是算术而不是感觉：模型平均每条主张引用 **2.7 条**来源，
抓 2 条等于按构造就让约四分之一的引用拿不到原文引证。

**抓正文的真实命中率**（这一轮同时也量了，因为它决定覆盖范围）：

| 站点 | 结果 |
| --- | --- |
| `gov.cn`（《社会保险法》全文） | ✔ 10550 字，readability |
| `irs.gov`（Publication 15 / Topic 554 / 罚金页） | ✔ 2945–60000 字 |
| `tsp.gov` | ✔ 3311 字 |
| `medicare.gov` | 直连 **403**，经 `r.jinaai.cn` 兜底救回 |
| `stats.gov.cn` / `mohrss.gov.cn` / 全国人大首页 | ✘ 抽不出正文（栏目页/SPA 外壳） |
| `ssa.gov` | ✘ 直连超时（本机对该域不可达） |

## 5. 建议的做法（第 1、2 步已落地；第 3–5 步待做）

原则来自 §2 的共性设计，落到本仓的具体形态。**没有一步是「换更强的模型」。**
状态：步 1、步 2 已实现并真机验证（见 §4）；步 3（时间锚）、步 4（多轮多视角）、步 5（两篇笔记互链）未做。

### 步 1（根上的事）：让外部来源也带「逐字引文」，并上机械门

现在 `TraceExternalSource` 只有 `title/url/snippet`。改成：

```
TraceExternalSource {
  title / url / publisher / authority      // 保持
  fetched?: boolean                        // 是否真的抓到了正文
  quotes?: { text: string; note?: string }[]   // 逐字摘自该页面正文的片段
}
```

然后复用本仓已有的断言原语与判定纪律，加一条服务端校验（与 `drill.ts` 的 `verifyExternalRefs` 同款思路）：

> **模型返回的每一条 `quotes[].text`，必须能在该 URL 实际抓到的正文里逐字命中；命不中的直接丢弃并记日志。
> 没抓到正文的 URL 只能标 `fetched: false`，其 quotes 一律不接受。**

这一步把「不捏造」从提示词约束升级为机械约束——**这是唯一能真正挡住编造引文的做法**，
也是 §2.2 里 `key_excerpts` 与 §2.5 里 `cited_text` 的同一个思想。
注意 §2.5 的教训：模型原生结构化引用与严格 JSON 不兼容，所以只能走「字段里填 + 服务端校验」这条路。

### 步 2（缺口最大的一步）：加「抓正文」能力，正文优先、snippet 兜底

新增一个与检索并列的步骤（不是新节点类型，先做成 `traceExternal.ts` 内部的取内容环节）：

1. 自建抓取：`fetch`（浏览器 UA）→ `jsdom` + `@mozilla/readability` + `turndown`；并发 3、单条超时 10 s——
   这些数值直接照搬 Cherry 的实测配置，**许可已验证全在红线内**；
2. **站点选择器表**：命中已知站点时优先用选择器（微信 `#js_content` 是实测过的那条），失败再退回通用算法；
3. 兜底：`r.jinaai.cn`（无需 key）——**实测它救回了本机 403 的知乎**；
4. **SSRF 必须复用 `apps/server/src/lib/url-guard.ts`**：现在的 `isBlockedFetchTarget` 只用在短链解析上；
   一旦开始抓检索结果里的任意 URL，它必须成为入口检查。Cherry 在这点上的做法是先做远程 URL 安全解析，
   **再**交给第三方（Jina）——对第三方尤其不能放私网目标过去；
5. 体积/token 预算：参考 Cherry 的 `2000 tokens` 均分与 open_deep_research 的 `5 万字符`截断，
   给每条来源一个上限，**超出部分不截断到正文中间就扔**——因为要逐字校验，截断位置会影响命中，
   做法是「先校验、后按预算裁剪展示/入模的部分」。

### 步 3：用视频发布日期做时间锚（本仓独有的、成本最低的一条）

库里已有 `pubdate`（B 站）与 `发布日期` 字段（Obsidian frontmatter）。它可以做两件事：

- **检索侧**：检索接口若支持时间窗就带上（Tavily 官方 SDK 有 `days` / `time_range` / `topic=news`，
  参数名已核实）；不支持时间窗时，把「不晚于 YYYY-MM-DD」写进 query 文本；
- **判定侧**：**视频不可能引用它发布之后的资料**。所以「来源发布日期晚于视频发布日期」是一个强信号——
  要么这是后续同一事件的追踪报道（可接受），要么这条来源解释的不是视频里那个语境（应降级）。
  这条约束能把「同一话题、不同年份」的误匹配挑出来，而这类误匹配正是当前 `weak_source` 的主要来源。

> 说明：**步 3 是我基于本仓已有数据的推论，不是从某个开源项目抄来的**。我核实过的项目都没有这一步
> （它们的研究对象是「今天的事实」，而你的对象是「某天的视频」）。

### 步 4：多轮与多视角（可后置，但要注意形态）

把「一条 claim 一次检索」升级为：

```
claim → 拆成可核查子问题（多视角）→ 每个子问题 1-2 条 query → 结果按 URL 去重
      → 抓正文 → 逐条判定 → 仍不确定的补一轮
```

两个关键约束：

- **本仓没有 function calling**，所以这必须是**引擎侧固定编排**（像现有配方那样），
  不是让模型自己决定调什么。这反而是优点：可复现、可计费估算、可断言；
- **硬预算**照抄 §2.2 的数值量级：子问题数、每步 query 数、抓正文条数、总调用数都写死上限。
  **中文源的现实**（§3.5）也决定了必须有预算：能抓到的页面少、每个页面又大，
  没有上限的话一次溯源会烧掉一大笔。

### 步 5：与「观点笔记」的关联（你提的那件事）

这件事比想象中便宜：`apps/server/src/lib/related-notes.ts` 已经在做「按 frontmatter 字段比对，
在文末追加 `## 相关笔记 [[链接]]`」。要让溯源笔记与观点笔记互链，最省的做法是
**把「原始链接」或一个新的「溯源」字段当作锚点**，让两篇笔记按同一锚点互相出现在对方的「相关笔记」里，
而不是新造一套关联存储。等步 1-2 落地（溯源笔记里有了真实 URL）再动这一步，顺序别反。

---

## 6. 诚实清单

**这次落地（§4）之后新增的、必须一起说的**

- **引文门的「丢弃」路径只在真实数据上触发过一次**：一轮里 2 条各丢了 1 处未命中的引文并如实标注；
  另一轮 22 处全部通过。所以它的行为是「通过校验的都是真的」（22/22 独立复核），
  而「该丢的都会丢」主要靠单元测试覆盖（编造引文、改写引文、超短引文、多段其一不中等）。
- **逐字命中只保证「这句话在页面上」，不保证「这句话支持那个主张」**——§2.6 的边界在这里同样成立。
  实测里多次出现模型把「主题相关但未支持」的来源判成 `not_found` 并写明理由，
  那是提示词在起作用，不是机械门在起作用。
- **抓正文仍有三类抓不到**（真实检索那一轮 36 条引用里）：本轮没去抓 7 条（超出每条的抓取上限）、
  检索接口没给链接 2 条、真失败 1 条（`nhc.gov.cn` HTTP 412，**连 Jina 镜像也没过**）。
  **中文官方站这一块明显弱于英文站**：IRS / congress.gov / usa.gov 能抓，
  而 `stats.gov.cn`、`mohrss.gov.cn`、全国人大首页抽不出正文（栏目页/框架/SPA），`ssa.gov` 本机不可达。
  这是本方案当前最大的天花板，比模型能力更限制溯源质量。
- **引文校验的范围是抓取上限之内**（单页 60k 字符）。超出部分既不给模型看、也不参与校验，
  所以「引文确实在正文里」这个结论的边界是「在抓到的前 60k 字符里」。
- **耗时**：15 条 208 秒（真实检索 + 30 次抓取）。抓取预算 80 页、每条主张最多 3 条，
  是按「不让一次溯源跑成压测」定的，不是实测出的最优值。
- **本轮没有动**：时间锚（用视频 `pubdate` 限制检索时间窗）、多轮多视角检索、
  溯源笔记与观点笔记的互链，都还是 §5 里的建议，未实现。

**没验证的**

- **B 站字幕是否登录后可见，未验证。** 未登录实测 `x/player/v2` 返回 `subtitles: []`（code 0），
  但这**既可能是「该视频没字幕」也可能是「未登录不可见」**，我无法区分。
  这直接影响一件大事：**有字幕就能做时间轴级溯源（"第 12 分 30 秒提到的那个数字来自哪"）**。
  建议你在登录态下用一条确定有字幕的视频验一次，再决定要不要做时间轴。
- **BoCha / Exa / SearXNG / Firecrawl 都没实测**（无 key / 未部署）。它们的参数是读官方 SDK 与
  Cherry 源码核实的，属于「文档/源码证据」而非「本机实测」。特别地，Bocha 的 `freshness` 参数
  我是从二手资料看到的，**Cherry 的 Bocha provider 实际并不发送该参数**，所以它是否可用**存疑**。
- **Jina 免费额度与限速未测**：我只连发了 10 个请求，没触到限速，**不代表高频可用**。
- **微信/百度百科的失败是在「无 cookie、无登录」条件下测的**：带登录 cookie 是否可抓，未验证。
- **没有评测集**：我没有测「靠 snippet 判定」与「靠正文判定」的准确率差多少。
  这需要一批人工标注的 claim→来源对，本仓目前没有，所以本文件里**没有任何关于「准确率提升 X%」的数字**。
- **中文源可抓性只有 9 条样本，且是当天结果**。反爬策略会变，结论有保质期。
  尤其 `r.jinaai.cn` 是第三方免费服务，**随时可能变策略或收费**，只能当兜底，不能当主路径。

**属于推算/估算的**

- 「抽正文约 4–12 s/条」是单条时延（实测），**不是吞吐**；并发下的总耗时未测。
- 各检索接口的**费用**完全没核对（本仓已有决策文档记着 `search_std` ¥0.01/次 来自官方定价页、未与账单核对，
  这一条延续，我也没有新增核对）。

**已知会限制结论成立条件的**

- 木桶效应：**检索不到就无从溯源**。本仓已有实测记录
  （`docs/decisions/trace-external-authority.md`）：同一条 Transformer 论文的检索池 30 条全是自媒体。
  本文件的方案**不能修复召回**，只能在「拿到的东西里挑好的、并诚实地标出不确定」。
- 自动校验的边界（§2.6）：NLI 类自动指标与人类判断相关性约 0.35。
  本方案靠「逐字命中」能拦住编造引文，**拦不住「引文是真的但结论是错的」**。
- 微信与百度百科抓不到，这两块内容在溯源报告里只能停留在 snippet 级别，
  报告里应当**显式标明「本条来源未能取得正文」**，而不是假装和处理过的一样。
