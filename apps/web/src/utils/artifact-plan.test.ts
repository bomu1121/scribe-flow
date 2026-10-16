import { describe, expect, it } from "vitest";
import { BUILTIN_PROMPT_BLOCKS, type PromptBlock } from "@scribe-flow/shared";
import { buildOutletPlan } from "./artifact-plan";

/**
 * 出口卡预告的口径。这里钉的是**判断**（几篇、哪几类、会不会互链），
 * 卡片上怎么排版由 CDP 在真机上量（见 docs/research/trace-artifact-visibility-research.md）。
 */

const blocks: PromptBlock[] = [
  ...BUILTIN_PROMPT_BLOCKS,
  { id: "custom.1", name: "我的写法", prompt: "x", builtin: false },
];

const prompt = (id: string, blockId: string) => ({ id, type: "process.prompt", data: { promptBlockId: blockId } });
const node = (id: string, type: string) => ({ id, type, data: {} });

/** 一条常见链路：来源 → 转写 → 校对 → 两张 AI 加工 → 出口卡。 */
function graph() {
  return {
    nodes: [
      node("n_src", "source.bili"),
      node("n_tr", "process.transcribe"),
      node("n_rf", "process.refine"),
      prompt("n_note", "builtin.insight.v6"),
      prompt("n_trace", "builtin.trace.v3"),
      node("n_ob", "process.obsidian"),
    ],
    edges: [
      { source: "n_src", target: "n_tr" },
      { source: "n_tr", target: "n_rf" },
      { source: "n_rf", target: "n_note" },
      { source: "n_rf", target: "n_trace" },
      { source: "n_note", target: "n_ob" },
      { source: "n_trace", target: "n_ob" },
    ],
  };
}

const plan = (over: Partial<Parameters<typeof buildOutletPlan>[0]> = {}) =>
  buildOutletPlan({ nodeId: "n_ob", blocks, ...graph(), ...over });

describe("buildOutletPlan", () => {
  it("写点什么都不知道时返回 undefined，而不是给一张假预告", () => {
    expect(buildOutletPlan({ nodeId: "n_ob", blocks, nodes: [node("n_ob", "process.obsidian")], edges: [] })).toBeUndefined();
    // 有一条连进来、但那个节点不在图里（边是脏数据）也要能算：按缺省类别报，不抛错
    expect(
      buildOutletPlan({ nodeId: "n_ob", blocks, nodes: [node("n_ob", "process.obsidian")], edges: [{ source: "n_x", target: "n_ob" }] }),
    ).toMatchObject({ count: 1, pieces: [{ kinds: ["note"] }] });
  });

  it("笔记 + 溯源报告两份直连：两篇、两类、会互链", () => {
    const result = plan()!;
    expect(result.count).toBe(2);
    expect(result.perPiece).toBe(true);
    expect(result.pieces.map((piece) => [piece.kinds, piece.blockName])).toEqual([
      [["note"], "速览版"],
      [["trace-report"], "上网查证"],
    ]);
    expect(result.interlink).toBe(true);
  });

  it("关掉「每个输入一篇」时合成一篇，且不再互链——合成稿没有单一类别可写进 front matter", () => {
    const result = plan({ splitByInput: false })!;
    expect(result.count).toBe(1);
    expect(result.perPiece).toBe(false);
    // 两份产物各自的类别仍然照报：用户要知道这一篇里混着什么
    expect(result.pieces.map((piece) => piece.kinds)).toEqual([["note"], ["trace-report"]]);
    expect(result.interlink).toBe(false);
  });

  it("中间夹一个合并节点：只剩一份输入、却带着两类（合并节点自己声明不了产物）", () => {
    const base = graph();
    const result = buildOutletPlan({
      nodeId: "n_ob",
      blocks,
      nodes: [...base.nodes, node("n_mg", "process.merge")],
      edges: [
        ...base.edges.filter((edge) => edge.target !== "n_ob"),
        { source: "n_note", target: "n_mg" },
        { source: "n_trace", target: "n_mg" },
        { source: "n_mg", target: "n_ob" },
      ],
    })!;
    expect(result.count).toBe(1);
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]!.kinds).toEqual(["note", "trace-report"]);
    // 上游挂着两个做法，名字说不准就不说
    expect(result.pieces[0]!.blockName).toBeUndefined();
    expect(result.interlink).toBe(false);
  });

  it("两个视频各出笔记与报告、接进同一张卡：各自有报告，但不是同源，不互链", () => {
    const result = buildOutletPlan({
      nodeId: "n_ob",
      blocks,
      nodes: [
        node("n_srcA", "source.bili"),
        node("n_trA", "process.transcribe"),
        prompt("n_noteA", "builtin.insight.v6"),
        node("n_srcB", "source.bili"),
        node("n_trB", "process.transcribe"),
        prompt("n_traceB", "builtin.trace.v3"),
        node("n_ob", "process.obsidian"),
      ],
      edges: [
        { source: "n_srcA", target: "n_trA" },
        { source: "n_trA", target: "n_noteA" },
        { source: "n_noteA", target: "n_ob" },
        { source: "n_srcB", target: "n_trB" },
        { source: "n_trB", target: "n_traceB" },
        { source: "n_traceB", target: "n_ob" },
      ],
    })!;
    expect(result.count).toBe(2);
    expect(result.interlink).toBe(false);
  });

  it("上游不是 AI 加工（转写直连）按普通笔记算；自定义提示词没声明也是笔记", () => {
    const plain = buildOutletPlan({
      nodeId: "n_ob",
      blocks,
      nodes: [node("n_tr", "process.transcribe"), node("n_ob", "process.obsidian")],
      edges: [{ source: "n_tr", target: "n_ob" }],
    })!;
    expect(plain.pieces[0]).toMatchObject({ kinds: ["note"] });
    expect(plain.pieces[0]!.blockName).toBeUndefined();

    const custom = buildOutletPlan({
      nodeId: "n_ob",
      blocks,
      nodes: [prompt("n_p", "custom.1"), node("n_ob", "process.obsidian")],
      edges: [{ source: "n_p", target: "n_ob" }],
    })!;
    expect(custom.pieces[0]).toMatchObject({ kinds: ["note"], blockName: "我的写法" });
  });
});
