---
title: DeepSeek 检索接入 ScribeFlow：B 站视频全链路实测
class: research
---

# DeepSeek 检索接入 ScribeFlow：B 站视频全链路实测

> 触发：用户询问 DeepSeek 新上线的 Search / Fetch API 能否接入现有「联网检索」，并要求拿一条 B 站视频走完整链路验收。
> 日期：2026-10-19。
> 环境：本机 Windows，`deepseek-flash` + MiMo ASR + DeepSeek Search API；真实密钥、真实视频、真实网页抓取，没有用桩数据。
> 本条只验证 **Search** 渠道。Fetch API 尚未接入，抓正文仍是「直连 → readability → Jina 兜底」。

---

## 0. 一句话

**Search 渠道接入可用，全链路跑通，报告里的 70 条外部来源全部带可点击链接。**
同一批 66 条检索词做受控对比，DeepSeek 返回 1,291 条结果、**1,291 条都有链接**；智谱返回 1,201 条、只有 632 条有链接（52.6%），其中 29 条查询一条链接都没有。DeepSeek 的平均延迟也更低（485 ms vs 1,250 ms）。

---

## 1. 这次跑了什么

| 项 | 值 |
| --- | --- |
| 视频 | [`BV1YXGo67EVT`](https://www.bilibili.com/video/BV1YXGo67EVT/)，《断供一周就瘫痪？欧盟报告曝光中国供应链的真正威慑力》，619 秒 |
| 链路 | `source.bili` → `process.transcribe` → `process.refine` → `process.prompt`（`builtin.trace.v3`）→ `process.output` |
| 模型 | `deepseek-flash` |
| 检索 | DeepSeek `/v1/tools/search`，`count=20`，`need_content=false` |
| 工程 | `prj_86bd4e2c-36e4-4118-b4cd-1d1691b6b406` |
| 运行 | `run_086e39fc-475f-4df7-8f67-2d65763028e9`，**成功**，881,054 ms（14 分 41 秒） |
| 产物 | `apps/server/data/outputs/run_086e39fc-475f-4df7-8f67-2d65763028e9/溯源报告.json`（65,362 字） |

> 链路刻意去掉了模板里的「速览」分支和 Obsidian 出口，改成一条溯源分支 + 一个 `process.output`。
> 原因是这次要验证检索，不想把测试笔记写进用户真实的 Obsidian 库；转写、校对、溯源、落盘四步都是真的。

节点耗时与用量：

| 节点 | 耗时 | 用量 |
| --- | --- | --- |
| `n_src` | 3,598 ms | — |
| `n_asr` | 41,572 ms | 3 次调用，231 音频秒（厂商报的，见 §6） |
| `n_refine` | 39,160 ms | 1 次调用 |
| `n_trace` | 796,705 ms | 73 次调用 |
| `n_trace_out` | 7 ms | — |

`n_trace` 的 73 次调用可以拆成：3 次配方模型调用（scan / audit / finalize）、66 次检索、4 次对照判断（33 条按每批 10 条）。
后两项的拆分是用「报告里的检索词数」与代码里的 `COMPARE_BATCH_SIZE` 核对的，运行日志没有逐条记录对照调用。

---

## 2. 全链路产出的报告

| 指标 | 实测 |
| --- | --- |
| 条目数 | 36 |
| 做过外部核查的条目 | 33 |
| 拿到来源的条目 | 28 |
| 拿到逐字引文的条目 | 16 |
| 核查结论 | verified 12 / not_found 15 / weak_source 4 / contradicted 1 / ambiguous 1 |
| 证据力度 | verbatim 14 / snippet 19 |
| 外部来源总数 | 70 |
| **带链接的来源** | **70（100%）** |
| 去重后链接 / 站点 | 64 / 51 |
| 抓到正文的来源 | 28 |
| 带逐字引文的来源 | 25 |
| 逐字引文总数 | 25 |
| 来源权威度 | authoritative 37 / reference 5 / self-media 8 / unknown 20 |
| 实际检索词 | 66 条 |

抓正文日志（运行日志里的 `抓正文 …`）：

| 指标 | 实测 |
| --- | --- |
| 抓取页数 | 80（正好撞上 `MAX_FETCH_PER_RUN` 的 80 页预算） |
| 成功 / 失败 | 72 / 8 |
| 正文来源 | readability 53 / Jina 19 |
| 抓到正文字符 | 653,786 |
| 单页耗时 | mean 5,441 ms，p50 461 ms，p95 30,000 ms，max 30,979 ms |
| 复用缓存 | 0 页 |

8 次失败里多数是机构站点：`stm.las.ac.cn` / `portal.las.ac.cn` 返回 HTTP 468、`mete.cbpt.cnki.net` 是 PDF、两个 404。
Jina 兜底把单页耗时拉到了 13–31 秒；**这是整条链路最慢的一段**，也是下一步接 DeepSeek Fetch 的直接理由。

---

## 3. 受控对比：同一批 66 条检索词

为了让「换渠道」成为唯一变量，取上面这份报告实际用过的 66 条检索词，分别打 DeepSeek 与智谱 `search_std`，参数都用 `count=20`。
两边都过一遍产品自己的 `rankSources`（`apps/server/src/lib/sourceAuthority.ts`，`maxResults=10`），所以「选出的来源」口径与真实运行一致。

| 指标 | DeepSeek | 智谱 |
| --- | --- | --- |
| 请求成功 | 65 / 66 | 66 / 66 |
| 返回结果 | 1,291 | 1,201 |
| **带有效链接** | **1,291（100%）** | **632（52.6%）** |
| **一条链接都没有的查询** | **0** | **29 / 66** |
| 重排后选出来源 | 650 | 394 |
| 其中带链接 | 650（100%） | 314（79.7%） |
| 候选池权威档位 | authoritative 154 / reference 12 / self-media 134 / unknown 991 | authoritative 15 / reference 0 / self-media 237 / unknown 949 |
| 选出来源权威档位 | authoritative 148 / reference 12 / self-media 126 / unknown 364 | authoritative 15 / reference 0 / self-media 177 / unknown 202 |
| 延迟 mean / p50 / p95 | 485 / 414 / 650 ms | 1,250 / 916 / 3,402 ms |
| 两家 URL 重合 | **1 条**（66 条查询里只有 1 条查询出现重合） | — |

说明：

- 智谱「选出来源」只有 394 条，不是 660 条上限：大量结果没有链接、没有站点名，`rankSources` 的去重键为空会被丢掉；
  另有同站点最多 2 条的限制。DeepSeek 的 650 条也是同一套去重/配额后的结果，不是没取满。
- DeepSeek 那 1 次失败是 HTTP 500（`internal_error`）；对比脚本只对 429 做了重试，而产品里的 `isRetryableSearchError`
  会把 5xx 当可重试，所以这次失败在真实产品路径上会被重试一次。这一点是脚本与产品的差异，不是接入缺陷。
- 两家 URL 几乎不重合，说明它们是**互补**的，不是同一批结果的两种排序。默认合并会让检索成本翻倍，本次没有这么做。

---

## 4. 改动

| 文件 | 改了什么 |
| --- | --- |
| `packages/shared/src/run.ts` | `SearchProvider` 增加 `deepseek`，补 `SEARCH_PROVIDER_LABELS` |
| `apps/server/src/lib/traceExternal.ts` | 新增 `deepseekSearch`（`/v1/tools/search`），请求 `query` 截到 128 字符，优先用 `summary` 做统一来源的 `snippet`；`429/408` 改为可重试 |
| `apps/server/src/lib/settings.ts` | `SEARCH_PROVIDERS` 增加 `deepseek` |
| `apps/server/src/routes/settings.ts` | 两处 `z.enum` 增加 `deepseek` |
| `apps/web/src/views/SettingsView.vue` | 设置页增加 DeepSeek 选项与说明 |
| `apps/server/src/lib/traceExternal.deepseek.test.ts` | 新增 3 条适配测试：字段映射、128 字符截断、429 重试 |

没有改运行引擎、图模型、提示词、溯源报告结构或数据库；`search.provider` 本来就是字符串设置，不需要迁移。

---

## 5. 结论

1. **接入可用，且是薄适配。** 现有 `searchWeb` 的渠道分发让新增 DeepSeek 只落在适配层、设置项与测试上，
   全链路没有出现渠道相关的异常；报告里 70/70 条来源带链接。
2. **在这份样本上，DeepSeek 的链接覆盖率、权威来源数量与延迟都明显优于智谱。**
   但样本只有一条视频、一个题材、一天，不能据此把默认渠道改掉；建议保留两家，先作为可选项跑一段时间。
3. **下一步最值得做的是 Fetch，而不是合并双引擎。** 这次 80 页抓取里 19 页走 Jina，p95 30 秒；
   DeepSeek Fetch 实测单页 126 ms（MDN，4,561 字）。把它插在「直连失败 → Jina」之间，收益比再买一份检索更大。
4. **接入 Fetch 前必须先做 Markdown 反转义。** DeepSeek Fetch 返回的是转义后的 Markdown（`init\(\)`、`\# 标题`），
   实测一句真实存在的引文在现有 `verifyQuote` 口径下判不中，反转义后通过；不处理会误杀真引文。

---

## 6. 诚实清单

- **样本只有一条视频、一个题材、一天。** 66 条检索词都来自这次 DeepSeek 生成的溯源报告；换成智谱生成报告，
  检索词会不同，链接覆盖率也可能不同。这不是一份跨题材基准。
- **没有跑智谱的全链路基线。** 受控对比只比「同一批检索词 + 同一套重排」，省掉了重跑转写/校对的成本；
  它不能回答「智谱全链路会不会产出更好的报告」，只能回答「同一批查询下两家检索质量差多少」。
- **没有独立复核 25 条引文。** 引文是引擎的 `verifyQuote` 在写入前逐字校验的；本次没有再抓一遍页面做第二套工具复核。
- **Fetch API 没有接入。** 这次抓正文仍是直连 + readability + Jina；8 次失败与 19 次 Jina 兜底都是现有管线的事实。
- **上游 `authority` 字段没有采用。** DeepSeek 会给 0–4 的权威度，但实测它把 CSDN、慕课网、华为云社区也标成 3；
  对比与产品仍用仓库自己的域名分档，避免把 self-media 抬成权威。
- **成本是算出来的，不是账单。** 66 次检索 × 5 元 / 1000 次 = **0.33 元**（官方价，按全部成功计）；
  模型 token 费用没有折算，因为设置页单价为空。这个数字没有和 DeepSeek 后台账单对过。
- **ASR 的音频秒数对不上。** 厂商回报 `audioSeconds=231`，而 WAV 实测 618.9 秒（`ffprobe`）。本次没有追查原因，
  也不影响检索验收；如果要做用量对账，这是一个需要单独查的点。
- **只测了一个 DeepSeek 渠道配置。** 没有测 `need_content=true`、`ori_question`、`lang:` / `site:` 等查询操作符；
  这些是接入后的可选增强，不是本次验收范围。
