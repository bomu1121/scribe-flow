import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TEMPLATES,
  availableSources,
  buildTemplateGraph,
  defaultSourceOf,
  supportsSource,
  type TemplateSourceKind,
  type WorkflowTemplate,
} from "./templates";
import { parseGraph, safeParseGraph } from "./schema";
import { NODE_CARD_WIDTH, NODE_PORTS, type GraphNode, type WorkflowGraph } from "./graph";
import { canConnectSpecs } from "./port";

const SINGLE = "template.single-note";

const templateById = (id: string) => WORKFLOW_TEMPLATES.find((t) => t.id === id);
/** 每个模板 × 每个允许来源的一份图：来源轴上的组合都要能建出合法图。 */
const allGraphs = (): { template: WorkflowTemplate; source: TemplateSourceKind; graph: WorkflowGraph }[] =>
  WORKFLOW_TEMPLATES.flatMap((template) =>
    availableSources(template).map((source) => ({ template, source, graph: buildTemplateGraph(template.id, { source })! })),
  );

const portOf = (node: GraphNode, handle: string | undefined) =>
  [...NODE_PORTS[node.type].inputs, ...NODE_PORTS[node.type].outputs].find((port) => port.id === handle);

describe("模板清单", () => {
  it("id 不重复，且都标注了分组", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of WORKFLOW_TEMPLATES) {
      expect(["通用", "垂直"]).toContain(template.group);
      expect(template.stages.length).toBeGreaterThan(0);
    }
  });

  it("模板只描述「加工路径」：不含来源与转写节点，from 只引用前面的 stage", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const keys = template.stages.map((stage) => stage.key);
      expect(new Set(keys).size).toBe(keys.length);
      const seen = new Set<string>();
      for (const stage of template.stages) {
        // 来源与转写由来源轴补在前面，模板里写它们等于把来源写死。
        expect(stage.type.startsWith("source.")).toBe(false);
        expect(stage.type).not.toBe("process.transcribe");
        // from 只能引用前面出现过的 stage，否则建的图会少一条边
        for (const from of stage.from ?? []) expect(seen.has(from), `${template.id} 的 ${stage.key} 引用了 ${from}`).toBe(true);
        seen.add(stage.key);
      }
    }
  });

  it("默认来源必须在允许列表里，且所有模板都支持 B 站（快捷新建只列这类）", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(availableSources(template)).toContain(defaultSourceOf(template));
      expect(supportsSource(template, "bili")).toBe(true);
    }
  });

  it("「选段加工」只对音视频来源可用（文稿来源只有一段，挑不出东西）", () => {
    const pick = templateById("template.pick-segments")!;
    expect(availableSources(pick)).toEqual(["bili", "file"]);
    expect(buildTemplateGraph(pick.id, { source: "text" })).toBeNull();
  });
});

describe("buildTemplateGraph", () => {
  it("未知模板返回 null", () => {
    expect(buildTemplateGraph("template.does-not-exist")).toBeNull();
  });

  it("模板不支持该来源时返回 null，而不是悄悄换一个来源", () => {
    expect(buildTemplateGraph("template.pick-segments", { source: "bili" })).not.toBeNull();
    expect(buildTemplateGraph("template.pick-segments", { source: "text" })).toBeNull();
  });

  it("每种来源都建出合法图，来源节点与转写节点按来源种类补齐", () => {
    for (const { template, source, graph } of allGraphs()) {
      expect(safeParseGraph(graph).success, `${template.id} / ${source}`).toBe(true);
      const types = graph.nodes.map((node) => node.type);
      if (source === "text") {
        expect(types[0], template.id).toBe("source.text");
        expect(types, template.id).not.toContain("process.transcribe");
      } else {
        expect(types[0], template.id).toBe(source === "bili" ? "source.bili" : "source.file");
        expect(types[1], template.id).toBe("process.transcribe");
        expect(graph.edges[0], template.id).toMatchObject({ sourceHandle: "audio", targetHandle: "audio" });
      }
    }
  });

  it("每条连线两端端口都相容（端口写错时这条会红，而不是等用户连不上）", () => {
    for (const { template, source, graph } of allGraphs()) {
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      for (const edge of graph.edges) {
        const from = byId.get(edge.source)!;
        const to = byId.get(edge.target)!;
        const sourcePort = portOf(from, edge.sourceHandle);
        const targetPort = portOf(to, edge.targetHandle);
        expect(sourcePort, `${template.id} / ${source} / ${edge.id}`).toBeDefined();
        expect(targetPort, `${template.id} / ${source} / ${edge.id}`).toBeDefined();
        expect(canConnectSpecs(sourcePort!, targetPort!), `${template.id} / ${source} / ${edge.id}`).toBe(true);
      }
    }
  });

  it("链路是连通的：除来源节点外每个节点都有上游，末端至少有一个节点", () => {
    for (const { template, source, graph } of allGraphs()) {
      const hasUpstream = new Set(graph.edges.map((edge) => edge.target));
      for (const node of graph.nodes) {
        if (node.type.startsWith("source.")) continue;
        expect(hasUpstream.has(node.id), `${template.id} / ${source} / ${node.id} 没有上游`).toBe(true);
      }
      const hasDownstream = new Set(graph.edges.map((edge) => edge.source));
      expect(graph.nodes.some((node) => !hasDownstream.has(node.id)), `${template.id} / ${source}`).toBe(true);
    }
  });

  it("同排相连的节点不会横向重叠", () => {
    for (const { template, source, graph } of allGraphs()) {
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      for (const edge of graph.edges) {
        const from = byId.get(edge.source)!;
        const to = byId.get(edge.target)!;
        if (from.position.y !== to.position.y) continue;
        expect(from.position.x + NODE_CARD_WIDTH[from.type], `${template.id} / ${source} / ${edge.id}`).toBeLessThanOrEqual(to.position.x);
      }
    }
  });

  it("模板不再以「输出」节点收尾：落盘改由运行收尾统一做，文件名跟着工程名走", () => {
    for (const { template, source, graph } of allGraphs()) {
      expect(graph.nodes.some((node) => node.type === "process.output"), `${template.id} / ${source}`).toBe(false);
    }
  });

  it("把 B 站解析结果写进来来源节点，并保留链路形状", () => {
    const graph = buildTemplateGraph(SINGLE, {
      source: "bili",
      bili: {
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        page: 2,
        pageInfo: { cid: 99, page: 2, part: "P2", duration: 300 },
        bvid: "BV1xx411c7mD",
        title: "芯片是怎么造出来的",
        cover: "https://i0.hdslb.com/x.jpg",
        uploader: "某某实验室",
        duration: 300,
      },
      promptBlockId: "builtin.insight.v4",
    })!;

    const source = graph.nodes.find((node) => node.type === "source.bili")!;
    expect(source.data).toMatchObject({
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      page: 2,
      bvid: "BV1xx411c7mD",
      title: "芯片是怎么造出来的",
      uploader: "某某实验室",
      duration: 300,
      pageInfo: { cid: 99, page: 2, part: "P2", duration: 300 },
    });

    const prompt = graph.nodes.find((node) => node.type === "process.prompt")!;
    expect(prompt.data).toMatchObject({ promptBlockId: "builtin.insight.v4" });
    expect(graph.edges).toHaveLength(3);
  });

  it("来源不是 B 站时不写 B 站解析结果（也不会蹦出一个 B 站来源节点）", () => {
    const graph = buildTemplateGraph(SINGLE, { source: "text", bili: { url: "https://www.bilibili.com/video/BV1xx411c7mD" } })!;
    expect(graph.nodes.some((node) => node.type === "source.bili")).toBe(false);
    expect(graph.nodes[0]).toMatchObject({ type: "source.text", data: { text: "" } });
  });

  it("预绑提示词块只落在 AI 加工节点，自带提示词的加工节点不被覆盖", () => {
    const graph = buildTemplateGraph("template.gameguide", { source: "bili", promptBlockId: "builtin.insight.v4" })!;
    const guide = graph.nodes.find((node) => node.type === "process.gameguide")!;
    expect((guide.data as Record<string, unknown>).promptBlockId).toBeUndefined();
    expect(guide.data.mode).toBe("audited");
    // 攻略链路没有 AI 加工节点，链路不应被凭空加上
    expect(graph.nodes.some((node) => node.type === "process.prompt")).toBe(false);
  });

  it("改过的实例不会污染模板（两次构建互相独立）", () => {
    const first = buildTemplateGraph(SINGLE, { source: "bili", promptBlockId: "builtin.tech" })!;
    first.nodes.find((node) => node.type === "process.prompt")!.data.label = "改过的名字";
    first.nodes[0].position.x = 9999;

    const second = buildTemplateGraph(SINGLE, { source: "bili", promptBlockId: "builtin.tech" })!;
    expect(second.nodes.find((node) => node.type === "process.prompt")!.data.label).toBeUndefined();
    expect(second.nodes[0].position.x).not.toBe(9999);
  });

  it("不带可选参数时仍能建出合法图（服务端按 templateId 建工程走的就是这条路）", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graph = buildTemplateGraph(template.id);
      expect(graph, template.id).not.toBeNull();
      expect(() => parseGraph(graph!), template.id).not.toThrow();
      expect(graph!.nodes[0].type, template.id).toBe(defaultSourceOf(template) === "text" ? "source.text" : "source.bili");
    }
  });

  it("要示范的节点都真的出现在链路里：合并 / 分章 / 挑选 / 导图 / 知识巩固 / Obsidian", () => {
    const typesIn = (id: string, source: TemplateSourceKind) => buildTemplateGraph(id, { source })!.nodes.map((node) => node.type);
    expect(typesIn("template.series-digest", "text")).toContain("process.merge");
    expect(typesIn("template.chapters", "text")).toContain("process.chapter");
    expect(typesIn("template.pick-segments", "bili")).toContain("flow.pick");
    expect(typesIn("template.mindmap", "text")).toContain("process.mindmap");
    expect(typesIn("template.drill", "text")).toContain("process.drill");
    expect(typesIn("template.obsidian", "text")).toContain("process.obsidian");
    // 多路对照的两条分支卡片长得一样，只有名字能区分——名字丢了就分不清哪份结果对应哪套提示词。
    const branches = buildTemplateGraph("template.multi-branch", { source: "text" })!.nodes.filter((node) => node.type === "process.prompt");
    expect(branches.map((node) => node.data.label)).toEqual(["AI 加工 A", "AI 加工 B"]);
  });

  it("多路对照不在末端合并：差异由结果页的「对照」标签页承担", () => {
    const graph = buildTemplateGraph("template.multi-branch", { source: "text" })!;
    expect(graph.nodes.some((node) => node.type === "process.merge")).toBe(false);
    // 两条分支都是末端（运行收尾会各落一份文件），末尾不再挂任何压平节点
    const sources = new Set(graph.edges.map((edge) => edge.source));
    const leaves = graph.nodes.filter((node) => !sources.has(node.id));
    expect(leaves.map((node) => node.type)).toEqual(["process.prompt", "process.prompt"]);
  });
});
