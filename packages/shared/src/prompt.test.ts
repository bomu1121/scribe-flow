import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_BLOCKS, aiPromptBlocks, availablePromptBlocks } from "./prompt";

describe("builtin prompt blocks", () => {
  it("展示名与系列名不夹带内部说法（版本号 / 配方 / 内置 / 代号）", () => {
    for (const block of BUILTIN_PROMPT_BLOCKS) {
      expect(block.name).not.toMatch(/v\d|配方|内置|试点|CASCADE|JSON/i);
      expect(block.series ?? block.name).not.toMatch(/v\d|配方|内置|试点|CASCADE|JSON/i);
    }
  });

  it("内置块 id 不重复", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("保留各版本观点提炼并标注版本：v4 接管推荐位", () => {
    const insightBlocks = BUILTIN_PROMPT_BLOCKS.filter((block) => block.series === "观点笔记");
    expect(insightBlocks.map((block) => block.version).sort()).toEqual(["v1", "v2", "v3", "v4", "v5", "v6"]);
    expect(insightBlocks.find((block) => block.id === "builtin.insight")?.recommended).toBeUndefined();
    expect(insightBlocks.find((block) => block.id === "builtin.insight.v4")?.recommended).toBe(true);
  });

  it("三个试用块都在、都是单次调用、都不抢推荐位", () => {
    for (const id of ["builtin.insight.v5", "builtin.insight.v6", "builtin.qa"]) {
      const block = BUILTIN_PROMPT_BLOCKS.find((item) => item.id === id);
      expect(block, id).toBeDefined();
      // 挂配方就是 4 次调用，与「先试用对比」的定位不符
      expect(block?.recipe, id).toBeUndefined();
      // 推荐位仍归成文版，试用块不夺位
      expect(block?.recommended, id).toBeUndefined();
    }
    expect(BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.qa")?.series).toBe("问答笔记");
  });

  it("问答笔记必须要求把问题写成二级标题：平铺的「问：」进不了结果页目录", () => {
    // 依据：apps/web/src/lib/markdown.ts 的 documentHeadings 只收 1–4 级标题。
    // 实测用「问：/答：」平铺那一版在应用里目录 0 条，找答案只能靠眼睛扫。
    const qa = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.qa");
    expect(qa?.prompt).toContain("问题必须是二级标题");
    expect(qa?.prompt).toContain("不要在问题前再加「问：」");
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

  it("观点笔记配方的拆解步限了引用条数：否则几十条引用里错一条就整节点作废", () => {
    // 实测：不限时它在 2,939 字的稿子上摘了 77-79 条，每条都要过逐字门，一条不过就废掉整次运行。
    for (const id of ["builtin.insight.v3", "builtin.insight.v4"]) {
      const scan = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === id)?.recipe?.steps.find((step) => step.id === "scan");
      expect(scan?.system, id).toContain("全篇合计不超过 20 条");
    }
  });

  it("速览与速查的速查段不用表格：窄阅读区里表格只能挤成一团或炸成几十行", () => {
    // 真实产物反馈：一格里最多 164 字、5 处用分号串了多条。结果页正文区约 700px，
    // Markdown 表格又没有换行单元格——复合内容没有中间态，所以这一段改成条目清单。
    const p = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6")?.prompt ?? "";
    expect(p).toContain("不要用表格");
    expect(p).toContain("一条一行、一事只说一遍");
  });

  it("观点速读：单次调用、自成一个系列、不抢推荐位", () => {
    const brief = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.brief");
    expect(brief).toBeDefined();
    expect(brief?.series).toBe("观点速读");
    expect(brief?.version).toBe("v1");
    // 压缩档的价值就是便宜，所以刻意不挂配方（挂了就是 4 次调用）
    expect(brief?.recipe).toBeUndefined();
    // 与「观点笔记」是两种产物，不设推荐位，用不用由人选
    expect(brief?.recommended).toBeUndefined();
    expect(BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight.v4")?.recommended).toBe(true);
  });

  it("观点速读的槽位不能被悄悄删掉：观众、硬长度预算、忽略清单、拒答", () => {
    const brief = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.brief");
    const prompt = brief?.prompt ?? "";
    expect(prompt).toContain("对谁有用"); // 观众槽（BibiGPT 槽位表里我们原本空着的一格）
    expect(prompt).toContain("长度预算（硬上限，超出即不合格）");
    expect(prompt).toContain("全篇不超过 800 字");
    expect(prompt).toContain("## 原稿没有回答"); // 缺口当一等公民
    expect(prompt).toContain("做不到就说做不到");
    expect(prompt).toContain("## 忽略清单（不要写进笔记）");
    // 压缩档不能带上「信息不缩水」——实测它和长度预算是会打架的（见调研 §4.5）
    expect(prompt).not.toContain("信息不缩水");
  });

  it("忽略清单槽接进了观点笔记全系列（单次块 + v3/v4 配方的拆解与起草步）", () => {
    const full = "片尾求关注、求点赞、求收藏、转发、投币、三连与下期预告";
    const brief = "不要为它们建 block，也不要在 quotes 里摘它们";
    const byId = (id: string) => BUILTIN_PROMPT_BLOCKS.find((block) => block.id === id);
    // 单次调用路径：v2 的 prompt、以及 v3/v4 作为兜底的 prompt 字段
    for (const id of ["builtin.insight", "builtin.insight.v3", "builtin.insight.v4"]) {
      expect(byId(id)?.prompt).toContain(full);
    }
    // 配方路径才是 v3/v4 真正跑的：拆解步用一句话版（避免与「只输出 JSON」打架），起草步用完整版
    for (const id of ["builtin.insight.v3", "builtin.insight.v4"]) {
      const steps = byId(id)?.recipe?.steps ?? [];
      expect(steps.find((step) => step.id === "scan")?.system).toContain(brief);
      expect(steps.find((step) => step.id === "draft")?.system).toContain(full);
    }
  });

  it("新增知识科普提炼内置块", () => {
    const knowledge = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.knowledge");
    expect(knowledge).toBeDefined();
    expect(knowledge?.series).toBe("科普笔记");
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
    expect(history?.series).toBe("历史脉络梳理");
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
    expect(v1?.version).toBe("v1");
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
  it("只放出已过审核的内置块（当前 5 个），其余一律不出现在可选列表里", () => {
    const ids = availablePromptBlocks(BUILTIN_PROMPT_BLOCKS, true).map((block) => block.id);
    expect([...ids].sort()).toEqual([
      "builtin.insight",
      "builtin.insight.v4",
      "builtin.insight.v5",
      "builtin.insight.v6",
      "builtin.qa",
    ]);
    // 未过审核的：旧的试点版本、上一代版本、以及整系列模版
    for (const blocked of [
      "builtin.insight.v1",
      "builtin.insight.v3",
      "builtin.brief",
      "builtin.tech",
      "builtin.knowledge",
      "builtin.trace.v3",
      "builtin.gameguide.v2",
      "builtin.drill",
    ]) {
      expect(ids, blocked).not.toContain(blocked);
    }
  });

  it("未过审核只影响可选列表：块本身还在 BUILTIN_PROMPT_BLOCKS 里，老工程照常解析", () => {
    // 引擎按 id 从 BUILTIN_PROMPT_BLOCKS 里解析，不看白名单——已有工程绑过的块不能被这次收紧搞失效
    const allIds = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    for (const id of ["builtin.insight.v3", "builtin.brief", "builtin.trace.v3"]) expect(allIds).toContain(id);
  });

  it("自定义块不受审核白名单约束（是用户自己写的）", () => {
    const custom = { id: "custom.1", name: "我的块", prompt: "x", builtin: false };
    expect(availablePromptBlocks([...BUILTIN_PROMPT_BLOCKS, custom], true).map((block) => block.id)).toContain("custom.1");
  });

  it("没配检索密钥时不列出以联网核查为核心的模版，其余照常（用注入的块验证，不受白名单影响）", () => {
    const injected = [
      { id: "x.required", name: "需核查", prompt: "x", builtin: false, externalCheck: "required" as const },
      { id: "x.optional", name: "可选核查", prompt: "x", builtin: false, externalCheck: "optional" as const },
    ];
    expect(availablePromptBlocks(injected, false).map((block) => block.id)).toEqual(["x.optional"]);
    expect(availablePromptBlocks(injected, true).map((block) => block.id)).toEqual(["x.required", "x.optional"]);
  });

  it("展示范围里收起的节点，它的块也不列出（用注入的块验证）", () => {
    const injected = [
      { id: "n.a", name: "A", prompt: "x", builtin: false, requiresNode: "process.gameguide" as const },
      { id: "n.b", name: "B", prompt: "x", builtin: false },
    ];
    expect(availablePromptBlocks(injected, true, ["process.gameguide"]).map((block) => block.id)).toEqual(["n.b"]);
    expect(availablePromptBlocks(injected, true, []).map((block) => block.id)).toEqual(["n.a", "n.b"]);
  });
});

describe("aiPromptBlocks（画布节点与快捷新建共用的「AI 加工」可选块）", () => {
  it("两处下拉是同一份列表：已过审核的 5 个通用块，顺序稳定", () => {
    expect(aiPromptBlocks([], true).map((block) => block.id)).toEqual([
      "builtin.insight",
      "builtin.insight.v4",
      "builtin.insight.v5",
      "builtin.insight.v6",
      "builtin.qa",
    ]);
  });

  it("由专属节点承载的块（阴阳师攻略 / 练一练）不属于「AI 加工」，一次也不出现", () => {
    const ids = aiPromptBlocks([], true).map((block) => block.id);
    for (const id of ["builtin.gameguide", "builtin.gameguide.v2", "builtin.drill"]) expect(ids).not.toContain(id);
    // 反过来也成立：列表里没有任何标了 requiresNode 的块
    expect(aiPromptBlocks([], true).every((block) => !block.requiresNode)).toBe(true);
  });

  it("自定义块追加在内置块之后，且不受审核白名单约束", () => {
    const custom = { id: "custom.1", name: "我的块", prompt: "x", builtin: false };
    const blocks = aiPromptBlocks([custom], true);
    expect(blocks.at(-1)).toBe(custom);
    expect(blocks.length).toBe(aiPromptBlocks([], true).length + 1);
  });

  it("没配检索密钥时不列出需要联网核查的块", () => {
    expect(aiPromptBlocks([], false).every((block) => block.externalCheck !== "required")).toBe(true);
  });
});
