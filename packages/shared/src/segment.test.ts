import { describe, expect, it } from "vitest";
import { parseGraph } from "./schema";
import { collectSegmentOptions, groupSegmentOptions, stalePickKeys } from "./segment";

/**
 * 素材挑选的「连接时识别」。
 * 用例按真实工程形状搭：用户的原话是「一个校对模块处理了八个输入」，
 * 所以重点是「能不能穿过中间模块识别到上游素材」。
 */

/** 一张多选 B 站来源卡（count 个素材）。 */
function biliCard(count: number) {
  return {
    id: "n_src",
    type: "source.bili" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "合集",
      url: "",
      items: Array.from({ length: count }, (_, i) => ({
        bvid: `BV1x${i + 1}`,
        cid: 100 + i,
        page: 1,
        part: "P1",
        title: `合集第 ${i + 1} 集`,
        duration: 300 + i,
      })),
    },
  };
}

const asrNode = { id: "n_asr", type: "process.transcribe" as const, position: { x: 300, y: 0 }, data: {} };
const refineNode = { id: "n_refine", type: "process.refine" as const, position: { x: 600, y: 0 }, data: {} };
const mergeNode = { id: "n_merge", type: "process.merge" as const, position: { x: 600, y: 0 }, data: {} };
const pickNode = { id: "n_pick", type: "flow.pick" as const, position: { x: 900, y: 0 }, data: {} };

const edge = (id: string, source: string, target: string, from: string, to: string) => ({ id, source, target, sourceHandle: from, targetHandle: to });

function graphOf(nodes: unknown[], edges: unknown[]) {
  return parseGraph({ schemaVersion: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } });
}

describe("挑选节点：识别上游集合", () => {
  it("接在多选来源卡后：列出卡内 8 个素材", () => {
    const graph = graphOf([biliCard(8), pickNode], [edge("e1", "n_src", "n_pick", "audio", "in")]);
    const options = collectSegmentOptions(graph, "n_pick");
    expect(options.length).toBe(8);
    expect(options[0].key).toBe("bvid:BV1x1:1");
    expect(options[0].title).toBe("合集第 1 集");
    expect(options[0].originNodeId).toBe("n_src");
  });

  it("接在「一个输入一份结果」的中间模块后：穿过转写与校对，仍识别到 8 个素材", () => {
    const graph = graphOf(
      [biliCard(8), asrNode, refineNode, pickNode],
      [
        edge("e1", "n_src", "n_asr", "audio", "audio"),
        edge("e2", "n_asr", "n_refine", "transcript", "transcript"),
        edge("e3", "n_refine", "n_pick", "transcript", "in"),
      ],
    );
    const options = collectSegmentOptions(graph, "n_pick");
    expect(options.length).toBe(8);
    expect(options.map((o) => o.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const groups = groupSegmentOptions(options);
    expect(groups).toHaveLength(1);
    expect(groups[0].originLabel).toBe("合集");
  });

  it("上游只有一份素材时没有可挑余地（不展示选择器）", () => {
    const graph = graphOf(
      [biliCard(1), asrNode, pickNode],
      [edge("e1", "n_src", "n_asr", "audio", "audio"), edge("e2", "n_asr", "n_pick", "transcript", "in")],
    );
    expect(collectSegmentOptions(graph, "n_pick")).toEqual([]);
  });

  it("多张来源卡汇入同一模块：列出全部卡的素材", () => {
    const graph = graphOf(
      [
        { id: "n_a", type: "source.text" as const, position: { x: 0, y: 0 }, data: { label: "甲稿", text: "甲" } },
        { id: "n_b", type: "source.text" as const, position: { x: 0, y: 100 }, data: { label: "乙稿", text: "乙" } },
        refineNode,
        pickNode,
      ],
      [
        edge("e1", "n_a", "n_refine", "transcript", "transcript"),
        edge("e2", "n_b", "n_refine", "transcript", "transcript"),
        edge("e3", "n_refine", "n_pick", "transcript", "in"),
      ],
    );
    expect(collectSegmentOptions(graph, "n_pick").map((o) => o.key)).toEqual(["node:n_a", "node:n_b"]);
  });

  it("压平型节点之后仍能找到它各入边上的素材（「只让第一份进合并」讲得通）", () => {
    const graph = graphOf(
      [biliCard(8), asrNode, mergeNode, pickNode],
      [
        edge("e1", "n_src", "n_asr", "audio", "audio"),
        edge("e2", "n_asr", "n_merge", "transcript", "noteBlock"),
        edge("e3", "n_merge", "n_pick", "noteDoc", "in"),
      ],
    );
    // 继续往上游追到来源卡：8 个素材仍可挑（引擎按入边过滤，语义成立）
    expect(collectSegmentOptions(graph, "n_pick").length).toBe(8);
    expect(collectSegmentOptions(graph, "n_merge").length).toBe(8);
  });

  it("失效的选择键会被点名，有效的不会", () => {
    const graph = graphOf([biliCard(8), pickNode], [edge("e1", "n_src", "n_pick", "audio", "in")]);
    const options = collectSegmentOptions(graph, "n_pick");
    expect(options.map((o) => o.key)).toContain("bvid:BV1x1:1");
    expect(stalePickKeys(options, { n_src: ["bvid:BV1x1:1"] })).toEqual([]);
    expect(stalePickKeys(options, { n_src: ["bvid:BV1x1:1", "bvid:ZZZ:9"] })).toEqual(["bvid:ZZZ:9"]);
  });
});
