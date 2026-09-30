import { describe, expect, it } from "vitest";
import { buildTemplateGraph, parseGraph, type GraphNode, type SourceVideoItem, type WorkflowGraph } from "@scribe-flow/shared";
import { applyBiliVideos, biliSourceData } from "./bili-source";

/**
 * 这几条断言守的是「勾选视频 → 来源节点数据」这一层：
 * 形状写歪不会报错，只会在运行时少一个 cid、少一段产物，所以把它钉在测试里。
 */

type BiliNode = Extract<GraphNode, { type: "source.bili" }>;

function biliNodeOf(graph: WorkflowGraph): BiliNode | undefined {
  return graph.nodes.find((node) => node.type === "source.bili") as BiliNode | undefined;
}

function video(overrides: Partial<SourceVideoItem> = {}): SourceVideoItem {
  return {
    bvid: "BV1xx411c7mD",
    title: "记忆系统是怎么做取舍的",
    cover: "https://i0.hdslb.com/bfs/archive/cover.jpg",
    uploader: "某 UP 主",
    duration: 742,
    pageCount: 1,
    ...overrides,
  };
}

/** 单线笔记链路（来源=bili）：图里已经有一个空的 B 站来源节点。 */
function templateGraph(): WorkflowGraph {
  const graph = buildTemplateGraph("template.single-note", { source: "bili" });
  if (!graph) throw new Error("模板构建失败，测试前置条件不成立");
  return graph;
}

describe("biliSourceData", () => {
  it("单个视频写成普通来源卡片：URL、元信息与第一个带 cid 的分 P", () => {
    const data = biliSourceData([
      video({
        pages: [
          { cid: 0, page: 1, part: "P1", duration: 300 },
          { cid: 12345, page: 2, part: "P2", duration: 442 },
        ],
      }),
    ]);

    expect(data.url).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(data.bvid).toBe("BV1xx411c7mD");
    expect(data.title).toBe("记忆系统是怎么做取舍的");
    expect(data.uploader).toBe("某 UP 主");
    expect(data.pageInfo).toEqual({ cid: 12345, page: 2, part: "P2", duration: 442 });
    // 单个视频不该变成多选卡片：多选卡片会走另一套下游渲染。
    expect(data.items).toBeUndefined();
  });

  it("没有分 P 也没有 cid 时只写链接与元信息，不编一个假 cid", () => {
    const data = biliSourceData([video({ pages: [{ cid: 0, page: 1, part: "正片", duration: 742 }] })]);

    expect(data.pageInfo).toBeUndefined();
    expect(data.bvid).toBe("BV1xx411c7mD");
  });

  it("多个视频合并成一张多选卡片：逐项都在，卡片自身的单值字段取第一个", () => {
    const second = video({ bvid: "BV1yy411c7mE", title: "第二期", duration: 100 });
    const data = biliSourceData([video({ cid: 999 }), second], "B站收藏");
    const items = data.items ?? [];

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.bvid)).toEqual(["BV1xx411c7mD", "BV1yy411c7mE"]);
    expect(items[0]).toMatchObject({ cid: 999, page: 1, part: "" });
    expect(data.label).toBe("B站收藏");
    expect(data.url).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(data.bvid).toBe("BV1xx411c7mD");
    expect(data.pageInfo).toEqual({ cid: 999, page: 1, part: "", duration: 742 });
  });
});

describe("applyBiliVideos", () => {
  it("填进图里已有的来源节点：节点数、节点 id 与连线都不动，只换数据", () => {
    const graph = templateGraph();
    const sourceNode = biliNodeOf(graph);
    expect(sourceNode?.data.url).toBe("");

    const next = applyBiliVideos(graph, [video({ cid: 999 })], "B站收藏");
    const patched = biliNodeOf(next);

    expect(next.nodes).toHaveLength(graph.nodes.length);
    expect(next.edges).toEqual(graph.edges);
    expect(patched?.id).toBe(sourceNode?.id);
    expect(patched?.data.bvid).toBe("BV1xx411c7mD");
    expect(patched?.data.url).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
    // 原图是撤销栈里的快照，不能被就地改掉。
    expect(sourceNode?.data.url).toBe("");
  });

  it("多个视频走多选卡片，一张卡片承载全部勾选项", () => {
    const next = applyBiliVideos(templateGraph(), [video({ cid: 1 }), video({ bvid: "BV1yy411c7mE", cid: 2 })], "B站收藏");
    const patched = biliNodeOf(next);
    const items = patched?.data.items as Array<{ bvid: string }>;

    expect(items.map((item) => item.bvid)).toEqual(["BV1xx411c7mD", "BV1yy411c7mE"]);
    expect(patched?.data.label).toBe("B站收藏");
  });

  it("图里没有 B 站来源节点（空白画布）时补一个", () => {
    const empty: WorkflowGraph = { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const next = applyBiliVideos(empty, [video({ cid: 999 })]);

    expect(next.nodes).toHaveLength(1);
    expect(biliNodeOf(next)?.data.bvid).toBe("BV1xx411c7mD");
    expect(empty.nodes).toHaveLength(0);
  });

  it("一个视频都没勾时不改图", () => {
    const graph = templateGraph();
    expect(applyBiliVideos(graph, [])).toBe(graph);
  });

  it("填好的图能过工程图校验", () => {
    // 建工程走的是导入接口，它拿 parseGraph 校验整张图；来源节点的数据形状写歪会在这里被拒。
    const single = applyBiliVideos(templateGraph(), [video({ cid: 999 })]);
    const multi = applyBiliVideos(templateGraph(), [video({ cid: 1 }), video({ bvid: "BV1yy411c7mE", cid: 2 })], "B站收藏");

    expect(() => parseGraph(single)).not.toThrow();
    expect(() => parseGraph(multi)).not.toThrow();
  });
});
