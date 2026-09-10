import type { ViewportTransform } from "@vue-flow/core";
import type { AsrEngine, BiliSourceItem, DrillDifficulty, DrillKind, GraphEdge, GraphNode, NodeRunStatus, NodeType, PageRef, ResultDelta, SourceVideoItem, WorkflowGraph } from "@scribe-flow/shared";
import type { RunSegment } from "./run-segments";

export const SCRIBE_NODE_TYPE = "scribe";
export const SCRIBE_EDGE_TYPE = "scribe";
/** 节点只允许在头部区域拖动。 */
export const NODE_DRAG_HANDLE_SELECTOR = ".sf-node-head";

/** 画布节点悬停预览用的完整输出（与输出抽屉同源，均为最近一次运行）。 */
export interface NodePreviewOutput {
  runId: string;
  /** 节点展示名（优先运行记录里的 nodeLabel）。 */
  nodeLabel: string;
  /** 完整文本内容；可能为空字符串（该次运行无文本产物）。 */
  text: string;
  /**
   * 一个输入一份结果时的分段（例如 8 个视频经同一个转写节点）。
   * 空数组表示该节点只有一份内容，浮层沿用整段预览。
   */
  segments: RunSegment[];
}

export interface NodeContextActions {
  duplicate: () => void;
  remove: () => void;
  runNode: () => void;
  runFromNode: () => void;
  /** 当前工程是否有运行正在进行；用于禁用右键菜单里的“运行”入口。 */
  running?: boolean;
  /** 运行进行中画布应只读：当前编辑不会影响正在进行的运行，禁止改动节点数据/结构。 */
  readonly?: boolean;
  copyOutput: () => void;
  /** 打开该节点在最近一次运行中的输出结果页；传入段序号可直达对应分段。 */
  viewOutput: (segmentIndex?: number) => void;
  /** 拉取该节点最近一次运行的完整文本（画布悬停预览用）；无匹配运行或无输出时返回 null。 */
  fetchNodeOutput?: () => Promise<NodePreviewOutput | null>;
  /** 卡片内表单更新节点数据。 */
  updateData: (patch: Record<string, unknown>) => void;
  /** 卡片内表单失焦时提交一次撤销历史。 */
  commit: () => void;
  /** 多选合并：把多个 B 站视频/分P 合并进当前节点，生成一张多选卡片。 */
  addSourceVideos: (videos: SourceVideoItem[]) => void;
}

export interface ScribeNodeData {
  nodeType: NodeType;
  label?: string;
  status?: NodeRunStatus;
  summary?: string;
  preview?: string;
  /** 相对直接上游的变化徽标；运行态字段，不持久化到工程图。 */
  delta?: ResultDelta;
  url?: string;
  pageInfo?: PageRef;
  /** 多选模式：一张卡片里的多个 B 站视频/分P。 */
  items?: BiliSourceItem[];
  bvid?: string;
  cover?: string;
  uploader?: string;
  duration?: number;
  fileName?: string;
  filePath?: string;
  /** 是否保留可播放视频（keepVideo，结果页附件）。 */
  keepVideo?: boolean;
  /** B站目标清晰度（playurl qn：16/32/64/80…），默认 80。 */
  videoQn?: number;
  text?: string;
  asrEngine?: AsrEngine;
  promptBlockId?: string;
  promptOverride?: string;
  title?: string;
  tags?: string;
  source?: string;
  author?: string;
  folder?: string;
  retry?: { maxRetries?: number; backoffMs?: number };
  condition?: { field: "charCount" | "wordCount" | "contains"; op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains"; value: string };
  operation?: "findReplace" | "regexReplace" | "template" | "cleanup";
  find?: string;
  replace?: string;
  pattern?: string;
  flags?: string;
  template?: string;
  granularity?: "coarse" | "medium" | "fine";
  maxChapters?: number;
  mode?: "standard" | "audited";
  branchSize?: "auto" | "few" | "many";
  maxDepth?: number;
  theme?: "paper" | "presentation" | "academic";
  pointCount?: number;
  kinds?: DrillKind[];
  difficulty?: DrillDifficulty;
  withExtensions?: boolean;
  focus?: string;
  /** 运行时注入的右键菜单动作，不会持久化。 */
  ctx?: NodeContextActions;
}

/** 与 Vue Flow 的 Node/Edge 输入结构保持兼容的最小画布节点类型。 */
export interface ScribeFlowNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  selected?: boolean;
  /** Vue Flow 节点拖动句柄选择器；仅命中该选择器的区域可拖动节点。 */
  dragHandle?: string;
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
    dragHandle: NODE_DRAG_HANDLE_SELECTOR,
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
    delete data.delta;
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
      return { label: "转写", retry: { maxRetries: 2, backoffMs: 3000 } };
    case "process.refine":
      return { label: "AI 校对", retry: { maxRetries: 2, backoffMs: 3000 } };
    case "process.prompt":
      return { label: "AI 加工", promptBlockId: undefined, retry: { maxRetries: 2, backoffMs: 3000 } };
    case "process.merge":
      return { label: "合并", title: "" };
    case "process.output":
      return { label: "输出", fileName: "笔记.md" };
    case "flow.if":
      return { label: "条件分支", condition: { field: "charCount", op: "gt", value: "5000" } };
    case "process.text":
      return { label: "文本工具", operation: "findReplace", find: "", replace: "" };
    case "process.chapter":
      return { label: "章节切分", granularity: "medium", maxChapters: 20, retry: { maxRetries: 2, backoffMs: 3000 } };
    case "process.gameguide":
      return { label: "阴阳师攻略加工", mode: "audited", retry: { maxRetries: 2, backoffMs: 3000 } };
    case "process.mindmap":
      return { label: "思维导图", branchSize: "auto", maxDepth: 4, theme: "paper", retry: { maxRetries: 2, backoffMs: 3000 } };
    case "process.obsidian":
      return { label: "Obsidian 笔记", folder: "" };
    case "process.drill":
      return {
        label: "知识巩固",
        pointCount: 6,
        kinds: ["single", "judge", "cloze"],
        difficulty: "medium",
        withExtensions: true,
        retry: { maxRetries: 2, backoffMs: 3000 },
      };
  }
}
