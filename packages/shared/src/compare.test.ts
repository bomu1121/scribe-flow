import { describe, expect, it } from "vitest";
import { DIFF_MAX_LINES, compareTexts, diffLines, measureText, summarizeDiff } from "./compare";

describe("measureText", () => {
  it("空文本不含 NaN：全部记 0", () => {
    expect(measureText("")).toEqual({
      chars: 0,
      lines: 0,
      paragraphs: 0,
      headings: 0,
      listItems: 0,
      tableRows: 0,
      quotes: 0,
      codeBlocks: 0,
    });
    expect(measureText("   \n\n  ")).toMatchObject({ chars: 0, lines: 0, paragraphs: 0 });
  });

  it("字数去掉所有空白（中文按字符、英文按字符，不做分词）", () => {
    expect(measureText("a b\tc\n中文 两字").chars).toBe(3 + 4);
    expect(measureText("中文 两字").chars).toBe(4);
  });

  it("逐项识别结构标记：标题 / 列表 / 表格 / 引用 / 代码围栏", () => {
    const text = [
      "# 标题一",
      "## 标题二",
      "",
      "正文一段。",
      "同一段的第二行。",
      "",
      "- 列表项 1",
      "* 列表项 2",
      "1. 列表项 3",
      "",
      "> 引用一句",
      "> 引用第二行",
      "",
      "| 表头 | 说明 |",
      "|---|---|",
      "| 值 | 备注 |",
      "",
      "```ts",
      "const a = 1;",
      "```",
    ].join("\n");
    const metrics = measureText(text);
    expect(metrics.headings).toBe(2);
    expect(metrics.listItems).toBe(3);
    expect(metrics.quotes).toBe(2);
    expect(metrics.tableRows).toBe(3);
    expect(metrics.codeBlocks).toBe(1);
    // 段落 = 连续非空行的块：两行标题挨着算一段，所以是
    // 标题(1)、正文(2)、列表(3)、引用(4)、表格(5)、代码(6) 共 6 段。
    expect(metrics.paragraphs).toBe(6);
    expect(metrics.lines).toBe(20);
  });
});

describe("diffLines", () => {
  it("完全相同的文本没有差异行", () => {
    expect(diffLines("同一段\n第二行", "同一段\n第二行")).toEqual([]);
  });

  it("只出现在一侧的行分别记为 del / add，顺序是先删后增", () => {
    expect(diffLines("A\nB", "A\nC")).toEqual([
      { type: "del", text: "B" },
      { type: "add", text: "C" },
    ]);
    expect(diffLines("A", "A\nB")).toEqual([{ type: "add", text: "B" }]);
  });

  it("超过行数上限时返回 null，而不是给出半截结论", () => {
    const many = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => `第 ${i} 行`).join("\n");
    expect(diffLines(many, "短文本")).toBeNull();
    expect(diffLines("短文本", many)).toBeNull();
  });
});

describe("summarizeDiff / compareTexts", () => {
  it("相同文本：增删都为 0、重合率 100%", () => {
    const left = "# 标题\n正文\n- 列表";
    const report = compareTexts(left, left);
    expect(report.stats).toEqual({ unchanged: 3, removed: 0, added: 0, similarity: 1 });
    expect(report.left).toEqual(report.right);
  });

  it("两侧内容完全不重叠：重合率 0", () => {
    const report = compareTexts("甲\n乙", "丙\n丁");
    expect(report.stats).toMatchObject({ unchanged: 0, removed: 2, added: 2, similarity: 0 });
  });

  it("重合率按公共行 × 2 ÷ 总行数：一半相同 = 50%", () => {
    const report = compareTexts("A\nB", "A\nC");
    expect(report.stats).toMatchObject({ unchanged: 1, removed: 1, added: 1 });
    expect(report.stats?.similarity).toBeCloseTo(0.5, 10);
  });

  it("两侧都空时记 100%（没有差异），不是 0/0", () => {
    const report = compareTexts("", "");
    expect(report.stats?.similarity).toBe(1);
    expect(summarizeDiff("", "", []).similarity).toBe(1);
  });

  it("超长内容只给指标、不给逐行统计（stats 为 null）", () => {
    const many = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => `行 ${i}`).join("\n");
    const report = compareTexts(many, "短");
    expect(report.stats).toBeNull();
    expect(report.left.lines).toBe(DIFF_MAX_LINES + 1);
    expect(report.right.lines).toBe(1);
  });
});
