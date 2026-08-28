import type { AsrEngine } from "./graph";

export type RunStatus = "running" | "success" | "error" | "cancelled";
export type NodeResultStatus = "queued" | "running" | "done" | "error" | "cancelled" | "skipped";

export interface RunMeta {
  id: string;
  projectId: string;
  projectName?: string;
  status: RunStatus;
  scope: RunScope;
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

export interface RunDetail extends RunMeta {
  nodeResults: RunNodeResult[];
}

export type RunNodeLogKind = "input" | "ai-request" | "ai-response" | "info" | "error";

export interface RunNodeLog {
  id: string;
  runId: string;
  nodeId: string;
  nodeLabel?: string;
  kind: RunNodeLogKind;
  content: string;
  createdAt: number;
}

/** SSE 事件（M3 运行引擎）。 */
export type RunEvent =
  | { type: "run.started"; run: RunMeta }
  | { type: "node.started"; runId: string; nodeId: string }
  | { type: "node.progress"; runId: string; nodeId: string; progress: number; message: string }
  | { type: "node.done"; runId: string; nodeId: string; summary: string }
  | { type: "node.error"; runId: string; nodeId: string; error: string }
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

export interface AppSettings {
  ai: AiSettings;
  asr: AsrSettings;
  general: {
    /** 节点执行并发数（1-4）。 */
    concurrency: number;
    outputDir: string;
  };
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
  general?: {
    concurrency?: number;
    outputDir?: string;
  };
}
