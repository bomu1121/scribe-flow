import { describe, expect, it } from "vitest";
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
    expect(markdown).toContain("原文：“The rate of social security tax on taxable wages is 6.2% each for the employer and employee.”");
    // 「抓了但失败」要带原因；「本轮没抓」不能写成抓取失败（那会让人以为站点抓不动）
    expect(markdown).toContain("抓取失败（HTTP 412），本条依据检索摘要");
    expect(markdown).toContain("本轮未抓取该来源的正文");
    // 速览里也把「有原文引证」的条数单列出来（与「有权威来源」分开报）
    expect(markdown).toContain("条附有来源页面的原文引证");
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
    expect(markdown).toContain("示例文稿");
    expect(markdown).toContain("其他位置 / 其他来源的提及");
    expect(markdown).toContain("内部观点");
    expect(markdown).toContain("未联网核查");
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

  it("待核实每条一张 callout 卡片，claim 加粗在正文首行，卡片之间空一行", () => {
    const markdown = traceReportToMarkdown(report);
    expect(markdown).toContain("## 待核实问题（2）");
    expect(markdown).toContain("> [!question] 待核实 1");
    expect(markdown).toContain("> [!question] 待核实 2");
    expect(markdown).toContain("> **中国失业率5.2%的统计时点、口径和来源。**");
    // 标题带（callout 的第一行）保持短：claim 二十多个字塞进标题会挤成一团，所以它在正文首行
    expect(markdown).not.toContain("> [!question] 中国失业率");
    // 卡片之间必须空一行，否则上一条会把下一条吞进去
    const firstCard = markdown.slice(markdown.indexOf("> [!question] 待核实 1"));
    const blankLineBeforeSecond = firstCard.slice(0, firstCard.indexOf("> [!question] 待核实 2"));
    expect(blankLineBeforeSecond.endsWith("\n\n")).toBe(true);
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
