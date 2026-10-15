import { describe, expect, it } from "vitest";
import { collectMaterialOptions, collectSegmentOptions } from "./segment";
import type { WorkflowGraph } from "./graph";

type GNode = WorkflowGraph["nodes"][number];
type GEdge = WorkflowGraph["edges"][number];

const biliGraph = (bvid: string, extraNodes: GNode[] = [], extraEdges: GEdge[] = []): WorkflowGraph => ({
  schemaVersion: 1 as const,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "n_src",
      type: "source.bili",
      position: { x: 0, y: 0 },
      data: { url: `https://www.bilibili.com/video/${bvid}`, bvid, page: 1, title: "测试视频" },
    },
    { id: "n_asr", type: "process.transcribe", position: { x: 200, y: 0 }, data: {} },
    { id: "n_refine", type: "process.refine", position: { x: 400, y: 0 }, data: {} },
    { id: "n_trace", type: "process.prompt", position: { x: 600, y: 0 }, data: { promptBlockId: "builtin.trace.v3" } },
    ...extraNodes,
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_asr", sourceHandle: "audio", targetHandle: "audio" },
    { id: "e2", source: "n_asr", target: "n_refine", sourceHandle: "transcript", targetHandle: "transcript" },
    { id: "e3", source: "n_refine", target: "n_trace", sourceHandle: "transcript", targetHandle: "transcript" },
    ...extraEdges,
  ],
});

describe("collectMaterialOptions（身份判断用，不是给选择器用的）", () => {
  it("单素材工程也返回身份——这正是它必须与 collectSegmentOptions 分开的原因", () => {
    const graph = biliGraph("BV1DTWw6UE1y");
    // 选择器用的那个：一个素材时没有挑选余地，返回空
    expect(collectSegmentOptions(graph, "n_trace")).toHaveLength(0);
    // 身份判断用的这个：必须给出真实身份，否则「素材没变」会被算成「素材变了」
    const options = collectMaterialOptions(graph, "n_trace");
    expect(options.map((option) => option.key)).toEqual(["bvid:BV1DTWw6UE1y:1"]);
  });

  it("换了来源卡的视频，身份随之改变（这就是能被检测出来的原因）", () => {
    const before = collectMaterialOptions(biliGraph("BV1DTWw6UE1y"), "n_trace").map((option) => option.key);
    const after = collectMaterialOptions(biliGraph("BV19JhW6vExZ"), "n_trace").map((option) => option.key);
    expect(before).toEqual(["bvid:BV1DTWw6UE1y:1"]);
    expect(after).toEqual(["bvid:BV19JhW6vExZ:1"]);
    expect(before).not.toEqual(after);
  });

  it("中间模块不承载素材，沿入边一路追到来源卡", () => {
    const graph = biliGraph("BV1DTWw6UE1y");
    for (const nodeId of ["n_asr", "n_refine", "n_trace"]) {
      expect(collectMaterialOptions(graph, nodeId).map((option) => option.key), nodeId).toEqual(["bvid:BV1DTWw6UE1y:1"]);
    }
  });

  it("多选卡（items）逐个列出，身份各自独立", () => {
    const graph = biliGraph("BV1DTWw6UE1y");
    (graph.nodes[0].data as Record<string, unknown>).items = [
      { bvid: "BV1aa411c7mD", page: 1, cid: 111, title: "第一集" },
      { bvid: "BV1bb411c7mD", page: 2, cid: 222, title: "第二集" },
    ];
    expect(collectMaterialOptions(graph, "n_trace").map((option) => option.key)).toEqual([
      "bvid:BV1aa411c7mD:1",
      "bvid:BV1bb411c7mD:2",
    ]);
  });

  it("压平型节点（合并）上游的身份照样追得到——「素材集合变了」这件事仍然成立", () => {
    const graph = biliGraph("BV1DTWw6UE1y", [
      { id: "n_merge", type: "process.merge", position: { x: 800, y: 0 }, data: {} },
    ], [{ id: "e4", source: "n_trace", target: "n_merge", sourceHandle: "noteBlock", targetHandle: "noteBlock" }]);
    // 合并会压平上游，产物与某一段素材之间没有一一对应关系（想按段分流必须拦在压平之前）。
    // 但它消费的还是这些素材，所以「素材集合变了」仍然可用于判断产物是否陈旧。
    expect(collectMaterialOptions(graph, "n_merge").map((option) => option.key)).toEqual(["bvid:BV1DTWw6UE1y:1"]);
    // 换成另一个视频后，同一节点的身份跟着变
    const swapped = biliGraph("BV19JhW6vExZ", [
      { id: "n_merge", type: "process.merge", position: { x: 800, y: 0 }, data: {} },
    ], [{ id: "e4", source: "n_trace", target: "n_merge", sourceHandle: "noteBlock", targetHandle: "noteBlock" }]);
    expect(collectMaterialOptions(swapped, "n_merge").map((option) => option.key)).toEqual(["bvid:BV19JhW6vExZ:1"]);
  });

  it("来源卡被删或没有可识别的素材时，算不出身份（调用方据此放行，不误拦）", () => {
    const graph = biliGraph("BV1DTWw6UE1y");
    (graph.nodes[0].data as Record<string, unknown>).bvid = "";
    (graph.nodes[0].data as Record<string, unknown>).url = "";
    expect(collectMaterialOptions(graph, "n_trace")).toHaveLength(0);
  });

  it("文本卡的标识来自节点 id（改文稿内容不会改标识——这是已知边界）", () => {
    const textGraph = (text: string): WorkflowGraph => ({
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "n_text", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text } },
        { id: "n_out", type: "process.output", position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [{ id: "e1", source: "n_text", target: "n_out", sourceHandle: "transcript", targetHandle: "transcript" }],
    });
    const keys = (text: string) => collectMaterialOptions(textGraph(text), "n_out").map((option) => option.key);
    expect(keys("甲")).toEqual(["node:n_text"]);
    // 改内容 → 标识不变（所以「改了文稿」这一类陈旧不归这个机制管，见 lib/material-staleness.ts 的边界说明）
    expect(keys("乙")).toEqual(["node:n_text"]);
  });
});
