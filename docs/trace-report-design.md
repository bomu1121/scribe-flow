# 信息溯源模块优化方案（结构化核对版 + 报告阅读器）

> 状态：已实现。
> 范围：把原来「简单的提示词指导的 Markdown 溯源」升级为「多步核对的结构化证据清单」，并在结果页提供卡片式、可定位原文高亮的溯源报告阅读器，与笔记加工在工作流中各自独立运行。

## 1. 调研结论：引用/溯源类 UI 的成熟做法

同类需求（RAG 引用、AI 搜索引用、知识库溯源）的最终实现普遍不是把来源堆成一段 Markdown，而是采用「渐进式深度」：

- **声明级引用**：每条结论/事实旁边直接出现来源徽标或引用编号，而不是文末统一列参考文献。
  - 例：ChatGPT Citations 在 claim 旁放 publisher chip；Perplexity 用数字引用锚点 + 来源面板。
- **预览胜过跳转**：引用必须能就地预览支撑片段，避免用户离开主阅读流去翻原文。
  - 例：FastGPT 知识库引用分块阅读器，点击引用打开浮窗并高亮命中片段。
- **可审计来源清单**：回答/报告级还应有完整的“本次用了哪些来源”的总览，支持在多个引用间导航。
- **信任分级**：对引用的相关性/质量做轻量标注，让用户快速判断该信源值不值得点开。
- **不要让用户只看“一句话出处”**：展示足够上下文，让用户能判断该引用是否真的支持前面的主张。

关键参考资料：
- [FastGPT 知识库引用分块阅读器](https://doc.fastgpt.cn/zh-CN/guide/chat/quoteList)
- [How to Design AI Citations & Sources UX | AI UX Playground](https://aiuxplayground.com/guides/how-to-design-ai-citations/)
- [Citations & Sources · ChatGPT AI UX Case Study](https://www.aiuxplayground.com/gallery/chatgpt-citations/)
- [Citations & Trust · Perplexity AI UX Case Study](https://www.aiuxplayground.com/gallery/perplexity-citations/)

## 2. 逻辑层：从“单次提示词”到“结构化核对配方”

新增内置提示词块 `builtin.trace.v2`（信息溯源 · 结构化核对版），与旧版 `builtin.trace` 并存，并在同系列中标记为推荐版本。

配方共 3 步，每步都携带原文，降低长文稿单次生成导致的信息遗漏与微编造：

| 步骤 | 作用 | 确定性门 |
|---|---|---|
| `scan` | 通读原文，抽取“值得溯源的信息”为 JSON 证据清单 | JSON 根键 `items`；`items[].evidence[].quote[]` 逐字回原文比对，不允许编造引用 |
| `audit` | 回原文逐条核对 claim/quote/category/confidence，输出核对表 | JSON 根键 `items` |
| `finalize` | 根据核对表生成最终结构化溯源报告 JSON | JSON 根键 `schema`/`items`；引用再次逐字回原文比对 |

引擎在配方执行时会自动向上游收集原始素材元信息（B站标题/UP主/链接、本地文件名、文本来源），注入到 `{{source}}`，让模型在证据里写“具体是哪条来源”，而不是只贴一段话。

配置 Tavily Search API Key（设置页 → 外部溯源）后，溯源 v2 还会在最终 JSON 生成后自动做外部联网核查：识别哪些条目引用了外部对象 → Tavily 检索 → AI 对照搜索结果给出 `external` 状态与参考链接。未配置 Key 时，外部归因条目会标记为“未联网核查”，不会影响内部溯源结果。

输出不是“笔记正文”，而是一份 JSON `TraceReport`：

```ts
interface TraceReport {
  schema: 1;
  title?: string;
  summary?: string;
  items: {
    id?: string;
    category: "fact" | "data" | "viewpoint" | "conclusion" | "term" | "step" | "caveat" | "other";
    claim: string;
    confidence: "confirmed" | "likely" | "uncertain";
    basis?: string; // 为什么这样归类/定级，例如“第2段明确陈述，第5段再次出现同一数据”
    attribution?: {
      kind: "self" | "external" | "unknown";
      name?: string;
      detail?: string;
    };
    external?: {
      status: "not_applicable" | "unchecked" | "verified" | "contradicted" | "not_found" | "ambiguous";
      query?: string;
      summary?: string;
      sources?: { title?: string; url?: string; snippet?: string }[];
      note?: string;
    };
    evidence: {
      quote: string;
      locator?: string;
      source?: { type?: string; name: string; author?: string; url?: string; locator?: string };
      note?: string;
    }[];
    mentions?: TraceEvidence[]; // 其他位置 / 其他来源的佐证提及
    note?: string;
  }[];
  uncertainties?: { claim: string; reason: string }[];
  warnings?: string[];
}
```

- `basis` 是每一条的核心：解释“凭什么说是事实/观点、凭什么给这个置信度”，避免只贴原文就下结论。
- `attribution` 区分“作者自己的观点”和“作者转述外部人物/机构/研究/书/新闻”。
- `external` 是外部联网核查结果：配置 Tavily 后，服务端会对 `attribution.kind === "external"` 的条目做真实检索并回填 `verified / contradicted / not_found / ambiguous / unchecked`。
- `evidence[].source` 写具体来源：视频标题 / UP主 / 链接 / P数 / 时间戳；没有来源元信息时只允许写“当前输入素材”。
- `mentions` 记录同一主张在其他段落或其他来源的再次出现，解决“只有一处引用、无法互相印证”的问题。
- `confirmed` 已不在 UI 中称为“原文直证”，而是“原文可见”：表示这句话确实出现在视频文稿里，并不代表它在外部世界为真。
- `likely` 表示依据上下文间接推断。
- `uncertain` / `uncertainties` 表示原文没讲清、容易误读或需要另行核实的点。

解析与 Markdown 导出放在 `packages/shared/src/trace.ts`，前端与测试共用，避免格式漂移。

## 3. 展示层：溯源报告阅读器

新增 `TraceReportViewer.vue`，在运行结果页中当选中节点是溯源节点且输出为结构化报告时自动切换为溯源阅读器。样式刻意保持“纸面审校”的克制感，避免彩色徽标堆叠：

- **概览**：只保留必要统计，不做彩色胶囊。
- **筛选**：普通文字筛选按钮，按类别与置信度过滤，支持关键词搜索。
- **条目**：每条主张以轻分割线的“审校条目”呈现，不再是一堆彩色卡片。
- **判断依据**：每条都显示 `basis`，说明凭什么这样归类/定级。
- **归属**：显示“内部观点”或“外部归因：某人/某机构/某研究”。
- **外部核查**：显示 `verified / contradicted / not_found / ambiguous / unchecked`，附检索结论与参考链接。
- **来源**：每条证据显示具体来源名称、作者/UP主、原始链接、定位（时间戳/P数/段落）。
- **交叉提及**：`mentions` 单独列在“其他位置 / 其他来源的提及”下，用于互相印证。
- **原文上下文**：点击“看原文上下文”，在当前工作流输入素材中定位该条引用，展示前后文并用高亮标出命中片段。
- **待核实/提醒**：集中展示模型识别出的存疑点与整体提醒。
- **可复制/下载**：复制与下载仍输出由结构化报告自动生成的 Markdown 版本，保证外部使用不丢可读性。

结果页同时把溯源节点作为独立“输出”列出：即使同一工作流里还有普通笔记输出，溯源报告也能单独查看，真正实现“笔记与溯源并行”。

## 4. 文件改动

| 文件 | 改动 |
|---|---|
| `packages/shared/src/trace.ts` | 新增 TraceReport 类型、宽松解析器、Markdown 导出 |
| `packages/shared/src/prompt.ts` | 新增 `builtin.trace.v2` 三步入配方 |
| `apps/web/src/components/TraceReportViewer.vue` | 新增溯源报告卡片式阅读器 |
| `apps/web/src/views/RunDetailView.vue` | 识别溯源节点、解析结构化报告、切换阅读器、导出 Markdown |
| `packages/shared/src/trace.test.ts` / `prompt.test.ts` / `apps/server/src/lib/engine.recipe.test.ts` | 类型、配方、引擎端到端测试 |
