import { describe, expect, it } from "vitest";
import type { RunNodeInput, RunNodeResult, WorkflowGraph } from "@scribe-flow/shared";
import { buildNodeSegments, buildSegmentMap } from "./run-segments";

const RUN_ID = "run_test";

function inputRow(partial: Partial<RunNodeInput> & Pick<RunNodeInput, "id" | "targetNodeId" | "sourceNodeId" | "position">): RunNodeInput {
  return { runId: RUN_ID, kind: "text", createdAt: 0, ...partial };
}

function nodeResult(nodeId: string, nodeType: string, label?: string): RunNodeResult {
  return { nodeId, nodeType, nodeLabel: label, status: "done", elapsedMs: 0 };
}

function resultMap(...nodes: RunNodeResult[]): Map<string, RunNodeResult> {
  return new Map(nodes.map((node) => [node.nodeId, node]));
}

/** 多选 B 站卡片 + 转写 + AI 加工 + 输出：与「8 个视频跑一条链路」的真实图形一致。 */
function graphFixture(): WorkflowGraph {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "n_src",
        type: "source.bili",
        position: { x: 0, y: 0 },
        data: {
          label: "B站链接",
          url: "https://www.bilibili.com/video/BV1",
          items: [
            { bvid: "BV1", cid: 1, page: 1, part: "", title: "第一个视频", uploader: "UP主", duration: 100 },
            { bvid: "BV2", cid: 2, page: 1, part: "", title: "第二个视频", uploader: "UP主", duration: 200 },
            { bvid: "BV3", cid: 3, page: 2, part: "下集", title: "第三个视频", uploader: "UP主", duration: 300 },
          ],
        },
      },
      { id: "n_asr", type: "process.transcribe", position: { x: 1, y: 0 }, data: { label: "转写" } },
      { id: "n_prompt", type: "process.prompt", position: { x: 2, y: 0 }, data: { label: "AI 加工" } },
      { id: "n_out", type: "process.output", position: { x: 3, y: 0 }, data: { label: "输出" } },
    ],
    edges: [
      { id: "e1", source: "n_src", target: "n_asr" },
      { id: "e2", source: "n_asr", target: "n_prompt" },
      { id: "e3", source: "n_prompt", target: "n_out" },
    ],
  };
}

/** 转写节点的三行输入：每行是该视频的转写文本（引擎转写后就地回写 text）。 */
function transcribeRows(): RunNodeInput[] {
  return [
    inputRow({ id: "i0", targetNodeId: "n_asr", sourceNodeId: "n_src", position: 0, kind: "text", text: "视频一的转写" }),
    inputRow({ id: "i1", targetNodeId: "n_asr", sourceNodeId: "n_src", position: 1, kind: "text", text: "视频二的转写" }),
    inputRow({ id: "i2", targetNodeId: "n_asr", sourceNodeId: "n_src", position: 2, kind: "text", text: "视频三的转写" }),
  ];
}

describe("buildNodeSegments", () => {
  it("把多视频经同一转写节点的结果按视频切开，标题取自原始素材", () => {
    const rows = transcribeRows();
    const segments = buildNodeSegments("n_asr", rows, resultMap(nodeResult("n_asr", "process.transcribe", "转写")), graphFixture());

    expect(segments.map((segment) => segment.label)).toEqual(["第一个视频", "第二个视频", "第三个视频 · P2 下集"]);
    expect(segments.map((segment) => segment.text)).toEqual(["视频一的转写", "视频二的转写", "视频三的转写"]);
    expect(segments.map((segment) => segment.position)).toEqual([0, 1, 2]);
    expect(segments.every((segment) => segment.meta.includes("UP主"))).toBe(true);
  });

  it("单 P 视频的 part 与标题相同时不重复拼接 P 号", () => {
    const graph = graphFixture();
    const source = graph.nodes.find((node) => node.id === "n_src");
    (source!.data as Record<string, unknown>).items = [
      { bvid: "BV1", cid: 1, page: 1, part: "第一个视频", title: "第一个视频" },
      { bvid: "BV2", cid: 2, page: 1, part: "第二个视频", title: "第二个视频" },
    ];
    const rows = transcribeRows().slice(0, 2);
    const segments = buildNodeSegments("n_asr", rows, resultMap(nodeResult("n_asr", "process.transcribe", "转写")), graph);

    expect(segments.map((segment) => segment.label)).toEqual(["第一个视频", "第二个视频"]);
  });

  it("AI 加工节点优先取各输入的处理结果（resultText），并沿链路回填视频标题", () => {
    const rows = [
      ...transcribeRows(),
      inputRow({ id: "p0", targetNodeId: "n_prompt", sourceNodeId: "n_asr", position: 0, text: "视频一的转写", resultText: "视频一的笔记" }),
      inputRow({ id: "p1", targetNodeId: "n_prompt", sourceNodeId: "n_asr", position: 1, text: "视频二的转写", resultText: "视频二的笔记" }),
    ];
    const nodes = resultMap(
      nodeResult("n_asr", "process.transcribe", "转写"),
      nodeResult("n_prompt", "process.prompt", "AI 加工"),
    );
    const segments = buildNodeSegments("n_prompt", rows, nodes, graphFixture());

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.text)).toEqual(["视频一的笔记", "视频二的笔记"]);
    expect(segments.map((segment) => segment.label)).toEqual(["第一个视频", "第二个视频"]);
  });

  it("「输出」整篇文档按汇入的每篇笔记分段，而不是把全文当一段", () => {
    const rows = [
      ...transcribeRows(),
      inputRow({ id: "o0", targetNodeId: "n_out", sourceNodeId: "n_prompt", position: 0, text: "# 视频一笔记\n\n正文一" }),
      inputRow({ id: "o1", targetNodeId: "n_out", sourceNodeId: "n_prompt", position: 1, text: "# 视频二笔记\n\n正文二" }),
      inputRow({ id: "o2", targetNodeId: "n_out", sourceNodeId: "n_prompt", position: 2, text: "# 视频三笔记\n\n正文三" }),
      inputRow({ id: "po0", targetNodeId: "n_prompt", sourceNodeId: "n_asr", position: 0, resultText: "视频一的笔记" }),
      inputRow({ id: "po1", targetNodeId: "n_prompt", sourceNodeId: "n_asr", position: 1, resultText: "视频二的笔记" }),
      inputRow({ id: "po2", targetNodeId: "n_prompt", sourceNodeId: "n_asr", position: 2, resultText: "视频三的笔记" }),
    ];
    const nodes = resultMap(
      nodeResult("n_asr", "process.transcribe", "转写"),
      nodeResult("n_prompt", "process.prompt", "AI 加工"),
      nodeResult("n_out", "process.output", "输出"),
    );
    const segments = buildNodeSegments("n_out", rows, nodes, graphFixture());

    expect(segments.map((segment) => segment.text)).toEqual(["# 视频一笔记\n\n正文一", "# 视频二笔记\n\n正文二", "# 视频三笔记\n\n正文三"]);
    expect(segments.map((segment) => segment.label)).toEqual(["第一个视频", "第二个视频", "第三个视频 · P2 下集"]);
  });

  it("文本工具这类逐项变换的节点，用交付给下游的多份内容分段（而不是未加工的输入）", () => {
    const rows = [
      inputRow({ id: "t0", targetNodeId: "n_text", sourceNodeId: "n_src", position: 0, text: "原始一" }),
      inputRow({ id: "t1", targetNodeId: "n_text", sourceNodeId: "n_src", position: 1, text: "原始二" }),
      inputRow({ id: "d0", targetNodeId: "n_out", sourceNodeId: "n_text", position: 0, text: "加工一" }),
      inputRow({ id: "d1", targetNodeId: "n_out", sourceNodeId: "n_text", position: 1, text: "加工二" }),
    ];
    const nodes = resultMap(nodeResult("n_text", "process.text", "文本工具"), nodeResult("n_out", "process.output", "输出"));
    const segments = buildNodeSegments("n_text", rows, nodes, graphFixture());

    expect(segments.map((segment) => segment.text)).toEqual(["加工一", "加工二"]);
  });

  it("单输入节点不分段（避免多出一层无意义的选择器）", () => {
    const rows = [inputRow({ id: "s0", targetNodeId: "n_prompt", sourceNodeId: "n_asr", position: 0, text: "唯一输入" })];
    expect(buildNodeSegments("n_prompt", rows, resultMap(nodeResult("n_prompt", "process.prompt", "AI 加工")), graphFixture())).toEqual([]);
  });

  it("输入里只有音频、还没有文稿时不分段", () => {
    const rows = [
      inputRow({ id: "a0", targetNodeId: "n_asr", sourceNodeId: "n_src", position: 0, kind: "audio", path: "a0.wav" }),
      inputRow({ id: "a1", targetNodeId: "n_asr", sourceNodeId: "n_src", position: 1, kind: "audio", path: "a1.wav" }),
    ];
    expect(buildNodeSegments("n_asr", rows, resultMap(nodeResult("n_asr", "process.transcribe", "转写")), graphFixture())).toEqual([]);
  });

  it("buildSegmentMap 只收录真正可分段的节点", () => {
    const rows = [...transcribeRows(), inputRow({ id: "o0", targetNodeId: "n_out", sourceNodeId: "n_prompt", position: 0, text: "唯一一篇" })];
    const nodes = resultMap(
      nodeResult("n_asr", "process.transcribe", "转写"),
      nodeResult("n_out", "process.output", "输出"),
      nodeResult("n_src", "source.bili", "B站链接"),
    );
    const map = buildSegmentMap(rows, nodes, graphFixture());

    expect(map.get("n_asr")).toHaveLength(3);
    expect(map.has("n_out")).toBe(false);
    expect(map.has("n_src")).toBe(false);
  });
});
