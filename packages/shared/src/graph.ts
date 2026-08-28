import { canConnect, type PortSpec, type PortType } from "./port";

export type NodeRunStatus = "idle" | "queued" | "running" | "done" | "error" | "cancelled";

export interface PageRef {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

/** B 站来源：手动 URL 或快捷选择后解析出的 pageInfo。 */
export interface BiliSourceData {
  url: string;
  pageInfo?: PageRef;
}

export interface FileSourceData {
  fileId?: string;
  fileName?: string;
  /** 服务端相对存储路径（如 uploads/xxxx.mp4）。 */
  filePath?: string;
  size?: number;
}

export interface TextSourceData {
  text: string;
}

export type AsrEngine = "mimo" | "openai-compatible";

export interface TranscribeData {
  asrEngine?: AsrEngine;
  asrUrl?: string;
  asrKey?: string;
}

export interface AiNodeData {
  /** 引用的提示词块 id（builtin.* 或自定义 id）。 */
  promptBlockId?: string;
  /** 节点级覆盖提示词（覆盖块内容）。 */
  promptOverride?: string;
  model?: string;
  outputName?: string;
}

export interface MergeData {
  title?: string;
}

export interface OutputData {
  fileName?: string;
}

export type NodeType =
  | "source.bili"
  | "source.file"
  | "source.text"
  | "process.transcribe"
  | "process.refine"
  | "process.prompt"
  | "process.merge"
  | "process.output";

export interface NodeBase {
  id: string;
  position: { x: number; y: number };
  data: {
    /** 节点显示名（缺省用类型中文名）。 */
    label?: string;
    status?: NodeRunStatus;
    /** 运行后的产物摘要，如「12 个观点块 · 1.2k 字」。 */
    summary?: string;
  };
}

export type GraphNode =
  | (NodeBase & { type: "source.bili"; data: NodeBase["data"] & BiliSourceData })
  | (NodeBase & { type: "source.file"; data: NodeBase["data"] & FileSourceData })
  | (NodeBase & { type: "source.text"; data: NodeBase["data"] & TextSourceData })
  | (NodeBase & { type: "process.transcribe"; data: NodeBase["data"] & TranscribeData })
  | (NodeBase & { type: "process.refine"; data: NodeBase["data"] & AiNodeData })
  | (NodeBase & { type: "process.prompt"; data: NodeBase["data"] & AiNodeData })
  | (NodeBase & { type: "process.merge"; data: NodeBase["data"] & MergeData })
  | (NodeBase & { type: "process.output"; data: NodeBase["data"] & OutputData });

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowGraph {
  schemaVersion: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: GraphViewport;
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  "source.bili": "B站链接",
  "source.file": "本地文件",
  "source.text": "文本",
  "process.transcribe": "转写",
  "process.refine": "AI 校对",
  "process.prompt": "AI 提示词",
  "process.merge": "合并",
  "process.output": "输出",
};

/** 每个节点类型的端口定义。 */
export const NODE_PORTS: Record<NodeType, { inputs: PortSpec[]; outputs: PortSpec[] }> = {
  "source.bili": { inputs: [], outputs: [{ id: "audio", type: "audio", label: "音频" }] },
  "source.file": { inputs: [], outputs: [{ id: "audio", type: "audio", label: "音频" }] },
  "source.text": { inputs: [], outputs: [{ id: "transcript", type: "transcript", label: "文稿" }] },
  "process.transcribe": {
    inputs: [{ id: "audio", type: "audio", label: "音频" }],
    outputs: [{ id: "transcript", type: "transcript", label: "文稿" }],
  },
  "process.refine": {
    inputs: [{ id: "transcript", type: "transcript", label: "文稿" }],
    outputs: [{ id: "transcript", type: "transcript", label: "文稿" }],
  },
  "process.prompt": {
    inputs: [{ id: "transcript", type: "transcript", label: "文稿" }],
    outputs: [{ id: "noteBlock", type: "noteBlock", label: "笔记块" }],
  },
  "process.merge": {
    inputs: [{ id: "noteBlock", type: "noteBlock", label: "笔记块" }],
    outputs: [{ id: "noteDoc", type: "noteDoc", label: "笔记文档" }],
  },
  "process.output": {
    inputs: [{ id: "noteDoc", type: "noteDoc", label: "笔记文档" }],
    outputs: [],
  },
};

/** 依据节点类型判断一条边是否合法。 */
export function isValidConnection(sourceNode: GraphNode, sourcePort: PortType | undefined, targetNode: GraphNode, targetPort: PortType | undefined): boolean {
  if (!sourcePort || !targetPort) return false;
  if (sourceNode.id === targetNode.id) return false;
  return canConnect(sourcePort, targetPort);
}

/** 新建一个合法的空 graph。 */
export function emptyGraph(): WorkflowGraph {
  return { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

let idCounter = 0;

/** 生成短 id：n_ 前缀 + 时间戳 + 序号，避免画布节点冲突。 */
export function nextNodeId(prefix = "n"): string {
  idCounter = (idCounter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(3, "0")}`;
}

export function nextEdgeId(): string {
  return nextNodeId("e");
}
