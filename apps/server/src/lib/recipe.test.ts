import { describe, expect, it } from "vitest";
import type { RecipeStep } from "@scribe-flow/shared";
import { assertStepOutput, collectFieldStrings, parseJsonLoose, renderStepSystem } from "./recipe";

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
