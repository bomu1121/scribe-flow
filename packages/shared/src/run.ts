import type { AsrEngine, WorkflowGraph } from "./graph";
import type { NutstoreSettings } from "./nutstore";
import type { RunMediaView } from "./media";

export type RunStatus = "running" | "success" | "error" | "cancelled";
export type NodeResultStatus = "queued" | "running" | "done" | "error" | "cancelled" | "skipped";

export interface RunMeta {
  id: string;
  projectId: string;
  projectName?: string;
  status: RunStatus;
  scope: RunScope;
  /** 当 scope 为 fromNode/node 时，记录本次运行的起点节点。 */
  nodeId?: string;
  createdAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  /** 产出的文档摘要，如「视频转笔记 · 2.1k 字」。 */
  summary?: string;
  error?: string;
}

export type RunScope = "all" | "fromNode" | "node";

export interface StartRunRequest {
  scope: RunScope;
  nodeId?: string;
}

export interface RunNodeResult {
  nodeId: string;
  nodeType: string;
  nodeLabel?: string;
  status: NodeResultStatus;
  elapsedMs: number;
  attempts?: number;
  summary?: string;
  error?: string;
  output?: NodeOutput;
}

export type NodeOutputKind = "text" | "noteBlock" | "noteDoc" | "audio";

export interface NodeOutput {
  kind: NodeOutputKind;
  /** 小文本/笔记直接内联；大文本只存路径。 */
  text?: string;
  /** 音频/大文件的相对存储路径（data 目录内）。 */
  path?: string;
  size?: number;
}

export interface RunNodeInput {
  id: string;
  runId: string;
  /** 消费该输入的节点（例如 process.transcribe / process.refine）。 */
  targetNodeId: string;
  /** 产生该输入的节点（来源或上游处理节点）。 */
  sourceNodeId: string;
  kind: "text" | "audio";
  text?: string;
  /** 该输入在目标节点处理后的独立结果（例如每个输入单独调用 AI 后的输出）。 */
  resultText?: string;
  path?: string;
  size?: number;
  /** 同一目标节点下的输入顺序（按连线顺序）。 */
  position: number;
  createdAt: number;
}

export interface RunDetail extends RunMeta {
  nodeResults: RunNodeResult[];
  /** 运行时的工程图快照；旧运行可能缺失，前端可回退到当前工程图。 */
  graph?: WorkflowGraph;
  /** 各节点消费的输入明细；用于在结果页单独查看“这条链路身上的所有输入”。 */
  inputs?: RunNodeInput[];
  /** 各来源节点保留的可播放视频附件（keepVideo）。 */
  media?: RunMediaView[];
}

export type RunNodeLogKind = "input" | "ai-request" | "ai-response" | "info" | "error";

export interface RunNodeLog {
  id: string;
  runId: string;
  nodeId: string;
  nodeLabel?: string;
  kind: RunNodeLogKind;
  content: string;
  /** M8-1：配方步骤 id（无配方/非配方节点的日志为空）。 */
  step?: string;
  /**
   * 多输入节点的输入归属：该条日志由第几个输入产生（对应 RunNodeInput.position）。
   * 一个节点处理 8 个视频时，8 组同名日志靠它分组到具体视频。
   */
  inputIndex?: number;
  /** 该节点本次执行的输入总数，用于展示「3/8」。 */
  inputTotal?: number;
  createdAt: number;
}

export interface ResultDelta {
  label: string;
  tone: "same" | "up" | "down" | "changed" | "new";
}

/** SSE 事件（M3 运行引擎；M8-1 增加配方步骤收尾事件）。 */
export type RunEvent =
  | { type: "run.started"; run: RunMeta }
  | { type: "node.started"; runId: string; nodeId: string }
  | { type: "node.progress"; runId: string; nodeId: string; progress: number; message: string }
  | { type: "node.retry"; runId: string; nodeId: string; attempt: number; maxRetries: number; error: string }
  | { type: "node.skipped"; runId: string; nodeId: string; reason: string }
  | { type: "node.done"; runId: string; nodeId: string; summary: string; preview?: string; delta?: ResultDelta }
  | { type: "node.error"; runId: string; nodeId: string; error: string }
  | { type: "node.step.done"; runId: string; nodeId: string; stepId: string; index: number; total: number; summary?: string }
  | { type: "node.step.error"; runId: string; nodeId: string; stepId: string; index: number; total: number; error: string }
  | { type: "run.done"; runId: string; status: RunStatus };

/** AI 提供商预设。 */
export type AiProvider = "deepseek" | "openai" | "custom";

export interface AiSettings {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface AsrSettings {
  engine: AsrEngine;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

/** 外部溯源检索服务配置。当前支持 Tavily Search API。 */
export interface SearchSettings {
  provider: "tavily";
  hasKey: boolean;
  maxResults: number;
}

export interface AppSettings {
  ai: AiSettings;
  asr: AsrSettings;
  search: SearchSettings;
  general: {
    /** 节点执行并发数（1-4）。 */
    concurrency: number;
    outputDir: string;
  };
  obsidian: {
    /** Obsidian 库根目录，例如 D:\\知识库。 */
    vaultPath: string;
    /** vault 内保存笔记的相对子目录，例如 00-Inbox。 */
    folder: string;
    /** 受控标签词表：维度 -> 标签数组。 */
    tagTaxonomy: Record<string, string[]>;
    /** 是否启用 AI 自动补全标签。 */
    autoTagEnabled: boolean;
    /** 最少标签数。 */
    tagMinCount: number;
    /** 最多标签数。 */
    tagMaxCount: number;
    /** 是否启用保存后自动关联相关笔记。 */
    autoLinkEnabled: boolean;
    /** 相关笔记最多数量。 */
    autoLinkMax: number;
    /** 是否双向回链旧笔记。 */
    autoLinkBidirectional: boolean;
  };
  nutstore: NutstoreSettings;
}

export interface UpdateSettingsRequest {
  ai?: {
    provider?: AiProvider;
    baseUrl?: string;
    model?: string;
    /** 只写密钥；留空表示不修改。 */
    apiKey?: string;
  };
  asr?: {
    engine?: AsrEngine;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  search?: {
    provider?: "tavily";
    apiKey?: string;
    maxResults?: number;
  };
  general?: {
    concurrency?: number;
    outputDir?: string;
  };
  obsidian?: {
    vaultPath?: string;
    folder?: string;
    tagTaxonomy?: Record<string, string[]>;
    autoTagEnabled?: boolean;
    tagMinCount?: number;
    tagMaxCount?: number;
    autoLinkEnabled?: boolean;
    autoLinkMax?: number;
    autoLinkBidirectional?: boolean;
  };
  nutstore?: {
    serverUrl?: string;
    account?: string;
    /** 只写密钥；留空表示不修改。 */
    password?: string;
    remoteRoot?: string;
    obsidianRemotePath?: string;
    obsidianMode?: boolean;
  };
}
