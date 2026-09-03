import { describe, expect, it } from "vitest";
import { canConnect, canConnectSpecs, type PortSpec } from "./port";
import { isValidConnection, NODE_CARD_WIDTH, type GraphNode } from "./graph";
import { WORKFLOW_TEMPLATES } from "./templates";
import { safeParseGraph } from "./schema";

const biliNode: GraphNode = {
  id: "a",
  type: "source.bili",
  position: { x: 0, y: 0 },
  data: { url: "" },
};

const transcribeNode: GraphNode = {
  id: "b",
  type: "process.transcribe",
  position: { x: 0, y: 0 },
  data: {},
};

describe("port", () => {
  it("音频只能进转写，不能进 AI 节点", () => {
    expect(canConnect("audio", "audio")).toBe(true);
    expect(canConnect("audio", "transcript")).toBe(false);
    expect(canConnect("noteBlock", "noteDoc")).toBe(true);
    expect(canConnect("transcript", "transcript")).toBe(true);
  });

  it("多类型端口按交集判断可连", () => {
    const ifOut: PortSpec = { id: "true", type: "transcript", accepts: ["transcript", "noteBlock", "noteDoc"] };
    const textIn: PortSpec = { id: "in", type: "transcript", accepts: ["transcript", "noteBlock", "noteDoc"] };
    const mergeIn: PortSpec = { id: "noteBlock", type: "noteBlock" };
    const outputIn: PortSpec = { id: "noteDoc", type: "noteDoc" };
    expect(canConnectSpecs(ifOut, textIn)).toBe(true);
    expect(canConnectSpecs(ifOut, mergeIn)).toBe(true);
    expect(canConnectSpecs(ifOut, outputIn)).toBe(true);
  });
});

describe("graph", () => {
  it("按端口类型校验连线", () => {
    expect(isValidConnection(biliNode, "audio", transcribeNode, "audio")).toBe(true);
    expect(isValidConnection(biliNode, "audio", transcribeNode, "transcript")).toBe(false);
  });

  it("保留 B 站来源节点的展示元信息", () => {
    const result = safeParseGraph({
      schemaVersion: 1,
      nodes: [
        {
          id: "a",
          type: "source.bili",
          position: { x: 0, y: 0 },
          data: {
            url: "https://www.bilibili.com/video/BV1xx411c7mD",
            bvid: "BV1xx411c7mD",
            title: "示例视频",
            cover: "https://example.com/cover.jpg",
            uploader: "UP 主",
            duration: 120,
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data.nodes[0].data as {
        bvid?: string;
        title?: string;
        cover?: string;
        uploader?: string;
        duration?: number;
      };
      expect(data.bvid).toBe("BV1xx411c7mD");
      expect(data.title).toBe("示例视频");
      expect(data.cover).toBe("https://example.com/cover.jpg");
      expect(data.uploader).toBe("UP 主");
      expect(data.duration).toBe(120);
    }
  });

  it("接受 B 站来源节点的多选 items 字段", () => {
    const result = safeParseGraph({
      schemaVersion: 1,
      nodes: [
        {
          id: "a",
          type: "source.bili",
          position: { x: 0, y: 0 },
          data: {
            url: "https://www.bilibili.com/video/BV1xx411c7mD",
            items: [
              { bvid: "BV1xx411c7mD", cid: 1001, page: 1, part: "P1", title: "示例视频", duration: 120 },
              { bvid: "BV1xx411c7mD", cid: 1002, page: 2, part: "P2", title: "示例视频", duration: 180 },
            ],
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data.nodes[0].data as { items?: { bvid: string; cid: number; page: number; part: string }[] };
      expect(data.items).toHaveLength(2);
      expect(data.items?.[1]?.cid).toBe(1002);
    }
  });

  it("接受 M6 条件分支/文本工具/章节切分节点", () => {
    const result = safeParseGraph({
      schemaVersion: 1,
      nodes: [
        { id: "a", type: "flow.if", position: { x: 0, y: 0 }, data: { condition: { field: "charCount", op: "gt", value: "5000" } } },
        { id: "b", type: "process.text", position: { x: 200, y: 0 }, data: { operation: "findReplace", find: "a", replace: "b" } },
        { id: "c", type: "process.chapter", position: { x: 400, y: 0 }, data: { granularity: "medium", maxChapters: 20 } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("拒绝非法的重试配置", () => {
    const result = safeParseGraph({
      schemaVersion: 1,
      nodes: [
        {
          id: "a",
          type: "process.transcribe",
          position: { x: 0, y: 0 },
          data: { retry: { maxRetries: -1, backoffMs: 3000 } },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.success).toBe(false);
  });
});

describe("templates", () => {
  it("6 个内置模板都能通过 graph 校验", () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const result = safeParseGraph(t.graph);
      expect(result.success).toBe(true);
    }
  });

  it("模板中同排相连的节点不会横向重叠", () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const nodesById = new Map(t.graph.nodes.map((n) => [n.id, n]));
      for (const e of t.graph.edges) {
        const source = nodesById.get(e.source);
        const target = nodesById.get(e.target);
        if (!source || !target || source.position.y !== target.position.y) continue;
        expect(source.position.x + NODE_CARD_WIDTH[source.type]).toBeLessThanOrEqual(target.position.x);
      }
    }
  });

  it("拒绝重复的节点 id", () => {
    const graph = structuredClone(WORKFLOW_TEMPLATES[0].graph);
    graph.nodes[1].id = graph.nodes[0].id;
    const result = safeParseGraph(graph);
    expect(result.success).toBe(false);
  });
});
