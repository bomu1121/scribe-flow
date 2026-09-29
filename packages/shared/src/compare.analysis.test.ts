import { describe, expect, it } from "vitest";
import {
  COMPARE_MAX_CHARS,
  clampCompareText,
  compareAnalysisToMarkdown,
  parseCompareAnalysis,
  type CompareAnalysis,
} from "./compare";

const VALID = {
  summary: "左边偏数据与表格，右边偏观点串讲",
  onlyLeft: [{ point: "附了 182 个国家和地区的数据表", detail: "182 个国家和地区" }],
  onlyRight: [{ point: "把结论收成三条行动建议" }],
  conflicts: [{ topic: "结论强度", left: "已明确失效", right: "仍需观察" }],
  shared: ["都讲了报告的核心判断"],
  fit: { left: ["需要引用原始数据时"], right: ["只想快速理解结论时"] },
};

describe("parseCompareAnalysis", () => {
  it("解析裸 JSON", () => {
    const analysis = parseCompareAnalysis(JSON.stringify(VALID));
    expect(analysis.summary).toBe(VALID.summary);
    expect(analysis.onlyLeft).toHaveLength(1);
    expect(analysis.fit.right).toEqual(["只想快速理解结论时"]);
  });

  it("容忍 ```json 围栏与开场白：取第一个 { 到最后一个 }", () => {
    const raw = `好的，以下是判读结果：\n\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``;
    expect(parseCompareAnalysis(raw).summary).toBe(VALID.summary);
  });

  it("数组字段缺失时补空数组，不因为模型少写字段就整条失败", () => {
    const analysis = parseCompareAnalysis(JSON.stringify({ summary: "两份几乎一致", sameNote: "只差标题" }));
    expect(analysis.onlyLeft).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
    expect(analysis.fit).toEqual({ left: [], right: [] });
    expect(analysis.sameNote).toBe("只差标题");
  });

  it("没有 JSON / 不是合法 JSON / 缺 summary 都要报错，且错误文案说清原因", () => {
    expect(() => parseCompareAnalysis("这两份差不多")).toThrow(/没找到 JSON/);
    expect(() => parseCompareAnalysis('{"summary": ,}')).toThrow(/不是合法 JSON/);
    expect(() => parseCompareAnalysis('{"onlyLeft": []}')).toThrow(/字段不完整/);
  });
});

describe("compareAnalysisToMarkdown", () => {
  const analysis = parseCompareAnalysis(JSON.stringify(VALID));

  it("把结论写成可复制的 Markdown，两边的标签出现在小标题里", () => {
    const markdown = compareAnalysisToMarkdown(analysis, { left: "AI 加工 A", right: "AI 加工 B" });
    expect(markdown).toContain("# 对照分析：AI 加工 A vs AI 加工 B");
    expect(markdown).toContain("只在「AI 加工 A」里讲到的");
    expect(markdown).toContain("附了 182 个国家和地区的数据表（182 个国家和地区）");
    expect(markdown).toContain("**结论强度**：AI 加工 A 说「已明确失效」；AI 加工 B 说「仍需观察」");
    expect(markdown).toContain("> 以上为 AI 对两份内容的差异判读，可能有误");
  });

  it("空数组的区块不出现（不写「无」占位）", () => {
    const minimal: CompareAnalysis = { summary: "一致", onlyLeft: [], onlyRight: [], conflicts: [], shared: [], fit: { left: [], right: [] } };
    const markdown = compareAnalysisToMarkdown(minimal, { left: "A", right: "B" });
    expect(markdown).not.toContain("## 只在");
    expect(markdown).not.toContain("## 两边不一致");
  });
});

describe("clampCompareText", () => {
  it("不超限时原样返回", () => {
    expect(clampCompareText("短文本")).toEqual({ text: "短文本", truncated: false });
  });

  it("超限时保留头尾并插省略标记，标记里写明省了多少字", () => {
    const text = "甲".repeat(COMPARE_MAX_CHARS + 500);
    const clamped = clampCompareText(text);
    expect(clamped.truncated).toBe(true);
    expect(clamped.text).toContain("【…此处省略约 500 字…】");
    // 去掉标记（连同它两侧的空行）后，剩下的正文正好是上限：头 60% + 尾 40%，不丢也不多。
    expect(clamped.text.replace(/\n*【…此处省略约 \d+ 字…】\n*/, "").length).toBe(COMPARE_MAX_CHARS);
  });

  it("可以自定义上限（测试与将来调参用）", () => {
    expect(clampCompareText("abcdefghij", 8).truncated).toBe(true);
    expect(clampCompareText("abcdefghij", 10).truncated).toBe(false);
  });
});
