---
title: 信息溯源联网核查：来源权威度分级与 v3 模版
class: decision
status: accepted
---


# 信息溯源联网核查：来源权威度分级与 v3 模版

> 状态：已实现（2026-09-24）。
> 关联：trace-report-design.md（结构化溯源报告与阅读器的原始方案，本方案在其之上扩展联网核查部分）。

## 1. 问题

外部联网核查上线后，实际用起来有两个毛病：

1. **触发面太窄**：只有 `attribution.kind === "external"` 或模型临时判断「像外部归因」的条目才会被查，报告里大量可核查的事实、数字、年份没有进检索；
2. **核查结果看着有来源，实际不可信**：检索接口按相关度排序，实测结果池被 CSDN、知乎、搜狐号、文库这类自媒体与聚合站占据，早期真机验证里「爱因斯坦因相对论获诺贝尔奖」这条引的是 CSDN 博客与搜狐号。报告呈现成「有来源」，但没有任何权威出处。

## 2. 实测证据（2026-09-24，智谱 `search_std`，真实 Key）

写这份方案前后做了几组受控实测，结论都影响设计，记在这里免得日后重新踩：

| 观察 | 数据 | 对设计的影响 |
| --- | --- | --- |
| `count` 不是硬上限 | 请求 2 / 5 / 10 / 20 条，实际返回 16 / 31 / 32 / 30 条 | 不能在接口侧限制条数；客户端切片与重排是必须的 |
| 同 query 命中服务端缓存 | 同一 query 连发四次，响应 `id`/`request_id` 与字节数完全相同 | 无法用同一 query 做 A/B 对照（换引擎、换参数都会被缓存掩盖） |
| 结果池很大 | 单次检索 16–32 条，平均每条正文 2.5K–3.9K 字符，JSON 约 100–180 KB | 早期「取前 5 条」等于放弃池里 80% 的候选，权威页常常就在里面 |
| 权威页在池里但排序靠后 | 「爱因斯坦 诺贝尔物理学奖 获奖原因」的池里含集美大学 `.edu.cn` 页面，按原排序进不了前 5 | 重排才是关键，不是换引擎 |
| 召回与检索词措辞强相关 | `arxiv 1706.03762`、`… Vaswani 2017 NeurIPS proceedings` 能召回 arxiv（各 1 条）；`arxiv.org Attention Is All You Need` 召回 0 条 | 模版必须要求把论文编号 / 标准号 / 准确日期 / 机构全称写进检索词 |
| 部分结果没有链接 | 同一 query 下有 2/5 条结果的 `link` 为空字符串 | 没有链接的来源不可引用，必须丢弃 |
| 错误形态 | 错引擎 → HTTP 400 + `{"error":{"code":"1211"}}`；错密钥 → HTTP 401 + `body.error` | 非 2xx 统一处理即可；200 带 error 的兜底保留但未被观测到 |

## 3. 决策

### 3.1 触发改为声明式

`engine.ts` 原先按 `blockId === "builtin.trace.v2"` 硬编码触发，新增模版就得改引擎。现改为读 `PromptBlock.externalCheck`，模版自己声明要不要联网核查。

### 3.2 新增 `builtin.trace.v3`（联网核查版）为推荐版本

配方结构与 v2 相同（`scan → audit → finalize`，每步携带原文，沿用同一套 JSON 断言门），差别在**把检索规划挪进抽取步**：

- 抽取时就为每条产出 `verify: { needed, queries }`——这一步模型手里有全文，比事后单独跑一次「规划步」更清楚该查什么，还省掉一次模型调用；
- `audit` 步增加第 9 项：核对哪些该查的漏标了、检索词能不能定位到外部来源、有没有把作者自述标成需要查；
- `finalize` 步要求逐条保留 `verify`（采纳核对表里修正后的版本），否则服务端没得可用。

v2 保留可用，但推荐位交给 v3：v2 的条目没有 `verify`，服务端会退回让 AI 现场规划（多一次调用，检索词质量也差些）。

### 3.3 检索改为「重排」而不是「取前 N」

`collectSources`：多条检索词分别检索 → 合并候选池 → 丢弃无链接或非法链接的结果 → 按域名判权威度分档 → 档内保持检索相关度序 → 同主机最多 2 条 → 取 `maxResults` 条。

权威度分档（`sourceAuthority.ts`，启发式清单）：

| 档位 | 判定 | 例子 |
| --- | --- | --- |
| `authoritative` | 命名分档 `.gov.cn/.gov/.edu.cn/.edu/.ac.cn` 等，或主机清单（学术出版、国际组织、官方媒体、中科院系统） | `nobelprize.org`、`arxiv.org`、`nature.com`、`who.int`、`xinhuanet.com`、`cas.cn` |
| `reference` | 百科、标准与规范、官方项目文档 | `wikipedia.org`、`baike.baidu.com`、`w3.org`、`developer.mozilla.org`、`github.com` |
| `self-media` | 自媒体、问答、文库、号类平台与聚合站 | `csdn.net`、`zhihu.com`、`sohu.com`、`cloud.tencent.com`、`zhidao.baidu.com` |
| `unknown` | 判不出来的一律落这里，不假装权威 | 其余域名 |

### 3.4 判定门槛与 `weak_source`

比对提示词给出按权威度分档的判定门槛：

- `verified`：至少一条 `authoritative` 或 `reference` 来源明确支持；
- **`weak_source`（新增状态）**：检索到支持说法，但全部是 `self-media` 或 `unknown`——「网上有说法、但没有权威出处」，与 `not_found` 区分开；
- `contradicted` / `ambiguous`：须由 `authoritative`/`reference` 来源支撑；
- `not_found`：没有能对应上的可引用来源（含来源只是主题相关、并未支持该说法）。

**权威度由服务端按域名判定，不采信模型自报**：比对完成后按 URL 回查候选池，把本地判定的档位写回 `sources[].authority`；不在池里的 URL（模型臆造的）标 `unknown`。

## 4. 已知边界

### 4.1 检索接口不给链接（同日补充实测）

真机跑通后发现：**相当一部分中文查询的响应里 `link`、`media`、`icon` 全是空字符串**，只有 `title` 与
`content`。实测样本：某批中文查询 20/20 条无链接，另一批 20 条里 15 条有链接；英文查询样本 16/16 有链接。
`content_size` 与它无关（A/B 对照互相矛盾，先后出现过「带参数 0 链接 / 不带 15 链接」和「带参数 12 链接 /
不带 0 链接」），`search_pro` 同样出现过 0 链接。**结论：这是接口行为，参数层面绕不过去。**

由此产生两条硬规则：

1. **无链接结果必须保留**。早期实现按「没链接 = 不可引用」丢弃，结果候选池被清空，整条被 AI 判成
   `not_found`——把「接口没给链接」说成「网上没有出处」，是在撒谎。现在这类来源一律判 `unknown` 档、
   在报告里标「本次检索未返回链接」。
2. **`not_found` 语义收紧**：只有检索结果为空、或结果与该说法主题无关时才允许判 `not_found`；
   仅仅没有链接不算。提示词里已写明这条。

权威度判定因此退化为「有域名按域名、没域名按站点名（`media`）、两者都没有只能 `unknown`」。这也是
`verified` 在实践中占比低的原因：不是说法站不住，而是这类查询拿不到足以判权威性的元信息。

### 4.2 其它

- **权威度清单是启发式**：域名清单判错会直接改变 `verified` / `weak_source` 的门槛。清单集中在 `apps/server/src/lib/sourceAuthority.ts`，调整必须同步 `sourceAuthority.test.ts`。
- **重排救不了召回**：本方案只能「在拿到的东西里挑好的」。如果接口压根没返回权威页（实测 Transformer 论文那条的池里 30 条全是 self-media），结论就只能是 `weak_source`，这是诚实的结论，但不是「这篇论文没有权威出处」。要改善得从检索词或换引擎入手。
- **核查条数：上游标多少查多少**，只留 200 条安全阀防畸形报告（触发时显式标注未核查）。真约束在比对步——所有检索结果要塞进 AI 调用，所以那边按每批 10 条分批，因此不需要靠砍条目来控载荷。排序（外部归因 > 事实数据 > 待核实）保留，只在安全阀触发时决定谁被挡下。
- **没做引擎 A/B**：`search_pro` 声称召回更好、单价 3 倍，但同一 query 会被缓存掩盖差异，无法在本地干净对照，所以仍用 `search_std`；换引擎目前是 `traceExternal.ts` 里的一行常量。
- **计费未核对**：`search_std` ¥0.01/次 来自官方定价页原文，未与账单核对。

## 5. 影响文件

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/trace.ts` | `weak_source` 状态、`TraceSourceAuthority` 与 `sources[].authority`、`queries`/`authorityCounts`、`TraceItem.verify`、Markdown 导出带档位 |
| `packages/shared/src/prompt.ts` | `PromptBlock.externalCheck`；抽取步共用铁律 `TRACE_EXTRACT_RULES`；新增 `RECIPE_TRACE_V3` 与 `builtin.trace.v3` |
| `apps/server/src/lib/sourceAuthority.ts` | 新增：域名分档、链接归一化、候选池重排 |
| `apps/server/src/lib/traceExternal.ts` | 多检索词 `collectSources`、候选池不再提前切片、比对提示词按档位门控、权威度回填 |
| `apps/server/src/lib/engine.ts` | 触发改读 `externalCheck` |
| `apps/web/src/views/RunDetailView.vue` | 溯源节点识别改按「信息溯源」系列，新增 v3 不再漏识 |
| `apps/web/src/components/TraceReportViewer.vue` | 展示档位、完整检索词、`weak_source` 提示 |
| `apps/server/src/routes/settings.ts` | 自检接口改用 `collectSources`，返回档位统计 |
