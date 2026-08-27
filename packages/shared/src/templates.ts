import type { GraphEdge, GraphNode, NodeType, WorkflowGraph } from "./graph";
import type { WorkflowTemplate } from "./project";

function node(type: NodeType, id: string, x: number, y: number, data: GraphNode["data"]): GraphNode {
  return { id, type, position: { x, y }, data } as GraphNode;
}

function edge(id: string, source: string, target: string, sourceHandle: string, targetHandle: string): GraphEdge {
  return { id, source, target, sourceHandle, targetHandle };
}

/** 模板一：视频观点笔记（默认）。 */
function videoInsightGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 40, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", 300, 40, { label: "转写" }),
      node("process.refine", "n_refine", 600, 40, { label: "AI 校对" }),
      node("process.prompt", "n_insight", 900, 40, { label: "观点提炼", promptBlockId: "builtin.insight", outputName: "观点笔记" }),
      node("process.output", "n_out", 1200, 40, { label: "输出", fileName: "观点笔记.md" }),
    ],
    edges: [
      edge("e1", "n_src", "n_asr", "audio", "audio"),
      edge("e2", "n_asr", "n_refine", "transcript", "transcript"),
      edge("e3", "n_refine", "n_insight", "transcript", "transcript"),
      edge("e4", "n_insight", "n_out", "noteBlock", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板二：技术教程拆解（观点 + 溯源并行）。 */
function techTutorialGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 80, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", 300, 80, { label: "转写" }),
      node("process.prompt", "n_tech", 600, 0, { label: "技术文案提炼", promptBlockId: "builtin.tech", outputName: "技术笔记" }),
      node("process.prompt", "n_trace", 600, 160, { label: "信息溯源", promptBlockId: "builtin.trace", outputName: "信息溯源" }),
      node("process.merge", "n_merge", 900, 80, { label: "合并", title: "技术拆解笔记" }),
      node("process.output", "n_out", 1200, 80, { label: "输出", fileName: "技术拆解笔记.md" }),
    ],
    edges: [
      edge("e1", "n_src", "n_asr", "audio", "audio"),
      edge("e2", "n_asr", "n_tech", "transcript", "transcript"),
      edge("e3", "n_asr", "n_trace", "transcript", "transcript"),
      edge("e4", "n_tech", "n_merge", "noteBlock", "noteBlock"),
      edge("e5", "n_trace", "n_merge", "noteBlock", "noteBlock"),
      edge("e6", "n_merge", "n_out", "noteDoc", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板三：多提示词对照。 */
function multiPromptGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 120, { label: "已有文稿", text: "" }),
      node("process.prompt", "n_a", 340, -40, { label: "观点提炼", promptBlockId: "builtin.insight", outputName: "版本 A" }),
      node("process.prompt", "n_b", 340, 120, { label: "技术文案提炼", promptBlockId: "builtin.tech", outputName: "版本 B" }),
      node("process.prompt", "n_c", 340, 280, { label: "信息溯源", promptBlockId: "builtin.trace", outputName: "版本 C" }),
      node("process.merge", "n_merge", 680, 120, { label: "合并", title: "多提示词对照" }),
      node("process.output", "n_out", 980, 120, { label: "输出", fileName: "多提示词对照.md" }),
    ],
    edges: [
      edge("e1", "n_text", "n_a", "transcript", "transcript"),
      edge("e2", "n_text", "n_b", "transcript", "transcript"),
      edge("e3", "n_text", "n_c", "transcript", "transcript"),
      edge("e4", "n_a", "n_merge", "noteBlock", "noteBlock"),
      edge("e5", "n_b", "n_merge", "noteBlock", "noteBlock"),
      edge("e6", "n_c", "n_merge", "noteBlock", "noteBlock"),
      edge("e7", "n_merge", "n_out", "noteDoc", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板四：已有文稿加工。 */
function textPolishGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 40, { label: "已有文稿", text: "" }),
      node("process.refine", "n_refine", 300, 40, { label: "AI 校对" }),
      node("process.prompt", "n_insight", 600, 40, { label: "观点提炼", promptBlockId: "builtin.insight", outputName: "观点笔记" }),
      node("process.output", "n_out", 900, 40, { label: "输出", fileName: "观点笔记.md" }),
    ],
    edges: [
      edge("e1", "n_text", "n_refine", "transcript", "transcript"),
      edge("e2", "n_refine", "n_insight", "transcript", "transcript"),
      edge("e3", "n_insight", "n_out", "noteBlock", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: "template.video-insight", name: "视频观点笔记", description: "B 站视频 → 转写 → 校对 → 观点提炼 → 输出", graph: videoInsightGraph() },
  { id: "template.tech-tutorial", name: "技术教程拆解", description: "技术文案提炼与信息溯源并行，合并为一份笔记", graph: techTutorialGraph() },
  { id: "template.multi-prompt", name: "多提示词对照", description: "同一份文稿跑三个提示词块，合并后对照阅读", graph: multiPromptGraph() },
  { id: "template.text-polish", name: "已有文稿加工", description: "粘贴已有文稿，直接校对与提炼，跳过下载转写", graph: textPolishGraph() },
];
