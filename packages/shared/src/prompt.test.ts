import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_BLOCKS } from "./prompt";

describe("builtin prompt blocks", () => {
  it("内置块 id 不重复", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("保留旧版与新版观点提炼并标注版本", () => {
    const insightBlocks = BUILTIN_PROMPT_BLOCKS.filter((block) => block.series === "观点提炼");
    expect(insightBlocks.map((block) => block.version).sort()).toEqual(["v1", "v2", "v3"]);
    expect(insightBlocks.find((block) => block.id === "builtin.insight")?.recommended).toBe(true);
  });

  it("观点提炼 v3 为配方试点：带 recipe、不设 recommended", () => {
    const v3 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight.v3");
    expect(v3).toBeDefined();
    expect(v3?.recipe).toBeDefined();
    expect(v3?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "draft", "audit", "finalize"]);
    expect(v3?.recommended).toBeUndefined();
    expect(v3?.recipe?.steps.every((step) => step.system.length > 0)).toBe(true);
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

  it("新增阴阳师攻略加工系列：单次版与核对版并存，核对版为推荐配方", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(ids).toContain("builtin.gameguide");
    expect(ids).toContain("builtin.gameguide.v2");
    const v1 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.gameguide");
    const v2 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.gameguide.v2");
    expect(v1?.name).toBe("阴阳师攻略提炼");
    expect(v1?.version).toBe("v1");
    expect(v2?.name).toBe("阴阳师攻略加工（核对版）");
    expect(v2?.version).toBe("v2");
    expect(v2?.recommended).toBe(true);
    expect(v2?.recipe).toBeDefined();
    expect(v2?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "draft", "audit", "finalize"]);
  });

  it("阴阳师攻略加工提示词包含决策/数值/版本时效等约束", () => {
    const v1 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.gameguide");
    expect(v1?.prompt).toContain("信息不缩水");
    expect(v1?.prompt).toContain("核心建议 / 优先级");
    expect(v1?.prompt).toContain("版本时效与待核实");
    expect(v1?.prompt).toContain("不添加原文没有的攻略信息");
  });
});
