import { describe, expect, it } from "vitest";
import type { RunNodeInput, RunNodeResult, WorkflowGraph } from "@scribe-flow/shared";
import { buildCompareOptions, pickDefaultComparePair } from "./run-compare";

const RUN_ID = "run_test";

function inputRow(partial: Partial<RunNodeInput> & Pick<RunNodeInput, "id" | "targetNodeId" | "sourceNodeId" | "position">): RunNodeInput {
  return { runId: RUN_ID, kind: "text", createdAt: 0, ...partial };
}

function done(nodeId: string, nodeType: string, text: string, label?: string): RunNodeResult {
  return { nodeId, nodeType, nodeLabel: label, status: "done", elapsedMs: 0, output: { kind: "noteBlock", text } };
}

describe("buildCompareOptions", () => {
  it("只收「跑完 + 有正文」的产物，失败的、空的不进列表", () => {
    const options = buildCompareOptions(
      [
        done("n_a", "process.prompt", "加工 A 的内容", "AI 加工 A"),
        { nodeId: "n_b", nodeType: "process.prompt", nodeLabel: "AI 加工 B", status: "error", elapsedMs: 0 },
        done("n_c", "process.prompt", "   ", "AI 加工 C"),
      ],
      [],
    );
    expect(options.map((option) => option.key)).toEqual(["n_a"]);
    expect(options[0].label).toBe("AI 加工 A");
  });

  it("结构化产物（练一练练习集 / 溯源报告）不进对照列表：正文是 JSON，逐行比只有字段噪音", () => {
    const options = buildCompareOptions(
      [
        done("n_drill", "process.drill", '{"kind":"drillSet","title":"练一练","points":[]}'),
        done("n_trace", "process.prompt", '{"schema":1,"items":[{"id":"item-1"}]}'),
        done("n_note", "process.prompt", "# 正常笔记"),
      ],
      [],
    );
    expect(options.map((option) => option.key)).toEqual(["n_note"]);
  });

  it("多素材链路按段展开：同一个节点的 8 份结果变成 8 个可对照项", () => {
    const nodes = [done("n_asr", "process.transcribe", "合并后的全文（不参与逐段）", "转写")];
    const rows = [
      inputRow({ id: "i0", targetNodeId: "n_asr", sourceNodeId: "n_src", position: 0, text: "第一段" }),
      inputRow({ id: "i1", targetNodeId: "n_asr", sourceNodeId: "n_src", position: 1, text: "第二段" }),
    ];
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "" } },
        { id: "n_asr", type: "process.transcribe", position: { x: 1, y: 0 }, data: { label: "转写" } },
      ],
      edges: [{ id: "e1", source: "n_src", target: "n_asr" }],
    };
    const options = buildCompareOptions(nodes, rows, graph);
    expect(options.map((option) => option.key)).toEqual(["n_asr#0", "n_asr#1"]);
    expect(options[0].text).toBe("第一段");
    expect(options[0].label.startsWith("转写 · 1.")).toBe(true);
  });
});

describe("pickDefaultComparePair", () => {
  const option = (key: string, nodeType: string, nodeId = key) => ({ key, nodeId, nodeType, label: key, text: "" });

  it("默认比最深的一组并行分支：两条 AI 加工互相对照", () => {
    const pair = pickDefaultComparePair([
      option("asr", "process.transcribe"),
      option("refine", "process.refine"),
      option("a", "process.prompt", "n_a"),
      option("b", "process.prompt", "n_b"),
    ]);
    expect(pair).toEqual({ leftKey: "a", rightKey: "b" });
  });

  it("多素材场景取「同一条素材的两套加工」，而不是同一个节点的两段", () => {
    const pair = pickDefaultComparePair([
      option("asr0", "process.transcribe", "n_asr"),
      option("asr1", "process.transcribe", "n_asr"),
      option("a0", "process.prompt", "n_a"),
      option("a1", "process.prompt", "n_a"),
      option("a2", "process.prompt", "n_a"),
      option("b0", "process.prompt", "n_b"),
      option("b1", "process.prompt", "n_b"),
      option("b2", "process.prompt", "n_b"),
    ]);
    expect(pair).toEqual({ leftKey: "a0", rightKey: "b0" });
  });

  it("没有相邻的同类型节点时退回最后两份，覆盖「链路上游 vs 下游」的天然对照", () => {
    const pair = pickDefaultComparePair([option("src", "source.text"), option("merge", "process.merge")]);
    expect(pair).toEqual({ leftKey: "src", rightKey: "merge" });
  });

  it("不足两份时不报错", () => {
    expect(pickDefaultComparePair([])).toEqual({ leftKey: "", rightKey: "" });
    expect(pickDefaultComparePair([option("only", "process.prompt")])).toEqual({ leftKey: "only", rightKey: "" });
  });
});
