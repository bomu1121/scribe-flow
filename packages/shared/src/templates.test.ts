import { describe, expect, it } from "vitest";
import { WORKFLOW_TEMPLATES, instantiateTemplate, isBiliTemplate } from "./templates";
import { parseGraph } from "./schema";

const BASIC = "template.video-basic";

describe("isBiliTemplate", () => {
  it("以 B 站视频为起点的模板为真，文稿类模板为假", () => {
    const byId = (id: string) => WORKFLOW_TEMPLATES.find((t) => t.id === id)!;
    expect(isBiliTemplate(byId(BASIC))).toBe(true);
    expect(isBiliTemplate(byId("template.video-obsidian"))).toBe(true);
    expect(isBiliTemplate(byId("template.text-polish"))).toBe(false);
  });
});

describe("instantiateTemplate", () => {
  it("未知模板返回 null", () => {
    expect(instantiateTemplate("template.does-not-exist")).toBeNull();
  });

  it("把 B 站解析结果写进来来源节点，并保留模板里的加工链路", () => {
    const graph = instantiateTemplate(BASIC, {
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
      fileStem: "芯片是怎么造出来的",
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

    const output = graph.nodes.find((node) => node.type === "process.output")!;
    expect(output.data).toMatchObject({ fileName: "芯片是怎么造出来的.md" });

    expect(graph.edges).toHaveLength(WORKFLOW_TEMPLATES.find((t) => t.id === BASIC)!.graph.edges.length);
  });

  it("改过的实例不会污染模板常量（两次实例互相独立）", () => {
    const first = instantiateTemplate(BASIC, { promptBlockId: "builtin.tech" })!;
    first.nodes.find((node) => node.type === "process.prompt")!.data.label = "改过的名字";
    first.nodes[0].position.x = 9999;

    const second = instantiateTemplate(BASIC, { promptBlockId: "builtin.tech" })!;
    expect(second.nodes.find((node) => node.type === "process.prompt")!.data.label).toBe("AI 加工");
    expect(second.nodes[0].position.x).not.toBe(9999);

    const template = WORKFLOW_TEMPLATES.find((t) => t.id === BASIC)!.graph;
    expect(template.nodes.some((node) => node.data.label === "改过的名字")).toBe(false);
  });

  it("不带可选参数时输出模板原样，且仍是合法图", () => {
    const graph = instantiateTemplate(BASIC)!;
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === BASIC)!.graph;
    expect(graph).toEqual(template);
    expect(() => parseGraph(graph)).not.toThrow();
  });

  it("预绑提示词块只落在 AI 加工节点，攻略加工的推荐块不被覆盖", () => {
    const graph = instantiateTemplate("template.video-game-guide", { promptBlockId: "builtin.insight.v4" })!;
    const guide = graph.nodes.find((node) => node.type === "process.gameguide")!;
    expect((guide.data as Record<string, unknown>).promptBlockId).toBeUndefined();
    expect(guide.data.mode).toBe("audited");
    // 攻略模板没有 process.prompt 节点，链路不应被凭空加上
    expect(graph.nodes.some((node) => node.type === "process.prompt")).toBe(false);
  });

  it("写入 B 站来源后仍是合法图", () => {
    const graph = instantiateTemplate(BASIC, {
      bili: { url: "https://www.bilibili.com/video/BV1xx411c7mD", bvid: "BV1xx411c7mD", title: "标题" },
    })!;
    expect(() => parseGraph(graph)).not.toThrow();
  });
});
