import { describe, expect, it } from "vitest";
import { canConnect } from "./port";
import { isValidConnection, type GraphNode } from "./graph";
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
});

describe("graph", () => {
  it("按端口类型校验连线", () => {
    expect(isValidConnection(biliNode, "audio", transcribeNode, "audio")).toBe(true);
    expect(isValidConnection(biliNode, "audio", transcribeNode, "transcript")).toBe(false);
  });
});

describe("templates", () => {
  it("4 个内置模板都能通过 graph 校验", () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const result = safeParseGraph(t.graph);
      expect(result.success).toBe(true);
    }
  });

  it("拒绝重复的节点 id", () => {
    const graph = structuredClone(WORKFLOW_TEMPLATES[0].graph);
    graph.nodes[1].id = graph.nodes[0].id;
    const result = safeParseGraph(graph);
    expect(result.success).toBe(false);
  });
});
