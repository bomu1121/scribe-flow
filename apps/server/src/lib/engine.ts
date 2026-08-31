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
  type RunNodeResult,
  type RunScope,
  type RunStatus,
  type WorkflowGraph,
} from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { biliCookies, projects, runNodeLogs, runNodeResults, runs } from "../db/schema";
import { chatCompletion, transcribeAudio } from "./ai";
import { downloadBiliAudio, toAsrWav } from "./media";
import { getAiConfig, getAsrConfig, getSettings } from "./settings";

const MAX_INLINE_TEXT = 200_000;

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
  outputs: Map<string, NodeOutput>;
  nodeAborts: Map<string, AbortController>;
  startedAt: number;
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
    const running = new Map<string, Promise<"done" | "error">>();
    const failed = new Set<string>();

    try {
      while (done.size + failed.size < active.order.length) {
        if (active.cancelled) break;
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

  /** 单节点/局部运行：不在本次运行内的上游节点，从最近一次成功结果取输入。 */
  private async previousOutput(nodeId: string): Promise<NodeOutput | undefined> {
    const row = this.db
      .select()
      .from(runNodeResults)
      .where(eq(runNodeResults.nodeId, nodeId))
      .orderBy(desc(runNodeResults.updatedAt))
      .limit(1)
      .get();
    if (!row || row.status !== "done" || !row.outputKind) return undefined;
    return { kind: row.outputKind, text: row.outputText ?? undefined, path: row.outputPath ?? undefined, size: row.outputSize ?? undefined };
  }

  private async resolveInputs(active: ActiveRun, node: GraphNode): Promise<{ text?: string; audioPaths: string[] }> {
    const inputs: NodeOutput[] = [];
    for (const edge of active.graph.edges) {
      if (edge.target !== node.id) continue;
      const source = active.graph.nodes.find((n) => n.id === edge.source);
      if (!source) continue;
      if (active.nodeIds.has(source.id)) {
        const output = active.outputs.get(source.id);
        if (output) inputs.push(output);
      } else {
        const previous = await this.previousOutput(source.id);
        if (previous) inputs.push(previous);
      }
    }
    const audioPaths = inputs
      .filter((i) => i.kind === "audio")
      .map((i) => i.path)
      .filter((p): p is string => Boolean(p))
      .map((p) => resolve(this.dataDir, p));
    const texts = inputs.filter((i) => i.kind !== "audio");
    return { text: texts.map((t) => t.text ?? "").filter(Boolean).join("\n\n") || undefined, audioPaths };
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
    await this.updateNode(active, nodeId, "running", 0, undefined, undefined);
    this.emit(active, { type: "node.started", runId: active.id, nodeId });

    try {
      const inputs = await this.resolveInputs(active, node);
      const output = await this.runNode(active, node, inputs, abort.signal);
      if (active.cancelled) throw new Error("运行已取消");
      const elapsed = Date.now() - started;
      await this.updateNode(active, nodeId, "done", elapsed, output.summary, output.output);
      this.emit(active, { type: "node.done", runId: active.id, nodeId, summary: output.summary ?? "完成", preview: previewFor(output.output) });
      active.outputs.set(nodeId, output.output);
      return "done";
    } catch (err) {
      const message = err instanceof Error ? err.message : "节点执行失败";
      const elapsed = Date.now() - started;
      const status = active.cancelled ? "cancelled" : "error";
      const finalError = active.cancelled ? "已取消" : message;
      await this.updateNode(active, nodeId, status, elapsed, undefined, undefined, finalError);
      this.emit(active, { type: "node.error", runId: active.id, nodeId, error: finalError });
      return status === "cancelled" ? "done" : "error";
    } finally {
      active.nodeAborts.delete(nodeId);
    }
  }

  private async runNode(
    active: ActiveRun,
    node: GraphNode,
    inputs: { text?: string; audioPaths: string[] },
    signal?: AbortSignal,
  ): Promise<{ output: NodeOutput; summary?: string }> {
    const data = node.data as Record<string, unknown>;
    switch (node.type) {
      case "source.bili": {
        const url = String(data.url ?? "").trim();
        if (!url) throw new Error("B 站链接为空");
        const bvid = url.match(/BV[0-9A-Za-z]+/)?.[0];
        if (!bvid) throw new Error("链接中没有识别到 BV 号");
        const pageInfo = data.pageInfo as { cid?: number } | undefined;
        const cid = Number(pageInfo?.cid ?? 0);
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
        return { output: { kind: "audio", path: rel, size }, summary: "音轨已就绪" };
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
          output: { kind: "audio", path: `runs/${active.id}/nodes/${node.id}/audio.wav` },
          summary: String(data.fileName ?? "音轨已就绪"),
        };
      }

      case "source.text": {
        const text = String(data.text ?? "").trim();
        if (!text) throw new Error("文稿为空");
        return { output: { kind: "text", text, size: text.length }, summary: `${text.length} 字` };
      }

      case "process.transcribe": {
        if (inputs.audioPaths.length === 0) throw new Error("没有可转写的音频输入");
        const config = getAsrConfig(this.db);
        if (!config.apiKey) throw new Error("未配置语音识别密钥，请到设置页填写");
        const parts: string[] = [];
        for (let i = 0; i < inputs.audioPaths.length; i += 1) {
          const audioPath = inputs.audioPaths[i];
          await this.progress(active, node.id, Math.round(10 + (i / inputs.audioPaths.length) * 80), `转写音频 ${i + 1}/${inputs.audioPaths.length}`);
          await this.log(active, node.id, "info", `音频输入 ${i + 1}：${audioPath}`);
          const text = await transcribeAudio(config, audioPath, signal);
          if (!text.trim()) throw new Error(`第 ${i + 1} 个音频转写结果为空`);
          await this.log(active, node.id, "ai-response", text);
          parts.push(text.trim());
        }
        const text = parts.join("\n\n");
        return { output: { kind: "text", text, size: text.length }, summary: `${inputs.audioPaths.length} 个音频 · ${text.length} 字` };
      }

      case "process.refine":
      case "process.prompt": {
        if (!inputs.text) throw new Error("没有文稿输入");
        await this.progress(active, node.id, 10, "调用 AI 模型");
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
        await this.log(active, node.id, "input", inputs.text);
        await this.log(active, node.id, "ai-request", `${model}\n\n${system}`);
        const text = await chatCompletion({ ...aiConfig, model }, system, inputs.text, signal);
        if (!text.trim()) throw new Error("AI 返回为空");
        await this.log(active, node.id, "ai-response", text);
        const kind = node.type === "process.prompt" ? "noteBlock" : "text";
        return { output: { kind, text, size: text.length }, summary: `${text.length} 字` };
      }

      case "process.merge": {
        if (!inputs.text) throw new Error("没有可合并的笔记块");
        const title = String(data.title ?? "").trim() || "合并笔记";
        const markdown = `# ${title}\n\n${inputs.text}`;
        await this.log(active, node.id, "input", inputs.text);
        return { output: { kind: "noteDoc", text: markdown, size: markdown.length }, summary: `${markdown.length} 字` };
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
        return { output: { kind: "noteDoc", text: inputs.text, path: rel, size: inputs.text.length }, summary: `${fileName} · ${inputs.text.length} 字` };
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
  ) {
    const node = active.graph.nodes.find((n) => n.id === nodeId);
    const values = {
      runId: active.id,
      nodeId,
      nodeType: node?.type ?? "",
      nodeLabel: node ? nodeLabel(node) : "",
      status,
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

  detail(runId: string): { run?: RunMeta; nodes: RunNodeResult[]; graph?: WorkflowGraph } {
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
      summary: r.summary ?? undefined,
      error: r.error ?? undefined,
      output: r.outputKind
        ? { kind: r.outputKind, text: r.outputText ?? undefined, path: r.outputPath ?? undefined, size: r.outputSize ?? undefined }
        : undefined,
    }));
    const graph = row.graphJson ? (JSON.parse(row.graphJson) as WorkflowGraph) : undefined;
    return { run, nodes, graph };
  }

  async deleteRun(runId: string) {
    await this.db.delete(runNodeResults).where(eq(runNodeResults.runId, runId)).run();
    await this.db.delete(runs).where(eq(runs.id, runId)).run();
    await rm(join(this.dataDir, "runs", runId), { recursive: true, force: true }).catch(() => undefined);
    const outputDir = getSettings(this.db).general.outputDir || "outputs";
    await rm(join(this.dataDir, outputDir, runId), { recursive: true, force: true }).catch(() => undefined);
  }
}

export function nextRunId(): string {
  return `run_${randomUUID()}`;
}
