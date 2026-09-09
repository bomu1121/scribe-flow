<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElTable, ElTableColumn } from "element-plus";
import { toast } from "@/lib/toast";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  ListTree,
  Maximize,
  Minimize,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  RefreshCw,
  RotateCcw,
  ScrollText,
  StopCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import type { ProjectMeta, RunDetail, RunNodeInput, RunNodeResult, WorkflowGraph } from "@scribe-flow/shared";
import { NODE_TYPE_LABELS } from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { subscribeRunEvents } from "@/lib/sse";
import { useProjectsStore } from "@/stores/projects";
import MindMapViewer from "@/components/MindMapViewer.vue";
import DiffViewer from "@/components/DiffViewer.vue";
import RunLogDialog from "@/components/RunLogDialog.vue";

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const run = ref<RunDetail | null>(null);
const loading = ref(false);
const activeTab = ref<"result" | "nodes" | "mindmap">("result");
const markdown = ref("");
const draft = ref("");
const mindMapMarkdown = ref("");
const selectedMindMapIndex = ref(0);
const editing = ref(false);
const zoom = ref(100);
const fullscreen = ref(false);
const sideCollapsed = ref(true);
const logDialogOpen = ref(false);
const logDialogNodeId = ref("");
const selectedOutputIndex = ref(0);
const selectedInputKey = ref("");
const tocValue = ref("");
const tocPanelOpen = ref(false);
const tocRootRef = ref<HTMLElement | null>(null);
const inputText = ref("");
const comparingDiff = ref(false);
const resultRootRef = ref<HTMLElement | null>(null);
const docScrollRef = ref<HTMLElement | null>(null);

const runId = String(route.params.runId);
const projectId = String(route.params.id);

/** 顶部副标题里的工程名跟随工程列表响应式更新，左侧栏重命名后立即同步。 */
const projectName = computed(() => {
  const item = projectsStore.list.find((p) => p.id === projectId);
  if (item) return item.name;
  if (projectsStore.current?.id === projectId) return projectsStore.current.name;
  return run.value?.projectName ?? "";
});

let stopRunEvents: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let tocCloseTimer: ReturnType<typeof setTimeout> | null = null;

const isRunning = computed(() => run.value?.status === "running");

const statusMeta: Record<string, { label: string }> = {
  running: { label: "运行中" },
  success: { label: "成功" },
  done: { label: "完成" },
  error: { label: "失败" },
  cancelled: { label: "已取消" },
  skipped: { label: "跳过" },
};

interface SourceInfo {
  nodeId: string;
  nodeType: string;
  label: string;
  status?: RunNodeResult["status"];
  summary?: string;
  error?: string;
  url?: string;
  pageInfo?: { page?: number; part?: string; duration?: number };
  items?: { title?: string; part?: string; page?: number; duration?: number }[];
  bvid?: string;
  title?: string;
  cover?: string;
  uploader?: string;
  duration?: number;
  fileName?: string;
  size?: number;
  textPreview?: string;
}

interface OutputDoc {
  node: RunNodeResult;
  title: string;
}

interface InputItem extends SourceInfo {
  key: string;
  sourceNodeId: string;
  kind: "text" | "audio";
  text?: string;
  path?: string;
  size?: number;
  /** 该中间步骤下多个来源的独立内容；存在时主区域按模块分开展示。 */
  modules?: { key: string; label: string; text: string }[];
  /** 在链路中的深度：0=原始素材，越靠近输出越大。 */
  depth: number;
  /** 节点类型短标签，用于卡片徽标展示。 */
  typeLabel: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSize(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 卡片徽标用的短类型名，避免和节点 label 重复。 */
const CHAIN_TYPE_SHORT: Record<string, string> = {
  "source.bili": "B站",
  "source.file": "文件",
  "source.text": "文本",
  "process.transcribe": "转写",
  "process.refine": "校对",
  "process.prompt": "AI",
  "process.merge": "合并",
  "process.output": "输出",
  "flow.if": "分支",
  "process.text": "工具",
  "process.chapter": "章节",
  "process.gameguide": "攻略",
  "process.mindmap": "导图",
  "process.obsidian": "Obsidian",
};

function chainTypeShort(nodeType: string): string {
  return CHAIN_TYPE_SHORT[nodeType] ?? NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] ?? nodeType;
}

function textCharCount(text?: string): number {
  return (text ?? "").replace(/\s/g, "").length;
}

/** 链路卡片副标题：把类型、元信息、字数/状态压缩成一行，避免“点击查看”这类赘余提示。 */
function chainCardMeta(input: InputItem): string {
  const parts: string[] = [];
  if (input.summary) {
    parts.push(input.summary);
  } else {
    if (input.nodeType === "source.bili") {
      if (input.items && input.items.length > 1) parts.push(`${input.items.length} 个视频`);
      else if (input.title) parts.push(input.title);
      if (input.uploader) parts.push(input.uploader);
      if (input.duration) parts.push(fmtDuration(input.duration));
    } else if (input.nodeType === "source.file") {
      if (input.fileName) parts.push(input.fileName);
      if (input.size) parts.push(fmtSize(input.size));
    } else if (input.text) {
      const chars = textCharCount(input.text);
      if (chars > 0) parts.push(`${chars} 字`);
    }
  }
  if (input.status === "error" && input.error) parts.push(input.error);
  return parts.length > 0 ? parts.join(" · ") : input.nodeType === "source.text" ? "空文稿" : "—";
}

function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "");
  return base || "section";
}

function uniqueHeadingId(text: string, seen: Map<string, number>): string {
  const base = slugify(text);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return `sec-${base}${count ? `-${count}` : ""}`;
}

const graph = computed<WorkflowGraph | undefined>(() => run.value?.graph);
const nodeResultMap = computed(() => new Map((run.value?.nodeResults ?? []).map((n) => [n.nodeId, n])));

const outputNodes = computed<OutputDoc[]>(() => {
  const all = run.value?.nodeResults ?? [];
  const docs = all.filter((n) => n.output?.kind === "noteDoc");
  const list = docs.length > 0 ? docs : all.filter((n) => n.output?.kind === "text" || n.output?.kind === "noteBlock").slice(-3);
  return list.map((n) => ({
    node: n,
    title: n.nodeLabel || NODE_TYPE_LABELS[n.nodeType as keyof typeof NODE_TYPE_LABELS] || n.nodeType,
  }));
});

const currentOutput = computed(() => outputNodes.value[selectedOutputIndex.value] ?? null);

const mindMapNodes = computed<OutputDoc[]>(() => {
  const all = run.value?.nodeResults ?? [];
  return all
    .filter((n) => n.nodeType === "process.mindmap" && (n.output?.kind === "noteDoc" || n.output?.kind === "text"))
    .map((n) => ({
      node: n,
      title: n.nodeLabel || NODE_TYPE_LABELS[n.nodeType as keyof typeof NODE_TYPE_LABELS] || n.nodeType,
    }));
});

const currentMindMap = computed(() => mindMapNodes.value[selectedMindMapIndex.value] ?? null);

const sources = computed<SourceInfo[]>(() => {
  const nodes = graph.value?.nodes ?? [];
  return nodes
    .filter((node) => node.type.startsWith("source."))
    .map((node) => {
      const result = nodeResultMap.value.get(node.id);
      const data = asRecord(node.data);
      const base: SourceInfo = {
        nodeId: node.id,
        nodeType: node.type,
        label: String(data.label ?? NODE_TYPE_LABELS[node.type as keyof typeof NODE_TYPE_LABELS] ?? node.type),
        status: result?.status,
        summary: result?.summary,
      };
      if (node.type === "source.bili") {
        return {
          ...base,
          url: String(data.url ?? ""),
          pageInfo: data.pageInfo as SourceInfo["pageInfo"],
          items: Array.isArray(data.items) ? (data.items as SourceInfo["items"]) : undefined,
          bvid: String(data.bvid ?? ""),
          title: String(data.title ?? ""),
          cover: String(data.cover ?? ""),
          uploader: String(data.uploader ?? ""),
          duration: typeof data.duration === "number" ? data.duration : undefined,
        };
      }
      if (node.type === "source.file") {
        return {
          ...base,
          fileName: String(data.fileName ?? ""),
          size: typeof data.size === "number" ? data.size : undefined,
        };
      }
      if (node.type === "source.text") {
        return {
          ...base,
          textPreview: String(data.text ?? "").slice(0, 80),
        };
      }
      return base;
    });
});

function resolveModuleLabel(
  row: RunNodeInput,
  rows: RunNodeInput[],
  resultMap: Map<string, RunNodeResult>,
  graph?: WorkflowGraph,
  sourceIndex = 0,
): string {
  let current = row;
  for (let depth = 0; depth < 12; depth += 1) {
    const nodeResult = resultMap.get(current.sourceNodeId);
    const graphNode = graph?.nodes.find((n) => n.id === current.sourceNodeId);
    const nodeType = nodeResult?.nodeType ?? graphNode?.type ?? "";
    if (nodeType.startsWith("source.")) {
      const data = (graphNode?.data ?? {}) as Record<string, unknown>;
      if (nodeType === "source.bili") {
        const items = Array.isArray(data.items) ? (data.items as { title?: string; part?: string; page?: number }[]) : [];
        const entry = items[sourceIndex];
        if (entry?.title || entry?.part) {
          const base = entry.title || (typeof data.title === "string" ? data.title : "") || nodeResult?.nodeLabel || NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] || nodeType;
          return entry.part ? `${base} · P${entry.page} ${entry.part}` : base;
        }
        if (typeof data.title === "string" && data.title) return data.title;
      }
      if (nodeType === "source.file" && typeof data.fileName === "string" && data.fileName) return data.fileName;
      return nodeResult?.nodeLabel || NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] || nodeType;
    }
    const next = rows.find((r) => r.targetNodeId === current.sourceNodeId && r.position === current.position);
    if (!next) break;
    current = next;
  }
  const nodeResult = resultMap.get(row.sourceNodeId);
  const graphNode = graph?.nodes.find((n) => n.id === row.sourceNodeId);
  const nodeType = nodeResult?.nodeType ?? graphNode?.type ?? "";
  return nodeResult?.nodeLabel || NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] || row.sourceNodeId;
}

function upstreamSourceIds(nodeId: string): Set<string> {
  const edges = graph.value?.edges ?? [];
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const edge of edges) {
      if (edge.target === id && !result.has(edge.source)) {
        result.add(edge.source);
        visit(edge.source);
      }
    }
  };
  visit(nodeId);
  return result;
}

const visibleSources = computed(() => {
  if (!currentOutput.value) return sources.value;
  const ids = upstreamSourceIds(currentOutput.value.node.nodeId);
  if (ids.size === 0) return sources.value;
  return sources.value.filter((s) => ids.has(s.nodeId));
});

const inputItems = computed<InputItem[]>(() => {
  if (!currentOutput.value) return [];
  const rows: RunNodeInput[] = run.value?.inputs ?? [];
  const upstream = upstreamSourceIds(currentOutput.value.node.nodeId);
  const nodes = graph.value?.nodes ?? [];
  const edges = graph.value?.edges ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map((run.value?.nodeResults ?? []).map((n, idx) => [n.nodeId, idx]));

  // 按“到输出的上游深度”分层：source 为 0，越靠近输出深度越大。
  const depthCache = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const node = nodeById.get(id);
    if (!node) return 0;
    if (node.type.startsWith("source.")) {
      depthCache.set(id, 0);
      return 0;
    }
    let max = 0;
    for (const edge of edges) {
      if (edge.target === id && upstream.has(edge.source)) {
        max = Math.max(max, depthOf(edge.source) + 1);
      }
    }
    depthCache.set(id, max);
    return max;
  };

  const items: InputItem[] = [];
  for (const node of nodes) {
    if (!upstream.has(node.id)) continue;
    const nodeResult = nodeResultMap.value.get(node.id);
    const source = sources.value.find((s) => s.nodeId === node.id);
    const nodeType = node.type;
    const data = asRecord(node.data);
    const label =
      source?.label ??
      nodeResult?.nodeLabel ??
      String(data.label ?? NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] ?? nodeType);
    const outgoing = rows.filter((r) => r.sourceNodeId === node.id);

    // 同一来源给同一消费节点的多行，才是“一个来源里的多个独立内容”（如多 P 视频）；
    // 同一内容分发给多个下游分支不应被误当成 modules。
    const byTarget = new Map<string, RunNodeInput[]>();
    for (const row of outgoing) {
      const list = byTarget.get(row.targetNodeId) ?? [];
      list.push(row);
      byTarget.set(row.targetNodeId, list);
    }
    const moduleGroup = [...byTarget.values()]
      .filter((group) => group.length > 1 && group.some((r) => r.kind === "text" && (r.text || r.resultText)))
      .sort((a, b) => b.length - a.length)[0];

    const textRow = outgoing.find((r) => r.kind === "text" && r.text);
    const audioRow = outgoing.find((r) => r.kind === "audio");
    const fallbackText = nodeResult?.output && nodeResult.output.kind !== "audio" ? nodeResult.output.text : undefined;
    const text = textRow?.text ?? fallbackText ?? (nodeType === "source.text" ? String(data.text ?? "") : undefined);
    const defaultKind: InputItem["kind"] = nodeType === "source.text" ? "text" : "audio";
    const modules = moduleGroup
      ? moduleGroup.map((r, index) => ({
          key: r.id,
          label: `${index + 1}. ${resolveModuleLabel(r, rows, nodeResultMap.value, graph.value, index)}`,
          text: r.text ?? r.resultText ?? "",
        }))
      : undefined;
    const depth = depthOf(node.id);
    const typeLabel = chainTypeShort(nodeType);
    const base: InputItem = {
      key: node.id,
      sourceNodeId: node.id,
      nodeId: node.id,
      nodeType,
      typeLabel,
      label,
      depth,
      status: source?.status ?? nodeResult?.status,
      summary: source?.summary ?? nodeResult?.summary,
      error: nodeResult?.error ?? source?.error,
      kind: textRow ? "text" : audioRow ? "audio" : fallbackText ? "text" : defaultKind,
      text,
      path: audioRow?.path ?? (nodeResult?.output?.kind === "audio" ? nodeResult.output.path : undefined),
      size: textRow?.size ?? audioRow?.size ?? nodeResult?.output?.size,
      modules,
    };
    items.push({ ...base, ...(source ?? {}) });
  }

  items.sort(
    (a, b) =>
      a.depth - b.depth ||
      (order.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER),
  );
  return items;
});

/** 把链路输入按深度分成可读的阶段，方便展示“原始素材 → 中间加工 → 最终输入”。 */
const chainStages = computed(() => {
  if (inputItems.value.length === 0) return [];
  const maxDepth = Math.max(...inputItems.value.map((item) => item.depth));
  const groups: { key: string; title: string; items: InputItem[] }[] = [];
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const stageItems = inputItems.value.filter((item) => item.depth === depth);
    if (stageItems.length === 0) continue;
    const title =
      depth === 0
        ? "原始素材"
        : depth === maxDepth
          ? maxDepth === 1
            ? "加工结果"
            : "最终输入"
          : `加工步骤 ${depth}`;
    groups.push({ key: `chain-${depth}`, title, items: stageItems });
  }
  return groups;
});

const selectedInput = computed(() => inputItems.value.find((i) => i.key === selectedInputKey.value) ?? null);
const selectedStageTitle = computed(() => {
  const item = selectedInput.value;
  if (!item) return "";
  return chainStages.value.find((stage) => stage.items.some((candidate) => candidate.key === item.key))?.title ?? "";
});
const viewingInput = computed(() => selectedInput.value !== null);
const currentMarkdown = computed(() => (editing.value ? draft.value : markdown.value));
/** 用于与当前输出对比的“链路输入”完整文本；多模块输入会合并后参与对比。 */
const inputCompareText = computed(() => {
  const item = selectedInput.value;
  if (!item) return "";
  if (item.modules && item.modules.length > 1) return item.modules.map((module) => module.text).join("\n\n");
  return item.text ?? "";
});
const canCompareInputToOutput = computed(() => viewingInput.value && Boolean(inputCompareText.value.trim()) && Boolean(markdown.value.trim()));
const activeMarkdown = computed(() => {
  if (activeTab.value === "mindmap") return mindMapMarkdown.value;
  return viewingInput.value ? inputText.value : currentMarkdown.value;
});
const renderedMarkdown = computed(() => renderMarkdown(markdown.value));
const renderedDraft = computed(() => renderMarkdown(draft.value));
const renderedInputMarkdown = computed(() => renderMarkdown(inputText.value));
const paperStyle = computed(() => ({ "--doc-scale": String(zoom.value / 100) }));
const inputWordCount = computed(() => inputText.value.replace(/\s/g, "").length);
const inputReadingTime = computed(() => Math.max(1, Math.round(inputWordCount.value / 400)));

const toc = computed(() => {
  const items: { id: string; text: string; level: number }[] = [];
  const seen = new Map<string, number>();
  for (const line of activeMarkdown.value.split("\n")) {
    const match = line.match(/^(#{1,4})\s+(.*)$/);
    if (!match) continue;
    const text = match[2]?.trim() ?? "";
    items.push({ id: uniqueHeadingId(text, seen), text, level: match[1].length });
  }
  return items;
});

const currentTocLabel = computed(() => toc.value.find((item) => item.id === tocValue.value)?.text ?? "文档目录");

const wordCount = computed(() => activeMarkdown.value.replace(/\s/g, "").length);
const readingTime = computed(() => Math.max(1, Math.round(wordCount.value / 400)));
const sourceSummary = computed(() => {
  const videoCount = visibleSources.value.reduce(
    (sum, s) => sum + (s.nodeType === "source.bili" ? (s.items?.length ?? 1) : s.nodeType === "source.file" ? 1 : 0),
    0,
  );
  const textCount = visibleSources.value.filter((s) => s.nodeType === "source.text").length;
  const parts: string[] = [];
  if (videoCount > 0) parts.push(`${videoCount} 个音视频`);
  if (textCount > 0) parts.push(`${textCount} 篇文稿`);
  return parts.length > 0 ? parts.join(" + ") : "无输入素材";
});

onMounted(() => {
  void loadRun();
  document.addEventListener("fullscreenchange", onFullscreenChange);
  window.addEventListener("pointerdown", onTocOutsidePointerDown, true);
});

onBeforeUnmount(() => {
  stopRunEvents?.();
  if (reloadTimer) clearTimeout(reloadTimer);
  if (tocCloseTimer) clearTimeout(tocCloseTimer);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  window.removeEventListener("pointerdown", onTocOutsidePointerDown, true);
});

async function loadRun(showLoading = true) {
  if (showLoading) loading.value = true;
  try {
    const data = await api.get<RunDetail>(`/api/runs/${runId}`);
    if (!data.graph) {
      try {
        const project = await api.get<ProjectMeta>(`/api/projects/${projectId}`);
        data.graph = project.graph;
      } catch {
        // 旧数据或工程已删除时，保留无图状态，仍展示节点结果
      }
    }
    const previousOutputId = currentOutput.value?.node.nodeId;
    run.value = data;
    // 运行中输出仍在变化，自动退出编辑，避免草稿被下一次刷新覆盖。
    if (data.status === "running" && editing.value) {
      editing.value = false;
      draft.value = markdown.value;
    }
    if (outputNodes.value.length > 0) {
      const focusNodeId = route.query.focus ? String(route.query.focus) : "";
      const focusIndex = focusNodeId ? outputNodes.value.findIndex((doc) => doc.node.nodeId === focusNodeId) : -1;
      const previousIndex = outputNodes.value.findIndex((doc) => doc.node.nodeId === previousOutputId);
      selectedOutputIndex.value = focusIndex >= 0 ? focusIndex : previousIndex >= 0 ? previousIndex : 0;
      await loadOutputContent(outputNodes.value[selectedOutputIndex.value].node.nodeId);
    } else {
      markdown.value = "";
      draft.value = "";
    }
    const queryTab = String(route.query.tab ?? "");
    if (queryTab === "mindmap" && mindMapNodes.value.length > 0) {
      activeTab.value = "mindmap";
      const focusNodeId = route.query.focus ? String(route.query.focus) : "";
      const focusIndex = focusNodeId ? mindMapNodes.value.findIndex((doc) => doc.node.nodeId === focusNodeId) : -1;
      selectedMindMapIndex.value = focusIndex >= 0 ? focusIndex : 0;
    } else if (activeTab.value === "mindmap" && mindMapNodes.value.length === 0) {
      activeTab.value = "result";
    }
    if (activeTab.value === "mindmap" && mindMapNodes.value.length > 0) {
      const mindIndex = Math.min(selectedMindMapIndex.value, mindMapNodes.value.length - 1);
      await loadMindMapContent(mindIndex);
    }
    refreshSelectedInputText();

    if (stopRunEvents) stopRunEvents();
    if (data.status === "running") {
      stopRunEvents = subscribeRunEvents(runId, (event) => {
        if (event.type === "node.done" || event.type === "node.error" || event.type === "run.done") {
          scheduleReload();
        }
      });
    } else {
      stopRunEvents = null;
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "运行详情加载失败");
  } finally {
    loading.value = false;
  }
}

function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void loadRun(false);
  }, 400);
}

async function loadOutputContent(nodeId: string) {
  const node = run.value?.nodeResults.find((n) => n.nodeId === nodeId);
  if (!node?.output) {
    markdown.value = "";
    draft.value = "";
    return;
  }
  if (node.output.text) {
    markdown.value = node.output.text;
  } else if (node.output.path) {
    try {
      const result = await api.get<{ text: string }>(`/api/runs/${runId}/outputs/${nodeId}/content`);
      markdown.value = result.text ?? "";
    } catch (err) {
      markdown.value = "";
      toast.error(err instanceof Error ? err.message : "输出内容读取失败");
    }
  } else {
    markdown.value = "";
  }
  draft.value = markdown.value;
}

async function loadMindMapContent(index?: number) {
  if (index !== undefined) selectedMindMapIndex.value = index;
  const doc = currentMindMap.value;
  if (!doc) {
    mindMapMarkdown.value = "";
    return;
  }
  const node = doc.node;
  if (node.output?.text) {
    mindMapMarkdown.value = node.output.text;
  } else if (node.output?.path) {
    try {
      const result = await api.get<{ text: string }>(`/api/runs/${runId}/outputs/${node.nodeId}/content`);
      mindMapMarkdown.value = result.text ?? "";
    } catch (err) {
      mindMapMarkdown.value = "";
      toast.error(err instanceof Error ? err.message : "思维导图内容读取失败");
    }
  } else {
    mindMapMarkdown.value = "";
  }
}

async function openMindMapTab(index = 0) {
  activeTab.value = "mindmap";
  await loadMindMapContent(index);
}

async function selectMindMap(index: number) {
  await loadMindMapContent(index);
}

async function selectOutput(index: number) {
  const doc = outputNodes.value[index];
  if (!doc) return;
  selectedInputKey.value = "";
  inputText.value = "";
  comparingDiff.value = false;
  selectedOutputIndex.value = index;
  editing.value = false;
  await loadOutputContent(doc.node.nodeId);
}

async function selectInput(key: string) {
  const item = inputItems.value.find((i) => i.key === key);
  if (!item) return;
  selectedInputKey.value = key;
  editing.value = false;
  comparingDiff.value = false;
  inputText.value = item.text ?? "";
  // 旧数据没有 run_node_inputs 时，大文本可能只存在输出文件里，按需读取。
  if (!inputText.value) {
    const node = nodeResultMap.value.get(item.sourceNodeId);
    if (node?.output && node.output.kind !== "audio" && node.output.path) {
      try {
        const result = await api.get<{ text: string }>(`/api/runs/${runId}/outputs/${item.sourceNodeId}/content`);
        inputText.value = result.text ?? "";
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "输入内容读取失败");
      }
    }
  }
}

function refreshSelectedInputText() {
  const item = selectedInput.value;
  inputText.value = item?.text ?? "";
}

function toggleInputDiff() {
  if (!canCompareInputToOutput.value) return;
  comparingDiff.value = !comparingDiff.value;
}

function toggleEdit() {
  if (!editing.value) {
    draft.value = markdown.value;
    editing.value = true;
  } else {
    editing.value = false;
    draft.value = markdown.value;
  }
}

function resetDraft() {
  draft.value = markdown.value;
  toast.success("已恢复为运行原始输出");
}

function setZoom(delta: number) {
  zoom.value = Math.min(200, Math.max(75, zoom.value + delta));
}

function resetZoom() {
  zoom.value = 100;
}

function onFullscreenChange() {
  fullscreen.value = Boolean(document.fullscreenElement);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await resultRootRef.value?.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    toast.error("全屏切换失败，请检查浏览器权限");
  }
}

function openTocPanel() {
  if (tocCloseTimer) clearTimeout(tocCloseTimer);
  tocCloseTimer = null;
  tocPanelOpen.value = true;
}

function closeTocPanel() {
  if (tocCloseTimer) clearTimeout(tocCloseTimer);
  tocCloseTimer = null;
  tocPanelOpen.value = false;
}

function scheduleCloseTocPanel() {
  if (tocCloseTimer) clearTimeout(tocCloseTimer);
  tocCloseTimer = setTimeout(() => {
    tocPanelOpen.value = false;
    tocCloseTimer = null;
  }, 220);
}

function cancelCloseTocPanel() {
  if (tocCloseTimer) clearTimeout(tocCloseTimer);
  tocCloseTimer = null;
}

function onTocOutsidePointerDown(event: PointerEvent) {
  if (!tocPanelOpen.value) return;
  const target = event.target as Node | null;
  if (tocRootRef.value && target && !tocRootRef.value.contains(target)) closeTocPanel();
}

function selectTocItem(id: string) {
  // 选中后不立即关闭，方便连续跳转多个章节；光标移开后由 hover 逻辑收起。
  scrollToHeading(id);
}

function scrollToHeading(id: string) {
  tocValue.value = id;
  const container = docScrollRef.value;
  const el = container?.querySelector<HTMLElement>(`#${id}`);
  if (!container || !el) return;
  const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12;
  container.scrollTo({ top, behavior: "smooth" });
}

function goBack() {
  const focus = activeTab.value === "mindmap" ? currentMindMap.value?.node.nodeId : currentOutput.value?.node.nodeId;
  router.push({ path: `/project/${projectId}`, query: focus ? { focus } : {} });
}

function fmt(ms?: number): string {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function asNode(row: unknown): RunNodeResult {
  return row as RunNodeResult;
}

function downloadMarkdown() {
  const text = activeMarkdown.value;
  if (!text) return;
  const blob = new Blob([text], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = viewingInput.value ? `run-${runId.slice(-6)}-input.md` : `run-${runId.slice(-6)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyMarkdown() {
  const text = activeMarkdown.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}

function openLogs(nodeId = "") {
  logDialogNodeId.value = nodeId;
  logDialogOpen.value = true;
}

async function retryNode(node: RunNodeResult) {
  try {
    const created = await api.post<{ id: string }>(`/api/runs/${runId}/nodes/${node.nodeId}/retry`);
    toast.clear();
    toast.success(`已启动重跑：#${created.id.slice(-6)}`);
    void router.push({ path: `/project/${projectId}/run/${created.id}`, query: { focus: node.nodeId } });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "重跑失败");
  }
}

async function stopRun() {
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${runId}/stop`);
    toast.success("已发送停止指令");
    await loadRun(false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "停止运行失败");
  }
}

async function forceStopRun() {
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${runId}/force-stop`);
    toast.success("已强制结束运行");
    await loadRun(false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "强制结束失败");
  }
}
</script>

<template>
  <div ref="resultRootRef" class="rv-root">
    <header class="rv-header">
      <div class="rv-header-left">
        <button type="button" class="rv-btn rv-btn--text" @click="goBack"><ArrowLeft :size="14" /><span>返回工作流</span></button>
        <div class="rv-title-block">
          <h2 class="rv-title">
            运行结果 <span class="tnum">#{{ runId.slice(-6) }}</span>
            <span v-if="run" class="rv-status" :class="`is-${run.status}`">
              <span class="rv-status-dot" aria-hidden="true" />
              {{ statusMeta[run.status]?.label }}
            </span>
          </h2>
          <p class="rv-sub">
            {{ run ? `${projectName} · 耗时 ${fmt(run.elapsedMs)} · ${new Date(run.createdAt).toLocaleString("zh-CN")}` : "加载中…" }}
          </p>
        </div>
      </div>
      <div class="rv-actions">
        <template v-if="run?.status === 'running'">
          <button type="button" class="rv-btn rv-btn--text" @click="stopRun"><StopCircle :size="14" /><span>停止</span></button>
          <button type="button" class="rv-btn rv-btn--danger-text" @click="forceStopRun"><StopCircle :size="14" /><span>强制结束</span></button>
        </template>
        <button type="button" class="rv-btn rv-btn--text" @click="openLogs('')"><ScrollText :size="14" /><span>查看日志</span></button>
        <button type="button" class="rv-btn rv-btn--text" :disabled="!activeMarkdown" @click="copyMarkdown"><Copy :size="14" /><span>复制</span></button>
        <button type="button" class="rv-btn rv-btn--text" :disabled="!activeMarkdown" @click="downloadMarkdown"><FileText :size="14" /><span>下载 Markdown</span></button>
      </div>
    </header>

    <nav class="rv-tabs" aria-label="运行详情视图切换">
      <button type="button" :class="{ active: activeTab === 'result' }" @click="activeTab = 'result'">结果</button>
      <button v-if="mindMapNodes.length > 0" type="button" :class="{ active: activeTab === 'mindmap' }" @click="openMindMapTab()">
        <Network :size="14" /><span>思维导图</span>
      </button>
      <button type="button" :class="{ active: activeTab === 'nodes' }" @click="activeTab = 'nodes'">节点流水</button>
    </nav>

    <div v-if="loading && !run" class="rv-loading"><div class="rv-loading-text">加载中…</div></div>

    <template v-else-if="run">
      <div v-show="activeTab === 'nodes'" class="rv-nodes page-scroll">
        <el-table :data="run.nodeResults" row-key="nodeId" size="small" class="rv-nodes-table">
          <el-table-column label="节点" min-width="160">
            <template #default="{ row }">{{ asNode(row).nodeLabel || asNode(row).nodeType }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <span class="rv-status" :class="`is-${asNode(row).status || 'idle'}`">
                <span class="rv-status-dot" aria-hidden="true" />
                {{ statusMeta[asNode(row).status]?.label ?? asNode(row).status }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="90">
            <template #default="{ row }"><span class="tnum">{{ fmt(asNode(row).elapsedMs) }}</span></template>
          </el-table-column>
          <el-table-column label="产物 / 错误" min-width="220">
            <template #default="{ row }">
              <span v-if="asNode(row).error" class="rv-node-error">{{ asNode(row).error }}</span>
              <span v-else-if="(asNode(row).attempts ?? 1) > 1" class="rv-node-retry">
                {{ asNode(row).summary || "—" }} · 重试 {{ asNode(row).attempts! - 1 }} 次
              </span>
              <span v-else>{{ asNode(row).summary || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="right">
            <template #default="{ row }">
              <button type="button" class="rv-btn rv-btn--table" @click="openLogs(asNode(row).nodeId)">日志</button>
              <button
                v-if="asNode(row).status === 'error'"
                type="button"
                class="rv-btn rv-btn--table"
                :disabled="isRunning"
                :title="isRunning ? '运行中不可重跑，请先等待或停止当前运行' : '重跑该节点'"
                @click="retryNode(asNode(row))"
              >
                <RefreshCw :size="13" /><span>重跑</span>
              </button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-show="activeTab === 'mindmap'" class="rv-mindmap">
        <div v-if="mindMapNodes.length > 1" class="rv-mindmap-tabs">
          <button
            v-for="(doc, index) in mindMapNodes"
            :key="doc.node.nodeId"
            type="button"
            :class="{ active: index === selectedMindMapIndex }"
            @click="selectMindMap(index)"
          >
            {{ doc.title }}
          </button>
        </div>
        <div class="rv-mindmap-main">
          <template v-if="currentMindMap && mindMapMarkdown">
            <MindMapViewer :markdown="mindMapMarkdown" height="100%" />
          </template>
          <div v-else class="rv-empty">
            <div class="rv-empty-title">没有可展示的思维导图</div>
            <div class="rv-empty-sub">运行完成后，思维导图会显示在这里。</div>
          </div>
        </div>
      </div>

      <div v-show="activeTab === 'result'" class="rv-body">
        <aside class="rv-side" :class="{ collapsed: sideCollapsed }">
          <div class="rv-side-head">
            <span class="rv-side-title">链路输入</span>
          </div>

          <div class="rv-side-content" :inert="sideCollapsed">
            <template v-if="chainStages.length > 0">
              <section v-for="stage in chainStages" :key="stage.key" class="rv-chain-stage">
                <div class="rv-stage-head">
                  <span class="rv-stage-title">{{ stage.title }}</span>
                  <span class="rv-stage-count tnum">{{ stage.items.length }}</span>
                </div>
                <div class="rv-chain-list">
                  <button
                    v-for="input in stage.items"
                    :key="input.key"
                    type="button"
                    class="rv-chain-row"
                    :class="{ active: selectedInputKey === input.key, [`is-${input.status}`]: input.status }"
                    @click="selectInput(input.key)"
                  >
                    <span
                      class="rv-chain-row-dot"
                      :class="`is-${input.status}`"
                      :title="input.status ? statusMeta[input.status]?.label ?? input.status : undefined"
                    />
                    <span class="rv-chain-row-main">
                      <span class="rv-chain-row-label">{{ input.label }}</span>
                      <span class="rv-chain-row-meta">{{ chainCardMeta(input) }}</span>
                      <span v-if="input.error" class="rv-chain-row-error">{{ input.error }}</span>
                    </span>
                    <span class="rv-chain-row-type">{{ input.typeLabel }}</span>
                  </button>
                </div>
              </section>
            </template>
            <div v-else class="rv-side-empty">本次结果没有可追溯的输入素材</div>

            <div class="rv-side-section-title">输出文档</div>
            <div v-if="outputNodes.length > 0" class="rv-output-list">
              <button
                v-for="(doc, index) in outputNodes"
                :key="doc.node.nodeId"
                type="button"
                class="rv-output-item"
                :class="{ active: !viewingInput && index === selectedOutputIndex }"
                @click="selectOutput(index)"
              >
                <span class="rv-output-name">{{ doc.title }}</span>
                <span class="rv-output-meta tnum">{{ doc.node.summary || "—" }}</span>
              </button>
            </div>
            <div v-else class="rv-side-empty">没有可展示的输出</div>
          </div>
        </aside>

        <section class="rv-main">
          <div class="rv-toolbar">
            <div class="rv-tool-group">
              <button
                type="button"
                class="rv-tool-btn"
                :title="sideCollapsed ? '展开链路面板' : '收起链路面板'"
                @click="sideCollapsed = !sideCollapsed"
              >
                <PanelLeftOpen v-if="sideCollapsed" :size="14" />
                <PanelLeftClose v-else :size="14" />
              </button>
              <span class="rv-tool-divider" />
              <button type="button" class="rv-tool-btn" title="缩小" @click="setZoom(-10)"><ZoomOut :size="14" /></button>
              <span class="rv-zoom tnum">{{ zoom }}%</span>
              <button type="button" class="rv-tool-btn" title="放大" @click="setZoom(10)"><ZoomIn :size="14" /></button>
              <button type="button" class="rv-tool-btn" title="重置缩放" @click="resetZoom"><RotateCcw :size="14" /></button>
              <span class="rv-tool-divider" />
              <button type="button" class="rv-tool-btn" :title="fullscreen ? '退出全屏' : '全屏阅读'" @click="toggleFullscreen">
                <Minimize v-if="fullscreen" :size="14" />
                <Maximize v-else :size="14" />
              </button>
              <button
                v-if="viewingInput && canCompareInputToOutput"
                type="button"
                class="rv-tool-btn"
                :class="{ active: comparingDiff }"
                :title="comparingDiff ? '退出对比，返回查看输入' : '将当前输入与最终输出做差异对比'"
                @click="toggleInputDiff"
              >
                <span>{{ comparingDiff ? "退出对比" : "对比输出" }}</span>
              </button>
              <button v-if="viewingInput" type="button" class="rv-tool-btn" title="返回输出" @click="selectedInputKey = ''; inputText = ''; comparingDiff = false">
                <ArrowLeft :size="14" /><span>输出</span>
              </button>
              <button
                v-if="!viewingInput"
                type="button"
                class="rv-tool-btn"
                :class="{ active: editing }"
                :disabled="isRunning"
                :title="isRunning ? '运行中不可编辑' : editing ? '退出编辑' : '编辑文档'"
                @click="toggleEdit"
              >
                <Eye v-if="editing" :size="14" />
                <PenLine v-else :size="14" />
              </button>
              <span v-if="editing && !viewingInput" class="rv-tool-text">编辑中</span>
            </div>
            <div
              v-if="toc.length > 0"
              ref="tocRootRef"
              class="rv-toc"
              @mouseenter="openTocPanel"
              @mouseleave="scheduleCloseTocPanel"
            >
              <ListTree :size="14" />
              <button
                type="button"
                class="rv-toc-trigger"
                :class="{ 'is-open': tocPanelOpen }"
                :aria-expanded="tocPanelOpen"
                aria-label="文档目录"
                @click="openTocPanel"
              >
                <span class="rv-toc-trigger-label">{{ currentTocLabel }}</span>
                <ChevronDown :size="12" class="rv-toc-trigger-arrow" />
              </button>

              <Transition name="toc-pop">
                <div
                  v-if="tocPanelOpen"
                  class="rv-toc-panel"
                  role="listbox"
                  aria-label="文档目录"
                  @mouseenter="cancelCloseTocPanel"
                  @mouseleave="scheduleCloseTocPanel"
                >
                  <div class="rv-toc-panel-title">文档目录</div>
                  <div class="rv-toc-panel-list">
                    <button
                      v-for="item in toc"
                      :key="item.id"
                      type="button"
                      role="option"
                      class="rv-toc-item"
                      :class="{ 'is-active': item.id === tocValue }"
                      :aria-selected="item.id === tocValue"
                      :style="{ paddingLeft: `${10 + (item.level - 1) * 16}px` }"
                      @click="selectTocItem(item.id)"
                    >
                      <span class="rv-toc-item-marker" />
                      <span class="rv-toc-item-text">{{ item.text }}</span>
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <div ref="docScrollRef" class="rv-doc-scroll">
            <template v-if="viewingInput && comparingDiff">
              <article class="rv-paper" :style="paperStyle">
                <header class="rv-paper-head">
                  <h1 class="rv-paper-title">链路输入 vs 当前输出</h1>
                  <p class="rv-paper-meta">{{ selectedInput?.label || "输入素材" }} → {{ currentOutput?.title || "输出文档" }}</p>
                </header>
                <DiffViewer :before="inputCompareText" :after="currentMarkdown" />
              </article>
            </template>
            <template v-else-if="viewingInput">
              <article class="rv-paper" :style="paperStyle">
                <header class="rv-paper-head">
                  <p v-if="selectedStageTitle" class="rv-paper-kicker">{{ selectedStageTitle }}</p>
                  <h1 class="rv-paper-title">{{ selectedInput?.label || "输入素材" }}</h1>
                  <p class="rv-paper-meta">
                    <template v-if="selectedInput?.nodeType === 'source.bili'">
                      <template v-if="selectedInput.items && selectedInput.items.length > 1">{{ selectedInput.label || "B站多选" }}（{{ selectedInput.items.length }} 项）</template>
                      <template v-else>{{ selectedInput.title || selectedInput.url || "B站视频" }}</template> · {{ fmtDuration(selectedInput.duration) }}
                    </template>
                    <template v-else-if="selectedInput?.nodeType === 'source.file'">
                      {{ selectedInput.fileName || "本地音视频" }} · {{ fmtSize(selectedInput.size) }}
                    </template>
                    <template v-else>
                      {{ selectedInput?.label || "文本输入" }}
                    </template>
                    <template v-if="selectedInput?.modules && selectedInput.modules.length > 1">
                      · {{ selectedInput.modules.length }} 个独立输入
                    </template>
                    <template v-else-if="inputText"> · {{ inputWordCount }} 字 · 约 {{ inputReadingTime }} 分钟阅读</template>
                  </p>
                </header>

                <div v-if="selectedInput?.modules && selectedInput.modules.length > 1" class="rv-input-modules">
                  <section v-for="module in selectedInput.modules" :key="module.key" class="rv-input-module">
                    <h2 class="rv-input-module-title">{{ module.label }}</h2>
                    <div class="rv-preview markdown-body" v-html="renderMarkdown(module.text)" />
                  </section>
                </div>
                <div v-else-if="inputText" class="rv-preview markdown-body" v-html="renderedInputMarkdown" />
                <div v-else class="rv-input-empty">
                  <p>这是一个音视频输入，当前没有单独转写文稿。</p>
                  <p>如果这是旧运行记录，重新运行一次即可在输入列表中查看每个音频的独立转写内容。</p>
                </div>
              </article>
            </template>
            <template v-else>
              <article class="rv-paper" :style="paperStyle">
                <header class="rv-paper-head">
                  <h1 class="rv-paper-title">{{ currentOutput?.title || "输出文档" }}</h1>
                  <p class="rv-paper-meta">
                    {{ sourceSummary }} · {{ wordCount }} 字 · 约 {{ readingTime }} 分钟阅读
                  </p>
                </header>

                <div v-if="editing" class="rv-edit-grid">
                  <textarea v-model="draft" class="rv-editor" spellcheck="false" aria-label="Markdown 编辑器" />
                  <div class="rv-preview markdown-body" v-html="renderedDraft" />
                </div>
                <div v-else class="rv-preview markdown-body" v-html="renderedMarkdown" />

                <div v-if="editing" class="rv-edit-actions">
                  <button type="button" class="rv-btn rv-btn--text" :disabled="draft === markdown" @click="resetDraft">恢复原始</button>
                  <button type="button" class="rv-btn rv-btn--text" @click="toggleEdit">退出编辑</button>
                  <button type="button" class="rv-btn rv-btn--text" :disabled="!draft" @click="copyMarkdown">复制编辑结果</button>
                </div>
              </article>

              <div v-if="!currentMarkdown" class="rv-empty">
                <div class="rv-empty-title">本次运行没有可展示的文本产物</div>
                <div class="rv-empty-sub">可以到「节点流水」查看各节点状态，或「查看日志」定位问题。</div>
              </div>
            </template>
          </div>
        </section>
      </div>
    </template>

    <RunLogDialog
      v-model:open="logDialogOpen"
      :run-id="runId"
      :nodes="run?.nodeResults ?? []"
      :initial-node-id="logDialogNodeId"
    />
  </div>
</template>

<style scoped>
.rv-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg);
}

.rv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.rv-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.rv-title-block {
  min-width: 0;
}

.rv-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-sub {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rv-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.rv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    opacity var(--dur-1) var(--ease-out);
}

.rv-btn:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rv-btn--text {
  padding: 0 6px;
  color: var(--color-text);
}

.rv-btn--text:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-btn--danger-text {
  padding: 0 6px;
  color: var(--color-error);
}

.rv-btn--danger-text:hover:not(:disabled) {
  background: var(--color-error-soft);
  color: var(--color-error);
}

.rv-btn--table {
  height: 24px;
  padding: 0 7px;
  color: var(--color-text-secondary);
}

.rv-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
}

.rv-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.rv-status.is-running {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-status.is-running .rv-status-dot {
  background: currentColor;
  animation: wp-pulse 1.5s var(--ease-out) infinite;
}

.rv-status.is-success,
.rv-status.is-done {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.rv-status.is-error {
  background: var(--color-error-soft);
  color: var(--color-error);
}

.rv-status.is-cancelled,
.rv-status.is-skipped,
.rv-status.is-idle {
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
}

.rv-tabs {
  display: flex;
  gap: 2px;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.rv-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.rv-tabs button.active {
  color: var(--color-text);
  border-bottom-color: var(--color-text);
}

.rv-loading {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.rv-nodes {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.rv-mindmap {
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  background: var(--color-canvas);
}

.rv-mindmap-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.rv-mindmap-tabs button {
  padding: 5px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.rv-mindmap-tabs button.active {
  border-color: var(--color-border-strong);
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-mindmap-main {
  height: calc(100vh - 140px);
  min-height: 400px;
  overflow: hidden;
}

.rv-nodes-table {
  width: 100%;
  --el-table-border-color: var(--color-border);
  --el-table-header-bg-color: var(--color-surface-muted);
  --el-table-row-hover-bg-color: var(--color-ink-soft);
}

.rv-nodes-table :deep(th.el-table__cell) {
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
}

.rv-nodes-table :deep(td.el-table__cell) {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.rv-nodes-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.rv-node-error {
  color: var(--color-error);
}

.rv-node-retry {
  color: var(--color-text-secondary);
}

.rv-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.rv-side {
  --rv-side-w: 300px;
  width: var(--rv-side-w);
  min-width: var(--rv-side-w);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow: hidden;
  flex-shrink: 0;
  transition: width var(--dur-2) var(--ease-out), min-width var(--dur-2) var(--ease-out);
}

.rv-side.collapsed {
  width: 0;
  min-width: 0;
  overflow: hidden;
  border-right: none;
}

.rv-side.collapsed .rv-side-head {
  display: none;
}

.rv-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 10px;
  flex-shrink: 0;
}

.rv-side-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rv-side.collapsed .rv-side-title {
  display: none;
}

.rv-side.collapsed .rv-side-head {
  justify-content: center;
  padding: 0;
}

.rv-side-content {
  width: var(--rv-side-w);
  max-width: var(--rv-side-w);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.rv-chain-stage + .rv-chain-stage {
  margin-top: 14px;
}

.rv-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin: 0 2px 6px;
}

.rv-stage-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
}

.rv-stage-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-ink-soft);
  color: var(--color-text-tertiary);
  font-size: 10px;
  line-height: 1.6;
}

.rv-chain-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rv-chain-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}

.rv-chain-row:hover,
.rv-chain-row.active {
  background: var(--color-ink-soft);
}

.rv-chain-row-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  flex-shrink: 0;
}

.rv-chain-row-dot.is-running {
  background: var(--color-text);
  animation: wp-pulse 1.5s var(--ease-out) infinite;
}

.rv-chain-row-dot.is-success,
.rv-chain-row-dot.is-done {
  background: var(--color-success);
}

.rv-chain-row-dot.is-error {
  background: var(--color-error);
}

.rv-chain-row-dot.is-cancelled,
.rv-chain-row-dot.is-skipped,
.rv-chain-row-dot.is-idle {
  background: var(--color-text-tertiary);
}

.rv-chain-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rv-chain-row-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
}

.rv-chain-row-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--color-text-tertiary);
}

.rv-chain-row-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-error);
  font-size: 10.5px;
  line-height: 1.4;
}

.rv-chain-row-type {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.rv-side-section-title {
  margin: 14px 2px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-output-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rv-output-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}

.rv-output-item:hover,
.rv-output-item.active {
  background: var(--color-ink-soft);
}

.rv-output-name,
.rv-output-meta {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rv-output-name {
  font-size: 12px;
  font-weight: 500;
}

.rv-output-meta {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.rv-side-empty {
  padding: 18px 8px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

.rv-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas);
}

.rv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.rv-tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rv-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.rv-tool-btn:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rv-tool-btn.active {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-zoom {
  min-width: 46px;
  text-align: center;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.rv-tool-divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--color-border);
}

.rv-tool-text {
  margin-left: 4px;
  font-size: 11px;
  color: var(--color-text);
}

.rv-toc {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}

.rv-toc-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.rv-toc-trigger:hover,
.rv-toc-trigger.is-open {
  border-color: var(--color-border-strong);
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-toc-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rv-toc-trigger-arrow {
  flex-shrink: 0;
  transition: transform var(--dur-2) var(--ease-out);
}

.rv-toc-trigger.is-open .rv-toc-trigger-arrow {
  transform: rotate(180deg);
}

.rv-toc-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--z-dropdown);
  display: flex;
  flex-direction: column;
  width: 300px;
  max-width: min(360px, calc(100vw - 24px));
  max-height: min(480px, 65vh);
  overflow: hidden;
  border: 1px solid var(--color-border-glass);
  border-radius: var(--radius-md);
  background: var(--color-surface-glass);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.rv-toc-panel-title {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.rv-toc-panel-list {
  overflow-y: auto;
  padding: 4px;
}

.rv-toc-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.rv-toc-item:hover {
  background: var(--color-ink-soft-glass);
  color: var(--color-text);
}

.rv-toc-item.is-active {
  background: var(--color-ink-soft-glass);
  color: var(--color-text);
}

.rv-toc-item-marker {
  width: 5px;
  height: 5px;
  margin-top: 6px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}

.rv-toc-item.is-active .rv-toc-item-marker {
  background: var(--color-text);
}

.rv-toc-item-text {
  min-width: 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.toc-pop-enter-active,
.toc-pop-leave-active {
  transition:
    opacity var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out);
  transform-origin: top right;
}

.toc-pop-enter-from,
.toc-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.rv-doc-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-surface);
}

.rv-paper {
  width: 100%;
  max-width: 780px;
  min-height: 100%;
  margin: 0 auto;
  padding: 40px 32px 96px;
  background: transparent;
  font-size: calc(16px * var(--doc-scale, 1));
}

.rv-paper-head {
  margin-bottom: 32px;
}

.rv-paper-kicker {
  margin: 0 0 4px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.rv-paper-title {
  margin: 0;
  font-size: 1.8em;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.35;
  color: var(--color-text);
}

.rv-paper-meta {
  margin: 8px 0 0;
  font-size: 0.8em;
  color: var(--color-text-tertiary);
}

.rv-preview {
  font-size: 1em;
  line-height: 1.85;
  color: var(--color-text);
  word-break: break-word;
}

.rv-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.rv-editor {
  width: 100%;
  min-height: 480px;
  padding: 14px;
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  background: var(--control-bg);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.85em;
  line-height: 1.7;
  resize: vertical;
  outline: none;
  transition: border-color 0.12s ease;
}

.rv-editor:focus {
  border-color: var(--control-border-focus);
}

.rv-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.rv-empty {
  max-width: 900px;
  margin: 24px auto 0;
  padding: 40px 24px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  text-align: center;
}

.rv-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.rv-input-empty {
  padding: 24px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  font-size: 13px;
  text-align: center;
}

.rv-input-empty p {
  margin: 4px 0;
}

.rv-input-module {
  margin: 0 0 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border);
}

.rv-input-module:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.rv-input-module-title {
  margin: 0 0 12px;
  font-size: 1.05em;
  font-weight: 600;
  color: var(--color-text);
}

@media (max-width: 1280px) {
  .rv-side {
    --rv-side-w: 260px;
  }
}

@media (max-width: 1024px) {
  .rv-side {
    --rv-side-w: 220px;
  }

  .rv-edit-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .rv-root {
    overflow-y: auto;
  }

  .rv-header {
    height: auto;
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 12px;
  }

  .rv-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .rv-body {
    flex-direction: column;
  }

  .rv-side {
    --rv-side-w: 100%;
    width: 100%;
    min-width: 0;
    max-height: 240px;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }

  .rv-side-content {
    width: 100%;
    max-width: 100%;
  }

  .rv-side.collapsed {
    display: none;
  }

  .rv-paper {
    padding: 24px 18px;
  }

  .rv-toolbar {
    flex-wrap: wrap;
    height: auto;
    padding: 8px 10px;
  }
}
</style>

