import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_BLOCKS, type RecipeStep } from "@scribe-flow/shared";
import { assertStepOutput, collectFieldStrings, parseJsonLoose, readSearchQueries, renderStepSystem } from "./recipe";

describe("renderStepSystem", () => {
  const ctx = { input: "原文全文", prev: "上一步产物", all: "全部产物" };

  it("展开 {{input}} / {{prev}} / {{all}}", () => {
    expect(renderStepSystem("输入：{{input}}\n上一步：{{prev}}\n全部：{{all}}", ctx)).toBe(
      "输入：原文全文\n上一步：上一步产物\n全部：全部产物",
    );
  });

  it("未知 {{...}} 原样保留（不误伤老提示词）", () => {
    expect(renderStepSystem("保持 {{unknown}} 不变", ctx)).toBe("保持 {{unknown}} 不变");
  });

  it("空文本替换为空串", () => {
    expect(renderStepSystem("a{{prev}}b", { ...ctx, prev: "" })).toBe("ab");
  });

  it("展开 {{source}}", () => {
    expect(renderStepSystem("来源：{{source}}", { ...ctx, source: "《示例视频》· UP：示例" })).toBe(
      "来源：《示例视频》· UP：示例",
    );
  });

  it("展开 {{params}}（节点参数指令，与原文分离）", () => {
    const params = "【出题要求】\n考察点数量：不超过 6 个";
    expect(renderStepSystem("{{params}}\n\n原文：{{input}}", { ...ctx, params })).toBe(
      `【出题要求】\n考察点数量：不超过 6 个\n\n原文：原文全文`,
    );
  });

  it("未提供 params 时 {{params}} 替换为空串", () => {
    expect(renderStepSystem("A{{params}}B", ctx)).toBe("AB");
  });

  it("展开 {{sources}}（联网参考资料，与原文分开注入）", () => {
    const sources = "【联网检索到的同类参考资料】\n检索词：闭包\n1. 闭包常见考点 —— https://example.com/a";
    expect(renderStepSystem("{{sources}}\n\n原文：{{input}}", { ...ctx, sources })).toBe(
      `${sources}\n\n原文：原文全文`,
    );
  });

  it("未提供 sources 时 {{sources}} 替换为空串（没声明检索的步骤不受影响）", () => {
    expect(renderStepSystem("A{{sources}}B", ctx)).toBe("AB");
  });
});

describe("readSearchQueries", () => {
  const points = JSON.stringify({
    points: [
      { id: "p1", name: "闭包", queries: ["闭包 常见考点", "闭包 内存泄漏"] },
      { id: "p2", name: "作用域链", queries: ["作用域链 面试题"] },
      // 模型漏写检索词的知识点不该让整步失败
      { id: "p3", name: "提升" },
    ],
  });

  it("按路径收集检索词，保持产物顺序", () => {
    expect(readSearchQueries(points, "points[].queries[]")).toEqual([
      "闭包 常见考点",
      "闭包 内存泄漏",
      "作用域链 面试题",
    ]);
  });

  it("去重（按空白与大小写归一），并丢掉空串", () => {
    const raw = JSON.stringify({ points: [{ queries: ["闭包 考点", "闭包考点", "  ", "CLOSE OVER", "close over"] }] });
    expect(readSearchQueries(raw, "points[].queries[]")).toEqual(["闭包 考点", "CLOSE OVER"]);
  });

  it("路径取不到东西、上一步不是 JSON、上一步为空 → 返回空数组（按不联网继续）", () => {
    expect(readSearchQueries(points, "points[].missing[]")).toEqual([]);
    expect(readSearchQueries("这不是 JSON，是多步配方第一步的自由文本", "points[].queries[]")).toEqual([]);
    expect(readSearchQueries("", "points[].queries[]")).toEqual([]);
  });

  it("带围栏的 JSON 也能取到（沿用宽松解析）", () => {
    expect(readSearchQueries("```json\n" + points + "\n```", "points[].queries[]")).toHaveLength(3);
  });
});

describe("parseJsonLoose", () => {
  it("裸 JSON 直接解析", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("剥离 Markdown 围栏", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("首尾大括号截取（模型前后夹带说明文字）", () => {
    expect(parseJsonLoose('好的：{"a":{"b":2}} 完毕')).toEqual({ a: { b: 2 } });
  });

  it("完全非法时抛中文错误", () => {
    expect(() => parseJsonLoose("这不是 JSON")).toThrow(/不是合法 JSON/);
  });
});

describe("collectFieldStrings", () => {
  it("按 blocks[].quotes[] 收集嵌套数组字符串", () => {
    const data = { blocks: [{ quotes: ["甲"] }, { quotes: ["乙", "丙"] }] };
    expect(collectFieldStrings(data, "blocks[].quotes[]")).toEqual(["甲", "乙", "丙"]);
  });

  it("不存在的路径返回空数组", () => {
    expect(collectFieldStrings({ items: [] }, "items[].quote")).toEqual([]);
  });
});

describe("assertStepOutput", () => {
  const step = (expects: RecipeStep["expects"]): RecipeStep => ({ id: "s", label: "示例", system: "x", expects });
  const ctx = { input: "原文里有这一句关键表述。", prev: "", all: "" };

  it("contains / notContains / lengthGte 通过", () => {
    const s = step({
      kind: "text",
      asserts: [
        { op: "contains", value: "关键表述" },
        { op: "notContains", value: "```" },
        { op: "lengthGte", value: 5 },
      ],
    });
    expect(() => assertStepOutput(s, "这句包含关键表述。", ctx)).not.toThrow();
  });

  it("contains 失败抛带步骤标签的错误", () => {
    const s = step({ kind: "text", asserts: [{ op: "contains", value: "缺失标题" }] });
    expect(() => assertStepOutput(s, "正文", ctx)).toThrow(/步骤「示例」断言未通过/);
  });

  it("jsonRootKeys 校验根键", () => {
    const s = step({ kind: "json", asserts: [{ op: "jsonRootKeys", value: ["items"] }] });
    expect(() => assertStepOutput(s, '{"items":[]}', ctx)).not.toThrow();
    expect(() => assertStepOutput(s, '{"blocks":[]}', ctx)).toThrow(/缺少根键：items/);
  });

  it("citationsInOriginal minCount：字段被整段改写时不再是静默通过", () => {
    // 实测故障形态：多步配方里 points 被改写成 {id,name,summary}，引文字段整段消失。
    // maxMiss 只数「没命中的」，0 条引用时它无话可说——这正是加 minCount 的原因。
    const s = step({ kind: "json", asserts: [{ op: "citationsInOriginal", field: "points[].sourceQuote", maxMiss: 2, minCount: 1 }] });
    const mangled = JSON.stringify({ points: [{ id: "p1", name: "切章粒度", summary: "按论证单元来定" }] });
    expect(() => assertStepOutput(s, mangled, ctx)).toThrow(/只找到 0 条引用，少于要求的 1 条/);

    // 有引文且命中原文时通过
    const ok = JSON.stringify({ points: [{ id: "p1", sourceQuote: "原文里有这一句关键表述" }] });
    expect(() => assertStepOutput(s, ok, ctx)).not.toThrow();

    // 省略 minCount 时行为不变（0 条引用仍通过，老配方不受影响）
    const loose = step({ kind: "json", asserts: [{ op: "citationsInOriginal", field: "points[].sourceQuote", maxMiss: 2 }] });
    expect(() => assertStepOutput(loose, mangled, ctx)).not.toThrow();
  });

  it("citationsInOriginal：末尾带 [] 的字符串字段收集不到引文（这次事故的根因，已修）", () => {
    // 记录这个坑本身：`sourceQuote[]` 里的 [] 表示「该字段是数组」，打在字符串上会一条都收不到。
    expect(collectFieldStrings({ points: [{ sourceQuote: "甲" }] }, "points[].sourceQuote[]")).toEqual([]);
    expect(collectFieldStrings({ points: [{ sourceQuote: "甲" }] }, "points[].sourceQuote")).toEqual(["甲"]);
  });

  it("citationsInOriginal：逐字引用可过、改写引用判失败", () => {
    const s = step({
      kind: "json",
      asserts: [{ op: "citationsInOriginal", field: "items[].quote", maxMiss: 0 }],
    });
    expect(() => assertStepOutput(s, '{"items":[{"quote":"关键表述"}]}', ctx)).not.toThrow();
    expect(() => assertStepOutput(s, '{"items":[{"quote":"完全不同的编造内容"}]}', ctx)).toThrow(/未在原文找到/);
  });

  it("citationsInOriginal 宽容规则：短引用与省略号结尾不判失败", () => {
    const s = step({
      kind: "json",
      asserts: [{ op: "citationsInOriginal", field: "items[].quote", maxMiss: 0 }],
    });
    expect(() => assertStepOutput(s, '{"items":[{"quote":"短"},{"quote":"被截断…"}]}', ctx)).not.toThrow();
  });

  it("citationsInOriginal 宽容规则：仅开头虚词被改写的截断引用不判失败（实测回归）", () => {
    const realCtx = {
      input: "但这绝不代表AI不会严重冲击经济和就业，因为它不需要消灭大部分工作岗位，照样可以改变人们的工作方式，重塑整个劳动市场。",
      prev: "",
      all: "",
    };
    const s = step({
      kind: "json",
      asserts: [{ op: "citationsInOriginal", field: "items[].quote", maxMiss: 0 }],
    });
    expect(() =>
      assertStepOutput(s, '{"items":[{"quote":"但它不需要消灭大部分工作岗位，照样可以改变人们的工作方式，重塑整个劳动市场。"}]}', realCtx),
    ).not.toThrow();
  });

  it("citationsInOriginal：开头虚词之外的改写仍判失败", () => {
    const realCtx = {
      input: "因为它不需要消灭大部分工作岗位，照样可以改变人们的工作方式，重塑整个劳动市场。",
      prev: "",
      all: "",
    };
    const s = step({
      kind: "json",
      asserts: [{ op: "citationsInOriginal", field: "items[].quote", maxMiss: 0 }],
    });
    expect(() =>
      assertStepOutput(s, '{"items":[{"quote":"但它不需要消灭所有工作岗位，照样可以改变人们的工作方式，重塑整个劳动市场。"}]}', realCtx),
    ).toThrow(/未在原文找到/);
  });

  it("citationsInOriginal 宽容规则：引号写法归一（原文直引号 vs 引用弯引号）", () => {
    const quoteCtx = { input: '作者把这一段叫做"生产力陷阱"，并解释了三层防线。', prev: "", all: "" };
    const s = step({
      kind: "json",
      asserts: [{ op: "citationsInOriginal", field: "items[].quote", maxMiss: 0 }],
    });
    expect(() => assertStepOutput(s, '{"items":[{"quote":"作者把这一段叫做“生产力陷阱”，并解释了三层防线。"}]}', quoteCtx)).not.toThrow();
  });

  it("kind=json 输出非 JSON 时先于断言失败", () => {
    const s = step({ kind: "json", asserts: [{ op: "jsonRootKeys", value: ["items"] }] });
    expect(() => assertStepOutput(s, "没有围栏的说明文字", ctx)).toThrow(/不是合法 JSON/);
  });
});

/**
 * 内置配方的引用回查门必须**真的在工作**。
 *
 * 这条守卫是被一次真实事故逼出来的：`items[].evidence[].quote[]` 这样的路径把末尾 `[]`（数组标记）
 * 加在了字符串字段上，`collectFieldStrings` 收集到 0 条引用 → 未命中数也是 0 → 断言恒过。
 * 溯源 v2/v3 的「引文必须逐字命中原文」和练一练的审题门因此一直是空转的，而字面上看它们都在。
 *
 * 所以这里刻意用**手写的真实产物形状**（而不是按 path 反推出来的对象）：路径写成字符串字段却带 `[]` 时，
 * 收集结果会是空的，断言门不抛错，这条用例立刻变红。按 path 反推的话它会顺着错路径造数据，永远抓不到。
 */
describe("内置配方的引用回查门是活的", () => {
  const BAD = "这句引文在原文里根本不存在，专门用来试探断言门是不是空转的。";
  /** 引用回查的比对源：故意写成与 BAD 完全不相干的一句话。 */
  const ctx = { input: "原文里有这一句关键表述，但没有任何一条引文与它逐字相同。", prev: "", all: "" };

  /** insight 系列：blocks[].quotes 是字符串数组。 */
  const insightProduct = (quote: string) => ({ blocks: [{ title: "示例主张", quotes: [quote] }] });
  /** 溯源系列：items[].evidence[].quote 是字符串。 */
  const traceProduct = (quote: string) => ({ items: [{ id: "item-1", evidence: [{ quote }] }] });
  /** 练一练：points[].sourceQuote 与 items[].sourceQuote 都是字符串；给够 3 条坏引文才能越过 maxMiss=2。 */
  const drillProduct = (quote: string) =>
    Object.fromEntries([
      ["points", [1, 2, 3].map((n) => ({ id: `p${n}`, name: `示例点${n}`, sourceQuote: quote }))],
      ["items", [1, 2, 3].map((n) => ({ id: `q${n}`, pointId: `p${n}`, sourceQuote: quote }))],
      ["extensions", []],
    ]);

  const cases = [
    { blockId: "builtin.insight.v3", stepId: "scan", path: "blocks[].quotes[]", product: insightProduct(BAD) },
    { blockId: "builtin.insight.v4", stepId: "scan", path: "blocks[].quotes[]", product: insightProduct(BAD) },
    { blockId: "builtin.trace.v2", stepId: "scan", path: "items[].evidence[].quote", product: traceProduct(BAD) },
    { blockId: "builtin.trace.v2", stepId: "finalize", path: "items[].evidence[].quote", product: traceProduct(BAD) },
    { blockId: "builtin.trace.v3", stepId: "scan", path: "items[].evidence[].quote", product: traceProduct(BAD) },
    { blockId: "builtin.trace.v3", stepId: "finalize", path: "items[].evidence[].quote", product: traceProduct(BAD) },
    { blockId: "builtin.drill", stepId: "audit", path: "points[].sourceQuote", product: drillProduct(BAD) },
    { blockId: "builtin.drill", stepId: "audit", path: "items[].sourceQuote", product: drillProduct(BAD) },
  ];

  for (const item of cases) {
    it(`${item.blockId} 的 ${item.stepId} 步：引文不在原文时必须判失败（${item.path}）`, () => {
      const block = BUILTIN_PROMPT_BLOCKS.find((entry) => entry.id === item.blockId);
      const step = block?.recipe?.steps.find((entry) => entry.id === item.stepId);
      expect(step, `${item.blockId} 缺少 ${item.stepId} 步`).toBeDefined();
      const declared = step!.expects?.asserts?.some(
        (entry) => entry.op === "citationsInOriginal" && entry.field === item.path,
      );
      expect(declared, `${item.blockId}/${item.stepId} 没有声明 ${item.path} 的引用回查`).toBe(true);
      // 收集不到引文时既不会有未命中（maxMiss 无话可说），所以这条抛错只有一种可能：门真的在查。
      expect(() => assertStepOutput(step!, JSON.stringify(item.product), ctx)).toThrow(/未在原文找到|只找到 0 条引用/);
    });
  }
});
