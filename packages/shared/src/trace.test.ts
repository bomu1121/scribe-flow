import { describe, expect, it } from "vitest";
import { parseTraceReport, parseTraceReports, traceReportToMarkdown, type TraceReport } from "./trace";

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
