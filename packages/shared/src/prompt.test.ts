import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_BLOCKS } from "./prompt";

describe("builtin prompt blocks", () => {
  it("内置块 id 不重复", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("保留旧版与新版观点提炼并标注版本", () => {
    const insightBlocks = BUILTIN_PROMPT_BLOCKS.filter((block) => block.series === "观点提炼");
    expect(insightBlocks.map((block) => block.version).sort()).toEqual(["v1", "v2"]);
    expect(insightBlocks.find((block) => block.id === "builtin.insight")?.recommended).toBe(true);
  });

  it("新增知识科普提炼内置块", () => {
    const knowledge = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.knowledge");
    expect(knowledge).toBeDefined();
    expect(knowledge?.name).toBe("知识科普提炼");
    expect(knowledge?.version).toBe("v1");
    expect(knowledge?.prompt).toContain("核心知识框架");
  });

  it("知识科普提炼提示词包含防重复标题、防补知识和表格分隔行约束", () => {
    const knowledge = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.knowledge");
    expect(knowledge?.prompt).toContain("只允许一个 H1");
    expect(knowledge?.prompt).toContain("[编辑补充]");
    expect(knowledge?.prompt).toContain("|---|---|---|");
  });

  it("CASCADE 与知识科普提炼同时存在", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(ids).toContain("builtin.cascade");
    expect(ids).toContain("builtin.knowledge");
  });

  it("新增历史认知加工内置块", () => {
    const history = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.history");
    expect(history).toBeDefined();
    expect(history?.name).toBe("历史认知加工");
    expect(history?.series).toBe("历史认知加工");
    expect(history?.version).toBe("v1");
    expect(history?.recommended).toBe(true);
  });

  it("历史认知加工提示词包含事实/观点分层与轻量笔记约束", () => {
    const history = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.history");
    expect(history?.prompt).toContain("## 事实 vs 作者观点");
    expect(history?.prompt).toContain("## 可以带走的看历史角度");
    expect(history?.prompt).toContain("不用今天的价值观简单批判古人");
    expect(history?.prompt).toContain("存疑/可能有争议");
  });
});
