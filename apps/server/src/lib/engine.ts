import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import {
  BUILTIN_PROMPT_BLOCKS,
  NODE_TYPE_LABELS,
  fileSegmentKey,
  isSourceOutputNeeded,
  maybeDrillToMarkdown,
  passesPick,
  segmentKey,
  type GraphNode,
  type NodeOutput,
  type NodePick,
  type Recipe,
  type ResultDelta,
  type RunEvent,
  type RunMeta,
  type RunNodeInput,
  type RunNodeResult,
  type RunScope,
  type RunStatus,
  type WorkflowGraph,
} from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { biliCookies, projects, runMedia, runNodeInputs, runNodeLogs, runNodeResults, runs } from "../db/schema";
import { chatCompletion, transcribeAudio, type AiConfig } from "./ai";
import { fetchBiliVideoDetail } from "./bilibili";
import { buildDrill, buildDrillParams } from "./drill";
import { countMindMapNodes, mindMapToMarkdown, parseMindMapJson } from "./mindmap";
import { downloadBiliAudio, toAsrWav } from "./media";
import {
  attachRunMedia,
  DEFAULT_VIDEO_QN,
  ensureBiliVideoAsset,
  ensureFileVideoAsset,
  gcMediaAssets,
} from "./media-store";
import { ensureRemoteDirectory, scanRemoteMarkdown, writeRemoteFile, type NutstoreConfig } from "./nutstore";
import { appendAllOutput, assertStepOutput, parseJsonLoose, renderStepSystem } from "./recipe";
import { getAiConfig, getAsrConfig, getNutstoreConfig, getSearchConfig, getSettings } from "./settings";
import { enrichTraceReportWithExternalChecks } from "./traceExternal";

const MAX_INLINE_TEXT = 200_000;

/** 外部调用/网络下载类节点自动重试；本地节点失败重试无意义。B 站下载最常见的失败就是瞬时网络错误。 */
export const RETRYABLE_NODE_TYPES = new Set(["source.bili", "process.transcribe", "process.refine", "process.prompt", "process.chapter", "process.gameguide", "process.mindmap", "process.drill"]);

/** 判断一次失败是否值得重试：取消、配置类与永久性错误不重试，其余（超时/网络/5xx/空结果）重试。 */
export function isRetryableError(error: Error, cancelled: boolean): boolean {
  if (cancelled) return false;
  const message = error.message;
  if (/运行已取消|未配置.*密钥|没有可.*输入|文稿为空|链接为空|缺少 BV|缺少 cid|文件为空|正则表达式无效|文稿过短|B 站登录已失效|没有可下载的音轨|断言未通过|不是合法 JSON|没有生成可用的练习题|练习产物|未通过校验/.test(message)) return false;
  return true;
}

/** 把错误链（如 undici 的 `fetch failed` → ConnectTimeoutError）压缩成一行可读文本，用于落库与界面展示。 */
export function describeError(err: unknown, maxLength = 400): string {
  let current: Error | undefined = err instanceof Error ? err : new Error(typeof err === "string" ? err : "节点执行失败");
  const parts: string[] = [];
  let guard = 0;
  while (current && guard < 6) {
    guard += 1;
    const message = current.message?.trim() ?? "";
    if (message) {
      const joined = parts.join("\n").toLowerCase();
      if (!joined.includes(message.toLowerCase())) {
        parts.push(message.length > 300 ? `${message.slice(0, 300)}…` : message);
      }
    }
    current = (current as Error & { cause?: unknown }).cause as Error | undefined;
  }
  const text = parts.join(" ← ");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
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

interface InputSourceMetaItem {
  sourceType: string;
  title?: string;
  author?: string;
  url?: string;
  fileName?: string;
  part?: string;
}

interface InputSourceMeta {
  /** 给大模型看的人类可读来源说明。 */
  label: string;
  items: InputSourceMetaItem[];
}

interface ResolvedInput {
  sourceNodeId: string;
  output: NodeOutput;
  position: number;
  /** 该输入对应的原始素材来源；用于溯源配方在 JSON 中写明“哪条视频/文稿/哪一段”。 */
  sourceMeta?: InputSourceMeta;
  /** 该输入承载的素材段标识（用于把身份传给下游，以及按挑选过滤）。 */
  itemKey?: string;
}

interface ResolvedInputs {
  text?: string;
  audioPaths: string[];
  items: ResolvedInput[];
  /** 被素材挑选排除、本次没有进入处理的素材（保留来源与段标识，供落库与日志说明）。 */
  excluded: { sourceNodeId: string; itemKey: string }[];
}

/** 节点是否配了素材挑选（含空数组：空数组表示明确排除该来源的全部素材）。 */
function nodePick(node: GraphNode): NodePick | undefined {
  const pick = (node.data as { pick?: NodePick }).pick;
  return pick && typeof pick === "object" ? pick : undefined;
}

/**
 * 按「连线顺序 + 该来源产出顺序」给产物补一个确定性段标识（仅用于兜底派生）。
 * `explicit`：产出方自己写好的段标识，优先沿用——若在这里被重新派生，
 * 下游再按标识挑选时就选不中了（标识会变成产出方的 position）。
 */
function derivedItemKey(sourceNodeId: string, position: number, explicit?: string): string {
  return explicit ?? `pos:${sourceNodeId}:${position}`;
}

/**
 * 从历史运行还原来源产物的素材身份。
 * 内容寻址的下载路径对同一条视频是稳定的（例如 `…/nodes/n_src/7ee5….m4a`），
 * 而多选卡片的转码产物固定为 `audio-<序号>.wav`，序号即 items 下标。
 */
function restoredAudioKey(node: GraphNode | undefined, outputPath: string): string | undefined {
  if (!node) return undefined;
  const data = node.data as { items?: unknown; bvid?: string; page?: number; fileId?: string; fileName?: string; filePath?: string };
  if (node.type === "source.bili") {
    const seq = Number(/audio-(\d+)\.wav$/.exec(outputPath)?.[1] ?? 0);
    if (seq > 0) {
      const items = Array.isArray(data.items)
        ? (data.items as { bvid?: string; page?: number; cid?: number }[])
        : [];
      const item = items[seq - 1];
      if (item) return segmentKey(node.id, { bvid: item.bvid ?? data.bvid, page: item.page, cid: item.cid });
    }
    const bvid = String(data.bvid ?? "").trim();
    return bvid ? segmentKey(node.id, { bvid, page: Number(data.page ?? 1) }) : undefined;
  }
  if (node.type === "source.file") return fileSegmentKey(data);
  return undefined;
}

/**
 * 摘要里写明「本次只加工了其中几段」。
 * 素材挑选会让节点只处理一部分素材，若摘要不点明，结果页会看起来像丢内容。
 */
function appendSkippedNote(summary: string | undefined, kept: number, skipped: number): string {
  const total = kept + skipped;
  const note = `已按挑选执行：处理 ${kept}/${total} 段（跳过 ${skipped} 段）`;
  return summary ? `${summary} · ${note}` : note;
}

/**
 * 把输入项与产出项配对，把素材身份传给下游。
 *
 * 采用「下标优先 + 唯一匹配兜底」：顺序一致时精确配对，数量不一致时（例如文本工具
 * 过滤掉了空文本）若产出唯一则直接沿用唯一的那个输入身份，避免错配到别的素材上。
 */
function pairItemKeys(inputs: ResolvedInput[], outputs: NodeOutput[]): void {
  if (outputs.length === 0) return;
  if (inputs.length === outputs.length) {
    outputs.forEach((output, i) => {
      if (!output.itemKey && inputs[i]?.itemKey) output.itemKey = inputs[i].itemKey;
    });
    return;
  }
  if (outputs.length === 1 && inputs.length === 1 && !outputs[0].itemKey && inputs[0].itemKey) {
    outputs[0].itemKey = inputs[0].itemKey;
  }
}

function escapePathName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

/** 解析 AI 返回的 JSON 标签数组；失败返回空数组。 */
function parseTagArray(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter((tag) => tag && !/\s/.test(tag));
    }
  } catch {
    // 忽略解析失败，由调用方降级
  }
  return [];
}

/** 解析 AI 返回的人物/事件/时期 JSON。 */
function parseHistoryEntities(raw: string): { persons: string[]; events: string[]; periods: string[] } {
  const empty = { persons: [], events: [], periods: [] };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const toList = (value: unknown) =>
      Array.isArray(value)
        ? value
            .map((item) => String(item).trim())
            .filter((item) => item)
            .slice(0, 5)
        : typeof value === "string" && value.trim()
          ? [value.trim()]
          : [];
    return {
      persons: toList(parsed["人物"]),
      events: toList(parsed["事件"]),
      periods: toList(parsed["时期"]),
    };
  } catch {
    return empty;
  }
}

/** 解析 YAML frontmatter 中的列表字段（如人物/事件）。 */
function parseYamlFieldList(content: string, field: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const yaml = match[1];
  const lines = yaml.split(/\r?\n/);
  const result: string[] = [];
  let inField = false;
  const fieldKey = field.toLowerCase();
  for (const line of lines) {
    const trimmed = line.trim();
    if (new RegExp(`^${field}:\\s*$`, "i").test(trimmed)) {
      inField = true;
      continue;
    }
    if (inField) {
      if (/^[^-\s]/.test(trimmed)) {
        inField = false;
      } else {
        const item = trimmed.match(/^-\s*(.+)$/);
        if (item) result.push(item[1].trim().replace(/^["']|["']$/g, ""));
        continue;
      }
    }
    const inline = trimmed.match(new RegExp(`^${field}:\\s*(.+)$`, "i"));
    if (inline) {
      result.push(
        ...inline[1]
          .split(/[,，\s]+/)
          .map((value) => value.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean),
      );
    }
  }
  return result.filter((value) => value);
}

/** 简单解析 Markdown 文件 frontmatter 中的 tags 列表。 */
function parseYamlTags(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const yaml = match[1];
  const lines = yaml.split(/\r?\n/);
  const tags: string[] = [];
  let inTags = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^tags:\s*$/i.test(trimmed)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      if (/^[^-\s]/.test(trimmed)) {
        inTags = false;
      } else {
        const item = trimmed.match(/^-\s*(.+)$/);
        if (item) tags.push(item[1].trim().replace(/^["']|["']$/g, ""));
        continue;
      }
    }
    const inline = trimmed.match(/^tags:\s*(.+)$/i);
    if (inline) {
      tags.push(
        ...inline[1]
          .split(/[,，\s]+/)
          .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean),
      );
    }
  }
  return tags.filter((tag) => tag);
}

function previewFor(output: NodeOutput): string | undefined {
  if (!output || (output.kind !== "text" && output.kind !== "noteBlock" && output.kind !== "noteDoc")) return undefined;
  const text = output.text ?? "";
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.slice(0, 320) || undefined;
}

function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 生成节点相对直接上游的变化徽标：新生成 / 与上游一致 / 字数增减 / 内容变化。 */
function computeResultDelta(current: NodeOutput | undefined, inputs: ResolvedInputs): ResultDelta | undefined {
  if (!current || (current.kind !== "text" && current.kind !== "noteBlock" && current.kind !== "noteDoc")) return undefined;
  const currentText = current.text ?? "";
  if (!currentText.trim()) return undefined;
  const upstreamTexts = inputs.items
    .filter((item) => item.output.kind !== "audio" && item.output.text?.trim())
    .map((item) => item.output.text?.trim() ?? "");
  if (upstreamTexts.length === 0) return { label: "新生成", tone: "new" };
  const upstreamText = upstreamTexts.join("\n\n");
  if (upstreamText.trim() === currentText.trim()) return { label: "与上游一致", tone: "same" };
  const diff = countChars(currentText) - countChars(upstreamText);
  if (diff === 0) return { label: "较上游内容变化", tone: "changed" };
  return { label: `较上游 ${diff > 0 ? "+" : ""}${diff} 字`, tone: diff > 0 ? "up" : "down" };
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

/**
 * 去掉包裹整篇 Markdown 的单个代码围栏。
 * 只在“整段输出被 ``` / ```markdown / ```md 包裹”时剥离，保留正文；
 * 如果正文内部还含有代码围栏则不处理，避免误删用户真正想保留的代码块。
 */
function stripOuterCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/);
  if (!match) return text;
  if (match[1].includes("```")) return text;
  return match[1].trim();
}

/** 阴阳师攻略 scan 步骤：把可能缺失的数组型字段补成空数组，避免下游步骤读不到键。 */
function ensureGameGuideScanKeys(raw: string): string {
  try {
    const parsed = parseJsonLoose(raw) as Record<string, unknown>;
    for (const key of ["entities", "loadouts", "steps", "caveats", "terms", "versionNotes"]) {
      if (!Array.isArray(parsed[key])) parsed[key] = [];
    }
    return JSON.stringify(parsed);
  } catch {
    return raw;
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

/** keepVideo 目标清晰度档：数据里可配（16–127），缺省 1080P。 */
function videoQn(data: Record<string, unknown>): number {
  const n = Number(data.videoQn ?? DEFAULT_VIDEO_QN);
  if (!Number.isFinite(n)) return DEFAULT_VIDEO_QN;
  return Math.min(127, Math.max(16, Math.round(n)));
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

  /**
   * 是否下载可播放视频：**只由节点显式配置决定（默认不保存）**。
   * 无论节点是否独立运行都不自动下载大文件；需要保存/查看视频时，
   * 在节点「高级设置 → 保留可播放视频」开启后重跑。
   */
  private wantsKeepVideo(_active: ActiveRun, _nodeId: string, data: Record<string, unknown>): boolean {
    return data.keepVideo === true;
  }

  /** keepVideo 结果落 run_media 附件行 + 运行日志；视频失败不判定节点失败（D3）。 */
  private async attachVideoResult(
    active: ActiveRun,
    nodeId: string,
    sourceIndex: number,
    result: { assetId: string; status: "ready" | "error" | "restoring"; error?: string },
  ) {
    attachRunMedia(this.db, {
      runId: active.id,
      nodeId,
      sourceIndex,
      assetId: result.assetId,
      status: result.status,
      error: result.error,
    });
    if (result.status === "ready") {
      await this.log(active, nodeId, "info", `可播放视频已缓存（附件 ${result.assetId}）`);
    } else if (result.status === "error") {
      await this.log(active, nodeId, "error", `可播放视频下载失败：${result.error ?? "未知错误"}（不影响音轨/转写）`);
    } else {
      await this.log(active, nodeId, "info", "可播放视频正在下载中…");
    }
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
        const ready = active.order.filter((id) => !done.has(id) && !failed.has(id) && !running.has(id) && this.isReadyToRun(active, id, done, failed, skipped));
        for (const nodeId of ready) {
          if (running.size >= concurrency) break;
          // 部分成功：部分上游已失败/被跳过，但仍有可用输入 → 用剩余输入继续，并明确提示。
          const degraded = this.degradedUpstreamLabels(active, nodeId, done, failed, skipped);
          if (degraded.length > 0) {
            const names = degraded.slice(0, 2).join("、");
            const suffix = degraded.length > 2 ? ` 等 ${degraded.length} 个` : "";
            this.emit(active, { type: "node.progress", runId: active.id, nodeId, progress: 0, message: `上游「${names}」失败${suffix}，将用其余可用输入继续` });
          }
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
      const message = describeError(err);
      await this.finishRun(active, "error", message);
      return;
    }

    if (active.cancelled) {
      await this.finishRun(active, "cancelled");
      return;
    }
    const failedLabels = [...failed]
      .map((id) => {
        const node = active.graph.nodes.find((n) => n.id === id);
        return node ? nodeLabel(node) : id;
      })
      .join("、");
    const runError = failed.size > 0 ? `部分节点执行失败${failedLabels ? `：${failedLabels}` : ""}` : undefined;
    await this.finishRun(active, failed.size > 0 ? "error" : "success", runError);
  }

  private async isSettled(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    await Promise.race([promise.then(() => (settled = true), () => (settled = true)), new Promise((r) => setTimeout(r, 0))]);
    return settled;
  }

  /** 节点真正需要等待的上游输入边：范围内、且不属于“条件分支未命中”的边。 */
  private expectedInputEdges(active: ActiveRun, nodeId: string): { source: string; sourceHandle?: string }[] {
    return active.graph.edges.filter((e) => {
      if (e.target !== nodeId || !active.nodeIds.has(e.source)) return false;
      const source = active.graph.nodes.find((n) => n.id === e.source);
      if (source?.type === "flow.if") {
        const branch = active.branches.get(e.source);
        if (branch && branch !== (e.sourceHandle || "true")) return false; // 未命中的分支不提供输入
      }
      return true;
    });
  }

  /**
   * 节点何时可以执行：期望输入全部尘埃落定（完成/跳过/失败），且至少一路真正成功。
   * 上游全部断供（无可用输入）的节点不会执行，由 skipBlocked 标记跳过。
   */
  private isReadyToRun(active: ActiveRun, nodeId: string, done: Set<string>, failed: Set<string>, skipped: Set<string>): boolean {
    const expected = this.expectedInputEdges(active, nodeId);
    if (expected.length === 0) return true;
    let hasUsableInput = false;
    for (const edge of expected) {
      const source = edge.source;
      if (done.has(source)) {
        if (!skipped.has(source)) hasUsableInput = true;
        continue;
      }
      if (!failed.has(source)) return false; // 上游仍在运行/排队
    }
    return hasUsableInput;
  }

  /** 部分成功场景下，收集已失败/被跳过但仍不影响本节点运行的上游标签（用于提示）。 */
  private degradedUpstreamLabels(active: ActiveRun, nodeId: string, done: Set<string>, failed: Set<string>, skipped: Set<string>): string[] {
    const labels: string[] = [];
    for (const edge of this.expectedInputEdges(active, nodeId)) {
      const source = edge.source;
      if (!failed.has(source) && !(done.has(source) && skipped.has(source))) continue;
      const node = active.graph.nodes.find((n) => n.id === source);
      labels.push(node ? nodeLabel(node) : source);
    }
    return [...new Set(labels)];
  }

  /** 断供跳过传播：某节点的所有上游都永久断供（上游失败/上游已跳过/分支未命中）时，把它标为 skipped。 */
  private async skipBlocked(active: ActiveRun, done: Set<string>, failed: Set<string>, skipped: Set<string>): Promise<void> {
    for (const nodeId of active.order) {
      if (done.has(nodeId) || failed.has(nodeId)) continue;
      const incoming = active.graph.edges.filter((e) => e.target === nodeId && active.nodeIds.has(e.source));
      if (incoming.length === 0) continue;
      const allBlocked = incoming.every((e) => this.isEdgeBlocked(active, e, failed, skipped));
      if (!allBlocked) continue;
      const failedUpstream = [...new Set(incoming.filter((e) => failed.has(e.source)).map((e) => e.source))];
      const reason =
        failedUpstream.length > 0
          ? `上游失败，跳过：${failedUpstream
              .map((id) => {
                const node = active.graph.nodes.find((n) => n.id === id);
                return node ? nodeLabel(node) : id;
              })
              .join("、")}`
          : "条件分支未命中或上游不可用，跳过";
      await this.updateNode(active, nodeId, "skipped", 0, undefined, undefined, reason);
      this.emit(active, { type: "node.skipped", runId: active.id, nodeId, reason });
      done.add(nodeId);
      skipped.add(nodeId);
    }
  }

  /** 一条边是否永久断供：来源节点已失败/已跳过，或来源是已执行的条件分支且输出 handle 与命中分支不符。 */
  private isEdgeBlocked(active: ActiveRun, edge: { source: string; sourceHandle?: string }, failed: Set<string>, skipped: Set<string>): boolean {
    if (failed.has(edge.source) || skipped.has(edge.source)) return true;
    const source = active.graph.nodes.find((n) => n.id === edge.source);
    if (source?.type !== "flow.if") return false;
    const branch = active.branches.get(edge.source);
    if (!branch) return false;
    return branch !== (edge.sourceHandle || "true");
  }

  /** 单节点/局部运行：不在本次运行内的上游节点，从当前工程的最近一次成功结果取输入（支持多输出节点）。 */
  private async previousOutputs(nodeId: string, projectId: string, graph?: WorkflowGraph): Promise<NodeOutput[]> {
    const runIds = this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.projectId, projectId))
      .all()
      .map((r) => r.id);
    if (runIds.length === 0) return [];
    const row = this.db
      .select()
      .from(runNodeResults)
      .where(and(eq(runNodeResults.nodeId, nodeId), eq(runNodeResults.status, "done"), inArray(runNodeResults.runId, runIds)))
      .orderBy(desc(runNodeResults.updatedAt))
      .limit(1)
      .get();
    if (!row || !row.outputKind) return [];
    if (
      row.nodeType === "process.transcribe" ||
      row.nodeType === "process.refine" ||
      row.nodeType === "process.prompt" ||
      row.nodeType === "process.gameguide" ||
      row.nodeType === "process.drill"
    ) {
      const inputRows = this.db
        .select()
        .from(runNodeInputs)
        .where(and(eq(runNodeInputs.runId, row.runId), eq(runNodeInputs.targetNodeId, nodeId), eq(runNodeInputs.kind, "text")))
        .orderBy(runNodeInputs.position)
        .all();
      if (inputRows.length > 0) {
        const kind: NodeOutput["kind"] =
          row.nodeType === "process.prompt" || row.nodeType === "process.gameguide" || row.nodeType === "process.drill"
            ? "noteBlock"
            : "text";
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
      const originNode = graph?.nodes.find((n) => n.id === nodeId);
      for (const inputRow of audioRows) {
        if (!inputRow.path || seen.has(inputRow.path)) continue;
        seen.add(inputRow.path);
        outputs.push({ kind: "audio", path: inputRow.path, size: inputRow.size ?? undefined, itemKey: restoredAudioKey(originNode, inputRow.path) });
      }
      if (outputs.length > 0) return outputs;
    }
    return [{ kind: row.outputKind, text: row.outputText ?? undefined, path: row.outputPath ?? undefined, size: row.outputSize ?? undefined }];
  }

  /** 沿上游链路找来源节点，用于 Obsidian 输出节点自动带出来源/作者/链接/标题。 */
  private upstreamSourceMeta(active: ActiveRun, nodeId: string): { source?: string; author?: string; url?: string; title?: string } {
    const queue = [nodeId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of active.graph.edges) {
        if (edge.target !== current) continue;
        const source = active.graph.nodes.find((n) => n.id === edge.source);
        if (!source) continue;
        const data = source.data as Record<string, unknown>;
        if (source.type === "source.bili") {
          const items = Array.isArray(data.items)
            ? (data.items as { bvid?: string; uploader?: string; title?: string }[])
            : [];
          const first = items[0];
          const bvid = String(first?.bvid ?? "").trim() || String(data.url ?? "").match(/BV[0-9A-Za-z]+/)?.[0] || "";
          return {
            source: "B站",
            author: String(data.uploader ?? first?.uploader ?? "").trim() || undefined,
            url: String(data.url ?? "").trim() || (bvid ? `https://www.bilibili.com/video/${bvid}` : undefined),
            title: String(data.title ?? first?.title ?? "").trim() || undefined,
          };
        }
        if (source.type === "source.file") {
          return {
            source: "本地文件",
            title: String(data.fileName ?? "").trim() || undefined,
          };
        }
        if (source.type === "source.text") {
          return { source: "文本" };
        }
        queue.push(source.id);
      }
    }
    return {};
  }

  /** 收集一个输入最终来自哪些原始素材节点（B站/本地文件/文本），用于溯源配方写明“具体来源”。 */
  private upstreamSourceMetas(active: ActiveRun, nodeId: string): InputSourceMetaItem[] {
    const result: InputSourceMetaItem[] = [];
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = active.graph.nodes.find((n) => n.id === id);
      if (!node) return;
      const data = node.data as Record<string, unknown>;
      if (node.type === "source.bili") {
        const items = Array.isArray(data.items)
          ? (data.items as { bvid?: string; cid?: number; page?: number; part?: string; title?: string; uploader?: string; url?: string }[])
          : [];
        const uploader = String(data.uploader ?? "").trim() || undefined;
        if (items.length > 0) {
          for (const item of items) {
            const bvid = String(item.bvid ?? "").trim() || String(data.url ?? "").match(/BV[0-9A-Za-z]+/)?.[0] || "";
            result.push({
              sourceType: "bili",
              title: String(item.title ?? data.title ?? "").trim() || undefined,
              author: String(item.uploader ?? uploader ?? "").trim() || undefined,
              url: String(data.url ?? "").trim() || (bvid ? `https://www.bilibili.com/video/${bvid}` : undefined),
              part: item.page ? `P${item.page}${item.part ? ` ${item.part}` : ""}` : undefined,
            });
          }
        } else {
          const bvid = String(data.bvid ?? "").trim() || String(data.url ?? "").match(/BV[0-9A-Za-z]+/)?.[0] || "";
          result.push({
            sourceType: "bili",
            title: String(data.title ?? "").trim() || undefined,
            author: uploader,
            url: String(data.url ?? "").trim() || (bvid ? `https://www.bilibili.com/video/${bvid}` : undefined),
          });
        }
        return;
      }
      if (node.type === "source.file") {
        result.push({
          sourceType: "file",
          fileName: String(data.fileName ?? "").trim() || undefined,
          title: String(data.label ?? "本地文件").trim(),
        });
        return;
      }
      if (node.type === "source.text") {
        result.push({
          sourceType: "text",
          title: String(data.label ?? "文本输入").trim(),
        });
        return;
      }
      for (const edge of active.graph.edges) {
        if (edge.target === id) visit(edge.source);
      }
    };
    visit(nodeId);
    return result;
  }

  private describeInputSource(active: ActiveRun, nodeId: string): InputSourceMeta | undefined {
    const items = this.upstreamSourceMetas(active, nodeId);
    if (items.length === 0) return undefined;
    const labels = items.map((item) => {
      if (item.sourceType === "bili") {
        const title = item.title ? `《${item.title}》` : "B站视频";
        const part = item.part ? ` ${item.part}` : "";
        const author = item.author ? ` · UP：${item.author}` : "";
        const url = item.url ? ` · ${item.url}` : "";
        return `${title}${part}${author}${url}`;
      }
      if (item.sourceType === "file") {
        return `本地文件《${item.fileName ?? item.title ?? "未命名文件"}》`;
      }
      return item.title || "文本输入";
    });
    return { label: labels.join("；"), items };
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
      const outputs = active.nodeIds.has(source.id)
        ? (active.outputs.get(source.id) ?? [])
        : await this.previousOutputs(source.id, active.projectId, active.graph);
      const sourceMeta = this.describeInputSource(active, source.id);
      for (const output of outputs) {
        const position = items.length;
        items.push({
          sourceNodeId: source.id,
          output,
          position,
          sourceMeta,
          // 产物自带身份时沿用；否则按「来源+产出顺序」派生。转写/AI 等节点逐个素材产出，
          // 这个顺序与来源 items 的顺序一致，因此派生标识在下游可稳定匹配。
          itemKey: derivedItemKey(source.id, position, output.itemKey),
        });
      }
    }

    // 素材挑选：未选中的素材不进入本节点，其下游因拿不到数据而一并跳过。
    const pick = nodePick(node);
    const kept: ResolvedInput[] = [];
    const excluded: { sourceNodeId: string; itemKey: string }[] = [];
    for (const item of items) {
      if (passesPick(pick, item.sourceNodeId, item.itemKey)) kept.push(item);
      else excluded.push({ sourceNodeId: item.sourceNodeId, itemKey: item.itemKey ?? "" });
    }
    if (excluded.length > 0) {
      const detail = excluded.map((e) => e.itemKey).filter(Boolean).slice(0, 6).join("、");
      await this.log(
        active,
        node.id,
        "info",
        `素材挑选：已跳过 ${excluded.length} 段未选中素材${detail ? `（${detail}）` : ""}`,
      );
    }
    if (kept.length === 0 && items.length > 0) {
      throw new Error(`素材挑选没有选中任何素材：共 ${items.length} 段全部被排除，请在节点高级设置里至少保留一段`);
    }

    const resolved = kept.map((item, i) => ({ ...item, position: i }));
    const audioPaths = resolved
      .filter((i) => i.output.kind === "audio")
      .map((i) => i.output.path)
      .filter((p): p is string => Boolean(p))
      .map((p) => resolve(this.dataDir, p));
    const texts = resolved.filter((i) => i.output.kind !== "audio");
    return { text: texts.map((t) => t.output.text ?? "").filter(Boolean).join("\n\n") || undefined, audioPaths, items: resolved, excluded };
  }

  /** 把当前节点消费到的每个输入落库，供结果页单独查看。 */
  private async persistInputs(
    active: ActiveRun,
    targetNodeId: string,
    items: ResolvedInput[],
    excluded: { sourceNodeId: string; itemKey: string }[] = [],
  ) {
    const now = Date.now();
    let position = 0;
    const insertRow = async (values: {
      sourceNodeId: string;
      kind: "text" | "audio";
      text?: string;
      path?: string;
      size?: number;
      itemKey?: string;
      excluded: boolean;
    }) => {
      await this.db
        .insert(runNodeInputs)
        .values({
          id: randomUUID(),
          runId: active.id,
          targetNodeId,
          sourceNodeId: values.sourceNodeId,
          kind: values.kind,
          text: values.text,
          path: values.path,
          size: values.size,
          position: position++,
          itemKey: values.itemKey,
          excluded: values.excluded,
          createdAt: now,
        })
        .run();
    };

    for (const item of items) {
      const output = item.output;
      await insertRow({
        sourceNodeId: item.sourceNodeId,
        kind: output.kind === "audio" ? "audio" : "text",
        text: output.kind === "audio" ? undefined : output.text,
        path: output.path,
        size: output.size,
        itemKey: item.itemKey,
        excluded: false,
      });
    }

    // 被挑选排除了的素材也记一行：结果页据此说明「共 8 段、本次只加工 2 段」。
    for (const skip of excluded) {
      await insertRow({ sourceNodeId: skip.sourceNodeId, kind: "text", itemKey: skip.itemKey, excluded: true });
    }
  }

  /** 音频转写完成后，把对应音频输入行升级为文本（保留 source/target/position）。 */
  private async updateInputText(
    active: ActiveRun,
    targetNodeId: string,
    sourceNodeId: string,
    position: number,
    text: string,
    size: number,
    itemKey?: string,
  ) {
    await this.db
      .update(runNodeInputs)
      .set({ kind: "text", text, size, path: undefined, itemKey })
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
      node.type === "process.prompt" || node.type === "process.gameguide" || node.type === "process.drill"
        ? "noteBlock"
        : node.type === "process.chapter" || node.type === "process.mindmap"
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
      let inputs: ResolvedInputs;
      try {
        inputs = await this.resolveInputs(active, node);
      } catch (err) {
        // 取输入阶段就失败（例如素材挑选把所有素材都排除了）也必须落一条失败状态，
        // 否则节点会永远停在「运行中」，运行结束时也说不清它为什么没产物。
        const message = describeError(err);
        const status = active.cancelled ? "cancelled" : "error";
        await this.updateNode(active, nodeId, status, Date.now() - started, undefined, undefined, active.cancelled ? "已取消" : message, 1);
        this.emit(active, { type: "node.error", runId: active.id, nodeId, error: active.cancelled ? "已取消" : message });
        return status === "cancelled" ? "done" : "error";
      }
      await this.persistInputs(active, node.id, inputs.items, inputs.excluded);
      while (true) {
        attempts += 1;
        try {
          const result = await this.runNode(active, node, inputs, abort.signal);
          if (active.cancelled) throw new Error("运行已取消");
          const elapsed = Date.now() - started;
          pairItemKeys(inputs.items, result.outputs);
          const combined = this.combineOutputs(node, result.outputs);
          const delta = computeResultDelta(combined, inputs);
          const summary = inputs.excluded.length > 0 ? appendSkippedNote(result.summary, inputs.items.length, inputs.excluded.length) : result.summary;
          await this.updateNode(active, nodeId, "done", elapsed, summary, combined, undefined, attempts);
          this.emit(active, {
            type: "node.done",
            runId: active.id,
            nodeId,
            summary: summary ?? "完成",
            preview: node.type === "process.mindmap" || node.type === "process.output" || node.type === "process.drill" ? undefined : previewFor(combined),
            delta,
          });
          active.outputs.set(nodeId, result.outputs);
          return "done";
        } catch (err) {
          const message = describeError(err);
          const error = err instanceof Error ? err : new Error(message);
          if (attempts <= maxRetries && isRetryableError(error, active.cancelled)) {
            const wait = backoffMs * attempts;
            this.emit(active, { type: "node.retry", runId: active.id, nodeId, attempt: attempts, maxRetries, error: message });
            await this.updateNode(active, nodeId, "running", 0, `重试 ${attempts}/${maxRetries}…`, undefined, undefined, attempts + 1);
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
        const items = Array.isArray(data.items)
          ? (data.items as { bvid?: string; cid?: number; page?: number; part?: string; title?: string; cover?: string; uploader?: string; duration?: number }[])
          : [];
        if (items.length > 0) {
          const cookie = this.db.select().from(biliCookies).where(eq(biliCookies.id, 1)).get()?.cookie;
          const dir = join(this.dataDir, "runs", active.id, "nodes", node.id);
          await mkdir(dir, { recursive: true });
          const outputs: NodeOutput[] = [];
          let skippedCount = 0;
          for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            const bvid = String(item.bvid ?? "").trim();
            if (!bvid) throw new Error(`多选卡片第 ${i + 1} 项缺少 BV 号`);
            const itemKey = segmentKey(node.id, { bvid, page: Number(item.page ?? 1), cid: Number(item.cid ?? 0) });
            // 素材挑选：下游都不要的素材不下载，避免「没选它却仍然跑了一遍」。
            if (!isSourceOutputNeeded(active.graph, node.id, itemKey)) {
              skippedCount += 1;
              await this.log(active, node.id, "info", `跳过素材 ${i + 1}/${items.length}（未被任何下游节点选中）：${itemKey}`);
              continue;
            }
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
            outputs.push({ kind: "audio", path: `runs/${active.id}/nodes/${node.id}/audio-${i + 1}.wav`, size, itemKey });
            if (this.wantsKeepVideo(active, node.id, data)) {
              const result = await ensureBiliVideoAsset(this.db, this.dataDir, {
                bvid,
                cid,
                qn: videoQn(data),
                cookie,
                title: String(item.title ?? data.title ?? "") || undefined,
                cover: String(item.cover ?? data.cover ?? "") || undefined,
                uploader: String(item.uploader ?? data.uploader ?? "") || undefined,
                url: `https://www.bilibili.com/video/${bvid}`,
              });
              await this.attachVideoResult(active, node.id, i, result);
            }
          }
          return { outputs, summary: `${outputs.length} 个音轨已就绪${skippedCount > 0 ? `（另跳过 ${skippedCount} 个未选中素材）` : ""}` };
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
        const singleKey = segmentKey(node.id, { bvid, page: Number(pageInfo?.page ?? 1) });
        if (!isSourceOutputNeeded(active.graph, node.id, singleKey)) {
          await this.log(active, node.id, "info", `跳过该素材（未被任何下游节点选中）：${singleKey}`);
          return { outputs: [], summary: "未被选中" };
        }
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
        if (this.wantsKeepVideo(active, node.id, data)) {
          await this.progress(active, node.id, 75, "下载并缓存可播放视频");
          const result = await ensureBiliVideoAsset(this.db, this.dataDir, {
            bvid,
            cid,
            qn: videoQn(data),
            cookie,
            title: String(data.title ?? "") || undefined,
            cover: String(data.cover ?? "") || undefined,
            uploader: String(data.uploader ?? "") || undefined,
            url: `https://www.bilibili.com/video/${bvid}`,
            durationSec: typeof data.duration === "number" ? data.duration : undefined,
          });
          await this.attachVideoResult(active, node.id, 0, result);
        }
        return { outputs: [{ kind: "audio", path: rel, size, itemKey: singleKey }], summary: "音轨已就绪" };
      }

      case "source.file": {
        const filePath = String(data.filePath ?? "");
        if (!filePath) throw new Error("请先上传本地音视频");
        const fileKey = fileSegmentKey(data as { fileId?: string; fileName?: string; filePath?: string });
        if (!isSourceOutputNeeded(active.graph, node.id, fileKey)) {
          await this.log(active, node.id, "info", `跳过该素材（未被任何下游节点选中）：${fileKey}`);
          return { outputs: [], summary: "未被选中" };
        }
        const abs = resolve(this.dataDir, filePath);
        const dir = join(this.dataDir, "runs", active.id, "nodes", node.id);
        await mkdir(dir, { recursive: true });
        await this.progress(active, node.id, 30, "FFmpeg 转码为 16k 单声道");
        const wav = join(dir, "audio.wav");
        await toAsrWav(abs, wav);
        if (this.wantsKeepVideo(active, node.id, data)) {
          await this.progress(active, node.id, 80, "准备可播放视频");
          const relPath = String(data.filePath ?? "");
          const result = await ensureFileVideoAsset(this.db, this.dataDir, relPath, String(data.fileName ?? "本地视频") || undefined);
          await this.attachVideoResult(active, node.id, 0, result);
        }
        return {
          outputs: [{ kind: "audio", path: `runs/${active.id}/nodes/${node.id}/audio.wav`, itemKey: fileKey }],
          summary: String(data.fileName ?? "音轨已就绪"),
        };
      }

      case "source.text": {
        const text = String(data.text ?? "").trim();
        if (!text) throw new Error("文稿为空");
        // 多份文稿连到同一节点时同样可以挑选，因此单份文稿也带上身份。
        return { outputs: [{ kind: "text", text, size: text.length, itemKey: segmentKey(node.id, {}) }], summary: `${text.length} 字` };
      }

      case "process.transcribe": {
        const audioItems = inputs.items.filter((i) => i.output.kind === "audio");
        if (audioItems.length === 0) throw new Error("没有可转写的音频输入");
        const config = getAsrConfig(this.db);
        if (!config.apiKey) throw new Error("未配置语音识别密钥，请到设置页填写");
        const parts: string[] = [];
        const inputRef = (item: ResolvedInput) => ({ index: item.position, total: audioItems.length });
        for (let i = 0; i < audioItems.length; i += 1) {
          const item = audioItems[i];
          const audioPath = resolve(this.dataDir, item.output.path ?? "");
          await this.progress(active, node.id, Math.round(10 + (i / audioItems.length) * 80), `转写音频 ${i + 1}/${audioItems.length}`);
          await this.log(active, node.id, "info", `音频输入 ${i + 1}：${audioPath}`, undefined, inputRef(item));
          const text = await transcribeAudio(config, audioPath, signal);
          if (!text.trim()) throw new Error(`第 ${i + 1} 个音频转写结果为空`);
          await this.log(active, node.id, "ai-response", text, undefined, inputRef(item));
          const trimmed = text.trim();
          await this.updateInputText(active, node.id, item.sourceNodeId, item.position, trimmed, trimmed.length, item.itemKey);
          parts.push(trimmed);
        }
        const outputs = parts.map((text) => ({ kind: "text" as const, text, size: text.length }));
        const total = parts.reduce((sum, text) => sum + text.length, 0);
        return { outputs, summary: `${audioItems.length} 个音频 · ${total} 字` };
      }

      case "process.gameguide":
      case "process.refine":
      case "process.prompt":
      case "process.drill": {
        const textItems = inputs.items.filter((i) => i.output.kind !== "audio" && i.output.text?.trim());
        if (textItems.length === 0) throw new Error("没有文稿输入");
        await this.progress(active, node.id, 5, `准备逐个处理 ${textItems.length} 个输入`);
        const aiConfig = getAiConfig(this.db);
        if (!aiConfig.apiKey) throw new Error("未配置 AI 模型密钥，请到设置页填写");
        const mode = node.type === "process.gameguide" ? String((data.mode as string | undefined) ?? "audited") : "";
        const isDrill = node.type === "process.drill";
        const blockId =
          String(data.promptBlockId ?? "") ||
          (node.type === "process.gameguide" ? (mode === "standard" ? "builtin.gameguide" : "builtin.gameguide.v2") : "") ||
          (isDrill ? "builtin.drill" : "");
        const override = String(data.promptOverride ?? "");
        const builtin = BUILTIN_PROMPT_BLOCKS.find((b) => b.id === blockId);
        /** 知识巩固：节点参数经 {{params}} 注入配方 system，刻意与原文分离（引用回查以 input 为比对源）。 */
        const drillParams = isDrill ? buildDrillParams(data) : undefined;
        /** 知识巩固产物编译后的摘要；空串表示沿用通用摘要。 */
        let drillSummary = "";

        // 配方分支：process.prompt / process.gameguide / process.drill 且块带 recipe、且无自定义提示词覆盖时执行多步链。
        const recipe =
          (node.type === "process.prompt" || node.type === "process.gameguide" || isDrill) && !override.trim()
            ? builtin?.recipe
            : undefined;
        if (recipe) {
          const parts: string[] = [];
          const totalFlat = recipe.steps.length * textItems.length;
          for (let i = 0; i < textItems.length; i += 1) {
            const item = textItems[i];
            const inputRef = { index: item.position, total: textItems.length };
            const inputText = item.output.text?.trim() ?? "";
            await this.progress(active, node.id, 8, `输入 ${i + 1}/${textItems.length}：运行配方 ${recipe.steps.length} 步`);
            let finalText = await this.executeRecipeOnInput(
              active,
              node,
              inputText,
              recipe,
              aiConfig,
              signal,
              item.sourceMeta?.label ?? "当前输入素材",
              i * recipe.steps.length,
              totalFlat,
              inputRef,
              drillParams,
            );
            // 信息溯源 v2：若配置了 Tavily，则对最终 JSON 做外部联网核查并回填 external 字段。
            if (blockId === "builtin.trace.v2") {
              const searchConfig = getSearchConfig(this.db);
              if (searchConfig.apiKey) {
                try {
                  finalText = await enrichTraceReportWithExternalChecks(inputText, finalText, aiConfig, searchConfig, signal);
                  await this.log(active, node.id, "info", "已执行外部联网核查", undefined, inputRef);
                } catch (err) {
                  await this.log(active, node.id, "info", `外部联网核查未完成，已保留内部溯源结果：${describeError(err)}`, undefined, inputRef);
                }
              }
            }
            // 知识巩固：把多步产物编译成结构化练习集（引文校验 + 逐条丢弃），并覆盖节点摘要。
            if (isDrill) {
              const built = buildDrill(finalText, inputText, { withExtensions: data.withExtensions !== false });
              if (!built.set) throw new Error(built.error ?? "没有生成可用的练习题，请重跑本节点");
              finalText = JSON.stringify(built.set);
              drillSummary = built.summary;
              if (built.drops.length > 0) {
                await this.log(active, node.id, "info", `丢弃明细：${built.dropDetail}`, undefined, inputRef);
              }
            }
            await this.updateInputResult(active, node.id, item.sourceNodeId, item.position, finalText);
            parts.push(finalText);
          }
          const outputs = parts.map((text) => ({ kind: "noteBlock" as const, text, size: text.length }));
          const total = parts.reduce((sum, text) => sum + text.length, 0);
          return { outputs, summary: drillSummary || `配方 ${recipe.steps.length} 步 · ${textItems.length} 输入 · ${totalFlat} 次调用 · ${total} 字` };
        }
        if (override.trim() && builtin?.recipe) {
          await this.log(active, node.id, "info", "自定义提示词覆盖配方，按单步执行");
        }
        const system =
          override.trim() ||
          builtin?.prompt ||
          (node.type === "process.refine"
            ? "你是文字校对编辑。修正转写文稿中的错别字、重复与语气词，保持原意与信息完整，只输出校对后的文稿。"
            : "你是内容编辑。按用户要求整理文稿，只输出整理结果。");
        const model = aiConfig.model;
        const parts: string[] = [];
        for (let i = 0; i < textItems.length; i += 1) {
          const item = textItems[i];
          const inputRef = { index: item.position, total: textItems.length };
          const inputText = item.output.text?.trim() ?? "";
          await this.progress(active, node.id, Math.round(10 + (i / textItems.length) * 80), `处理输入 ${i + 1}/${textItems.length}`);
          await this.log(active, node.id, "input", inputText, undefined, inputRef);
          await this.log(active, node.id, "ai-request", `${model}\n\n${system}`, undefined, inputRef);
          const result = await chatCompletion({ ...aiConfig, model }, system, inputText, signal);
          if (!result.trim()) throw new Error(`第 ${i + 1} 个输入处理结果为空`);
          const trimmed = result.trim();
          await this.log(active, node.id, "ai-response", trimmed, undefined, inputRef);
          await this.updateInputResult(active, node.id, item.sourceNodeId, item.position, trimmed);
          parts.push(trimmed);
        }
        // 知识巩固：自定义提示词覆盖配方时走单步路径，产物同样要编译成练习集再落盘。
        if (isDrill) {
          const builtList = parts.map((text, index) =>
            buildDrill(text, textItems[index]?.output.text?.trim() ?? "", { withExtensions: data.withExtensions !== false }),
          );
          const failed = builtList.find((built) => !built.set);
          if (failed) throw new Error(failed.error ?? "没有生成可用的练习题，请重跑本节点");
          parts.splice(0, parts.length, ...builtList.map((built) => JSON.stringify(built.set)));
          drillSummary =
            builtList.length === 1
              ? builtList[0].summary
              : `${builtList.length} 份练习 · ${builtList.map((built) => `${built.set!.items.length} 题`).join(" / ")}`;
        }
        const kind: NodeOutput["kind"] =
          node.type === "process.prompt" || node.type === "process.gameguide" || isDrill ? "noteBlock" : "text";
        const outputs = parts.map((text) => ({ kind, text, size: text.length }));
        const total = parts.reduce((sum, text) => sum + text.length, 0);
        return { outputs, summary: drillSummary || `${textItems.length} 个输入 · ${total} 字` };
      }

      case "process.merge": {
        if (!inputs.text) throw new Error("没有可合并的笔记块");
        // 知识巩固产物是 JSON：逐输入序列化成可读 Markdown，避免原始 JSON 混进笔记文档。
        const noteText = inputs.items
          .filter((item) => item.output.kind !== "audio")
          .map((item) => maybeDrillToMarkdown(item.output.text ?? ""))
          .filter(Boolean)
          .join("\n\n");
        const title = String(data.title ?? "").trim() || "合并笔记";
        const markdown = `# ${title}\n\n${noteText}`;
        await this.log(active, node.id, "input", noteText);
        return { outputs: [{ kind: "noteDoc", text: markdown, size: markdown.length }], summary: `${markdown.length} 字` };
      }

      case "process.output": {
        if (!inputs.text) throw new Error("没有可输出的文档");
        const fileName = escapePathName(String(data.fileName ?? "笔记.md").trim() || "笔记.md");
        const outputDir = getSettings(this.db).general.outputDir || "outputs";
        const dir = join(this.dataDir, outputDir, active.id);
        await mkdir(dir, { recursive: true });
        const outPath = join(dir, fileName);
        // 知识巩固产物是 JSON：写出前序列化成可读 Markdown 题目集。
        const outText = inputs.items
          .filter((item) => item.output.kind !== "audio")
          .map((item) => maybeDrillToMarkdown(item.output.text ?? ""))
          .filter(Boolean)
          .join("\n\n");
        await writeFile(outPath, outText, "utf8");
        const rel = `${outputDir}/${active.id}/${fileName}`;
        await this.log(active, node.id, "info", `输出文件：${rel}`);
        return { outputs: [{ kind: "noteDoc", text: outText, path: rel, size: outText.length }], summary: `${fileName} · ${outText.length} 字` };
      }

      case "flow.pick": {
        // 到达这里说明挑选已经在 resolveInputs 里生效（未选中的素材根本没进来），
        // 本节点的职责只是把选中的原样放行，并把素材身份一起传下去。
        const textItems = inputs.items.filter((i) => i.output.kind !== "audio" && (i.output.text ?? "").trim());
        if (textItems.length === 0) throw new Error("没有可挑选的内容输入");
        const outputs: NodeOutput[] = textItems.map((item) => ({
          kind: item.output.kind,
          text: item.output.text,
          size: item.output.size ?? item.output.text?.length,
          itemKey: item.itemKey,
        }));
        const total = inputs.items.length + inputs.excluded.length;
        return { outputs, summary: `放行 ${textItems.length}/${total} 段` };
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
          return { kind: item.output.kind as NodeOutput["kind"], text, size: text.length, itemKey: item.itemKey };
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
        const model = aiConfig.model;
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

      case "process.mindmap": {
        const textItems = inputs.items.filter((i) => i.output.kind !== "audio" && i.output.text?.trim());
        if (textItems.length === 0) throw new Error("没有文稿输入");
        const text = textItems.map((i) => i.output.text?.trim() ?? "").filter(Boolean).join("\n\n");
        if (!text.trim()) throw new Error("没有可生成思维导图的文稿");
        const aiConfig = getAiConfig(this.db);
        if (!aiConfig.apiKey) throw new Error("未配置 AI 模型密钥，请到设置页填写");
        const branchSize = String(data.branchSize ?? "auto") as "auto" | "few" | "many";
        const maxDepth = Math.min(5, Math.max(3, Number(data.maxDepth ?? 4) || 4));
        const theme = String(data.theme ?? "paper") as "paper" | "presentation" | "academic";
        const branchGuide =
          branchSize === "few" ? "主分支 3-5 个" : branchSize === "many" ? "主分支 6-9 个" : "主分支 4-7 个";
        const titleHint = String(data.title ?? "").trim()
          ? `导图标题必须使用用户指定的“${String(data.title).trim()}”，不要另取标题。`
          : "为导图取一个不超过 20 字的中心主题标题。";
        const model = aiConfig.model;
        const system = `你是思维导图结构化编辑。请把下面“校对后的原稿”整理成思维导图。
要求：
1. 只输出 JSON，不要输出解释或 Markdown 代码块。
2. JSON 格式：{"title":"中心主题","nodes":[{"text":"主分支","children":[{"text":"子主题","children":[{"text":"叶子要点"}]}]}]}
3. ${branchGuide}；层级最多 ${maxDepth} 层（不含中心主题）；每个节点 2-5 个子节点。
4. 节点文本用短语，中文建议不超过 12 字，不要照抄长句。
5. 严格忠于原文，不新增原文没有的观点，删除重复或高度重叠的分支。
6. ${titleHint}
7. 如果原稿较长，优先提炼骨架与关键结论，而不是罗列每一句话。`;
        await this.log(active, node.id, "ai-request", `${model}\n\n${system}`);
        await this.progress(active, node.id, 15, "AI 提炼思维导图结构");
        const result = await chatCompletion({ ...aiConfig, model }, system, text, signal);
        await this.log(active, node.id, "ai-response", result);
        const tree = parseMindMapJson(result, { branchSize, maxDepth, theme });
        if (!tree.title && String(data.title ?? "").trim()) tree.title = String(data.title).trim();
        const markdown = mindMapToMarkdown(tree, { branchSize, maxDepth, theme });
        const nodeCount = countMindMapNodes(tree.nodes);
        const summary = `${tree.nodes.length} 个主分支 · ${nodeCount} 个节点 · ${markdown.length} 字`;
        return { outputs: [{ kind: "noteDoc", text: markdown, size: markdown.length }], summary };
      }

      case "process.obsidian": {
        if (!inputs.text) throw new Error("没有可写入 Obsidian 的文稿");
        const settings = getSettings(this.db);
        const nutstoreMode = settings.nutstore.obsidianMode;
        if (nutstoreMode && !settings.nutstore.hasPassword) {
          throw new Error("已开启坚果云 Obsidian 模式，但尚未配置坚果云账号/应用密码，请到设置页填写");
        }
        let config: NutstoreConfig | undefined;
        let vaultPath = "";
        let dir = "";
        let remoteObsidianRoot = "";
        let remoteDir = "";
        const folder = (String(data.folder ?? "").trim() || settings.obsidian.folder || "00-Inbox").replace(/^[\\/]+|[\\/]+$/g, "");
        const segments = folder.split(/[\\/]+/).filter(Boolean);
        if (segments.some((segment) => segment === "..")) throw new Error("Obsidian 保存目录不能包含 ..");
        if (nutstoreMode) {
          config = getNutstoreConfig(this.db);
          if (!config.account || !config.password) throw new Error("坚果云账号或应用密码为空，请到设置页填写");
          remoteObsidianRoot = (settings.nutstore.obsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian").replace(/\/+$/, "");
          remoteDir = segments.length ? `${remoteObsidianRoot}/${segments.join("/")}` : remoteObsidianRoot;
          await ensureRemoteDirectory(config, remoteDir);
        } else {
          vaultPath = settings.obsidian.vaultPath.trim();
          if (!vaultPath) throw new Error("未配置 Obsidian 库路径，请到设置页填写");
          dir = join(vaultPath, ...segments);
          await mkdir(dir, { recursive: true });
        }
        const text = inputs.text.trim();
        const meta = this.upstreamSourceMeta(active, node.id);
        const source = String(data.source ?? "").trim() || meta.source || "";
        const author = String(data.author ?? "").trim() || meta.author || "";
        const url = String(data.url ?? "").trim() || meta.url || "";
        let title = String(data.title ?? "").trim();
        if (!title) {
          const firstHeading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
          title = meta.title || firstHeading || "未命名笔记";
        }
        const created = new Date().toISOString().slice(0, 10);
        const noteType = source === "文本" ? "学习笔记" : source === "B站" || source === "本地文件" ? "视频笔记" : "笔记";
        const explicitTags = String(data.tags ?? "")
          .split(/[,，\s]+/)
          .map((tag) => tag.trim())
          .filter(Boolean);
        // 简单历史知识库模式：AI 只提取人物/事件/时期，不做精细标签。
        const entities = settings.obsidian.autoTagEnabled
          ? await this.extractHistoryEntities(text, signal)
          : { persons: [], events: [], periods: [] };
        const frontmatterLines = [
          "---",
          `标题: ${title}`,
          `类型: ${noteType}`,
          source ? `来源: ${source}` : undefined,
          author ? `作者: ${author}` : undefined,
          url ? `原始链接: ${url}` : undefined,
          `创建日期: ${created}`,
          ...(explicitTags.length > 0 ? ["tags:", ...explicitTags.map((tag) => `  - ${tag}`)] : []),
          ...(entities.persons.length > 0 ? ["人物:", ...entities.persons.map((person) => `  - ${person}`)] : []),
          ...(entities.events.length > 0 ? ["事件:", ...entities.events.map((event) => `  - ${event}`)] : []),
          ...(entities.periods.length > 0 ? [`时期: ${entities.periods[0]}`] : []),
          "---",
        ].filter((line): line is string => typeof line === "string");
        const body = text.startsWith("# ") ? text : `# ${title}\n\n${text}`;
        let markdown = `${frontmatterLines.join("\n")}\n\n${body}\n`;
        const fileName = `${escapePathName(title)}.md`;
        const outPath = nutstoreMode ? `${remoteDir}/${fileName}` : join(dir, fileName);

        // 自动关联：只按人物/事件/时期判断相关性，找到后写入 [[链接]]。
        let relatedNames: string[] = [];
        if (settings.obsidian.autoLinkEnabled && settings.obsidian.autoLinkMax > 0) {
          let existingNotes: Array<{ absPath: string; name: string; persons: string[]; events: string[]; periods: string[]; content: string }>;
          if (nutstoreMode && config) {
            existingNotes = await this.scanRemoteObsidianNotes(config, remoteObsidianRoot);
          } else {
            existingNotes = await this.scanObsidianNotes(vaultPath, outPath);
          }
          relatedNames = this.findRelatedNoteNames(
            { persons: entities.persons, events: entities.events, periods: entities.periods, title },
            existingNotes,
            settings.obsidian.autoLinkMax || 5,
          );
          if (relatedNames.length > 0) {
            markdown += `\n## 相关笔记\n${relatedNames.map((name) => `- [[${name}]]`).join("\n")}\n`;
          }
        }

        if (nutstoreMode && config) {
          await writeRemoteFile(config, outPath, markdown);
          await this.log(active, node.id, "info", `已写入坚果云 Obsidian：${outPath}`);
        } else {
          await writeFile(outPath, markdown, "utf8");
          await this.log(active, node.id, "info", `已写入 Obsidian：${outPath}`);
        }
        const linkText = relatedNames.length > 0 ? ` · 关联 ${relatedNames.length} 篇` : "";
        return {
          outputs: [{ kind: "noteDoc", text: markdown, size: markdown.length, path: outPath }],
          summary: `已保存到 ${nutstoreMode ? "坚果云 Obsidian" : "Obsidian"}：${folder}/${fileName}${linkText}`,
        };
      }

      default:
        throw new Error(`节点类型暂不支持：${(node as { type: string }).type}`);
    }
  }

  /** AI 从正文提取历史笔记需要的人物/事件/时期。 */
  private async extractHistoryEntities(text: string, signal?: AbortSignal): Promise<{ persons: string[]; events: string[]; periods: string[] }> {
    const empty = { persons: [], events: [], periods: [] };
    try {
      const aiConfig = getAiConfig(this.db);
      if (!aiConfig.apiKey) return empty;
      const system = `你是历史笔记结构化助手。请从下面的笔记中提取三类信息：
1. 人物：提到的重要历史人物，使用规范姓名；
2. 事件：涉及的历史事件/事迹；
3. 时期：历史时期或朝代。

只输出 JSON，不要解释，格式：{"人物":["..."],"事件":["..."],"时期":["..."]}。每个字段最多 5 个。`;
      const result = await chatCompletion({ ...aiConfig }, system, text.slice(0, 12000), signal);
      return parseHistoryEntities(result);
    } catch {
      return empty;
    }
  }

  /** 根据受控词表 + AI 生成 Obsidian 标签。 */
  private async buildObsidianTags(input: { text: string; source: string; noteType: string; explicitTags: string[]; signal?: AbortSignal }): Promise<string[]> {
    const obsidian = getSettings(this.db).obsidian;
    const min = Math.max(1, obsidian.tagMinCount || 5);
    const max = Math.max(min, obsidian.tagMaxCount || 10);
    const taxonomyTags = Object.values(obsidian.tagTaxonomy ?? {})
      .flat()
      .map((tag) => tag.trim())
      .filter(Boolean);
    const taxonomyLower = new Set(taxonomyTags.map((tag) => tag.toLowerCase()));
    const tags = [...input.explicitTags.map((tag) => tag.trim()).filter(Boolean)];

    const addTag = (tag: string) => {
      const value = tag.trim();
      if (value && !tags.some((existing) => existing.toLowerCase() === value.toLowerCase())) tags.push(value);
    };

    if (input.source === "B站") addTag("B站");
    else if (input.source === "文本") addTag("文稿");
    else if (input.source === "本地文件") addTag("本地视频");
    else if (input.source) addTag(input.source);

    if (input.noteType === "学习笔记") addTag("学习笔记");
    else if (input.noteType === "视频笔记") addTag("视频笔记");
    addTag("未整理");

    if (obsidian.autoTagEnabled && tags.length < min) {
      try {
        const aiConfig = getAiConfig(this.db);
        if (aiConfig.apiKey) {
          const system = `你是知识库打标助手。请根据下面的笔记内容，为 Obsidian 笔记生成标签。
要求：
1. 优先从“可用标签”中选择；
2. 如果确实需要，最多新增 3 个不在可用标签中的标签；
3. 最终输出 ${min}-${max} 个标签；
4. 不要解释，只输出 JSON 数组；
5. 标签不能包含空格。

可用标签：
${JSON.stringify(taxonomyTags)}`;
          const result = await chatCompletion({ ...aiConfig }, system, input.text.slice(0, 12000), input.signal);
          const generated = parseTagArray(result);
          let addedNew = 0;
          for (const tag of generated) {
            if (tags.length >= max) break;
            if (taxonomyLower.has(tag.toLowerCase())) {
              addTag(tag);
            } else if (addedNew < 3) {
              addTag(tag);
              addedNew += 1;
            }
          }
        }
      } catch {
        // AI 打标失败不阻塞保存
      }
    }

    if (tags.length === 0) addTag("笔记");
    return tags.slice(0, max);
  }

  /** 扫描 Obsidian 库内已有笔记（跳过模板/附件/隐藏目录）。 */
  private async scanObsidianNotes(
    vaultPath: string,
    excludePath: string,
  ): Promise<Array<{ absPath: string; name: string; persons: string[]; events: string[]; periods: string[]; content: string }>> {
    const results: Array<{ absPath: string; name: string; persons: string[]; events: string[]; periods: string[]; content: string }> = [];
    const walk = async (dir: string, rel: string) => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          if (entry.name === "90-Templates" || entry.name === "Attachments") continue;
          await walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const abs = join(dir, entry.name);
          if (resolve(abs) === resolve(excludePath)) continue;
          const content = await readFile(abs, "utf8").catch(() => "");
          if (!content.trim()) continue;
          results.push({
            absPath: abs,
            name: entry.name.replace(/\.md$/, ""),
            persons: parseYamlFieldList(content, "人物"),
            events: parseYamlFieldList(content, "事件"),
            periods: parseYamlFieldList(content, "时期"),
            content,
          });
        }
      }
    };
    await walk(vaultPath, "");
    return results;
  }

  /** 扫描坚果云远程 Obsidian 库内已有笔记（内容只用于相关性判断）。 */
  private async scanRemoteObsidianNotes(
    config: NutstoreConfig,
    remoteRoot: string,
  ): Promise<Array<{ absPath: string; name: string; persons: string[]; events: string[]; periods: string[]; content: string }>> {
    const notes = await scanRemoteMarkdown(config, remoteRoot, { maxFiles: 2000, maxFileBytes: 1024 * 1024 });
    return notes.map((note) => ({
      absPath: note.path,
      name: note.name.replace(/\.md$/, ""),
      persons: parseYamlFieldList(note.content, "人物"),
      events: parseYamlFieldList(note.content, "事件"),
      periods: parseYamlFieldList(note.content, "时期"),
      content: note.content,
    }));
  }

  /** 根据当前笔记的人物/事件/时期，找出库内相关笔记名。 */
  private findRelatedNoteNames(
    current: { persons: string[]; events: string[]; periods: string[]; title: string },
    notes: Array<{ name: string; persons: string[]; events: string[]; periods: string[]; content: string }>,
    max: number,
  ): string[] {
    const scored: Array<{ name: string; score: number }> = [];
    for (const note of notes) {
      let score = 0;
      for (const person of current.persons) {
        const lower = person.toLowerCase();
        if (note.persons.some((candidate) => candidate.toLowerCase() === lower)) score += 4;
        if (note.name.toLowerCase().includes(lower)) score += 2;
        if (note.content.toLowerCase().includes(lower)) score += 1;
      }
      for (const event of current.events) {
        const lower = event.toLowerCase();
        if (note.events.some((candidate) => candidate.toLowerCase() === lower)) score += 4;
        if (note.name.toLowerCase().includes(lower)) score += 2;
        if (note.content.toLowerCase().includes(lower)) score += 1;
      }
      for (const period of current.periods) {
        const lower = period.toLowerCase();
        if (note.periods.some((candidate) => candidate.toLowerCase() === lower)) score += 3;
        if (note.name.toLowerCase().includes(lower)) score += 1;
        if (note.content.toLowerCase().includes(lower)) score += 1;
      }
      if (current.title && note.name.toLowerCase().includes(current.title.toLowerCase())) score += 2;
      // 至少达到强相关阈值才认为相关，避免误连。
      if (score >= 3) scored.push({ name: note.name, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map((item) => item.name);
  }

  private async progress(active: ActiveRun, nodeId: string, progress: number, message: string) {
    if (active.cancelled) throw new Error("运行已取消");
    this.emit(active, { type: "node.progress", runId: active.id, nodeId, progress, message });
    // 进度同时落库：离开工作流再回来时，卡片底部仍能恢复当前进行中的摘要/进度信息。
    await this.db
      .update(runNodeResults)
      .set({ status: "running", summary: `${message} ${progress}%`, updatedAt: Date.now() })
      .where(and(eq(runNodeResults.runId, active.id), eq(runNodeResults.nodeId, nodeId)))
      .run();
  }

  private async log(
    active: ActiveRun,
    nodeId: string,
    kind: "input" | "ai-request" | "ai-response" | "info" | "error",
    content: string,
    step?: string,
    /** 多输入节点：标注该条日志属于第几个输入（对应 run_node_inputs.position）。 */
    input?: { index: number; total: number },
  ) {
    if (!content) return;
    await this.db
      .insert(runNodeLogs)
      .values({
        id: randomUUID(),
        runId: active.id,
        nodeId,
        kind,
        content: content.slice(0, 8000),
        step: step ?? undefined,
        inputIndex: input?.index,
        inputTotal: input?.total,
        createdAt: Date.now(),
      })
      .run();
  }

  /**
   * M8-1：对单个输入执行一条配方（顺序步骤 + 确定性断言门）。
   * 步骤 0 的 user 消息为原文；后续步骤的 user 消息为上一步输出；
   * system 模板变量 {{input}}/{{prev}}/{{all}} 由执行器展开。
   * 断言失败/JSON 非法抛出的错误不可自动重试（isRetryableError 词表）；网络类错误保留 cause，走节点级重试。
   */
  private async executeRecipeOnInput(
    active: ActiveRun,
    node: GraphNode,
    inputText: string,
    recipe: Recipe,
    aiConfig: AiConfig,
    signal: AbortSignal | undefined,
    sourceLabel: string,
    flatBase: number,
    totalFlat: number,
    /** 该输入在节点输入列表里的位置，用于把日志归到对应分段。 */
    inputRef?: { index: number; total: number },
    /** 节点参数指令（{{params}}），与原文分离注入，避免污染引用回查的比对源。 */
    params?: string,
  ): Promise<string> {
    await this.log(active, node.id, "input", inputText, undefined, inputRef);
    let prev = "";
    let all = "";
    for (let j = 0; j < recipe.steps.length; j += 1) {
      const step = recipe.steps[j];
      const flatIndex = flatBase + j;
      const system = renderStepSystem(step.system, { input: inputText, prev, all, source: sourceLabel, params });
      const user = j === 0 ? inputText : prev;
      const model = step.model ?? aiConfig.model;
      const progress = Math.round(10 + ((flatIndex + 1) / totalFlat) * 86);
      await this.progress(active, node.id, progress, `步骤 ${flatIndex + 1}/${totalFlat} ${step.label}`);
      await this.log(active, node.id, "ai-request", `[${step.id}] ${step.label}\n\n${model}\n\n${system}`, step.id, inputRef);
      let result: string;
      try {
        result = await chatCompletion({ ...aiConfig, model }, system, user, signal);
      } catch (error) {
        const message = describeError(error);
        this.emit(active, { type: "node.step.error", runId: active.id, nodeId: node.id, stepId: step.id, index: flatIndex + 1, total: totalFlat, error: message });
        throw new Error(`步骤「${step.label}」调用失败：${message}`, { cause: error });
      }
      const raw = result.trim();
      // 文本步骤：AI 偶尔会把整篇 Markdown 用 ```markdown ... ``` 包起来。
      // 这里先剥掉外层围栏再校验/落盘，避免因为这种格式问题误判失败。
      let trimmed = step.expects?.kind === "text" ? stripOuterCodeFence(raw) : raw;
      // 阴阳师攻略 scan：AI 可能少写空数组字段（如 versionNotes），这里自动补全，
      // 避免 jsonRootKeys 因“少一个空数组”把整条流程判失败。
      if (node.type === "process.gameguide" && step.id === "scan") {
        trimmed = ensureGameGuideScanKeys(trimmed);
      }
      if (!trimmed) {
        const message = `步骤「${step.label}」返回空内容`;
        this.emit(active, { type: "node.step.error", runId: active.id, nodeId: node.id, stepId: step.id, index: flatIndex + 1, total: totalFlat, error: message });
        throw new Error(message);
      }
      await this.log(active, node.id, "ai-response", `[${step.label}] 输出 ${trimmed.length} 字\n\n${trimmed}`, step.id, inputRef);
      try {
        assertStepOutput(step, trimmed, { input: inputText, prev, all });
      } catch (error) {
        const message = describeError(error);
        this.emit(active, { type: "node.step.error", runId: active.id, nodeId: node.id, stepId: step.id, index: flatIndex + 1, total: totalFlat, error: message });
        throw error instanceof Error ? error : new Error(message);
      }
      this.emit(active, { type: "node.step.done", runId: active.id, nodeId: node.id, stepId: step.id, index: flatIndex + 1, total: totalFlat, summary: `${step.label} 完成` });
      prev = trimmed;
      all = appendAllOutput(all, step, trimmed);
    }
    return prev;
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
      nodeId: row.nodeId ?? undefined,
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
      itemKey: r.itemKey ?? undefined,
      excluded: r.excluded === true,
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
    const mediaRows = this.db.select().from(runMedia).where(eq(runMedia.runId, runId)).all();
    const assetIds = mediaRows.map((r) => r.assetId);
    await this.db.delete(runNodeResults).where(eq(runNodeResults.runId, runId)).run();
    await this.db.delete(runNodeInputs).where(eq(runNodeInputs.runId, runId)).run();
    await this.db.delete(runNodeLogs).where(eq(runNodeLogs.runId, runId)).run();
    await this.db.delete(runMedia).where(eq(runMedia.runId, runId)).run();
    await this.db.delete(runs).where(eq(runs.id, runId)).run();
    // 媒体 GC：不再被任何运行引用的资产删行；media/ 文件删除，uploads/ 直放原件保留。
    await gcMediaAssets(this.db, this.dataDir, assetIds);
    await rm(join(this.dataDir, "runs", runId), { recursive: true, force: true }).catch(() => undefined);
    const outputDir = getSettings(this.db).general.outputDir || "outputs";
    await rm(join(this.dataDir, outputDir, runId), { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * 删除工程及其全部运行记录（含节点结果/输入/日志与产物文件）。
   * 调用方需保证该工程没有 running 状态的运行；返回被清理的运行数。
   */
  async deleteProject(projectId: string): Promise<number> {
    const rows = this.db.select().from(runs).where(eq(runs.projectId, projectId)).all();
    for (const row of rows) {
      await this.deleteRun(row.id);
    }
    await this.db.delete(runs).where(eq(runs.projectId, projectId)).run();
    await this.db.delete(projects).where(eq(projects.id, projectId)).run();
    return rows.length;
  }
}

export function nextRunId(): string {
  return `run_${randomUUID()}`;
}
