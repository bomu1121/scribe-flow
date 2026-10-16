import { describe, expect, it } from "vitest";
import type { TraceItem } from "./trace";
import { isTraceReportProduct, parseTraceReport, parseTraceReports, traceReportToMarkdown, type TraceReport } from "./trace";

const SAMPLE: TraceReport = {
  schema: 1,
  title: "示例信息溯源",
  summary: "共提取 2 条可溯源信息。",
  items: [
    {
      id: "item-1",
      category: "fact",
      claim: "示例原文包含关键句甲。",
      confidence: "confirmed",
      basis: "原文第 1 段明确陈述，第 2 段再次出现同一表述。",
      evidence: [
        {
          quote: "示例原文关键句甲",
          locator: "00:12",
          source: { type: "text", name: "示例文稿", locator: "第 1 段" },
          note: "作者口述",
        },
      ],
      mentions: [{ quote: "示例原文关键句甲", source: { name: "示例文稿", locator: "第 2 段" } }],
    },
    {
      id: "item-2",
      category: "viewpoint",
      claim: "作者认为该方案更稳。",
      confidence: "uncertain",
      basis: "仅作者在结尾口头表态，原文没有数据支撑。",
      attribution: { kind: "self", name: "UP主" },
      external: { status: "unchecked", note: "尚未配置外部检索" },
      evidence: [],
      note: "原文未给出明确依据",
    },
  ],
  uncertainties: [{ claim: "某数据出处", reason: "原文未展开" }],
  warnings: ["时间戳来自转写稿，可能与原视频有偏差。"],
};

describe("trace report parser", () => {
  it("解析合法 JSON 并保留字段", () => {
    const report = parseTraceReport(JSON.stringify(SAMPLE));
    expect(report).not.toBeNull();
    expect(report?.items).toHaveLength(2);
    expect(report?.items[0]?.evidence[0]?.quote).toBe("示例原文关键句甲");
    expect(report?.uncertainties).toHaveLength(1);
    expect(report?.warnings).toHaveLength(1);
  });

  it("保留外部来源的正文与逐字引文（这是「不捏造」的落地形态）", () => {
    const raw = JSON.stringify({
      schema: 1,
      items: [
        {
          id: "item-1",
          category: "data",
          claim: "美国社保税合计 12.4%。",
          confidence: "confirmed",
          evidence: [{ quote: "原文引用" }],
          external: {
            status: "verified",
            evidence: "verbatim",
            queries: ["IRS social security tax 12.4%"],
            sources: [
              {
                title: "Publication 15 | IRS",
                url: "https://www.irs.gov/publications/p15",
                authority: "authoritative",
                fetched: true,
                contentChars: 12345,
                quotes: [{ text: "The rate of social security tax on taxable wages is 6.2% each for the employer and employee." }],
              },
              { title: "抓不到正文的来源", url: "https://www.medicare.gov/x", authority: "authoritative", fetched: false },
            ],
          },
        },
      ],
    });
    const source = parseTraceReport(raw)?.items[0]?.external?.sources?.[0];
    expect(parseTraceReport(raw)?.items[0]?.external?.evidence).toBe("verbatim");
    expect(source?.fetched).toBe(true);
    expect(source?.contentChars).toBe(12345);
    expect(source?.quotes?.[0]?.text).toContain("6.2% each for the employer");
    const second = parseTraceReport(raw)?.items[0]?.external?.sources?.[1];
    expect(second?.fetched).toBe(false);
    expect(second?.quotes).toBeUndefined();
  });

  it("抓失败的原因被保留（否则「为什么没抓到」查不出来）", () => {
    const raw = JSON.stringify({
      schema: 1,
      items: [
        {
          id: "item-1",
          category: "fact",
          claim: "某说法。",
          confidence: "likely",
          evidence: [{ quote: "原文引用" }],
          external: {
            status: "weak_source",
            sources: [
              { title: "抓不到", url: "https://www.nhc.gov.cn/x", fetched: false, fetchError: "HTTP 412" },
              // 无链接的来源不写 fetchError：那不算抓取失败（报告另标「本次检索未返回链接」）
              { title: "无链接来源", fetched: false },
            ],
          },
        },
      ],
    });
    const sources = parseTraceReport(raw)?.items[0]?.external?.sources;
    expect(sources?.[0]?.fetchError).toBe("HTTP 412");
    expect(sources?.[1]?.fetchError).toBeUndefined();
  });

  it("非法的 evidence 取值被丢弃，不写进模型", () => {
    const raw = JSON.stringify({
      schema: 1,
      items: [
        {
          id: "item-1",
          category: "fact",
          claim: "某说法。",
          confidence: "likely",
          external: { status: "verified", evidence: "看起来很权威" },
          evidence: [{ quote: "原文引用" }],
        },
      ],
    });
    expect(parseTraceReport(raw)?.items[0]?.external?.evidence).toBeUndefined();
  });

  it("Markdown 导出带上引文与「未能取到正文」的标注", () => {
    const raw = JSON.stringify({
      schema: 1,
      items: [
        {
          id: "item-1",
          category: "data",
          claim: "美国社保税合计 12.4%。",
          confidence: "confirmed",
          evidence: [{ quote: "原文引用" }],
          external: {
            status: "verified",
            evidence: "verbatim",
            sources: [
              {
                title: "Publication 15 | IRS",
                url: "https://www.irs.gov/publications/p15",
                authority: "authoritative",
                fetched: true,
                quotes: [{ text: "The rate of social security tax on taxable wages is 6.2% each for the employer and employee." }],
              },
              { title: "抓取失败的来源", url: "https://www.nhc.gov.cn/x", authority: "authoritative", fetched: false, fetchError: "HTTP 412" },
              { title: "本轮没去抓的来源", url: "https://www.ssa.gov/y", authority: "authoritative", fetched: false },
            ],
          },
        },
      ],
    });
    const report = parseTraceReport(raw);
    const markdown = traceReportToMarkdown(report!);
    expect(markdown).toContain("　原文：“The rate of social security tax on taxable wages is 6.2% each for the employer and employee.”");
    // 「抓了但失败」与「本轮没抓」要分开写，且都要说明「这条结论依据检索摘要」——
    // 这直接影响该不该信它（旧版把原因全写出来，新版在行内只留这一句结论性的说明）
    expect(markdown).toContain("（抓取失败，依据检索摘要）");
    expect(markdown).toContain("（本轮未抓正文，依据检索摘要）");
    // 速览里也把「有原文引证」的条数单列出来（与「有权威来源」分开报）
    expect(markdown).toContain("附来源原文引证");
  });

  it("能剥离 Markdown 围栏与多余文本", () => {
    const raw = "```json\n" + JSON.stringify(SAMPLE) + "\n```";
    expect(parseTraceReport(raw)?.items).toHaveLength(2);
  });

  it("缺字段时做宽容降级，坏条目丢弃", () => {
    const raw = JSON.stringify({
      schema: 1,
      items: [
        { category: "bad", claim: "有效", confidence: "confirmed", evidence: [] },
        { claim: "", evidence: [] },
        { category: "data", claim: "有效数据", confidence: "likely", evidence: [] },
      ],
    });
    const report = parseTraceReport(raw);
    expect(report?.items).toHaveLength(2);
    expect(report?.items[0]?.category).toBe("other");
  });

  it("解析以 --- 拼接的多份报告", () => {
    const raw = `${JSON.stringify(SAMPLE)}\n\n---\n\n${JSON.stringify({ ...SAMPLE, title: "第二份" })}`;
    const reports = parseTraceReports(raw);
    expect(reports).toHaveLength(2);
  });

  it("生成可读 Markdown 导出", () => {
    const markdown = traceReportToMarkdown(SAMPLE);
    expect(markdown).toContain("# 示例信息溯源");
    expect(markdown).toContain("原文可见");
    expect(markdown).toContain("待核实");
    expect(markdown).toContain("判断依据");
    // 引文只留原文：主来源（这里是「示例文稿」）不再逐条重复名字与段号（用户反馈）
    expect(markdown).toContain("“示例原文关键句甲”");
    expect(markdown).not.toContain("（示例文稿 · 第 1 段）");
    expect(markdown).toContain("另处提及");
    expect(markdown).toContain("内部观点");
    expect(markdown).toContain("未联网核查");
    // 按核查结论分组（问题优先）：SAMPLE 里两条分别是 viewpoint(未核查) 与 fact(未核查)
    expect(markdown).toContain("## 未联网核查（2 条）");
  });
});

describe("溯源报告的 Markdown 落盘形态（写 Obsidian 用）", () => {
  const report: TraceReport = {
    schema: 1,
    title: "信息溯源报告",
    items: [],
    uncertainties: [
      { claim: "中国失业率5.2%的统计时点、口径和来源。", reason: "原文只给数字，未说明口径。" },
      { claim: "美国自雇税中 Medicare 部分的具体税率。", reason: "原文只说「也是全额自付」。" },
    ],
    warnings: ["时间戳来自转写稿。"],
  };

  it("待核实合并成一个折叠 callout：claim 加粗成段、段间空一行（旧版一条一个橙框，10 条就是 10 个）", () => {
    const markdown = traceReportToMarkdown(report);
    expect(markdown).toContain("## 待核实（2 条）");
    expect(markdown).toContain("> [!question]- 待核实（2 条）");
    expect(markdown).toContain("> **中国失业率5.2%的统计时点、口径和来源。**");
    expect(markdown).toContain("> **美国自雇税中 Medicare 部分的具体税率。**");
    // 标题带（callout 的第一行）保持短：claim 二十多个字塞进标题会挤成一团，所以它在正文首行
    expect(markdown).not.toContain("> [!question] 中国失业率");
    // 两条 claim 之间必须空一行：Markdown 会把连续两行并成一段，claim 就会连在一起
    const claims = markdown.slice(markdown.indexOf("> **中国失业率"));
    expect(claims.slice(0, claims.indexOf("> **美国自雇税"))).toContain(">\n");
    // 不再是平铺 bullet
    expect(markdown).not.toContain("- 中国失业率5.2%的统计时点");
  });

  it("报告标题是通用值时用 fallbackTitle 兜底（否则十份笔记都叫「信息溯源报告」）", () => {
    expect(traceReportToMarkdown(report, { fallbackTitle: "《中美社保对比》 · 信息溯源" })).toContain(
      "# 《中美社保对比》 · 信息溯源",
    );
    // 报告自己写了真标题就用它的，不被兜底盖掉
    const named: TraceReport = { ...report, title: "社保说法溯源清单" };
    expect(traceReportToMarkdown(named, { fallbackTitle: "《中美社保对比》 · 信息溯源" })).toContain("# 社保说法溯源清单");
    // 没有兜底值时保持原样
    expect(traceReportToMarkdown({ ...report, title: undefined })).toContain("# 信息溯源报告");
  });
});

describe("isTraceReportProduct：一份产物算不算溯源报告", () => {
  it("产出方声明了报告就算，正文是不是 JSON 都算", () => {
    expect(isTraceReportProduct(JSON.stringify(SAMPLE), "trace-report")).toBe(true);
    // 声明了但正文不是那份 JSON（模型没按格式出）：仍按报告处理，由落盘那一步决定降级
    expect(isTraceReportProduct("这是一段散文。", "trace-report")).toBe(true);
  });

  it("没声明时按正文格式兜底——文本来源里直接粘一篇报告也算（否则整篇 JSON 会进笔记库）", () => {
    expect(isTraceReportProduct(JSON.stringify(SAMPLE))).toBe(true);
    expect(isTraceReportProduct("这是一篇普通笔记。")).toBe(false);
    /*
     * 兜底的边界（实测了四种拼法）：报告前后接一段散文都还能解析（解析器从第一个 `{` 取到最后一个 `}`），
     * 但**两份报告拼在一起就解析不了**——第一份的 `{` 到第二份的 `}` 不是一个合法 JSON。
     * 这正是它当不了主判据的原因：两份报告合成一篇时兜底落空，只能靠产出方的声明。
     */
    expect(isTraceReportProduct(`${JSON.stringify(SAMPLE)}\n\n这是一篇普通笔记。`)).toBe(true);
    expect(isTraceReportProduct(`${JSON.stringify(SAMPLE)}\n\n${JSON.stringify(SAMPLE)}`)).toBe(false);
  });
});

/**
 * B4 导出形态的契约（用户从六套候选里选定后落地）。
 *
 * 这一组钉的不是「好不好看」，而是几条**会静默失效**的规则：
 * 组的先后（问题优先）、callout 类型与状态的对应、引文要不要附出处、标签加粗的写法。
 */
describe("B4 导出形态（按核查结论分组 + 详情折叠 + 平铺行）", () => {
  /** 五种状态各一条，外加一条没有 external 的：用来验分组顺序与类型映射。 */
  const mixed: TraceReport = {
    schema: 1,
    title: "混合状态报告",
    items: ([
      ["verified", "可印证的"],
      ["weak_source", "仅非权威的"],
      ["contradicted", "有反证的"],
      ["not_found", "没找到出处的"],
      ["ambiguous", "有争议的"],
    ] as const).map(([status, label], index): TraceItem => ({
      id: `item-${index}`,
      category: "fact" as const,
      claim: `${label}主张。`,
      confidence: "confirmed" as const,
      basis: "原文第 1 段明确说到。",
      attribution: { kind: "self" as const },
      evidence: [{ quote: `${label}原文`, source: { type: "bili" as const, name: "某个视频", url: "https://example.com/v" } }],
      external: { status, summary: `${label}结论。`, sources: [] },
    })).concat([
      { id: "item-plain", category: "viewpoint" as const, claim: "没有核查的主张。", confidence: "likely" as const, evidence: [] },
    ]),
  };

  it("分组按「问题优先」排，未联网核查垫底", () => {
    const markdown = traceReportToMarkdown(mixed);
    const order = ["## 外部有反证（1 条）", "## 存在争议或不明确（1 条）", "## 未找到外部出处（1 条）", "## 仅非权威来源（1 条）", "## 外部可印证（1 条）", "## 未联网核查（1 条）"].map((title) =>
      markdown.indexOf(title),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("只给真问题上暖色：未找到出处=failure、有反证=danger、其余=info", () => {
    const markdown = traceReportToMarkdown(mixed);
    expect(markdown).toContain("> [!failure]- 联网核查 · 未找到外部出处");
    expect(markdown).toContain("> [!danger]- 联网核查 · 外部有矛盾/反证");
    expect(markdown).toContain("> [!warning]- 联网核查 · 存在争议/不明确");
    expect(markdown).toContain("> [!info]- 联网核查 · 仅非权威来源");
    expect(markdown).toContain("> [!info]- 联网核查 · 外部可印证");
  });

  it("核查块与原文依据都默认折叠；速览不折叠", () => {
    const markdown = traceReportToMarkdown(mixed);
    expect(markdown).toContain("> [!summary] 溯源速览");
    expect(markdown).not.toContain("> [!summary]-");
    expect(markdown).toContain("> [!quote]- 原文依据");
  });

  it("平铺：核查块里不用列表标记（每缩进一层就吃掉一截行宽）", () => {
    const body = traceReportToMarkdown(mixed);
    const callout = body.slice(body.indexOf("> [!info]- 联网核查 · 仅非权威来源"));
    const block = callout.slice(0, callout.indexOf("> [!quote]"));
    expect(block).not.toContain("> - ");
    expect(block).not.toContain(">   - ");
  });

  it("引文只留原文：主来源不附出处，非主来源才附", () => {
    const report: TraceReport = {
      schema: 1,
      title: "两个来源",
      items: [
        {
          id: "a",
          category: "fact",
          claim: "主要来自视频。",
          confidence: "confirmed",
          evidence: [
            { quote: "第一句", source: { type: "bili", name: "视频甲", url: "https://example.com/a" } },
            { quote: "第二句", source: { type: "bili", name: "视频甲", url: "https://example.com/a" } },
            { quote: "来自文件的一句", locator: "第 3 页", source: { type: "file", name: "报告.pdf" } },
          ],
        },
      ],
    };
    const markdown = traceReportToMarkdown(report);
    expect(markdown).toContain("> “第一句”\n");
    expect(markdown).toContain("> “第二句”\n");
    expect(markdown).not.toContain("视频甲");
    // 非主来源仍然标得出处——那时它是真信息
    expect(markdown).toContain("“来自文件的一句”——（报告.pdf · 第 3 页）");
  });

  it("字段标签的冒号在 `**` 外面（`**判断依据：**…` 会让星号字面漏进笔记）", () => {
    const markdown = traceReportToMarkdown(mixed);
    expect(markdown).toContain("**判断依据**：");
    expect(markdown).not.toContain("**判断依据：**");
    expect(markdown).not.toContain("**内部观点：**");
  });
});
