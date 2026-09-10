import { describe, expect, it } from "vitest";
import { buildDrill, buildDrillParams, describeDrops, dropReasons, summarizeDrill } from "./drill";

const SOURCE = "按字数切分会在论证中间截断，模型看到的上下文不完整。按语义切章则能保证每个章节自洽。";

function raw(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "示例练习",
    points: [
      {
        id: "p1",
        name: "切章策略",
        type: "causal",
        gist: "按语义切优于按字数切",
        sourceQuote: "按语义切章则能保证每个章节自洽",
      },
    ],
    items: [
      {
        id: "q1",
        pointId: "p1",
        kind: "single",
        stem: "为什么应该按语义切章？",
        options: ["因为按字数切会截断论证", "因为速度更快", "因为更省 token"],
        answer: ["因为按字数切会截断论证"],
        explanation: "原文指出按字数切会在论证中间截断。",
        sourceQuote: "按字数切分会在论证中间截断",
      },
    ],
    extensions: [{ pointId: "p1", question: "再想一步：没有章节标记怎么办？", hint: "想想上下文长度", angle: "工程约束" }],
    ...overrides,
  });
}

describe("buildDrill", () => {
  it("编译合法产物并给出可读摘要", () => {
    const built = buildDrill(raw(), SOURCE);
    expect(built.set).not.toBeNull();
    expect(built.error).toBeUndefined();
    expect(built.summary).toBe("1 个考察点 · 1 题 · 1 条延伸");
    expect(built.dropDetail).toBe("");
  });

  it("丢弃不合格条目并在摘要里报数", () => {
    const payload = JSON.stringify({
      ...JSON.parse(raw()),
      items: [
        ...JSON.parse(raw()).items,
        {
          id: "q2",
          pointId: "p1",
          kind: "single",
          stem: "另外一问：覆盖率重要吗？",
          options: ["重要", "不重要", "看场景"],
          answer: ["重要"],
          sourceQuote: "这句原文里没有",
        },
      ],
    });
    const built = buildDrill(payload, SOURCE);
    expect(built.set!.items).toHaveLength(1);
    expect(built.summary).toContain("丢弃 1");
    expect(built.summary).toContain("引文未命中原文");
    expect(built.dropDetail).toContain("第 2 题");
  });

  it("产物完全不可用时给出中文错误", () => {
    const built = buildDrill("不是 JSON", SOURCE);
    expect(built.set).toBeNull();
    expect(built.error).toBe("练习产物不是有效 JSON");
  });

  it("题目全部未通过校验时说明丢弃原因", () => {
    const payload = JSON.stringify({ ...JSON.parse(raw()), items: [] });
    const built = buildDrill(payload, SOURCE);
    expect(built.set).toBeNull();
    expect(built.error).toContain("知识点");
  });

  it("withExtensions=false 时确定性剔除延伸问题", () => {
    const built = buildDrill(raw(), SOURCE, { withExtensions: false });
    expect(built.set!.extensions).toEqual([]);
    expect(built.summary).toBe("1 个考察点 · 1 题 · 0 条延伸");
  });
});

describe("summarizeDrill", () => {
  it("最多列举两类丢弃原因并按频次排序", () => {
    const drops = [
      { where: "第 1 题", reason: "引文未命中原文" },
      { where: "第 2 题", reason: "引文未命中原文" },
      { where: "第 3 题", reason: "题干泄漏答案" },
      { where: "第 4 题", reason: "重复题目" },
    ];
    const set = { schema: 1 as const, kind: "drillSet" as const, points: [], items: [], extensions: [] };
    expect(summarizeDrill(set, drops)).toContain("丢弃 4（引文未命中原文 ×2、题干泄漏答案）");
  });

  it("dropReasons 去重计数", () => {
    expect(
      dropReasons([
        { where: "a", reason: "重复题目" },
        { where: "b", reason: "重复题目" },
      ]),
    ).toBe("重复题目 ×2");
  });

  it("describeDrops 带位置便于排查", () => {
    expect(describeDrops([{ where: "第 1 题", reason: "题干泄漏答案" }])).toBe("第 1 题：题干泄漏答案");
  });
});

describe("buildDrillParams", () => {
  it("按节点参数生成出题要求", () => {
    const params = buildDrillParams({ pointCount: 8, kinds: ["single", "multi"], difficulty: "hard", focus: "只考察结论" });
    expect(params).toContain("考察点数量：不超过 8 个");
    expect(params).toContain("题型：单选、多选");
    expect(params).toContain("难度：挑战");
    expect(params).toContain("考察侧重：只考察结论");
  });

  it("缺省值：6 个考察点 / 单选判断填空 / 适中 / 输出延伸", () => {
    const params = buildDrillParams({});
    expect(params).toContain("考察点数量：不超过 6 个");
    expect(params).toContain("题型：单选、判断、填空");
    expect(params).toContain("难度：适中");
    expect(params).toContain("输出延伸问题：是");
  });

  it("越界数量被钳制、非法题型被忽略", () => {
    expect(buildDrillParams({ pointCount: 99 })).toContain("不超过 12 个");
    expect(buildDrillParams({ pointCount: 1 })).toContain("不超过 3 个");
    expect(buildDrillParams({ kinds: ["不存在的题型"] })).toContain("题型：单选、判断、填空");
  });

  it("关闭延伸问题时明确写「否」", () => {
    expect(buildDrillParams({ withExtensions: false })).toContain("输出延伸问题：否");
  });
});
