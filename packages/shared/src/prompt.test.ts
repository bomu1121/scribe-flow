import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_BLOCKS, availablePromptBlocks, bindablePromptBlocks } from "./prompt";

describe("builtin prompt blocks", () => {
  it("内置块 id 不重复", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("保留各版本观点提炼并标注版本：v4 接管推荐位", () => {
    const insightBlocks = BUILTIN_PROMPT_BLOCKS.filter((block) => block.series === "观点提炼");
    expect(insightBlocks.map((block) => block.version).sort()).toEqual(["v1", "v2", "v3", "v4"]);
    expect(insightBlocks.find((block) => block.id === "builtin.insight")?.recommended).toBeUndefined();
    expect(insightBlocks.find((block) => block.id === "builtin.insight.v4")?.recommended).toBe(true);
  });

  it("观点提炼 v3 为配方试点：带 recipe、不设 recommended", () => {
    const v3 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight.v3");
    expect(v3).toBeDefined();
    expect(v3?.recipe).toBeDefined();
    expect(v3?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "draft", "audit", "finalize"]);
    expect(v3?.recommended).toBeUndefined();
    expect(v3?.recipe?.steps.every((step) => step.system.length > 0)).toBe(true);
  });

  it("观点提炼 v4 为排版核对配方：4 步、finalize 带禁 ### 硬门、prompt 字段是新版式", () => {
    const v4 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight.v4");
    expect(v4).toBeDefined();
    expect(v4?.name).toContain("排版版");
    expect(v4?.version).toBe("v4");
    expect(v4?.recommended).toBe(true);
    expect(v4?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "draft", "audit", "finalize"]);
    expect(v4?.recipe?.steps.every((step) => step.system.length > 0)).toBe(true);
    const finalize = v4?.recipe?.steps.find((step) => step.id === "finalize");
    expect(finalize?.expects?.kind).toBe("text");
    expect(finalize?.expects?.asserts).toContainEqual({ op: "notContains", value: "###" });
    expect(v4?.prompt).toContain("期刊式");
    expect(v4?.prompt).not.toContain("## 总体概要"); // prompt 字段须为 v4 新版式，而非 v2 旧文本
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

  it("信息溯源系列：v1/v2 保留，v3 为推荐的联网核查版", () => {
    const v1 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace");
    const v2 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace.v2");
    const v3 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace.v3");
    expect(v1?.version).toBe("v1");
    expect(v1?.recipe).toBeUndefined();
    expect(v2).toBeDefined();
    expect(v2?.name).toContain("结构化核对版");
    expect(v2?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "audit", "finalize"]);
    expect(v2?.recipe?.steps.every((step) => step.system.length > 0)).toBe(true);
    // 推荐位交给 v3；v2 仍可用，只是不再推荐
    expect(v2?.recommended).toBeUndefined();
    expect(v3?.version).toBe("v3");
    expect(v3?.recommended).toBe(true);
    expect(v3?.externalCheck).toBe("required");
    expect(v3?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "audit", "finalize"]);
    expect(v3?.recipe?.steps.map((step) => step.label)).toEqual(["通读抽取并规划核查", "回文核对并校核查计划", "结构化成稿"]);
  });

  it("v3 抽取步产出核查计划，v2/v3 共用同一份字段铁律", () => {
    const v2 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace.v2");
    const v3 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace.v3");
    const v3Scan = v3?.recipe?.steps[0]?.system ?? "";
    expect(v3Scan).toContain('"verify"');
    expect(v3Scan).toContain("needed=true");
    expect(v3Scan).toContain("queries 要能直接粘进搜索引擎");
    // 共用铁律：两版抽取步都必须带上同一条不许编造引用的约束
    const sharedRule = "4. evidence[].quote 必须逐字摘自原文，禁止改写、拼接、脑补；长句只截取连续短句；";
    expect(v2?.recipe?.steps[0]?.system).toContain(sharedRule);
    expect(v3Scan).toContain(sharedRule);
    // 成稿步必须要求保留核查计划，否则服务端没得可用
    expect(v3?.recipe?.steps[2]?.system).toContain("verify 必须逐条保留");
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

describe("availablePromptBlocks", () => {
  it("没配检索密钥时不列出以联网核查为核心的模版，其余模版照常可选", () => {
    const ids = availablePromptBlocks(BUILTIN_PROMPT_BLOCKS, false).map((block) => block.id);
    expect(ids).not.toContain("builtin.trace.v3");
    // v2 的核心价值是原文核对与结构化报告，没有密钥也照样能用，不能一起藏掉
    expect(ids).toContain("builtin.trace.v2");
    expect(ids).toContain("builtin.trace");
    expect(ids).toContain("builtin.insight.v4");
  });

  it("配了密钥就把原列表原样交回", () => {
    expect(availablePromptBlocks(BUILTIN_PROMPT_BLOCKS, true)).toHaveLength(BUILTIN_PROMPT_BLOCKS.length);
  });
});

describe("bindablePromptBlocks", () => {
  it("同系列只留推荐版本：观点提炼出 v4 而非 v1/v2/v3", () => {
    const blocks = bindablePromptBlocks();
    const insight = blocks.filter((block) => block.series === "观点提炼");
    expect(insight.map((block) => block.id)).toEqual(["builtin.insight.v4"]);
  });

  it("排除由专属节点承载的块（知识巩固），且没有重复项", () => {
    const ids = bindablePromptBlocks().map((block) => block.id);
    expect(ids).not.toContain("builtin.drill");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("没有推荐位的系列取该系列首个版本", () => {
    const blocks = bindablePromptBlocks();
    expect(blocks.find((block) => block.series === "技术文案提炼")?.id).toBe("builtin.tech");
    expect(blocks.find((block) => block.series === "概念演进摘要（CASCADE）")?.id).toBe("builtin.cascade");
  });

  it("自定义块按传入顺序追加在内置候选之后", () => {
    const custom = { id: "custom.1", name: "我的块", prompt: "x", builtin: false };
    const blocks = bindablePromptBlocks([custom]);
    expect(blocks.at(-1)).toBe(custom);
    expect(blocks.length).toBe(bindablePromptBlocks().length + 1);
  });
});
