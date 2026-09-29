import { describe, expect, it } from "vitest";
import { isNodeHidden, hiddenNodesInTemplate, nodeTypeLabel, visibleTemplates, NODE_TYPE_ORDER } from "./visibility";
import { NODE_TYPE_LABELS } from "./graph";
import { BUILTIN_PROMPT_BLOCKS, availablePromptBlocks } from "./prompt";
import { WORKFLOW_TEMPLATES } from "./templates";

/**
 * 展示范围（设置页「收起哪些节点」）的规则：只影响新建时的可选项，
 * 而且链路与提示词块要跟着各自的节点一起收起来——四处入口共用这一份判定。
 */

describe("NODE_TYPE_ORDER", () => {
  it("覆盖全部节点类型，且不重复（设置页的开关列表照它渲染）", () => {
    const all = Object.keys(NODE_TYPE_LABELS);
    expect([...NODE_TYPE_ORDER].sort()).toEqual([...all].sort());
    expect(new Set(NODE_TYPE_ORDER).size).toBe(NODE_TYPE_ORDER.length);
    for (const type of NODE_TYPE_ORDER) expect(nodeTypeLabel(type)).toBe(NODE_TYPE_LABELS[type]);
  });
});

describe("isNodeHidden", () => {
  it("没设置或空数组时什么都不隐藏", () => {
    expect(isNodeHidden(undefined, "process.gameguide")).toBe(false);
    expect(isNodeHidden([], "process.gameguide")).toBe(false);
  });

  it("只在列表里的类型算隐藏", () => {
    expect(isNodeHidden(["process.gameguide"], "process.gameguide")).toBe(true);
    expect(isNodeHidden(["process.gameguide"], "process.prompt")).toBe(false);
  });
});

describe("hiddenNodesInTemplate", () => {
  const guide = WORKFLOW_TEMPLATES.find((t) => t.id === "template.gameguide")!;
  const single = WORKFLOW_TEMPLATES.find((t) => t.id === "template.single-note")!;

  it("链路用到的节点被收起时，报出是哪个节点", () => {
    expect(hiddenNodesInTemplate(guide, ["process.gameguide"])).toEqual(["process.gameguide"]);
    // 阴阳师链路里的校对节点仍在，所以只报那一个节点，不漏不重。
    expect(hiddenNodesInTemplate(guide, ["process.refine"])).toEqual(["process.refine"]);
  });

  it("来源轴补出来的来源与转写节点也算数：隐藏「B站链接」时视频链路一起收起", () => {
    // 单线笔记的 stages 里没有来源节点，但它默认从 B 站进——隐藏来源类型时这条链路同样不该出现。
    expect(hiddenNodesInTemplate(single, ["source.bili"])).toEqual(["source.bili"]);
    expect(hiddenNodesInTemplate(single, ["process.transcribe"])).toEqual(["process.transcribe"]);
    // 文稿来源的链路不受「B站链接」影响。
    expect(hiddenNodesInTemplate(single, ["source.bili"]).length).toBeGreaterThan(0);
    expect(hiddenNodesInTemplate({ ...single, sources: ["text"] }, ["source.bili"])).toEqual([]);
  });

  it("没隐藏时一律为空", () => {
    expect(hiddenNodesInTemplate(guide, [])).toEqual([]);
    expect(hiddenNodesInTemplate(guide, undefined)).toEqual([]);
  });
});

describe("visibleTemplates", () => {
  it("默认（什么都没隐藏）返回全部链路", () => {
    expect(visibleTemplates([])).toHaveLength(WORKFLOW_TEMPLATES.length);
    expect(visibleTemplates(undefined)).toHaveLength(WORKFLOW_TEMPLATES.length);
  });

  it("隐藏阴阳师攻略节点后，只少掉那一条垂直链路", () => {
    const visible = visibleTemplates(["process.gameguide"]);
    expect(visible.map((t) => t.id)).not.toContain("template.gameguide");
    expect(visible).toHaveLength(WORKFLOW_TEMPLATES.length - 1);
  });

  it("隐藏通用加工节点会连带收起所有用到它的链路（这是规则，不是副作用）", () => {
    const visible = visibleTemplates(["process.refine"]);
    const usedRefine = WORKFLOW_TEMPLATES.filter((t) => t.stages.some((stage) => stage.type === "process.refine"));
    expect(usedRefine.length).toBeGreaterThan(0);
    for (const template of usedRefine) expect(visible.map((t) => t.id)).not.toContain(template.id);
  });
});

describe("availablePromptBlocks 与展示范围", () => {
  it("承载块的节点被收起时，它的块不再出现；通用块不受影响", () => {
    const visible = availablePromptBlocks(BUILTIN_PROMPT_BLOCKS, true, ["process.gameguide", "process.drill"]);
    const ids = visible.map((block) => block.id);
    expect(ids).not.toContain("builtin.gameguide");
    expect(ids).not.toContain("builtin.gameguide.v2");
    expect(ids).not.toContain("builtin.drill");
    expect(ids).toContain("builtin.insight.v4");
  });

  it("不传展示范围时行为与从前一致（老调用方不受影响）", () => {
    const before = availablePromptBlocks(BUILTIN_PROMPT_BLOCKS, true);
    expect(before).toHaveLength(BUILTIN_PROMPT_BLOCKS.length);
    // 检索密钥没配时仍然只滤掉「必须有联网核查」的块。
    expect(availablePromptBlocks(BUILTIN_PROMPT_BLOCKS, false).map((b) => b.id)).not.toContain("builtin.trace.v3");
  });
});
