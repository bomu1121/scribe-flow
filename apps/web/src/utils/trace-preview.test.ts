import { describe, expect, it } from "vitest";
import type { TraceItem, TraceReport } from "@scribe-flow/shared";
import { summarizeTraceReports, traceStatusTone } from "./trace-preview";

/**
 * 浮层摘要的口径：总量、问题条数、先看哪几条。
 * 布局本身由真机量（`pnpm smoke:ui`），这里只钉判断。
 */

function item(claim: string, over: Partial<TraceItem> = {}): TraceItem {
  return { category: "fact", claim, confidence: "confirmed", evidence: [], ...over };
}

const report: TraceReport = {
  schema: 1,
  title: "信息溯源报告",
  summary: "本次覆盖 7 条主张。",
  items: [
    item("没有 external 的主张"),
    item("有权威来源印证的主张", {
      external: { status: "verified", sources: [{ authority: "authoritative", url: "https://example.com" }] },
    }),
    item("找不到出处的主张", { external: { status: "not_found" } }),
    item("只有自媒体来源的主张", { external: { status: "weak_source" } }),
    item("外部有反证的主张", { external: { status: "contradicted" } }),
    item("外部来源互相矛盾的主张", { external: { status: "ambiguous" } }),
    item("明确未核查的主张", { external: { status: "unchecked" } }),
  ],
};

describe("summarizeTraceReports", () => {
  it("只把真正进入核查的条目算进「已核查」，状态分布按问题优先排", () => {
    const result = summarizeTraceReports([report]);
    expect(result.total).toBe(7);
    expect(result.checked).toBe(5);
    // ambiguous 不算「需要留意」（与结果页的 FLAGGED_EXTERNAL_STATUSES 同一口径），但仍单独出现在分布里
    expect(result.flagged).toBe(3);
    expect(result.authoritative).toBe(1);
    expect(result.chips.map((chip) => [chip.status, chip.count])).toEqual([
      ["contradicted", 1],
      ["ambiguous", 1],
      ["not_found", 1],
      ["weak_source", 1],
      ["verified", 1],
      ["unchecked", 2],
    ]);
  });

  it("先看哪几条按问题严重程度排，序号仍是报告里的原始位置", () => {
    const result = summarizeTraceReports([report]);
    expect(result.priorityItems.map((entry) => entry.index)).toEqual([4, 5, 2]);
    expect(result.priorityItems.map((entry) => entry.item.claim)).toEqual([
      "外部有反证的主张",
      "外部来源互相矛盾的主张",
      "找不到出处的主张",
    ]);
    // 排序不能改到报告本身
    expect(report.items[0]!.claim).toBe("没有 external 的主张");
  });

  it("一条都没联网核查时不给「未核查 N」这一行——它没有信息量", () => {
    const plain: TraceReport = { schema: 1, items: [item("甲"), item("乙")] };
    const result = summarizeTraceReports([plain]);
    expect(result.checked).toBe(0);
    expect(result.chips).toEqual([]);
    expect(result.priorityItems).toHaveLength(2);
  });

  it("多份报告合并统计，待核实与提醒也一起算", () => {
    const second: TraceReport = {
      schema: 1,
      items: [item("另一份报告的主张", { external: { status: "not_found" } })],
      uncertainties: [{ claim: "甲", reason: "原文没说" }, { claim: "乙", reason: "原文没说" }],
      warnings: ["时间戳来自转写稿"],
    };
    const result = summarizeTraceReports([report, second]);
    expect(result.total).toBe(8);
    expect(result.flagged).toBe(4);
    expect(result.uncertainties).toBe(2);
    expect(result.warnings).toBe(1);
  });

  it("条数上限可调，默认 3 条", () => {
    expect(summarizeTraceReports([report]).priorityItems).toHaveLength(3);
    expect(summarizeTraceReports([report], 2).priorityItems).toHaveLength(2);
  });
});

describe("traceStatusTone", () => {
  it("只给真问题上暖色", () => {
    expect(traceStatusTone("contradicted")).toBe("danger");
    expect(traceStatusTone("not_found")).toBe("warning");
    expect(traceStatusTone("ambiguous")).toBe("warning");
    expect(traceStatusTone("weak_source")).toBe("info");
    expect(traceStatusTone("verified")).toBe("success");
    expect(traceStatusTone(undefined)).toBe("muted");
    expect(traceStatusTone("unchecked")).toBe("muted");
  });
});
