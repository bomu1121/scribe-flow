import type { ViewportTransform } from "@vue-flow/core";
import type { AsrEngine, GraphEdge, GraphNode, NodeRunStatus, NodeType, PageRef, SourceVideoItem, WorkflowGraph } from "@scribe-flow/shared";

export const SCRIBE_NODE_TYPE = "scribe";
export const SCRIBE_EDGE_TYPE = "scribe";

export interface NodeContextActions {
  duplicate: () => void;
  remove: () => void;
  runNode: () => void;
  runFromNode: () => void;
  copyOutput: () => void;
  /** 打开该节点在最近一次运行中的输出结果页。 */
  viewOutput: () => void;
  /** 卡片内表单更新节点数据。 */
  updateData: (patch: Record<string, unknown>) => void;
  /** 卡片内表单失焦时提交一次撤销历史。 */
  commit: () => void;
  /** 快捷选择器确认后：第一个填当前节点，其余生成新的 B 站来源节点。 */
  addSourceVideos: (videos: SourceVideoItem[]) => void;
}

export interface ScribeNodeData {
  nodeType: NodeType;
  label?: string;
  status?: NodeRunStatus;
  summary?: string;
  preview?: string;
  url?: string;
  pageInfo?: PageRef;
  bvid?: string;
  cover?: string;
  uploader?: string;
  duration?: number;
  fileName?: string;
  filePath?: string;
  text?: string;
  asrEngine?: AsrEngine;
  promptBlockId?: string;
  promptOverride?: string;
  model?: string;
  outputName?: string;
  title?: string;
  /** 运行时注入的右键菜单动作，不会持久化。 */
  ctx?: NodeContextActions;
}

/** 与 Vue Flow 的 Node/Edge 输入结构保持兼容的最小画布节点类型。 */
export interface ScribeFlowNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  selected?: boolean;
  data: ScribeNodeData;
  [key: string]: unknown;
}

export interface ScribeFlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  selected?: boolean;
  [key: string]: unknown;
}

export function toFlowNodes(graph: WorkflowGraph, ctxFactory: (nodeId: string) => NodeContextActions): ScribeFlowNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: SCRIBE_NODE_TYPE,
    position: { ...node.position },
    selected: false,
    data: {
      ...(node.data as Record<string, unknown>),
      nodeType: node.type,
      ctx: ctxFactory(node.id),
    } as ScribeNodeData,
  }));
}

export function toFlowEdges(graph: WorkflowGraph): ScribeFlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: SCRIBE_EDGE_TYPE,
    selected: false,
  }));
}

export function toBusinessGraph(nodes: ScribeFlowNode[], edges: ScribeFlowEdge[], viewport: ViewportTransform): WorkflowGraph {
  const businessNodes: GraphNode[] = nodes.map((node) => {
    const data = { ...node.data } as Record<string, unknown>;
    delete data.nodeType;
    delete data.ctx;
    // 运行态字段只属于内存/运行记录，不写入工程定义，避免刷新后“卡在 running”。
    delete data.status;
    delete data.summary;
    delete data.preview;
    return {
      id: node.id,
      type: node.data.nodeType,
      position: { x: node.position.x, y: node.position.y },
      data,
    } as GraphNode;
  });

  const businessEdges: GraphEdge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  }));

  return {
    schemaVersion: 1,
    nodes: businessNodes,
    edges: businessEdges,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  };
}

export function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

export function emptyNodeData(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "source.bili":
      return { label: "B站链接", url: "" };
    case "source.file":
      return { label: "本地文件" };
    case "source.text":
      return { label: "文本", text: "" };
    case "process.transcribe":
      return { label: "转写" };
    case "process.refine":
      return { label: "AI 校对" };
    case "process.prompt":
      return { label: "AI 加工", promptBlockId: undefined, outputName: "" };
    case "process.merge":
      return { label: "合并", title: "" };
    case "process.output":
      return { label: "输出", fileName: "笔记.md" };
  }
}
