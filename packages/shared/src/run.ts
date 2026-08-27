export type RunStatus = "running" | "success" | "error" | "cancelled";

export interface RunMeta {
  id: string;
  projectId: string;
  status: RunStatus;
  createdAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  /** 产出的文档摘要，如「视频观点笔记 · 2.1k 字」。 */
  summary?: string;
}

export interface RunNodeResult {
  nodeId: string;
  status: "done" | "error" | "cancelled";
  elapsedMs: number;
  summary?: string;
  error?: string;
}

export interface RunDetail extends RunMeta {
  nodeResults: RunNodeResult[];
}

/** SSE 事件（M3 实现运行引擎后启用）。 */
export type RunEvent =
  | { type: "run.started"; run: RunMeta }
  | { type: "node.started"; runId: string; nodeId: string }
  | { type: "node.progress"; runId: string; nodeId: string; progress: number; message: string }
  | { type: "node.done"; runId: string; nodeId: string; summary: string }
  | { type: "node.error"; runId: string; nodeId: string; error: string }
  | { type: "run.done"; runId: string; status: RunStatus };
