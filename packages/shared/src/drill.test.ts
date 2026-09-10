import { describe, expect, it } from "vitest";
import {
  drillSetToMarkdown,
  gradeObjective,
  maybeDrillToMarkdown,
  normalizeClozeAnswer,
  normalizeForMatch,
  parseDrillSet,
  type DrillItem,
} from "./drill";

const SOURCE =
  "按字数切分会在论证中间截断，模型看到的上下文不完整。按语义切章则能保证每个章节自洽。命中率是检索的第一指标，覆盖率同样重要。";

function point(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "切章策略",
    type: "causal",
    gist: "按语义切优于按字数切",
    worthTesting: "是后续理解的前提",
    sourceQuote: "按语义切章则能保证每个章节自洽",
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    pointId: "p1",
    kind: "single",
    difficulty: "medium",
    stem: "为什么应该按语义切章？",
    options: ["因为按字数切会截断论证", "因为速度更快", "因为更省 token"],
    answer: ["因为按字数切会截断论证"],
    explanation: "原文指出按字数切会在论证中间截断。",
    sourceQuote: "按字数切分会在论证中间截断",
    ...overrides,
  };
}

function raw(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "测试练习",
    points: [point()],
    items: [item()],
    extensions: [{ pointId: "p1", question: "再想一步：没有章节标记怎么办？", hint: "想想上下文长度", angle: "工程约束" }],
    ...overrides,
  });
}

describe("normalizeForMatch", () => {
  it("全角转半角、去空白、去强调符、转小写", () => {
    expect(normalizeForMatch("Ａ　Ｂ *C*")).toBe("abc");
    expect(normalizeForMatch("按语义切章 则能保证")).toBe("按语义切章则能保证");
  });

  it("填空判分额外忽略标点", () => {
    expect(normalizeClozeAnswer("命中率，")).toBe("命中率");
    expect(normalizeClozeAnswer("ＣｏｖｅｒａｇＥ。")).toBe("coverage");
  });
});

describe("parseDrillSet", () => {
  it("解析合法产物", () => {
    const { set, drops } = parseDrillSet(raw(), SOURCE);
    expect(drops).toEqual([]);
    expect(set).not.toBeNull();
    expect(set!.kind).toBe("drillSet");
    expect(set!.title).toBe("测试练习");
    expect(set!.points).toHaveLength(1);
    expect(set!.items).toHaveLength(1);
    expect(set!.extensions).toHaveLength(1);
  });

  it("容忍 ```json 围栏与前后废话", () => {
    const wrapped = `好的，这是结果：\n\n\`\`\`json\n${raw()}\n\`\`\`\n希望有帮助。`;
    expect(parseDrillSet(wrapped, SOURCE).set).not.toBeNull();
  });

  it("JSON 非法时返回面向用户的错误而不是抛异常", () => {
    const result = parseDrillSet("这不是 JSON", SOURCE);
    expect(result.set).toBeNull();
    expect(result.error).toBe("练习产物不是有效 JSON");
  });

  it("缺少 points 时整体失败", () => {
    const result = parseDrillSet(raw({ points: [] }), SOURCE);
    expect(result.set).toBeNull();
    expect(result.error).toContain("知识点");
  });

  it("引文未命中原文时丢弃该题，其余题目保留", () => {
    const payload = raw({
      items: [
        item(),
        item({ id: "q2", stem: "另外一问：覆盖率和命中率哪个更重要？", sourceQuote: "这句话原文里没有出现过" }),
      ],
    });
    const { set, drops } = parseDrillSet(payload, SOURCE);
    expect(set!.items).toHaveLength(1);
    expect(drops.some((drop) => drop.reason === "引文未命中原文")).toBe(true);
  });

  it("sourceText 为空时跳过引文校验（结果页二次解析）", () => {
    const payload = raw({ items: [item({ sourceQuote: "结果页不再校验引文" })] });
    expect(parseDrillSet(payload, "").set).not.toBeNull();
  });

  it("答案不在选项内时丢弃该题", () => {
    const payload = raw({ items: [item({ answer: ["一个不在选项里的答案"] })] });
    const { set, drops } = parseDrillSet(payload, SOURCE);
    expect(set).toBeNull();
    expect(drops.some((drop) => drop.reason === "答案与选项不匹配")).toBe(true);
  });

  it("pointId 悬空时丢弃该题", () => {
    const payload = raw({ items: [item({ pointId: "p404" })] });
    const { set, drops } = parseDrillSet(payload, SOURCE);
    expect(set).toBeNull();
    expect(drops.some((drop) => drop.reason === "引用了不存在的知识点")).toBe(true);
  });

  it("题干泄漏答案时丢弃该题", () => {
    const payload = raw({
      items: [item({ stem: "请问「因为按字数切会截断论证」这个说法对吗？" })],
    });
    const { drops } = parseDrillSet(payload, SOURCE);
    expect(drops.some((drop) => drop.reason === "题干泄漏答案")).toBe(true);
  });

  it("知识点没有通过校验的题目时连同延伸问题一起丢弃", () => {
    const payload = raw({ items: [item({ kind: "unknown" })] });
    const { set, drops } = parseDrillSet(payload, SOURCE);
    expect(set).toBeNull();
    expect(drops.some((drop) => drop.reason.includes("没有通过校验的题目"))).toBe(true);
  });

  it("判断题自造选项与答案时归一为「正确/错误」", () => {
    const payload = raw({
      items: [item({ kind: "judge", options: ["对", "错"], answer: ["错"] })],
    });
    const { set } = parseDrillSet(payload, SOURCE);
    expect(set!.items[0].options).toEqual(["正确", "错误"]);
    expect(set!.items[0].answer).toEqual(["错误"]);
  });

  it("填空题不需要选项，答案原文即判分依据", () => {
    const payload = raw({
      items: [item({ kind: "cloze", options: [], answer: ["命中率"] })],
    });
    const { set } = parseDrillSet(payload, SOURCE);
    expect(set!.items[0].options).toEqual([]);
    expect(set!.items[0].answer).toEqual(["命中率"]);
  });

  it("选项重复或数量越界时丢弃该题", () => {
    const tooFew = raw({ items: [item({ options: ["A", "B"], answer: ["A"] })] });
    expect(parseDrillSet(tooFew, SOURCE).set).toBeNull();
    const duplicated = raw({
      items: [item({ options: ["因为按字数切会截断论证", "因为按字数切会截断论证", "因为更省 token"], answer: ["因为更省 token"] })],
    });
    // 去重后只剩 2 个选项，低于下限 → 丢弃
    expect(parseDrillSet(duplicated, SOURCE).set).toBeNull();
  });

  it("超出考察点数量上限时截断并记录丢弃原因", () => {
    const manyPoints = Array.from({ length: 14 }, (_, i) => point({ id: `p${i + 1}`, name: `知识点${i + 1}` }));
    const payload = raw({ points: manyPoints });
    const { drops } = parseDrillSet(payload, SOURCE);
    expect(drops.some((drop) => drop.reason.includes("超出考察点数量上限"))).toBe(true);
  });

  it("重复题干只保留第一道", () => {
    const payload = raw({ items: [item(), item({ id: "q2" })] });
    const { set, drops } = parseDrillSet(payload, SOURCE);
    expect(set!.items).toHaveLength(1);
    expect(drops.some((drop) => drop.reason === "重复题目")).toBe(true);
  });
});

describe("gradeObjective", () => {
  const base: DrillItem = {
    id: "q1",
    pointId: "p1",
    kind: "single",
    stem: "题干",
    options: ["甲选项内容", "乙选项内容", "丙选项内容"],
    answer: ["甲选项内容"],
  };

  it("单选严格判分", () => {
    expect(gradeObjective(base, ["甲选项内容"]).correct).toBe(true);
    expect(gradeObjective(base, ["乙选项内容"]).correct).toBe(false);
  });

  it("未作答判错", () => {
    expect(gradeObjective(base, []).correct).toBe(false);
  });

  it("多选少选 / 多选分别给出中文提示", () => {
    const multi: DrillItem = { ...base, kind: "multi", answer: ["甲选项内容", "乙选项内容"] };
    expect(gradeObjective(multi, ["甲选项内容", "乙选项内容"]).correct).toBe(true);
    const missing = gradeObjective(multi, ["甲选项内容"]);
    expect(missing.correct).toBe(false);
    expect(missing.note).toContain("少选");
    const extra = gradeObjective(multi, ["甲选项内容", "乙选项内容", "丙选项内容"]);
    expect(extra.correct).toBe(false);
    expect(extra.note).toContain("多选");
  });

  it("判断按归一化后比对", () => {
    const judge: DrillItem = { ...base, kind: "judge", options: ["正确", "错误"], answer: ["错误"] };
    expect(gradeObjective(judge, ["错误"]).correct).toBe(true);
    expect(gradeObjective(judge, ["正确"]).correct).toBe(false);
  });

  it("填空忽略全角、空白与标点差异", () => {
    const cloze: DrillItem = { ...base, kind: "cloze", options: [], answer: ["命中率"] };
    expect(gradeObjective(cloze, ["命中率，"]).correct).toBe(true);
    expect(gradeObjective(cloze, ["覆盖率"]).correct).toBe(false);
  });
});

describe("drillSetToMarkdown", () => {
  it("包含题目、选项、答案、解析、原文依据与延伸段", () => {
    const { set } = parseDrillSet(raw(), SOURCE);
    const markdown = drillSetToMarkdown(set!);
    expect(markdown).toContain("# 测试练习");
    expect(markdown).toContain("## 考察点");
    expect(markdown).toContain("## 练习题");
    expect(markdown).toContain("### Q1（单选）");
    expect(markdown).toContain("- 因为按字数切会截断论证");
    expect(markdown).toContain("**答案**：因为按字数切会截断论证");
    expect(markdown).toContain("**解析**");
    expect(markdown).toContain("**原文依据**");
    expect(markdown).toContain("## 再想一步");
  });
});

describe("maybeDrillToMarkdown", () => {
  it("产物 JSON 转 Markdown", () => {
    const { set } = parseDrillSet(raw(), SOURCE);
    const out = maybeDrillToMarkdown(JSON.stringify(set));
    expect(out.startsWith("# 测试练习")).toBe(true);
    expect(out).not.toContain("\"kind\":\"drillSet\"");
  });

  it("LLM 原始输出（没有 kind 标记）原样返回", () => {
    const text = raw();
    expect(maybeDrillToMarkdown(text)).toBe(text);
  });

  it("普通 Markdown 原样返回", () => {
    const markdown = "# 普通笔记\n\n正文";
    expect(maybeDrillToMarkdown(markdown)).toBe(markdown);
  });

  it("以 { 开头但不是产物的文本原样返回", () => {
    const text = '{"foo":"bar"}';
    expect(maybeDrillToMarkdown(text)).toBe(text);
    expect(maybeDrillToMarkdown("{坏 JSON")).toBe("{坏 JSON");
  });
});
