import { describe, expect, it } from "vitest";
import {
  BUILTIN_PROMPT_BLOCKS,
  aiPromptBlocks,
  availablePromptBlocks,
  blockSeriesName,
  compareVersion,
  currentPromptBlock,
  groupPromptBlocks,
  isTraceBlock,
  promptBlockVersions,
  variantTitle,
} from "./prompt";

describe("builtin prompt blocks", () => {
  it("展示名与系列名不夹带内部说法（版本号 / 配方 / 内置 / 代号）", () => {
    for (const block of BUILTIN_PROMPT_BLOCKS) {
      expect(block.name).not.toMatch(/v\d|配方|内置|试点|CASCADE|JSON/i);
      expect(block.series ?? block.name).not.toMatch(/v\d|配方|内置|试点|CASCADE|JSON/i);
    }
  });

  it("内置提示词 id 不重复", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("观点提炼系列：5 个成员同挂一个系列名，只有详尽版被迭代过（v1/v2），推荐位归成文版", () => {
    const insight = BUILTIN_PROMPT_BLOCKS.filter((block) => block.series === "观点提炼");
    expect(new Set(insight.map((block) => block.name))).toEqual(new Set(["详尽版", "逐段核对", "成文版", "连贯版", "速览版"]));
    // 「详尽版」有两代（v1 是它的上一代），其余的成员都是第一代、刻意不带 version——
    // 列表上不再平铺版本号，正是靠「没迭代过就没有版本」这条实现
    expect(insight.filter((block) => block.name === "详尽版").map((block) => block.version).sort()).toEqual(["v1", "v2"]);
    expect(insight.filter((block) => block.name !== "详尽版").every((block) => block.version === undefined)).toBe(true);
    expect(insight.find((block) => block.id === "builtin.insight")?.recommended).toBeUndefined();
    expect(insight.find((block) => block.id === "builtin.insight.v4")?.recommended).toBe(true);
  });

  it("三个试用提示词都在、都不抢推荐位", () => {
    for (const id of ["builtin.insight.v5", "builtin.insight.v6", "builtin.qa"]) {
      const block = BUILTIN_PROMPT_BLOCKS.find((item) => item.id === id);
      expect(block, id).toBeDefined();
      // 推荐位仍归成文版，试用提示词不夺位
      expect(block?.recommended, id).toBeUndefined();
    }
    expect(BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.qa")?.series).toBe("问答笔记");
  });

  it("连贯版与问答笔记保持单次调用：挂四步配方与「先试用对比」的定位不符", () => {
    for (const id of ["builtin.insight.v5", "builtin.qa"]) {
      expect(BUILTIN_PROMPT_BLOCKS.find((b) => b.id === id)?.recipe, id).toBeUndefined();
    }
  });

  it("速览版是两步配方，且第二步是追加式（正文逐字不改靠拼接，不靠模型听话）", () => {
    /*
     * 这条断言在 2026-10-14 之前是「三个试用块都不许有配方」，理由写的是「挂配方就是 4 次调用」。
     * 现在 v6 破了这条，只破一半——它的配方是 2 步，且第二步声明 `append`：
     * 实测让末步**重写整篇**要多花十几倍输出 token（那一节只 188-313 字，整篇 4,000+ 字），
     * 正文还会被模型顺手改掉。三臂对照的数字见 PROMPT_SULAN / RECIPE_SULAN 的注释。
     */
    const v6 = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6");
    expect(v6?.recipe?.steps.map((step) => step.id)).toEqual(["sulan", "xianyin"]);
    const last = v6?.recipe?.steps.at(-1);
    expect(last?.append?.before).toBe("> [!example]-");
    // 后面若接上第三步，追加的语义就说不通了（引擎的 prev 会被下一步读走）。
    expect(v6?.recipe?.steps.filter((step) => step.append)).toHaveLength(1);
    // 这一节的产出必须说出「找什么」，否则会退化成把正文换个说法——成文版那栏就是这么坏掉的。
    expect(last?.system).toContain("情绪色彩");
    expect(last?.system).toContain("未明说的潜台词");
    expect(last?.system).toContain("矛盾心态");
    // 两道断言门：写成 `## ` 标题（会被读成正文的下一节）、或把整篇笔记又抄一遍。
    expect(last?.expects?.asserts).toEqual([
      { op: "contains", value: "> [!quote] 弦外之音" },
      { op: "lengthLte", value: 1500 },
    ]);
    // 这一节必须是标注框、不是二级标题：跟正文小节同级同形时，读者会把它读成正文的顺序续篇
    // （用户拿真实产物反馈过）。速览与速查都有框，只有它没有的那一版最容易被误读。
    expect(last?.system).toContain("写成标注框，不要写成 `## ` 标题");
    expect(last?.system).toContain("> [!quote] 弦外之音");
    // 框内要连贯行文：这一节夹在散文正文与速查清单之间，夹一个列表两头都不像。
    expect(last?.system).toContain("不要用列表或分点");
    // 第一步就是原来那次单次调用，一字不改。
    expect(v6?.recipe?.steps[0]?.system).toBe(v6?.prompt);
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
    expect(v4?.recommended).toBe(true);
    expect(v4?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "draft", "audit", "finalize"]);
    expect(v4?.recipe?.steps.every((step) => step.system.length > 0)).toBe(true);
    const finalize = v4?.recipe?.steps.find((step) => step.id === "finalize");
    expect(finalize?.expects?.kind).toBe("text");
    expect(finalize?.expects?.asserts).toContainEqual({ op: "notContains", value: "###" });
    expect(v4?.prompt).toContain("期刊式");
    expect(v4?.prompt).not.toContain("## 总体概要"); // prompt 字段须为 v4 新版式，而非 v2 旧文本
  });

  it("观点提炼配方的拆解步限了引用条数：否则几十条引用里错一条就整节点作废", () => {
    // 实测：不限时它在 2,939 字的稿子上摘了 77-79 条，每条都要过逐字门，一条不过就废掉整次运行。
    for (const id of ["builtin.insight.v3", "builtin.insight.v4"]) {
      const scan = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === id)?.recipe?.steps.find((step) => step.id === "scan");
      expect(scan?.system, id).toContain("全篇合计不超过 20 条");
    }
  });

  it("速览版的速查段不用表格：窄阅读区里表格只能挤成一团或炸成几十行", () => {
    // 真实产物反馈：一格里最多 164 字、5 处用分号串了多条。结果页正文区约 700px，
    // Markdown 表格又没有换行单元格——复合内容没有中间态，所以这一段改成条目清单。
    const p = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6")?.prompt ?? "";
    expect(p).toContain("不要用表格");
    expect(p).toContain("一条一行、一事只说一遍");
  });

  it("速览版写成 Obsidian callout：速览不折叠、速查折叠并分组，正文小节升到二级", () => {
    // 依据与实测（平铺 28 条 1093px → 折叠 125px）见 docs/research/obsidian-note-typography.md。
    // 两个容易静默出错的地方也都钉住：类型名要写全（不认识/写不全的类型要么回落 note 要么显示英文标题）、
    // 折叠标记 `-` 不能省（省了默认展开，几十条会把页面铺满）。
    const p = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === "builtin.insight.v6")?.prompt ?? "";
    expect(p).toContain("> [!summary] 速览");
    expect(p).toContain("> [!example]- 速查");
    expect(p).toContain("**默认折叠**，不能省");
    expect(p).toContain("类别要当结构写，不要塞进圆括号");
    expect(p).toContain("小标题用**二级**");
    expect(p).not.toContain("（〈类别〉）");
  });

  it("观点速读：单次调用、自成一个系列、不抢推荐位", () => {
    const brief = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.brief");
    expect(brief).toBeDefined();
    expect(brief?.series).toBe("观点速读");
    // 压缩档的价值就是便宜，所以刻意不挂配方（挂了就是 4 次调用）
    expect(brief?.recipe).toBeUndefined();
    // 与「观点提炼」是两种产物，不设推荐位，用不用由人选
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

  it("忽略清单槽接进了观点提炼全系列（单次提示词 + v3/v4 配方的拆解与起草步）", () => {
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

  it("新增知识科普提炼内置提示词", () => {
    const knowledge = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.knowledge");
    expect(knowledge).toBeDefined();
    expect(knowledge?.series).toBe("科普笔记");
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

  it("新增历史认知加工内置提示词", () => {
    const history = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.history");
    expect(history).toBeDefined();
    expect(history?.series).toBe("历史脉络梳理");
    expect(history?.recommended).toBe(true);
  });

  it("历史认知加工提示词包含事实/观点分层与轻量笔记约束", () => {
    const history = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.history");
    expect(history?.prompt).toContain("## 事实 vs 作者观点");
    expect(history?.prompt).toContain("## 可以带走的看历史角度");
    expect(history?.prompt).toContain("不用今天的价值观简单批判古人");
    expect(history?.prompt).toContain("存疑/可能有争议");
  });

  it("信息溯源系列：基础 / 逐条对照 / 上网查证三档，上网查证为推荐的联网核查版", () => {
    const v1 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace");
    const v2 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace.v2");
    const v3 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.trace.v3");
    expect(v1?.recipe).toBeUndefined();
    expect(v2).toBeDefined();
    expect(v2?.recipe?.steps.map((step) => step.id)).toEqual(["scan", "audit", "finalize"]);
    expect(v2?.recipe?.steps.every((step) => step.system.length > 0)).toBe(true);
    // 推荐位交给 v3；v2 仍可用，只是不再推荐
    expect(v2?.recommended).toBeUndefined();
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

  it("阴阳师攻略系列：基础与逐段核对并存，逐段核对为推荐配方", () => {
    const ids = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    expect(ids).toContain("builtin.gameguide");
    expect(ids).toContain("builtin.gameguide.v2");
    const v1 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.gameguide");
    const v2 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.gameguide.v2");
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
  it("只放出已过审核的内置提示词（当前 6 个），其余一律不出现在可选列表里", () => {
    const ids = availablePromptBlocks(BUILTIN_PROMPT_BLOCKS, true).map((block) => block.id);
    expect([...ids].sort()).toEqual([
      "builtin.insight",
      "builtin.insight.v4",
      "builtin.insight.v5",
      "builtin.insight.v6",
      "builtin.qa",
      "builtin.trace.v3",
    ]);
    // 未过审核的：旧的试点版本、上一代版本、以及整系列模版
    for (const blocked of [
      "builtin.insight.v1",
      "builtin.insight.v3",
      "builtin.brief",
      "builtin.tech",
      "builtin.knowledge",
      "builtin.trace",
      "builtin.trace.v2",
      "builtin.gameguide.v2",
      "builtin.drill",
    ]) {
      expect(ids, blocked).not.toContain(blocked);
    }
  });

  it("未过审核只影响可选列表：提示词本身还在 BUILTIN_PROMPT_BLOCKS 里，老工程照常解析", () => {
    // 引擎按 id 从 BUILTIN_PROMPT_BLOCKS 里解析，不看白名单——已有工程绑过的提示词不能被这次收紧搞失效
    const allIds = BUILTIN_PROMPT_BLOCKS.map((block) => block.id);
    for (const id of ["builtin.insight.v3", "builtin.brief", "builtin.trace.v3"]) expect(allIds).toContain(id);
  });

  it("自定义提示词不受审核白名单约束（是用户自己写的）", () => {
    const custom = { id: "custom.1", name: "我的块", prompt: "x", builtin: false };
    expect(availablePromptBlocks([...BUILTIN_PROMPT_BLOCKS, custom], true).map((block) => block.id)).toContain("custom.1");
  });

  it("没配检索密钥时不列出以联网核查为核心的模版，其余照常（用注入的提示词验证，不受白名单影响）", () => {
    const injected = [
      { id: "x.required", name: "需核查", prompt: "x", builtin: false, externalCheck: "required" as const },
      { id: "x.optional", name: "可选核查", prompt: "x", builtin: false, externalCheck: "optional" as const },
    ];
    expect(availablePromptBlocks(injected, false).map((block) => block.id)).toEqual(["x.optional"]);
    expect(availablePromptBlocks(injected, true).map((block) => block.id)).toEqual(["x.required", "x.optional"]);
  });

  it("展示范围里收起的节点，它的提示词也不列出（用注入的提示词验证）", () => {
    const injected = [
      { id: "n.a", name: "A", prompt: "x", builtin: false, requiresNode: "process.gameguide" as const },
      { id: "n.b", name: "B", prompt: "x", builtin: false },
    ];
    expect(availablePromptBlocks(injected, true, ["process.gameguide"]).map((block) => block.id)).toEqual(["n.b"]);
    expect(availablePromptBlocks(injected, true, []).map((block) => block.id)).toEqual(["n.a", "n.b"]);
  });
});

describe("aiPromptBlocks（画布节点与快捷新建共用的「AI 加工」可选提示词）", () => {
  it("两处下拉是同一份列表：已过审核的 6 个通用提示词，顺序稳定", () => {
    expect(aiPromptBlocks([], true).map((block) => block.id)).toEqual([
      "builtin.insight",
      "builtin.insight.v4",
      "builtin.insight.v5",
      "builtin.insight.v6",
      "builtin.qa",
      "builtin.trace.v3",
    ]);
  });

  it("由专属节点承载的提示词（阴阳师攻略 / 练一练）不属于「AI 加工」，一次也不出现", () => {
    const ids = aiPromptBlocks([], true).map((block) => block.id);
    for (const id of ["builtin.gameguide", "builtin.gameguide.v2", "builtin.drill"]) expect(ids).not.toContain(id);
    // 反过来也成立：列表里没有任何标了 requiresNode 的提示词
    expect(aiPromptBlocks([], true).every((block) => !block.requiresNode)).toBe(true);
  });

  it("自定义提示词追加在内置提示词之后，且不受审核白名单约束", () => {
    const custom = { id: "custom.1", name: "我的块", prompt: "x", builtin: false };
    const blocks = aiPromptBlocks([custom], true);
    expect(blocks.at(-1)).toBe(custom);
    expect(blocks.length).toBe(aiPromptBlocks([], true).length + 1);
  });

  it("没配检索密钥时不列出需要联网核查的提示词", () => {
    expect(aiPromptBlocks([], false).every((block) => block.externalCheck !== "required")).toBe(true);
  });
});

describe("系列 / 成员 / 版本（两级身份 + 一个迭代号）", () => {
  it("同一个 (系列, 成员) 里版本号不重复：重复会让「当前版本」取到哪一条变成看数组顺序", () => {
    const seen = new Map<string, string[]>();
    for (const block of BUILTIN_PROMPT_BLOCKS) {
      const key = `${blockSeriesName(block)}|${block.name}`;
      seen.set(key, [...(seen.get(key) ?? []), block.version ?? "v1"]);
    }
    for (const [key, versions] of seen) expect(new Set(versions).size, key).toBe(versions.length);
  });

  it("一个系列里至多一个推荐位：推荐是「这个系列该先用哪个」的单一答案", () => {
    const counts = new Map<string, number>();
    for (const block of BUILTIN_PROMPT_BLOCKS) {
      if (!block.recommended) continue;
      const series = blockSeriesName(block);
      counts.set(series, (counts.get(series) ?? 0) + 1);
    }
    for (const [series, count] of counts) expect(count, series).toBe(1);
  });

  it("variantTitle：只有系列与成员名不同才加前缀（单成员系列不该出现「观点速读 · 观点速读」）", () => {
    const byId = (id: string) => BUILTIN_PROMPT_BLOCKS.find((block) => block.id === id)!;
    expect(variantTitle(byId("builtin.insight.v4"))).toBe("观点提炼 · 成文版");
    expect(variantTitle(byId("builtin.action"))).toBe("行动项清单");
    expect(variantTitle({ id: "c", name: "会议纪要提炼", prompt: "x", builtin: false })).toBe("会议纪要提炼");
  });

  it("compareVersion：v10 大于 v9（不能按字符串比，否则 v10 排在 v9 前面）", () => {
    expect(compareVersion("v10", "v9")).toBeGreaterThan(0);
    expect(compareVersion(undefined, "v1")).toBe(0);
    expect(compareVersion("v2", "v1")).toBeGreaterThan(0);
  });

  it("currentPromptBlock：有推荐用推荐，没有取版本号最大的", () => {
    const v1 = { id: "a1", name: "A", prompt: "x", builtin: true, version: "v1" };
    const v2 = { id: "a2", name: "A", prompt: "x", builtin: true, version: "v2" };
    const v10 = { id: "a10", name: "A", prompt: "x", builtin: true, version: "v10" };
    expect(currentPromptBlock([v1, v2, v10])?.id).toBe("a10");
    expect(currentPromptBlock([{ ...v1, recommended: true }, v2, v10])?.id).toBe("a1");
  });

  it("groupPromptBlocks：成员折叠到当前版本、单成员与自定义各自成组、顺序沿用传入顺序", () => {
    const groups = groupPromptBlocks([...BUILTIN_PROMPT_BLOCKS, { id: "custom.1", name: "我的块", prompt: "x", builtin: false }]);
    // 6 条观点提炼的块折成 5 个成员：详尽版的 v1 收进它自己那条版本线
    const insight = groups.find((group) => group.series === "观点提炼")!;
    expect(insight.members.map((block) => block.name)).toEqual(["详尽版", "逐段核对", "成文版", "连贯版", "速览版"]);
    // 详尽版没有推荐位，当前代靠「版本号最大」取到不带 version 后缀的那条（v2）
    expect(insight.members[0]?.id).toBe("builtin.insight");
    // 单成员系列照样成组，只有一个成员——由调用方决定要不要渲染分组标题
    expect(groups.find((group) => group.series === "行动项清单")?.members.map((block) => block.id)).toEqual(["builtin.action"]);
    // 自定义提示词没写 series，归到「自定义」一组
    expect(groups.find((group) => group.series === "自定义")?.members.map((block) => block.id)).toEqual(["custom.1"]);
    // 分组顺序 = 第一次出现的顺序，不排序
    expect(groups[0]?.series).toBe("观点提炼");
  });

  it("promptBlockVersions：只看同一个 (系列, 成员)，按版本从新到旧", () => {
    const current = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight")!;
    expect(promptBlockVersions(BUILTIN_PROMPT_BLOCKS, current).map((block) => block.id)).toEqual(["builtin.insight", "builtin.insight.v1"]);
    // 别的成员只有一代
    const other = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight.v4")!;
    expect(promptBlockVersions(BUILTIN_PROMPT_BLOCKS, other).map((block) => block.id)).toEqual(["builtin.insight.v4"]);
  });

  it("isTraceBlock：只认「信息溯源」系列（结果页靠它把溯源报告从普通笔记里分流）", () => {
    const byId = (id: string) => BUILTIN_PROMPT_BLOCKS.find((block) => block.id === id)!;
    expect(isTraceBlock(byId("builtin.trace"))).toBe(true);
    expect(isTraceBlock(byId("builtin.trace.v3"))).toBe(true);
    expect(isTraceBlock(byId("builtin.insight"))).toBe(false);
    // 自定义提示词没有 series：名字碰巧叫「信息溯源」也不能误判
    expect(isTraceBlock({ id: "c", name: "信息溯源", prompt: "x", builtin: false })).toBe(false);
  });
});
