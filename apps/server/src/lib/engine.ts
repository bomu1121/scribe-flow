import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, desc, eq, notInArray } from "drizzle-orm";
import {
  BUILTIN_PROMPT_BLOCKS,
  NODE_TYPE_LABELS,
  type GraphNode,
  type NodeOutput,
  type RunEvent,
  type RunMeta,
  type RunNodeInput,
  type RunNodeResult,
  type RunScope,
  type RunStatus,
  type WorkflowGraph,
} from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { biliCookies, projects, runNodeInputs, runNodeLogs, runNodeResults, runs } from "../db/schema";
import { chatCompletion, transcribeAudio } from "./ai";
import { fetchBiliVideoDetail } from "./bilibili";
import { downloadBiliAudio, toAsrWav } from "./media";
import { getAiConfig, getAsrConfig, getSettings } from "./settings";

const MAX_INLINE_TEXT = 200_000;

/** 只有外部调用类节点才自动重试；本地节点失败重试无意义。 */
const RETRYABLE_NODE_TYPES = new Set(["process.transcribe", "process.refine", "process.prompt", "process.chapter"]);

/** 判断一次失败是否值得重试：取消与配置类错误不重试，其余（超时/网络/5xx/空结果）重试。 */
function isRetryableError(error: Error, cancelled: boolean): boolean {
  if (cancelled) return false;
  const message = error.message;
  if (/运行已取消|未配置.*密钥|没有可.*输入|文稿为空|链接为空|缺少 BV|缺少 cid|文件为空|正则表达式无效|文稿过短/.test(message)) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ActiveRun {
  id: string;
  projectId: string;
  projectName: string;
  graph: WorkflowGraph;
  scope: RunScope;
  nodeIds: Set<string>;
  order: string[];
  cancelled: boolean;
  listeners: Set<(event: RunEvent) => void>;
  outputs: Map<string, NodeOutput[]>;
  /** 条件分支节点执行后的分支结果（true/false），用于下游按 handle 取数与跳过。 */
  branches: Map<string, "true" | "false">;
  nodeAborts: Map<string, AbortController>;
  startedAt: number;
}

interface ResolvedInput {
  sourceNodeId: string;
  output: NodeOutput;
  position: number;
}

interface ResolvedInputs {
  text?: string;
  audioPaths: string[];
  items: ResolvedInput[];
}

function escapePathName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

function previewFor(output: NodeOutput): string | undefined {
  if (!output || (output.kind !== "text" && output.kind !== "noteBlock" && output.kind !== "noteDoc")) return undefined;
  const text = output.text ?? "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.slice(0, 120) || undefined;
}

function nodeLabel(node: GraphNode): string {
  return String((node.data as { label?: string }).label ?? NODE_TYPE_LABELS[node.type] ?? node.type);
}

/** 中文字符 + 英文单词数（近似）。 */
function countWords(text: string): number {
  const chinese = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const english = text.replace(/[\u4e00-\u9fa5]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return chinese + english;
}

function applyTextOperation(
  operation: string,
  text: string,
  data: Record<string, unknown>,
): string {
  switch (operation) {
    case "findReplace": {
      const find = String(data.find ?? "");
      const replace = String(data.replace ?? "");
      if (!find) return text;
      return text.split(find).join(replace);
    }
    case "regexReplace": {
      const pattern = String(data.pattern ?? "");
      if (!pattern) throw new Error("正则表达式无效：pattern 为空");
      const flags = String(data.flags ?? "");
      try {
        return text.replace(new RegExp(pattern, flags), String(data.replace ?? ""));
      } catch (err) {
        throw new Error(`正则表达式无效：${err instanceof Error ? err.message : "未知错误"}`);
      }
    }
    case "template": {
      const template = String(data.template ?? "");
      if (!template.includes("{{input}}")) return template ? `${template}\n\n${text}` : text;
      return template.split("{{input}}").join(text);
    }
    case "cleanup":
      return text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    default:
      throw new Error(`文本工具暂不支持该操作：${operation}`);
  }
}

/** 解析章节切分的 LLM 输出；非法 JSON 抛中文错误。 */
function parseChaptersJson(raw: string, maxChapters: number): { title: string; content: string }[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const fragment = start >= 0 && end > start ? raw.slice(start, end + 1) : raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fragment);
  } catch (err) {
    throw new Error(`章节切分结果不是有效 JSON：${err instanceof Error ? err.message : "解析失败"}`);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { chapters?: unknown })?.chapters;
  if (!Array.isArray(list)) throw new Error("章节切分结果缺少 chapters 数组");
  const chapters = list
    .map((item) => {
      const obj = item as { title?: unknown; content?: unknown };
      return { title: String(obj.title ?? "").trim(), content: String(obj.content ?? "").trim() };
    })
    .filter((c) => c.title && c.content);
  if (chapters.length === 0) throw new Error("章节切分结果为空");
  if (chapters.length > maxChapters) {
    throw new Error(`章节数量 ${chapters.length} 超过上限 ${maxChapters}，请调大“最多章节”或改用更粗的粒度`);
  }
  return chapters;
}

export class RunEngine {
  private actives = new Map<string, ActiveRun>();

  constructor(
    private db: AppDatabase,
    private dataDir: string,
  ) {}

  get activeRunIds(): string[] {
    return [...this.actives.keys()];
  }

  /** 启动一次运行：run 行由调用方创建。 */
  start(runId: string, projectId: string, graph: WorkflowGraph, scope: RunScope, nodeId?: string): void {
    const nodeIds = new Set<string>();
    if (scope === "node" && nodeId) {
      nodeIds.add(nodeId);
    } else {
      for (const node of graph.nodes) nodeIds.add(node.id);
      if (scope === "fromNode" && nodeId) {
        const downstream = this.downstream(graph, nodeId);
        for (const id of [...nodeIds]) {
          if (id !== nodeId && !downstream.has(id)) nodeIds.delete(id);
        }
      }
    }
    const order = this.topological(graph, nodeIds);
    const active: ActiveRun = {
      id: runId,
      projectId,
      projectName: "",
      graph,
      scope,
      nodeIds,
      order,
      cancelled: false,
      listeners: new Set(),
      outputs: new Map(),
      branches: new Map(),
      nodeAborts: new Map(),
      startedAt: Date.now(),
    };
    const project = this.db.select().from(projects).where(eq(projects.id, projectId)).get();
    active.projectName = project?.name ?? "";
    this.actives.set(runId, active);
    void this.runLoop(active);
  }

  stop(runId: string): boolean {
    const active = this.actives.get(runId);
    if (!active) return false;
    active.cancelled = true;
    for (const controller of active.nodeAborts.values()) controller.abort();
    return true;
  }

  /** 强制结束：立即把运行与未完成节点标记为 cancelled，并中止所有进行中的 HTTP 请求。 */
  forceStop(runId: string): boolean {
    const active = this.actives.get(runId);
    if (active) {
      active.cancelled = true;
      for (const controller of active.nodeAborts.values()) controller.abort();
    }
    const row = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!row) return false;
    const now = Date.now();
    this.db
      .update(runs)
      .set({ status: "cancelled", finishedAt: now, elapsedMs: now - (active?.startedAt ?? row.createdAt), error: "已手动强制结束" })
      .where(eq(runs.id, runId))
      .run();
    this.db
      .update(runNodeResults)
      .set({ status: "cancelled", error: "已手动强制结束", updatedAt: now })
      .where(and(eq(runNodeResults.runId, runId), notInArray(runNodeResults.status, ["done", "error", "cancelled", "skipped"])))
      .run();
    if (active) {
      this.emit(active, { type: "run.done", runId, status: "cancelled" });
    }
    return true;
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const active = this.actives.get(runId);
    active?.listeners.add(listener);
    return () => active?.listeners.delete(listener);
  }

  private emit(active: ActiveRun, event: RunEvent) {
    for (const listener of active.listeners) listener(event);
  }

  private downstream(graph: WorkflowGraph, rootId: string): Set<string> {
    const result = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges) {
        if (result.has(edge.source) && !result.has(edge.target)) {
          result.add(edge.target);
          changed = true;
        }
      }
    }
    return result;
  }

  private topological(graph: WorkflowGraph, nodeIds: Set<string>): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const edge of graph.edges) {
        if (edge.target === id && nodeIds.has(edge.source)) visit(edge.source);
      }
      order.push(id);
    };
    for (const id of nodeIds) visit(id);
    return order;
  }

  private async runLoop(active: ActiveRun) {
    const concurrency = Math.min(4, Math.max(1, getSettings(this.db).general.concurrency || 2));
    const done = new Set<string>();
    const skipped = new Set<string>();
    const running = new Map<string, Promise<"done" | "error">>();
    const failed = new Set<string>();

    try {
      while (done.size + failed.size < active.order.length) {
        if (active.cancelled) break;
        await this.skipBlocked(active, done, failed, skipped);
        const ready = active.order.filter((id) => !done.has(id) && !failed.has(id) && !running.has(id) && this.depsDone(active, id, done));
        for (const nodeId of ready) {
          if (running.size >= concurrency) break;
          running.set(nodeId, this.executeNode(active, nodeId));
        }
        if (running.size === 0) break;
        await Promise.race([...running.values()]);
        for (const [id, promise] of running) {
          if (await this.isSettled(promise)) {
            const result = await promise;
            if (result === "done") done.add(id);
            else failed.add(id);
            running.delete(id);
          }
        }
      }

      // 标记未执行的节点为 skipped（失败上游导致）
      for (const nodeId of active.order) {
        if (!done.has(nodeId) && !failed.has(nodeId)) {
          await this.updateNode(active, nodeId, active.cancelled ? "cancelled" : "skipped", 0, undefined, undefined, active.cancelled ? "已取消" : "上游失败，跳过");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "运行失败";
      await this.finishRun(active, "error", message);
      return;
    }

    if (active.cancelled) {
      await this.finishRun(active, "cancelled");
      return;
    }
    await this.finishRun(active, failed.size > 0 ? "error" : "success", failed.size > 0 ? "部分节点执行失败" : undefined);
  }

  private async isSettled(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    await Promise.race([promise.then(() => (settled = true), () => (settled = true)), new Promise((r) => setTimeout(r, 0))]);
    return settled;
  }

  private depsDone(active: ActiveRun, nodeId: string, done: Set<string>): boolean {
    for (const edge of active.graph.edges) {
      if (edge.target !== nodeId) continue;
      if (!active.nodeIds.has(edge.source)) continue;
      if (!done.has(edge.source)) return false;
    }
    return true;
  }

  /** 条件分支跳过传播：某个节点的所有上游都永久断供（分支未命中或上游已跳过）时，把它标为 skipped。 */
  private async skipBlocked(active: ActiveRun, done: Set<string>, failed: Set<string>, skipped: Set<string>): Promise<void> {
    for (const nodeId of active.order) {
      if (done.has(nodeId) || failed.has(nodeId)) continue;
      const incoming = active.graph.edges.filter((e) => e.target === nodeId && active.nodeIds.has(e.source));
      if (incoming.length === 0) continue;
      const allBlocked = incoming.every((e) => this.isEdgeBlocked(active, e, skipped));
      if (!allBlocked) continue;
      const reason = "条件分支未命中，跳过";
      await this.updateNode(active, nodeId, "skipped", 0, undefined, undefined, reason);
      this.emit(active, { type: "node.skipped", runId: active.id, nodeId, reason });
      done.add(nodeId);
      skipped.add(nodeId);
    }
  }

  /** 一条边是否永久断供：来源是已跳过的节点，或来源是已执行的条件分支且输出 handle 与命中分支不符。 */
  private isEdgeBlocked(active: ActiveRun, edge: { source: string; sourceHandle?: string }, skipped: Set<string>): boolean {
    if (skipped.has(edge.source)) return true;
    const source = active.graph.nodes.find((n) => n.id === edge.source);
    if (source?.type !== "flow.if") return false;
    const branch = active.branches.get(edge.source);
    if (!branch) return false;
    return branch !== (edge.sourceHandle || "true");
  }

  /** 单节点/局部运行：不在本次运行内的上游节点，从最近一次成功结果取输入（支持多输出节点）。 */
  private async previousOutputs(nodeId: string): Promise<NodeOutput[]> {
    const row = this.db
      .select()
      .from(runNodeResults)
      .where(eq(runNodeResults.nodeId, nodeId))
      .orderBy(desc(runNodeResults.updatedAt))
      .limit(1)
      .get();
    if (!row || row.status !== "done" || !row.outputKind) return [];
    if (row.nodeType === "process.transcribe" || row.nodeType === "process.refine" || row.nodeType === "process.prompt") {
      const inputRows = this.db
        .select()
        .from(runNodeInputs)
        .where(and(eq(runNodeInputs.runId, row.runId), eq(runNodeInputs.targetNodeId, nodeId), eq(runNodeInputs.kind, "text")))
        .orderBy(runNodeInputs.position)
        .all();
      if (inputRows.length > 0) {
        const kind: NodeOutput["kind"] = row.nodeType === "process.prompt" ? "noteBlock" : "text";
        const outputs: NodeOutput[] = [];
        for (const inputRow of inputRows) {
          const text = inputRow.resultText ?? inputRow.text;
          if (text) outputs.push({ kind, text, size: text.length });
        }
        if (outputs.length > 0) return outputs;
      }
    }
    // 多选 B 站/本地音视频来源：从该节点被下游消费的音频输入行还原多个输出，
    // 保证“从下游节点单独运行”时仍能拿到全部音频，而不是只有合并后的第一个。
    if (row.nodeType === "source.bili" || row.nodeType === "source.file") {
      const audioRows = this.db
        .select()
        .from(runNodeInputs)
        .where(and(eq(runNodeInputs.runId, row.runId), eq(runNodeInputs.sourceNodeId, nodeId), eq(runNodeInputs.kind, "audio")))
        .orderBy(runNodeInputs.position)
        .all();
      const seen = new Set<string>();
      const outputs: NodeOutput[] = [];
      for (const inputRow of audioRows) {
        if (!inputRow.path || seen.has(inputRow.path)) continue;
        seen.add(inputRow.path);
        outputs.push({ kind: "audio", path: inputRow.path, size: inputRow.size ?? undefined });
      }
      if (outputs.length > 0) return outputs;
    }
    return [{ kind: row.outputKind, text: row.outputText ?? undefined, path: row.outputPath ?? undefined, size: row.outputSize ?? undefined }];
  }

  private async resolveInputs(active: ActiveRun, node: GraphNode): Promise<ResolvedInputs> {
    const items: ResolvedInput[] = [];
    for (const edge of active.graph.edges) {
      if (edge.target !== node.id) continue;
      const source = active.graph.nodes.find((n) => n.id === edge.source);
      if (!source) continue;
      // 条件分支按 handle 取数：分支不匹配的边不传输入。
      if (source.type === "flow.if" && active.nodeIds.has(source.id)) {
        const branch = active.branches.get(source.id);
        if (branch && branch !== (edge.sourceHandle || "true")) continue;
      }
      const outputs = active.nodeIds.has(source.id) ? (active.outputs.get(source.id) ?? []) : await this.previousOutputs(source.id);
      for (const output of outputs) items.push({ sourceNodeId: source.id, output, position: items.length });
    }
    const audioPaths = items
      .filter((i) => i.output.kind === "audio")
      .map((i) => i.output.path)
      .filter((p): p is string => Boolean(p))
      .map((p) => resolve(this.dataDir, p));
    const texts = items.filter((i) => i.output.kind !== "audio");
    return { text: texts.map((t) => t.output.text ?? "").filter(Boolean).join("\n\n") || undefined, audioPaths, items };
  }

  /** 把当前节点消费到的每个输入落库，供结果页单独查看。 */
  private async persistInputs(active: ActiveRun, targetNodeId: string, items: ResolvedInput[]) {
    const now = Date.now();
    for (const item of items) {
      const output = item.output;
      await this.db
        .insert(runNodeInputs)
        .values({
          id: randomUUID(),
          runId: active.id,
          targetNodeId,
          sourceNodeId: item.sourceNodeId,
          kind: output.kind === "audio" ? "audio" : "text",
          text: output.kind === "audio" ? undefined : output.text,
          path: output.path,
          size: output.size,
          position: item.position,
          createdAt: now,
        })
        .run();
    }
  }

  /** 音频转写完成后，把对应音频输入行升级为文本（保留 source/target/position）。 */
  private async updateInputText(active: ActiveRun, targetNodeId: string, sourceNodeId: string, position: number, text: string, size: number) {
    await this.db
      .update(runNodeInputs)
      .set({ kind: "text", text, size, path: undefined })
      .where(
        and(
          eq(runNodeInputs.runId, active.id),
          eq(runNodeInputs.targetNodeId, targetNodeId),
          eq(runNodeInputs.sourceNodeId, sourceNodeId),
          eq(runNodeInputs.position, position),
        ),
      )
      .run();
  }

  /** AI 节点逐个处理输入后，把每个输入对应的独立处理结果写回。 */
  private async updateInputResult(active: ActiveRun, targetNodeId: string, sourceNodeId: string, position: number, resultText: string) {
    await this.db
      .update(runNodeInputs)
      .set({ resultText })
      .where(
        and(
          eq(runNodeInputs.runId, active.id),
          eq(runNodeInputs.targetNodeId, targetNodeId),
          eq(runNodeInputs.sourceNodeId, sourceNodeId),
          eq(runNodeInputs.position, position),
        ),
      )
      .run();
  }

  /** 多输出节点落库/展示时合并成一份主输出，保留兼容性；独立结果仍存于 run_node_inputs。 */
  private combineOutputs(node: GraphNode, outputs: NodeOutput[]): NodeOutput {
    if (outputs.length === 0) return { kind: "text", text: "" };
    if (outputs.length === 1) return outputs[0];
    // 多输出音视频来源（多选卡片）没有可合并的文本，主输出保留第一个音频即可；
    // 完整多输出仍通过 active.outputs / run_node_inputs 传递给下游。
    if (outputs.every((output) => output.kind === "audio")) return outputs[0];
    const firstKind = outputs[0]?.kind;
    const kind: NodeOutput["kind"] =
      node.type === "process.prompt"
        ? "noteBlock"
        : node.type === "process.chapter"
          ? "noteDoc"
          : node.type === "flow.if" || node.type === "process.text"
            ? (firstKind ?? "text")
            : node.type === "process.merge" || node.type === "process.output"
              ? "noteDoc"
              : "text";
    const text = outputs
      .map((output) => output.text ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n");
    return { kind, text, size: text.length };
  }

  private nodeById(active: ActiveRun, nodeId: string): GraphNode {
    const node = active.graph.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`节点不存在：${nodeId}`);
    return node;
  }

  private async executeNode(active: ActiveRun, nodeId: string): Promise<"done" | "error"> {
    const node = this.nodeById(active, nodeId);
    const started = Date.now();
    const abort = new AbortController();
    active.nodeAborts.set(nodeId, abort);
    const data = node.data as Record<string, unknown>;
    const retry = (data.retry as { maxRetries?: number; backoffMs?: number } | undefined) ?? {};
    const maxRetries = RETRYABLE_NODE_TYPES.has(node.type) ? Math.max(0, Number(retry.maxRetries ?? 2) || 0) : 0;
    const backoffMs = Math.max(100, Number(retry.backoffMs ?? 3000) || 3000);
    await this.updateNode(active, nodeId, "running", 0, undefined, undefined, undefined, 1);
    this.emit(active, { type: "node.started", runId: active.id, nodeId });

    let attempts = 0;
    try {
      const inputs = await this.resolveInputs(active, node);
      await this.persistInputs(active, node.id, inputs.items);
      while (true) {
        attempts += 1;
        try {
          const result = await this.runNode(active, node, inputs, abort.signal);
          if (active.cancelled) throw new Error("运行已取消");
          const elapsed = Date.now() - started;
          const combined = this.combineOutputs(node, result.outputs);
          await this.updateNode(active, nodeId, "done", elapsed, result.summary, combined, undefined, attempts);
          this.emit(active, { type: "node.done", runId: active.id, nodeId, summary: result.summary ?? "完成", preview: previewFor(combined) });
          active.outputs.set(nodeId, result.outputs);
          return "done";
        } catch (err) {
          const message = err instanceof Error ? err.message : "节点执行失败";
          const error = err instanceof Error ? err : new Error(message);
          if (attempts <= maxRetries && isRetryableError(error, active.cancelled)) {
            const wait = backoffMs * attempts;
            this.emit(active, { type: "node.retry", runId: active.id, nodeId, attempt: attempts, maxRetries, error: message });
            await this.updateNode(active, nodeId, "running", 0, undefined, undefined, undefined, attempts + 1);
            await sleep(wait);
            continue;
          }
          const elapsed = Date.now() - started;
          const status = active.cancelled ? "cancelled" : "error";
          const finalError = active.cancelled ? "已取消" : message;
          await this.updateNode(active, nodeId, status, elapsed, undefined, undefined, finalError, attempts);
          this.emit(active, { type: "node.error", runId: active.id, nodeId, error: finalError });
          return status === "cancelled" ? "done" : "error";
        }
      }
    } finally {
      active.nodeAborts.delete(nodeId);
    }
  }

  private async runNode(
    active: ActiveRun,
    node: GraphNode,
    inputs: ResolvedInputs,
    signal?: AbortSignal,
  ): Promise<{ outputs: NodeOutput[]; summary?: string }> {
    const data = node.data as Record<string, unknown>;
    switch (node.type) {
      case "source.bili": {
        const items = Array.isArray(data.items) ? (data.items as { bvid?: string; cid?: number; page?: number; part?: string; duration?: number }[]) : [];
        if (items.length > 0) {
          const cookie = this.db.select().from(biliCookies).where(eq(biliCookies.id, 1)).get()?.cookie;
          const dir = join(this.dataDir, "runs", active.id, "nodes", node.id);
          await mkdir(dir, { recursive: true });
          const outputs: NodeOutput[] = [];
          for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            const bvid = String(item.bvid ?? "").trim();
            if (!bvid) throw new Error(`多选卡片第 ${i + 1} 项缺少 BV 号`);
            let cid = Number(item.cid ?? 0);
            if (!cid) {
              const detail = await fetchBiliVideoDetail(bvid);
              const page = detail.pages.find((p) => p.page === Number(item.page ?? 1)) ?? detail.pages[0];
              cid = page?.cid ?? 0;
            }
            if (!cid) throw new Error(`多选卡片第 ${i + 1} 项缺少 cid，请重新在卡片中解析链接`);
            await this.progress(active, node.id, Math.round((i / items.length) * 80 + 10), `下载第 ${i + 1}/${items.length} 个 B 站音轨`);
            const audio = await downloadBiliAudio(bvid, cid, cookie, dir);
            const wav = join(dir, `audio-${i + 1}.wav`);
            await toAsrWav(audio, wav);
            const size = await stat(wav).then((s) => s.size);
            outputs.push({ kind: "audio", path: `runs/${active.id}/nodes/${node.id}/audio-${i + 1}.wav`, size });
          }
          return { outputs, summary: `${items.length} 个音轨已就绪` };
        }

        const url = String(data.url ?? "").trim();
        const bvid = url.match(/BV[0-9A-Za-z]+/)?.[0] || String(data.bvid ?? "").trim();
        if (!url && !bvid) throw new Error("B 站链接为空");
        if (!bvid) throw new Error("链接中没有识别到 BV 号");
        const pageInfo = data.pageInfo as { cid?: number; page?: number } | undefined;
        let cid = Number(pageInfo?.cid ?? 0);
        if (!cid) {
          const detail = await fetchBiliVideoDetail(bvid);
          const page = detail.pages.find((p) => p.page === Number(pageInfo?.page ?? 1)) ?? detail.pages[0];
          cid = page?.cid ?? 0;
        }
        if (!cid) throw new Error("该视频缺少 cid，请重新在卡片中解析链接");
        const cookie = this.db.select().from(biliCookies).where(eq(biliCookies.id, 1)).get()?.cookie;
        const dir = join(this.dataDir, "runs", active.id, "nodes", node.id);
        await mkdir(dir, { recursive: true });
        await this.progress(active, node.id, 20, "下载 B 站音轨");
        const audio = await downloadBiliAudio(bvid, cid, cookie, dir);
        await this.progress(active, node.id, 70, "FFmpeg 转码为 16k 单声道");
        const wav = join(dir, "audio.wav");
        await toAsrWav(audio, wav);
        const size = await stat(wav).then((s) => s.size);
        const rel = `runs/${active.id}/nodes/${node.id}/audio.wav`;
        return { outputs: [{ kind: "audio", path: rel, size }], summary: "音轨已就绪" };
      }

      case "source.file": {
        const filePath = String(data.filePath ?? "");
        if (!filePath) throw new Error("请先上传本地音视频");
        const abs = resolve(this.dataDir, filePath);
        const dir = join(this.dataDir, "runs", active.id, "nodes", node.id);
        await mkdir(dir, { recursive: true });
        await this.progress(active, node.id, 30, "FFmpeg 转码为 16k 单声道");
        const wav = join(dir, "audio.wav");
        await toAsrWav(abs, wav);
        return {
          outputs: [{ kind: "audio", path: `runs/${active.id}/nodes/${node.id}/audio.wav` }],
          summary: String(data.fileName ?? "音轨已就绪"),
        };
      }

      case "source.text": {
        const text = String(data.text ?? "").trim();
        if (!text) throw new Error("文稿为空");
        return { outputs: [{ kind: "text", text, size: text.length }], summary: `${text.length} 字` };
      }

      case "process.transcribe": {
        const audioItems = inputs.items.filter((i) => i.output.kind === "audio");
        if (audioItems.length === 0) throw new Error("没有可转写的音频输入");
        const config = getAsrConfig(this.db);
        if (!config.apiKey) throw new Error("未配置语音识别密钥，请到设置页填写");
        const parts: string[] = [];
        for (let i = 0; i < audioItems.length; i += 1) {
          const item = audioItems[i];
          const audioPath = resolve(this.dataDir, item.output.path ?? "");
          await this.progress(active, node.id, Math.round(10 + (i / audioItems.length) * 80), `转写音频 ${i + 1}/${audioItems.length}`);
          await this.log(active, node.id, "info", `音频输入 ${i + 1}：${audioPath}`);
          const text = await transcribeAudio(config, audioPath, signal);
          if (!text.trim()) throw new Error(`第 ${i + 1} 个音频转写结果为空`);
          await this.log(active, node.id, "ai-response", text);
          const trimmed = text.trim();
          await this.updateInputText(active, node.id, item.sourceNodeId, item.position, trimmed, trimmed.length);
          parts.push(trimmed);
        }
        const outputs = parts.map((text) => ({ kind: "text" as const, text, size: text.length }));
        const total = parts.reduce((sum, text) => sum + text.length, 0);
        return { outputs, summary: `${audioItems.length} 个音频 · ${total} 字` };
      }

      case "process.refine":
      case "process.prompt": {
        const textItems = inputs.items.filter((i) => i.output.kind !== "audio" && i.output.text?.trim());
        if (textItems.length === 0) throw new Error("没有文稿输入");
        await this.progress(active, node.id, 5, `准备逐个处理 ${textItems.length} 个输入`);
        const aiConfig = getAiConfig(this.db);
        if (!aiConfig.apiKey) throw new Error("未配置 AI 模型密钥，请到设置页填写");
        const blockId = String(data.promptBlockId ?? "");
        const override = String(data.promptOverride ?? "");
        const builtin = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === blockId);
        const system =
          override.trim() ||
          builtin?.prompt ||
          (node.type === "process.refine"
            ? "你是文字校对编辑。修正转写文稿中的错别字、重复与语气词，保持原意与信息完整，只输出校对后的文稿。"
            : "你是内容编辑。按用户要求整理文稿，只输出整理结果。");
        const model = String(data.model ?? "").trim() || aiConfig.model;
        const parts: string[] = [];
        for (let i = 0; i < textItems.length; i += 1) {
          const item = textItems[i];
          const inputText = item.output.text?.trim() ?? "";
          await this.progress(active, node.id, Math.round(10 + (i / textItems.length) * 80), `处理输入 ${i + 1}/${textItems.length}`);
          await this.log(active, node.id, "input", inputText);
          await this.log(active, node.id, "ai-request", `${model}\n\n${system}`);
          const result = await chatCompletion({ ...aiConfig, model }, system, inputText, signal);
          if (!result.trim()) throw new Error(`第 ${i + 1} 个输入处理结果为空`);
          const trimmed = result.trim();
          await this.log(active, node.id, "ai-response", trimmed);
          await this.updateInputResult(active, node.id, item.sourceNodeId, item.position, trimmed);
          parts.push(trimmed);
        }
        const kind: NodeOutput["kind"] = node.type === "process.prompt" ? "noteBlock" : "text";
        const outputs = parts.map((text) => ({ kind, text, size: text.length }));
        const total = parts.reduce((sum, text) => sum + text.length, 0);
        return { outputs, summary: `${textItems.length} 个输入 · ${total} 字` };
      }

      case "process.merge": {
        if (!inputs.text) throw new Error("没有可合并的笔记块");
        const title = String(data.title ?? "").trim() || "合并笔记";
        const markdown = `# ${title}\n\n${inputs.text}`;
        await this.log(active, node.id, "input", inputs.text);
        return { outputs: [{ kind: "noteDoc", text: markdown, size: markdown.length }], summary: `${markdown.length} 字` };
      }

      case "process.output": {
        if (!inputs.text) throw new Error("没有可输出的文档");
        const fileName = escapePathName(String(data.fileName ?? "笔记.md").trim() || "笔记.md");
        const outputDir = getSettings(this.db).general.outputDir || "outputs";
        const dir = join(this.dataDir, outputDir, active.id);
        await mkdir(dir, { recursive: true });
        const outPath = join(dir, fileName);
        await writeFile(outPath, inputs.text, "utf8");
        const rel = `${outputDir}/${active.id}/${fileName}`;
        await this.log(active, node.id, "info", `输出文件：${rel}`);
        return { outputs: [{ kind: "noteDoc", text: inputs.text, path: rel, size: inputs.text.length }], summary: `${fileName} · ${inputs.text.length} 字` };
      }

      case "flow.if": {
        if (!inputs.text) throw new Error("没有可判断的输入");
        const cond = data.condition as { field?: string; op?: string; value?: string } | undefined;
        if (!cond?.field || !cond.op) throw new Error("条件分支未配置条件");
        const field = cond.field;
        const op = cond.op;
        const rawValue = String(cond.value ?? "");
        let matched: boolean;
        let actualText: string;
        if (field === "contains") {
          matched = inputs.text.includes(rawValue);
          if (op === "notContains") matched = !matched;
          actualText = `包含"${rawValue}"`;
        } else {
          const value = field === "charCount" ? inputs.text.length : countWords(inputs.text);
          const target = Number(rawValue);
          if (!Number.isFinite(target)) throw new Error(`条件比较值不是有效数字：${rawValue}`);
          switch (op) {
            case "gt": matched = value > target; break;
            case "gte": matched = value >= target; break;
            case "lt": matched = value < target; break;
            case "lte": matched = value <= target; break;
            case "eq": matched = value === target; break;
            default: throw new Error(`条件分支不支持该操作符：${op}`);
          }
          actualText = `${value} ${op} ${rawValue}`;
        }
        const branch = matched ? "true" : "false";
        active.branches.set(node.id, branch);
        const kind: NodeOutput["kind"] = inputs.items.find((i) => i.output.kind !== "audio")?.output.kind ?? "text";
        return {
          outputs: [{ kind, text: inputs.text, size: inputs.text.length }],
          summary: `条件${matched ? "成立" : "不成立"} · ${actualText}`,
        };
      }

      case "process.text": {
        const textItems = inputs.items.filter((i) => i.output.kind !== "audio" && i.output.text?.trim());
        if (textItems.length === 0) throw new Error("没有文本输入");
        const operation = String(data.operation ?? "cleanup");
        const outputs: NodeOutput[] = textItems.map((item) => {
          const text = applyTextOperation(operation, item.output.text ?? "", data);
          return { kind: item.output.kind as NodeOutput["kind"], text, size: text.length };
        });
        const total = outputs.reduce((sum, output) => sum + (output.text?.length ?? 0), 0);
        return { outputs, summary: `${outputs.length} 个输入 · ${total} 字` };
      }

      case "process.chapter": {
        if (!inputs.text) throw new Error("没有可切分的文稿输入");
        const text = inputs.text.trim();
        if (text.length < 200) throw new Error("文稿过短，不适合章节切分");
        const aiConfig = getAiConfig(this.db);
        if (!aiConfig.apiKey) throw new Error("未配置 AI 模型密钥，请到设置页填写");
        const granularity = String(data.granularity ?? "medium");
        const maxChapters = Math.min(50, Math.max(1, Number(data.maxChapters ?? 20) || 20));
        const granularityLabel =
          granularity === "coarse" ? "粗粒度（章节数 ≤ 12）" : granularity === "fine" ? "细粒度（章节数 ≤ 30）" : "中粒度（章节数 ≤ 20）";
        const model = String(data.model ?? "").trim() || aiConfig.model;
        const system = `你是内容编辑。把下面的文稿切分为章节。只输出 JSON，格式：{"chapters":[{"title":"章节标题","content":"本章内容"}]}。要求：章节数不超过 ${maxChapters}；粒度：${granularityLabel}；保持原文信息完整，不新增观点。`;
        await this.log(active, node.id, "ai-request", `${model}\n\n${system}`);
        const result = await chatCompletion({ ...aiConfig, model }, system, text, signal);
        await this.log(active, node.id, "ai-response", result);
        const chapters = parseChaptersJson(result, maxChapters);
        const outputs: NodeOutput[] = chapters.map((c) => ({
          kind: "noteBlock",
          text: `## ${c.title}\n\n${c.content}`,
          size: c.title.length + c.content.length + 4,
        }));
        const total = outputs.reduce((sum, output) => sum + (output.size ?? 0), 0);
        return { outputs, summary: `${chapters.length} 章 · ${total} 字` };
      }

      default:
        throw new Error(`节点类型暂不支持：${(node as { type: string }).type}`);
    }
  }

  private async progress(active: ActiveRun, nodeId: string, progress: number, message: string) {
    if (active.cancelled) throw new Error("运行已取消");
    this.emit(active, { type: "node.progress", runId: active.id, nodeId, progress, message });
  }

  private async log(active: ActiveRun, nodeId: string, kind: "input" | "ai-request" | "ai-response" | "info" | "error", content: string) {
    if (!content) return;
    await this.db
      .insert(runNodeLogs)
      .values({ id: randomUUID(), runId: active.id, nodeId, kind, content: content.slice(0, 8000), createdAt: Date.now() })
      .run();
  }

  private async updateNode(
    active: ActiveRun,
    nodeId: string,
    status: "running" | "done" | "error" | "cancelled" | "skipped",
    elapsedMs: number,
    summary?: string,
    output?: NodeOutput,
    error?: string,
    attempts = 1,
  ) {
    const node = active.graph.nodes.find((n) => n.id === nodeId);
    const values = {
      runId: active.id,
      nodeId,
      nodeType: node?.type ?? "",
      nodeLabel: node ? nodeLabel(node) : "",
      status,
      attempts,
      elapsedMs,
      summary,
      error,
      outputKind: output?.kind,
      outputText: output?.text && output.text.length <= MAX_INLINE_TEXT ? output.text : undefined,
      outputPath: output?.path,
      outputSize: output?.size,
      updatedAt: Date.now(),
    } as const;
    await this.db
      .insert(runNodeResults)
      .values({ id: `${active.id}:${nodeId}`, ...values })
      .onConflictDoUpdate({ target: runNodeResults.id, set: values })
      .run();
  }

  private async finishRun(active: ActiveRun, status: RunStatus, error?: string) {
    const elapsed = Date.now() - active.startedAt;
    const rows = this.db.select().from(runNodeResults).where(eq(runNodeResults.runId, active.id)).all();
    const doneCount = rows.filter((r) => r.status === "done").length;
    const outputRow = rows.find((r) => r.outputKind === "noteDoc" && r.outputPath);
    const summary = outputRow?.summary ?? (doneCount > 0 ? `${doneCount} 个节点完成` : undefined);
    await this.db
      .update(runs)
      .set({ status, finishedAt: Date.now(), elapsedMs: elapsed, summary, error })
      .where(eq(runs.id, active.id))
      .run();

    this.emit(active, { type: "run.done", runId: active.id, status });
    setTimeout(() => this.actives.delete(active.id), 60_000);
  }

  /** 旧运行没有 run_node_inputs 时，从节点结果与转写日志推导输入明细，保证历史结果页也能单独查看。 */
  private buildLegacyInputs(
    runId: string,
    runRow: (typeof runs)["$inferSelect"],
    nodeRows: (typeof runNodeResults)["$inferSelect"][],
    graph?: WorkflowGraph,
  ): RunNodeInput[] {
    if (!graph) return [];
    const inputs: RunNodeInput[] = [];
    const createdAt = runRow.createdAt;
    const resultByNode = new Map(nodeRows.filter((r) => r.status === "done").map((r) => [r.nodeId, r]));

    for (const edge of graph.edges) {
      const sourceRow = resultByNode.get(edge.source);
      if (!sourceRow) continue;
      const targetRow = resultByNode.get(edge.target);
      const position = graph.edges.filter((e) => e.target === edge.target).findIndex((e) => e.id === edge.id);
      const base = { runId, sourceNodeId: edge.source, targetNodeId: edge.target, createdAt, position: Math.max(0, position) };

      if (sourceRow.outputKind !== "audio") {
        const text = sourceRow.outputText;
        if (text) {
          inputs.push({
            id: `legacy-${edge.source}-${edge.target}`,
            kind: "text",
            text,
            size: sourceRow.outputSize ?? text.length,
            ...base,
          });
        }
        continue;
      }

      // 音频输入：只有直接下游转写节点会产出独立文本，从日志按“音频输入 N：路径”匹配。
      const target = graph.nodes.find((n) => n.id === edge.target);
      if (target?.type !== "process.transcribe" || !targetRow?.outputText) continue;
      const transcribeLogs = this.db
        .select()
        .from(runNodeLogs)
        .where(and(eq(runNodeLogs.runId, runId), eq(runNodeLogs.nodeId, edge.target)))
        .orderBy(runNodeLogs.createdAt)
        .all();
      const infoPaths = transcribeLogs
        .filter((l) => l.kind === "info" && /^音频输入 \d+：/.test(l.content))
        .map((l) => l.content.replace(/^音频输入 \d+：/, "").trim());
      const responses = transcribeLogs.filter((l) => l.kind === "ai-response").map((l) => l.content);
      const absPath = resolve(this.dataDir, sourceRow.outputPath ?? "");
      const idx = infoPaths.findIndex((p) => p === absPath);
      if (idx >= 0 && responses[idx]) {
        inputs.push({
          id: `legacy-${edge.source}-${edge.target}`,
          kind: "text",
          text: responses[idx],
          size: responses[idx].length,
          ...base,
        });
      }
    }
    return inputs;
  }

  detail(runId: string): { run?: RunMeta; nodes: RunNodeResult[]; graph?: WorkflowGraph; inputs?: RunNodeInput[] } {
    const row = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!row) return { nodes: [] };
    const project = this.db.select().from(projects).where(eq(projects.id, row.projectId)).get();
    const run: RunMeta = {
      id: row.id,
      projectId: row.projectId,
      projectName: project?.name,
      status: row.status,
      scope: row.scope,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt ?? undefined,
      elapsedMs: row.elapsedMs ?? undefined,
      summary: row.summary ?? undefined,
      error: row.error ?? undefined,
    };
    const rows = this.db.select().from(runNodeResults).where(eq(runNodeResults.runId, runId)).all();
    const nodes: RunNodeResult[] = rows.map((r) => ({
      nodeId: r.nodeId,
      nodeType: r.nodeType,
      nodeLabel: r.nodeLabel ?? undefined,
      status: r.status,
      elapsedMs: r.elapsedMs,
      attempts: r.attempts,
      summary: r.summary ?? undefined,
      error: r.error ?? undefined,
      output: r.outputKind
        ? { kind: r.outputKind, text: r.outputText ?? undefined, path: r.outputPath ?? undefined, size: r.outputSize ?? undefined }
        : undefined,
    }));
    const inputRows = this.db.select().from(runNodeInputs).where(eq(runNodeInputs.runId, runId)).orderBy(runNodeInputs.createdAt, runNodeInputs.position).all();
    const storedInputs = inputRows.map((r) => ({
      id: r.id,
      runId: r.runId,
      targetNodeId: r.targetNodeId,
      sourceNodeId: r.sourceNodeId,
      kind: r.kind as "text" | "audio",
      text: r.text ?? undefined,
      resultText: r.resultText ?? undefined,
      path: r.path ?? undefined,
      size: r.size ?? undefined,
      position: r.position,
      createdAt: r.createdAt,
    }));
    let graph = row.graphJson ? (JSON.parse(row.graphJson) as WorkflowGraph) : undefined;
    if (!graph) {
      const project = this.db.select().from(projects).where(eq(projects.id, row.projectId)).get();
      if (project) graph = JSON.parse(project.graphJson) as WorkflowGraph;
    }
    const inputs = storedInputs.length > 0 ? storedInputs : this.buildLegacyInputs(runId, row, rows, graph);
    return { run, nodes, graph, inputs };
  }

  async deleteRun(runId: string) {
    await this.db.delete(runNodeResults).where(eq(runNodeResults.runId, runId)).run();
    await this.db.delete(runNodeInputs).where(eq(runNodeInputs.runId, runId)).run();
    await this.db.delete(runs).where(eq(runs.id, runId)).run();
    await rm(join(this.dataDir, "runs", runId), { recursive: true, force: true }).catch(() => undefined);
    const outputDir = getSettings(this.db).general.outputDir || "outputs";
    await rm(join(this.dataDir, outputDir, runId), { recursive: true, force: true }).catch(() => undefined);
  }
}

export function nextRunId(): string {
  return `run_${randomUUID()}`;
}
