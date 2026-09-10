import { describe, expect, it } from "vitest";
import { parseDrillSets } from "./drill";

function product(title: string) {
  return JSON.stringify({
    schema: 1,
    kind: "drillSet",
    title,
    points: [{ id: "p1", name: "考察点", type: "concept", gist: "一句话", sourceQuote: "引文" }],
    items: [
      {
        id: "q1",
        pointId: "p1",
        kind: "single",
        stem: `题干（${title}）`,
        options: ["甲选项内容", "乙选项内容", "丙选项内容"],
        answer: ["甲选项内容"],
        sourceQuote: "引文",
      },
    ],
    extensions: [],
  });
}

describe("parseDrillSets", () => {
  it("单份产物直接解析", () => {
    const sets = parseDrillSets(product("第一份"));
    expect(sets).toHaveLength(1);
    expect(sets[0].title).toBe("第一份");
  });

  it("多份产物按引擎分隔符切分，逐份解析", () => {
    const text = `${product("第一份")}\n\n---\n\n${product("第二份")}`;
    const sets = parseDrillSets(text);
    expect(sets.map((set) => set.title)).toEqual(["第一份", "第二份"]);
  });

  it("坏产物不影响好产物", () => {
    const text = `${product("好的")}\n\n---\n\n这不是 JSON`;
    const sets = parseDrillSets(text);
    expect(sets).toHaveLength(1);
    expect(sets[0].title).toBe("好的");
  });

  it("空文本与非法文本返回空数组", () => {
    expect(parseDrillSets("")).toEqual([]);
    expect(parseDrillSets("   ")).toEqual([]);
    expect(parseDrillSets("普通 Markdown 文本")).toEqual([]);
  });

  it("容忍 ```json 围栏包裹的产物", () => {
    const sets = parseDrillSets(`\`\`\`json\n${product("围栏")}\n\`\`\``);
    expect(sets).toHaveLength(1);
    expect(sets[0].title).toBe("围栏");
  });

  it("结果页解析不做引文校验（生成期已过滤）", () => {
    const payload = JSON.stringify({
      ...JSON.parse(product("改过引文")),
      points: [{ id: "p1", name: "考察点", type: "concept", gist: "一句话", sourceQuote: "原文里没有这句" }],
      items: [
        {
          id: "q1",
          pointId: "p1",
          kind: "single",
          stem: "题干",
          options: ["甲选项内容", "乙选项内容", "丙选项内容"],
          answer: ["甲选项内容"],
          sourceQuote: "原文里也没有这句",
        },
      ],
    });
    expect(parseDrillSets(payload)).toHaveLength(1);
  });
});
