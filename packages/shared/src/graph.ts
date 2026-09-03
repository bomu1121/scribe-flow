import { canConnect, type PortSpec, type PortType } from "./port";

export type NodeRunStatus = "idle" | "queued" | "running" | "done" | "error" | "cancelled" | "skipped";

export interface PageRef {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

/** B 站来源卡片里的单个可下载视频/分P。 */
export interface BiliSourceItem {
  bvid: string;
  cid: number;
  page: number;
  part: string;
  title?: string;
  cover?: string;
  uploader?: string;
  duration?: number;
}

/** B 站来源：手动 URL 或快捷选择后解析出的 pageInfo。 */
export interface BiliSourceData {
  url: string;
  pageInfo?: PageRef;
  /**
   * 多选模式：一张卡片承载多个 B 站视频/分P。
   * 运行时会逐个产出音频，等价于多张独立来源卡片连到下游。
   */
  items?: BiliSourceItem[];
  /** 展示用元信息（解析成功后写入，运行结果页据此展示封面/标题/UP主）。 */
  bvid?: string;
  title?: string;
  cover?: string;
  uploader?: string;
  duration?: number;
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

export interface RetryConfig {
  /** 最大重试次数（不含首次执行），默认 2。 */
  maxRetries?: number;
  /** 首次重试退避毫秒数，后续按次数递增，默认 3000。 */
  backoffMs?: number;
}

export interface IfCondition {
  field: "charCount" | "wordCount" | "contains";
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains";
  /** contains 系列为要匹配的文本；其余为数字字符串。 */
  value: string;
}

export interface IfData {
  condition: IfCondition;
}

export interface TextToolData {
  operation: "findReplace" | "regexReplace" | "template" | "cleanup";
  find?: string;
  replace?: string;
  pattern?: string;
  flags?: string;
  template?: string;
}

export interface ChapterData {
  granularity: "coarse" | "medium" | "fine";
  maxChapters?: number;
}

export interface MindMapData {
  /** 导图标题；缺省由服务端根据输入首句/文稿生成。 */
  title?: string;
  /** 主分支数量倾向。 */
  branchSize?: "auto" | "few" | "many";
  /** 层级上限（不含中心主题），默认 4。 */
  maxDepth?: number;
  /** 导图主题标识，第一版只影响 Markmap frontmatter 的少量配色。 */
  theme?: "paper" | "presentation" | "academic";
}

/** Obsidian 笔记输出节点：把上游 Markdown 包装成 Obsidian 友好 frontmatter 并写入本地库。 */
export interface ObsidianData {
  /** 笔记标题；缺省取正文第一个 H1，再缺省用“未命名笔记”。 */
  title?: string;
  /** 标签，逗号分隔，写入 frontmatter tags 列表。 */
  tags?: string;
  /** 来源说明，如“B站 / 本地文件 / 网页”。 */
  source?: string;
  /** 作者 / UP 主。 */
  author?: string;
  /** 原始链接。 */
  url?: string;
  /** vault 内相对子目录；缺省用设置里的默认目录。 */
  folder?: string;
}

export type NodeType =
  | "source.bili"
  | "source.file"
  | "source.text"
  | "process.transcribe"
  | "process.refine"
  | "process.prompt"
  | "process.merge"
  | "process.output"
  | "flow.if"
  | "process.text"
  | "process.chapter"
  | "process.mindmap"
  | "process.obsidian";

export interface NodeBase {
  id: string;
  position: { x: number; y: number };
  data: {
    /** 节点显示名（缺省用类型中文名）。 */
    label?: string;
    status?: NodeRunStatus;
    /** 运行后的产物摘要，如「12 个观点块 · 1.2k 字」。 */
    summary?: string;
    /** 失败重试策略（仅对转写/AI/章节等外部调用节点生效）。 */
    retry?: RetryConfig;
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
  | (NodeBase & { type: "process.output"; data: NodeBase["data"] & OutputData })
  | (NodeBase & { type: "flow.if"; data: NodeBase["data"] & IfData })
  | (NodeBase & { type: "process.text"; data: NodeBase["data"] & TextToolData })
  | (NodeBase & { type: "process.chapter"; data: NodeBase["data"] & ChapterData })
  | (NodeBase & { type: "process.mindmap"; data: NodeBase["data"] & MindMapData })
  | (NodeBase & { type: "process.obsidian"; data: NodeBase["data"] & ObsidianData });

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
  "flow.if": "条件分支",
  "process.text": "文本工具",
  "process.chapter": "章节切分",
  "process.mindmap": "思维导图",
  "process.obsidian": "Obsidian 笔记",
};

/** 画布节点卡片宽度（px）；与 apps/web/src/components/canvas/ScribeNode.vue 的 .sf-node--* 宽度保持一致。 */
export const NODE_CARD_WIDTH: Record<NodeType, number> = {
  "source.bili": 380,
  "source.file": 320,
  "source.text": 340,
  "process.transcribe": 224,
  "process.refine": 224,
  "process.prompt": 320,
  "process.merge": 224,
  "process.output": 320,
  "flow.if": 300,
  "process.text": 260,
  "process.chapter": 240,
  "process.mindmap": 300,
  "process.obsidian": 300,
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
  "flow.if": {
    inputs: [
      { id: "in", type: "transcript", label: "输入", accepts: ["transcript", "noteBlock", "noteDoc"] },
    ],
    outputs: [
      { id: "true", type: "transcript", label: "是", accepts: ["transcript", "noteBlock", "noteDoc"] },
      { id: "false", type: "transcript", label: "否", accepts: ["transcript", "noteBlock", "noteDoc"] },
    ],
  },
  "process.text": {
    inputs: [
      { id: "in", type: "transcript", label: "输入", accepts: ["transcript", "noteBlock", "noteDoc"] },
    ],
    outputs: [
      { id: "out", type: "transcript", label: "输出", accepts: ["transcript", "noteBlock", "noteDoc"] },
    ],
  },
  "process.chapter": {
    inputs: [{ id: "in", type: "transcript", label: "文稿" }],
    outputs: [{ id: "chapters", type: "noteBlock", label: "章节" }],
  },
  "process.mindmap": {
    inputs: [
      { id: "in", type: "transcript", label: "输入", accepts: ["transcript", "noteBlock", "noteDoc"] },
    ],
    outputs: [{ id: "doc", type: "noteDoc", label: "导图 Markdown" }],
  },
  "process.obsidian": {
    inputs: [
      { id: "in", type: "noteDoc", label: "输入", accepts: ["transcript", "noteBlock", "noteDoc"] },
    ],
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
