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
  /**
   * 素材段标识（见 segmentKey）：该产物对应哪一个来源素材。
   * 缺失表示不可筛选的整体产物（如合并后的文档），一律通过节点的素材挑选。
   */
  itemKey?: string;
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
  /** 该输入承载的素材段标识（见 segment.ts 的 segmentKey）；整体产物可能没有。 */
  itemKey?: string;
  /**
   * 该输入被节点的素材挑选排除，本次没有进入处理。
   * 记录它只为让结果页能说明「素材共 8 段、本次只加工 2 段」，不代表节点消费了它。
   */
  excluded?: boolean;
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

/** 外部溯源检索渠道：智谱 BigModel 联网搜索、Tavily Search API。 */
export type SearchProvider = "zhipu" | "tavily";

/** 渠道展示名，服务端错误信息与设置页共用一份。 */
export const SEARCH_PROVIDER_LABELS: Record<SearchProvider, string> = {
  zhipu: "智谱",
  tavily: "Tavily",
};

/** 外部溯源检索服务配置。 */
export interface SearchSettings {
  provider: SearchProvider;
  hasKey: boolean;
  maxResults: number;
}

/**
 * 「常规」分组的设置：运行与产出的全局默认。
 * 这里放的是**没被节点/工程单独指定的东西**，节点自己配了就以节点为准（重试策略就是这种关系）。
 */
export interface GeneralSettings {
  /** 节点执行并发数（1-4）。 */
  concurrency: number;
  /**
   * 产物根目录。相对路径相对数据目录解析，也可以直接填绝对路径把成稿写到数据目录之外。
   * 留空回落 DEFAULT_OUTPUT_DIR。
   */
  outputDir: string;
  /**
   * 服务端解析后的产物根目录绝对路径。
   * 只在设置接口的响应（与 engine 内部）里有值——数据目录是启动参数不是设置项，
   * 底层 `getSettings(db)` 拿不到它，所以这是可选的，界面按「有则回显」处理。
   */
  resolvedOutputDir?: string;
  /** 自动落盘的文件名模板，占位符见 FILE_NAME_TOKENS。 */
  fileNameTemplate: string;
  /** 节点没单独配 retry 时的默认最大重试次数（0-10）。 */
  maxRetries: number;
  /** 节点没单独配 retry 时的默认重试等待基数（秒，1-60）；按次数线性递增。 */
  retryBackoffSec: number;
  /** 运行结束时发系统通知。 */
  runEndNotify: boolean;
  /** 运行结束时播放提示音。 */
  runEndSound: boolean;
}

/** 新数值设置的取值范围；服务端校验、设置页输入框与服务端收口共用一份。 */
export const GENERAL_LIMITS = {
  concurrency: { min: 1, max: 4 },
  maxRetries: { min: 0, max: 10 },
  retryBackoffSec: { min: 1, max: 60 },
} as const;

export interface AppSettings {
  ai: AiSettings;
  asr: AsrSettings;
  search: SearchSettings;
  general: GeneralSettings;
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
    provider?: SearchProvider;
    apiKey?: string;
    maxResults?: number;
  };
  general?: {
    concurrency?: number;
    outputDir?: string;
    fileNameTemplate?: string;
    maxRetries?: number;
    retryBackoffSec?: number;
    runEndNotify?: boolean;
    runEndSound?: boolean;
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
