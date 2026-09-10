<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElOption, ElSelect, ElTable, ElTableColumn } from "element-plus";
import { toast } from "@/lib/toast";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileText,
  ListTree,
  Maximize,
  Minimize,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  ScrollText,
  StopCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import type { ProjectMeta, RunDetail, RunNodeInput, RunNodeResult, RunMediaView, TraceReport, WorkflowGraph } from "@scribe-flow/shared";
import { NODE_TYPE_LABELS, parseTraceReports, traceReportToMarkdown } from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { buildNodeSegments, type RunSegment } from "@/utils/run-segments";
import { subscribeRunEvents } from "@/lib/sse";
import { useProjectsStore } from "@/stores/projects";
import MindMapViewer from "@/components/MindMapViewer.vue";
import DiffViewer from "@/components/DiffViewer.vue";
import RunLogDialog from "@/components/RunLogDialog.vue";
import TraceReportViewer from "@/components/TraceReportViewer.vue";
import MediaPlayer from "@/components/media/MediaPlayer.vue";

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

// ---------- 顶部「结果 / 思维导图 / 节点流水」切换：滑动墨条 + 内容淡入 ----------
type DetailTab = "result" | "nodes" | "mindmap";
const tabsEl = ref<HTMLElement | null>(null);
const tabRefs = ref<Partial<Record<DetailTab, HTMLButtonElement | null>>>({});
/** 墨条位置（相对 tablist 容器），首次测量前隐藏，避免进场时从 0 滑一次。 */
const tabIndicator = ref({ x: 0, width: 0 });
const tabIndicatorReady = ref(false);
/** 切 tab 后给新面板挂一次淡入（用 v-show 保留滚动位置与表格状态，不卸载 DOM）。 */
const paneEntering = ref(false);
let paneEnterTimer: ReturnType<typeof setTimeout> | null = null;
let tabResizeObserver: ResizeObserver | null = null;

const failedNodeCount = computed(() => (run.value?.nodeResults ?? []).filter((node) => node.status === "error").length);

/** tablist 的可见顺序（思维导图只在有导图时才出现）。 */
const tabOrder = computed<DetailTab[]>(() => {
  const order: DetailTab[] = ["result"];
  if (mindMapNodes.value.length > 0) order.push("mindmap");
  order.push("nodes");
  return order;
});

function setTabRef(tab: DetailTab, el: unknown) {
  tabRefs.value[tab] = (el as HTMLButtonElement | null) ?? null;
}

function updateTabIndicator() {
  const container = tabsEl.value;
  const button = tabRefs.value[activeTab.value];
  if (!container || !button) {
    tabIndicatorReady.value = false;
    return;
  }
  const containerBox = container.getBoundingClientRect();
  const buttonBox = button.getBoundingClientRect();
  // 墨条比按钮窄一点，视觉上贴着文字而不是撑满按钮
  const inset = 12;
  tabIndicator.value = {
    x: buttonBox.left - containerBox.left + inset,
    width: Math.max(0, buttonBox.width - inset * 2),
  };
  tabIndicatorReady.value = true;
}

/** 统一切换入口：内容淡入 + 墨条平滑滑动；重复点当前 tab 不做任何动画。 */
function setActiveTab(tab: DetailTab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  paneEntering.value = false;
  void nextTick(() => {
    paneEntering.value = true;
    if (paneEnterTimer) clearTimeout(paneEnterTimer);
    paneEnterTimer = setTimeout(() => {
      paneEntering.value = false;
      paneEnterTimer = null;
    }, 220);
    updateTabIndicator();
  });
}

/** ←/→/Home/End 在 tab 之间移动（roving tabindex：只有当前 tab 可被 Tab 键聚焦）。 */
function onTabKeydown(event: KeyboardEvent, current: DetailTab) {
  const order = tabOrder.value;
  const index = order.indexOf(current);
  if (index < 0) return;
  let next = -1;
  if (event.key === "ArrowRight") next = (index + 1) % order.length;
  else if (event.key === "ArrowLeft") next = (index - 1 + order.length) % order.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = order.length - 1;
  if (next < 0) return;
  event.preventDefault();
  const target = order[next];
  setActiveTab(target);
  void nextTick(() => tabRefs.value[target]?.focus());
}

/**
 * 结果页在同一路由名下会被复用实例（App.vue 按路由名 key），
 * 所以在左侧运行库切换运行 / 工程时，必须让这两个 id 保持响应式并主动重载。
 */
const runId = computed(() => String(route.params.runId ?? ""));
const projectId = computed(() => String(route.params.id ?? ""));

/** 顶部副标题里的工程名跟随工程列表响应式更新，左侧栏重命名后立即同步。 */
const projectName = computed(() => {
  const item = projectsStore.list.find((p) => p.id === projectId.value);
  if (item) return item.name;
  if (projectsStore.current?.id === projectId.value) return projectsStore.current.name;
  return run.value?.projectName ?? "";
});

let stopRunEvents: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let tocCloseTimer: ReturnType<typeof setTimeout> | null = null;
/** 竞态令牌：切换运行后，先前发出的详情/输出请求返回时直接丢弃。 */
let loadRunToken = 0;

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
  /** 该中间步骤下多个来源的独立内容；存在时主区域按分段切换阅读。 */
  segments?: RunSegment[];
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

/** 画布中配置了信息溯源块的 AI 节点；它们的结构化报告需要作为独立输出展示。 */
const traceNodeIds = computed(() => {
  const ids = new Set<string>();
  for (const node of graph.value?.nodes ?? []) {
    const data = asRecord(node.data);
    const blockId = String(data.promptBlockId ?? "");
    if (node.type === "process.prompt" && (blockId === "builtin.trace" || blockId === "builtin.trace.v2")) ids.add(node.id);
  }
  return ids;
});

const outputNodes = computed<OutputDoc[]>(() => {
  const all = run.value?.nodeResults ?? [];
  const docs = all.filter((n) => n.output?.kind === "noteDoc");
  const traceDocs = all.filter(
    (n) =>
      (traceNodeIds.value.has(n.nodeId) || looksLikeTraceReport(n.output?.text ?? "")) &&
      (n.output?.kind === "noteBlock" || n.output?.kind === "text"),
  );
  const fallback = docs.length > 0 ? [] : all.filter((n) => (n.output?.kind === "text" || n.output?.kind === "noteBlock") && !traceNodeIds.value.has(n.nodeId)).slice(-3);
  const list = [...traceDocs, ...docs, ...fallback];
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

// 思维导图 tab 的出现/消失由运行数据决定，会改变按钮宽度 → 重新量一次墨条。
watch([activeTab, () => mindMapNodes.value.length], () => {
  void nextTick(updateTabIndicator);
});

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

    // 一个节点处理多个输入时，每个输入一份独立结果：这里还原成分段，供主区域切换阅读。
    const segments = buildNodeSegments(node.id, rows, nodeResultMap.value, graph.value);

    const textRow = outgoing.find((r) => r.kind === "text" && r.text);
    const audioRow = outgoing.find((r) => r.kind === "audio");
    const fallbackText = nodeResult?.output && nodeResult.output.kind !== "audio" ? nodeResult.output.text : undefined;
    const text = textRow?.text ?? fallbackText ?? (nodeType === "source.text" ? String(data.text ?? "") : undefined);
    const defaultKind: InputItem["kind"] = nodeType === "source.text" ? "text" : "audio";
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
      segments: segments.length > 1 ? segments : undefined,
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

function sourceInfoLabel(source: SourceInfo): string {
  if (source.nodeType === "source.bili") {
    const parts: string[] = [];
    if (source.title) parts.push(`《${source.title}》`);
    else if (source.items && source.items.length > 1) parts.push(`B站 ${source.items.length} 个视频`);
    else parts.push("B站视频");
    if (source.uploader) parts.push(source.uploader);
    if (source.url) parts.push(source.url);
    return parts.join(" · ");
  }
  if (source.nodeType === "source.file") {
    return source.fileName ? `本地文件《${source.fileName}》` : "本地文件";
  }
  if (source.nodeType === "source.text") {
    return source.label || "文本输入";
  }
  return source.label || source.nodeType;
}

function originLabelForInput(item: InputItem): string {
  const originIds = upstreamSourceIds(item.sourceNodeId);
  const origins = sources.value.filter((source) => originIds.has(source.nodeId));
  if (origins.length > 0) {
    const base = origins.map(sourceInfoLabel).join("；");
    return item.nodeType.startsWith("process.") ? `${base} · ${item.typeLabel}产物` : base;
  }
  return item.label || item.typeLabel || item.sourceNodeId;
}

/** 溯源报告原文定位用：把当前输出链路上的文本输入都提供给阅读器，用于高亮引用。 */
const traceSources = computed(() => {
  const result: { key: string; label: string; text: string }[] = [];
  // 越靠近当前溯源节点的输入越接近模型真正看到的原文，优先用于定位高亮。
  const ordered = [...inputItems.value].sort((a, b) => b.depth - a.depth);
  for (const item of ordered) {
    const label = originLabelForInput(item);
    if (item.segments && item.segments.length > 1) {
      for (const segment of item.segments) {
        if (segment.text.trim()) {
          result.push({
            key: `${item.key}:${segment.inputId}`,
            label: `${label} · ${segment.index + 1}. ${segment.label}`,
            text: segment.text,
          });
        }
      }
    } else if (item.text?.trim()) {
      result.push({ key: item.key, label, text: item.text });
    }
  }
  return result;
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

// ---------- 可播放视频附件（keepVideo 产物） ----------
const runMediaList = computed(() => run.value?.media ?? []);
/** 当前选中的链路输入（来源节点）对应的可播放视频；多选/分P 时按 sourceIndex 逐项对应。 */
const inputMedia = computed(() => {
  const item = selectedInput.value;
  if (!item) return [];
  return runMediaList.value.filter((m) => m.nodeId === item.sourceNodeId);
});
const activeMediaIndex = ref(0);
watch(
  () => selectedInput.value?.key,
  () => {
    activeMediaIndex.value = 0;
  },
);
const activeMedia = computed(() => inputMedia.value[Math.min(activeMediaIndex.value, inputMedia.value.length - 1)] ?? null);
const restoreState = ref<{ id: string; progress: number; message?: string } | null>(null);

/** 无文本输出（如纯「下载并查看」流程）时，直接在主区给出素材视频兜底入口。 */
const fallbackMediaList = computed(() => (outputNodes.value.length === 0 ? runMediaList.value : []));
const fallbackMediaIndex = ref(0);
watch(fallbackMediaList, (list) => {
  if (fallbackMediaIndex.value >= list.length) fallbackMediaIndex.value = 0;
});
const fallbackMedia = computed(
  () => fallbackMediaList.value[Math.min(fallbackMediaIndex.value, fallbackMediaList.value.length - 1)] ?? null,
);

function mediaStreamUrl(media: RunMediaView): string {
  return media.asset ? `/api/media/${media.asset.id}/stream` : "";
}

/** B站资产缺失时一键重新下载（文件不进备份，恢复后即可播放）。 */
async function restoreMedia(media: RunMediaView) {
  const asset = media.asset;
  if (!asset || media.kind !== "bili") return;
  if (restoreState.value) return;
  try {
    const created = await api.post<{ jobId: string }>(`/api/media/${asset.id}/restore`);
    restoreState.value = { id: asset.id, progress: 0, message: "准备下载…" };
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const job = await api.get<{ status: string; progress: number; message?: string; error?: string }>(
        `/api/media/restore-jobs/${created.jobId}`,
      );
      restoreState.value = { id: asset.id, progress: job.progress, message: job.message ?? undefined };
      if (job.status !== "running") {
        restoreState.value = null;
        if (job.status === "done") {
          toast.success("视频已重新下载");
          await loadRun(false);
        } else {
          toast.error(job.error ?? "重新下载失败");
        }
        return;
      }
    }
    restoreState.value = null;
    toast.error("重新下载超时，请稍后重试");
  } catch (err) {
    restoreState.value = null;
    toast.error(err instanceof Error ? err.message : "重新下载失败");
  }
}
const selectedStageTitle = computed(() => {
  const item = selectedInput.value;
  if (!item) return "";
  return chainStages.value.find((stage) => stage.items.some((candidate) => candidate.key === item.key))?.title ?? "";
});
const viewingInput = computed(() => selectedInput.value !== null);
const currentMarkdown = computed(() => (editing.value ? draft.value : markdown.value));
/** 用于与当前输出对比的“链路输入”完整文本；多输入会按原顺序合并后参与对比。 */
const inputCompareText = computed(() => {
  const item = selectedInput.value;
  if (!item) return "";
  if (item.segments && item.segments.length > 1) return item.segments.map((segment) => segment.text).join("\n\n---\n\n");
  return item.text ?? "";
});

// ---------- 多输入分段阅读：一个节点处理 8 个视频时，按视频切开而不是首尾相接 ----------
/** -1 = 合并全文；>=0 = 选中第 N 段。 */
const segmentIndex = ref(-1);
/** 右侧「分段大纲」栏的收起状态与筛选词（段数多时用）。 */
const railCollapsed = ref(false);
const segmentFilter = ref("");
const railListRef = ref<HTMLElement | null>(null);

/** 当前输出文档的可分段内容（如「输出」节点由 8 个视频的笔记汇成）。 */
const docSegments = computed<RunSegment[]>(() =>
  currentOutput.value ? buildNodeSegments(currentOutput.value.node.nodeId, run.value?.inputs ?? [], nodeResultMap.value, graph.value) : [],
);
/** 当前选中的链路中间节点产出的可分段内容。 */
const activeSegments = computed<RunSegment[]>(() => (viewingInput.value ? selectedInput.value?.segments ?? [] : docSegments.value));
const selectedSegment = computed<RunSegment | null>(
  () => activeSegments.value.find((segment) => segment.index === segmentIndex.value) ?? null,
);
/** 大纲筛选（仅按标题过滤，段数 > 12 才出现输入框）。 */
const visibleSegments = computed(() => {
  const keyword = segmentFilter.value.trim().toLowerCase();
  if (!keyword) return activeSegments.value;
  return activeSegments.value.filter((segment) => `${segment.label} ${segment.meta}`.toLowerCase().includes(keyword));
});
/** 「全文」那一行的字数：分段视图取当前视图的合并正文。 */
const fullBodyChars = computed(() => (viewingInput.value ? inputCompareText.value : currentMarkdown.value).replace(/\s/g, "").length);
const segmentPositionLabel = computed(() => (segmentIndex.value < 0 ? "全文" : `${segmentIndex.value + 1} / ${activeSegments.value.length}`));
/** 分段视图下的正文：选中某段时只渲染该段，「全文」时仍是合并全文。 */
const inputBodyText = computed(() => selectedSegment.value?.text ?? inputCompareText.value);
const outputBodyText = computed(() => (selectedSegment.value ? selectedSegment.value.text : currentMarkdown.value));
const renderedOutputBody = computed(() => renderMarkdown(outputBodyText.value));
const renderedInputBody = computed(() => renderMarkdown(inputBodyText.value));
/** 分段所属的视图标识：切换节点 / 运行 / 视图时回到第 1 段，运行中被 SSE 刷新时不打断当前选择。 */
const segmentScope = computed(() => {
  if (activeSegments.value.length <= 1) return "";
  const target = viewingInput.value ? selectedInputKey.value : currentOutput.value?.node.nodeId ?? "";
  return target ? `${runId.value}::${viewingInput.value ? "in" : "out"}::${target}` : "";
});

/** 分段选择：默认第 1 段；（画布浮层带来的）?focus=&seg= 只作用于它指向的那个节点。 */
function syncSegmentSelection() {
  const segments = activeSegments.value;
  if (segments.length === 0) {
    segmentIndex.value = -1;
    return;
  }
  const focus = String(route.query.focus ?? "");
  const target = viewingInput.value ? selectedInputKey.value : currentOutput.value?.node.nodeId ?? "";
  if (focus && focus !== target) {
    segmentIndex.value = 0;
    return;
  }
  const raw = Number(route.query.seg);
  if (Number.isInteger(raw) && raw >= 0 && raw < segments.length) {
    segmentIndex.value = raw;
    return;
  }
  segmentIndex.value = 0;
}

watch(segmentScope, (scope) => {
  segmentFilter.value = "";
  if (editing.value) return;
  if (!scope) {
    segmentIndex.value = -1;
    return;
  }
  syncSegmentSelection();
});

function selectSegment(index: number) {
  segmentIndex.value = index;
  // 切段等同于换一份正文，回到顶部，避免停在上一段的滚动位置。
  docScrollRef.value?.scrollTo({ top: 0 });
  tocValue.value = "";
}

function fmtSegmentChars(size: number): string {
  if (!size) return "";
  return size >= 10000 ? `${(size / 10000).toFixed(1)} 万字` : `${size} 字`;
}

/** 顺序切段：全文 ↔ 1..N，越界不动（顺序阅读用，不把「全文」卷进循环）。 */
function stepSegment(delta: number) {
  const count = activeSegments.value.length;
  if (count === 0) return;
  const current = segmentIndex.value;
  const next = current < 0 ? (delta > 0 ? 0 : -1) : Math.min(count - 1, Math.max(0, current + delta));
  if (next !== current) selectSegment(next);
}

/** 大纲内的键盘导航：↑↓ / j k / Home End，焦点跟着选中项走。 */
function onRailKeydown(event: KeyboardEvent, index: number) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End", "j", "k"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const ordered = [-1, ...activeSegments.value.map((segment) => segment.index)];
  const position = ordered.indexOf(index);
  let target = index;
  if (event.key === "ArrowDown" || event.key === "j") target = ordered[Math.min(ordered.length - 1, position + 1)] ?? index;
  else if (event.key === "ArrowUp" || event.key === "k") target = ordered[Math.max(0, position - 1)] ?? index;
  else if (event.key === "Home") target = ordered[0] ?? index;
  else if (event.key === "End") target = ordered[ordered.length - 1] ?? index;
  if (target === index) return;
  selectSegment(target);
  void nextTick(() => {
    railListRef.value?.querySelector<HTMLElement>(`[data-seg-index="${target}"]`)?.focus();
  });
}

// 换段后把当前项滚进可视区（深链直达第 7 段时不至于还停在列表顶部）。
watch([segmentIndex, segmentScope, visibleSegments], () => {
  void nextTick(ensureActiveRailRowVisible);
});

/** 只用大纲容器自身的滚动，避免整页被带着跳（因此不用 scrollIntoView）。 */
function ensureActiveRailRowVisible() {
  const container = railListRef.value;
  const row = container?.querySelector<HTMLElement>(".rv-rail-row.on");
  if (!container || !row) return;
  const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const bottom = delta + row.offsetHeight;
  if (delta < 0) container.scrollTop += delta - 6;
  else if (bottom > container.clientHeight) container.scrollTop += bottom - container.clientHeight + 6;
}

function looksLikeTraceReport(text: string): boolean {
  return /"schema"\s*:\s*1/.test(text) && /"items"\s*:/.test(text);
}

const isTraceOutput = computed(() =>
  Boolean(
    currentOutput.value &&
      (traceNodeIds.value.has(currentOutput.value.node.nodeId) || looksLikeTraceReport(markdown.value)),
  ),
);
const traceReports = computed<TraceReport[]>(() => (isTraceOutput.value ? parseTraceReports(markdown.value) : []));
/** 溯源产物同样按分段收敛：选中某一段时只展示该段的报告，而不是 8 个视频的报告叠在一起。 */
const activeTraceReports = computed<TraceReport[]>(() =>
  selectedSegment.value ? parseTraceReports(selectedSegment.value.text) : traceReports.value,
);
const traceMarkdownExport = computed(() => activeTraceReports.value.map((report) => traceReportToMarkdown(report)).join("\n\n---\n\n"));
const activeMarkdown = computed(() => {
  if (activeTab.value === "mindmap") return mindMapMarkdown.value;
  if (activeTraceReports.value.length > 0) return traceMarkdownExport.value;
  if (selectedSegment.value) return selectedSegment.value.text;
  if (viewingInput.value) return inputCompareText.value;
  return currentMarkdown.value;
});
const renderedDraft = computed(() => renderMarkdown(draft.value));
const paperStyle = computed(() => ({ "--doc-scale": String(zoom.value / 100) }));
const canCompareInputToOutput = computed(
  () => viewingInput.value && Boolean(inputCompareText.value.trim()) && Boolean(markdown.value.trim()),
);
const inputWordCount = computed(() => inputBodyText.value.replace(/\s/g, "").length);
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
  window.addEventListener("resize", updateTabIndicator);
  // 字体加载/缩放/侧栏折叠都会改变按钮宽度，用 ResizeObserver 跟着量
  if (typeof ResizeObserver !== "undefined" && tabsEl.value) {
    tabResizeObserver = new ResizeObserver(() => updateTabIndicator());
    tabResizeObserver.observe(tabsEl.value);
  }
  void nextTick(updateTabIndicator);
});

onBeforeUnmount(() => {
  stopRunEvents?.();
  if (reloadTimer) clearTimeout(reloadTimer);
  if (tocCloseTimer) clearTimeout(tocCloseTimer);
  if (paneEnterTimer) clearTimeout(paneEnterTimer);
  tabResizeObserver?.disconnect();
  tabResizeObserver = null;
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  window.removeEventListener("pointerdown", onTocOutsidePointerDown, true);
  window.removeEventListener("resize", updateTabIndicator);
});

async function loadRun(showLoading = true) {
  const token = ++loadRunToken;
  if (showLoading) loading.value = true;
  try {
    const data = await api.get<RunDetail>(`/api/runs/${runId.value}`);
    if (token !== loadRunToken) return;
    if (!data.graph) {
      try {
        const project = await api.get<ProjectMeta>(`/api/projects/${projectId.value}`);
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
    const focusNodeId = route.query.focus ? String(route.query.focus) : "";
    if (outputNodes.value.length > 0) {
      const focusIndex = focusNodeId ? outputNodes.value.findIndex((doc) => doc.node.nodeId === focusNodeId) : -1;
      const previousIndex = outputNodes.value.findIndex((doc) => doc.node.nodeId === previousOutputId);
      selectedOutputIndex.value = focusIndex >= 0 ? focusIndex : previousIndex >= 0 ? previousIndex : 0;
      await loadOutputContent(outputNodes.value[selectedOutputIndex.value].node.nodeId);
    } else {
      markdown.value = "";
      draft.value = "";
    }
    // 中间节点（转写 / 校对 / AI 加工）不是「输出文档」：画布上点它的「查看输出」时，
    // 直接按链路输入打开它自己的产物，而不是退回到最后一篇输出文档。
    if (focusNodeId && !outputNodes.value.some((doc) => doc.node.nodeId === focusNodeId)) {
      if (inputItems.value.some((item) => item.key === focusNodeId)) {
        await selectInput(focusNodeId);
      }
    }
    const queryTab = String(route.query.tab ?? "");
    if (queryTab === "mindmap" && mindMapNodes.value.length > 0) {
      setActiveTab("mindmap");
      const mindFocusIndex = focusNodeId ? mindMapNodes.value.findIndex((doc) => doc.node.nodeId === focusNodeId) : -1;
      selectedMindMapIndex.value = mindFocusIndex >= 0 ? mindFocusIndex : 0;
    } else if (activeTab.value === "mindmap" && mindMapNodes.value.length === 0) {
      setActiveTab("result");
    }
    if (activeTab.value === "mindmap" && mindMapNodes.value.length > 0) {
      const mindIndex = Math.min(selectedMindMapIndex.value, mindMapNodes.value.length - 1);
      await loadMindMapContent(mindIndex);
    }
    refreshSelectedInputText();

    if (stopRunEvents) stopRunEvents();
    if (data.status === "running") {
      stopRunEvents = subscribeRunEvents(runId.value, (event) => {
        if (event.type === "node.done" || event.type === "node.error" || event.type === "run.done") {
          scheduleReload();
        }
      });
    } else {
      stopRunEvents = null;
    }
  } catch (err) {
    if (token === loadRunToken) toast.error(err instanceof Error ? err.message : "运行详情加载失败");
  } finally {
    if (token === loadRunToken) loading.value = false;
  }
}

function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void loadRun(false);
  }, 400);
}

/** 切换运行前清空上一份运行的本地视图状态，避免旧结果、旧编辑草稿短暂串台。 */
function resetRunViewState() {
  loadRunToken += 1;
  stopRunEvents?.();
  stopRunEvents = null;
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  restoreState.value = null;
  run.value = null;
  markdown.value = "";
  draft.value = "";
  mindMapMarkdown.value = "";
  inputText.value = "";
  selectedOutputIndex.value = 0;
  selectedMindMapIndex.value = 0;
  selectedInputKey.value = "";
  segmentIndex.value = -1;
  activeMediaIndex.value = 0;
  fallbackMediaIndex.value = 0;
  editing.value = false;
  comparingDiff.value = false;
  tocValue.value = "";
  tocPanelOpen.value = false;
  logDialogOpen.value = false;
  logDialogNodeId.value = "";
}

/**
 * 结果页复用同一组件实例：在左侧运行库切换到别的运行（含重跑后跳转、跨工程打开上次结果）时，
 * 路由参数变了但组件不会重建，必须在这里自己重载。
 */
watch(
  () => `${projectId.value}::${runId.value}`,
  () => {
    resetRunViewState();
    void loadRun();
  },
);

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
      const result = await api.get<{ text: string }>(`/api/runs/${runId.value}/outputs/${nodeId}/content`);
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
      const result = await api.get<{ text: string }>(`/api/runs/${runId.value}/outputs/${node.nodeId}/content`);
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
  setActiveTab("mindmap");
  await loadMindMapContent(index);
}

async function selectMindMap(index: number) {
  await loadMindMapContent(index);
}

async function selectOutput(index: number) {
  const doc = outputNodes.value[index];
  if (!doc) return;
  // 重复点同一个输出时保持当前分段，只有真的换了目标才回到第 1 段。
  const switched = selectedOutputIndex.value !== index || selectedInputKey.value !== "";
  selectedInputKey.value = "";
  inputText.value = "";
  comparingDiff.value = false;
  selectedOutputIndex.value = index;
  editing.value = false;
  if (switched) segmentIndex.value = -1;
  await loadOutputContent(doc.node.nodeId);
}

async function selectInput(key: string) {
  const item = inputItems.value.find((i) => i.key === key);
  if (!item) return;
  const switched = selectedInputKey.value !== key;
  selectedInputKey.value = key;
  editing.value = false;
  comparingDiff.value = false;
  if (switched) segmentIndex.value = -1;
  inputText.value = item.text ?? "";
  // 旧数据没有 run_node_inputs 时，大文本可能只存在输出文件里，按需读取。
  if (!inputText.value) {
    const node = nodeResultMap.value.get(item.sourceNodeId);
    if (node?.output && node.output.kind !== "audio" && node.output.path) {
      try {
        const result = await api.get<{ text: string }>(`/api/runs/${runId.value}/outputs/${item.sourceNodeId}/content`);
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
    // 编辑只针对整篇输出：进入编辑时退出分段视图，避免「编辑一段却保存不上去」的误解。
    segmentIndex.value = -1;
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
  router.push({ path: `/project/${projectId.value}`, query: focus ? { focus } : {} });
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
  // 分段视图下文件名带上该段标题，导出的就是这一段而不是整篇。
  const segment = selectedSegment.value;
  const segmentSuffix = segment ? `-${String(segment.index + 1).padStart(2, "0")}-${slugify(segment.label).slice(0, 40)}` : "";
  a.download = viewingInput.value ? `run-${runId.value.slice(-6)}-input${segmentSuffix}.md` : `run-${runId.value.slice(-6)}${segmentSuffix}.md`;
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
    const created = await api.post<{ id: string }>(`/api/runs/${runId.value}/nodes/${node.nodeId}/retry`);
    toast.clear();
    toast.success(`已启动重跑：#${created.id.slice(-6)}`);
    void router.push({ path: `/project/${projectId.value}/run/${created.id}`, query: { focus: node.nodeId } });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "重跑失败");
  }
}

async function stopRun() {
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${runId.value}/stop`);
    toast.success("已发送停止指令");
    await loadRun(false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "停止运行失败");
  }
}

async function forceStopRun() {
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${runId.value}/force-stop`);
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

    <div ref="tabsEl" class="rv-tabs" role="tablist" aria-label="运行详情视图切换">
      <button
        :ref="(el) => setTabRef('result', el)"
        type="button"
        role="tab"
        id="rv-tab-result"
        aria-controls="rv-panel-result"
        :aria-selected="activeTab === 'result'"
        :tabindex="activeTab === 'result' ? 0 : -1"
        :class="{ active: activeTab === 'result' }"
        @click="setActiveTab('result')"
        @keydown="onTabKeydown($event, 'result')"
      >
        结果
      </button>
      <button
        v-if="mindMapNodes.length > 0"
        :ref="(el) => setTabRef('mindmap', el)"
        type="button"
        role="tab"
        id="rv-tab-mindmap"
        aria-controls="rv-panel-mindmap"
        :aria-selected="activeTab === 'mindmap'"
        :tabindex="activeTab === 'mindmap' ? 0 : -1"
        :class="{ active: activeTab === 'mindmap' }"
        @click="openMindMapTab()"
        @keydown="onTabKeydown($event, 'mindmap')"
      >
        <Network :size="14" /><span>思维导图</span>
      </button>
      <button
        :ref="(el) => setTabRef('nodes', el)"
        type="button"
        role="tab"
        id="rv-tab-nodes"
        aria-controls="rv-panel-nodes"
        :aria-selected="activeTab === 'nodes'"
        :aria-label="failedNodeCount > 0 ? `节点流水，${failedNodeCount} 个节点失败` : undefined"
        :tabindex="activeTab === 'nodes' ? 0 : -1"
        :class="{ active: activeTab === 'nodes' }"
        @click="setActiveTab('nodes')"
        @keydown="onTabKeydown($event, 'nodes')"
      >
        <span>节点流水</span>
        <span v-if="failedNodeCount > 0" class="rv-tab-dot" aria-hidden="true" />
      </button>
      <span
        class="rv-tabs-ink"
        :class="{ ready: tabIndicatorReady }"
        :style="{ transform: `translateX(${tabIndicator.x}px)`, width: `${tabIndicator.width}px` }"
        aria-hidden="true"
      />
    </div>

    <div v-if="loading && !run" class="rv-loading"><div class="rv-loading-text">加载中…</div></div>

    <template v-else-if="run">
      <div
        v-show="activeTab === 'nodes'"
        id="rv-panel-nodes"
        role="tabpanel"
        aria-labelledby="rv-tab-nodes"
        class="rv-nodes page-scroll"
        :class="{ 'is-entering': paneEntering }"
      >
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

      <div
        v-show="activeTab === 'mindmap'"
        id="rv-panel-mindmap"
        role="tabpanel"
        aria-labelledby="rv-tab-mindmap"
        class="rv-mindmap"
        :class="{ 'is-entering': paneEntering }"
      >
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

      <div
        v-show="activeTab === 'result'"
        id="rv-panel-result"
        role="tabpanel"
        aria-labelledby="rv-tab-result"
        class="rv-body"
        :class="{ 'is-entering': paneEntering }"
      >
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
                <span class="rv-output-name">
                  {{ doc.title }}
                  <span v-if="traceNodeIds.has(doc.node.nodeId)" class="rv-output-badge">溯源</span>
                </span>
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
              <button
                v-if="activeSegments.length > 1"
                type="button"
                class="rv-tool-btn rv-rail-toggle"
                :title="railCollapsed ? '展开分段大纲' : '收起分段大纲'"
                @click="railCollapsed = !railCollapsed"
              >
                <PanelRightOpen v-if="railCollapsed" :size="14" />
                <PanelRightClose v-else :size="14" />
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
                v-if="!viewingInput && traceReports.length === 0"
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
              v-if="toc.length > 0 && traceReports.length === 0"
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

          <!-- 窄屏（<1280px）降级：单行标题 + 下拉 + 翻页，不铺开 N 个按钮 -->
          <div v-if="activeSegments.length > 1 && !editing && !comparingDiff" class="rv-segbar">
            <button type="button" class="rv-segbar-arrow" aria-label="上一段" :disabled="segmentIndex <= -1" @click="stepSegment(-1)">‹</button>
            <el-select
              :model-value="segmentIndex"
              class="rv-segbar-select"
              size="small"
              aria-label="选择分段"
              @change="(value: number) => selectSegment(Number(value))"
            >
              <el-option :value="-1" :label="`全文（合并 ${activeSegments.length} 段）`" />
              <el-option
                v-for="segment in activeSegments"
                :key="segment.inputId"
                :value="segment.index"
                :label="`${segment.index + 1}. ${segment.label}${segment.size ? ` · ${fmtSegmentChars(segment.size)}` : ''}`"
              />
            </el-select>
            <button
              type="button"
              class="rv-segbar-arrow"
              aria-label="下一段"
              :disabled="segmentIndex >= activeSegments.length - 1"
              @click="stepSegment(1)"
            >
              ›
            </button>
          </div>

          <div class="rv-doc-area">
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
                    <template v-if="selectedInput?.segments && selectedInput.segments.length > 1">
                      · {{ selectedInput.segments.length }} 个独立输入
                      <template v-if="selectedSegment"> · 第 {{ selectedSegment.index + 1 }}/{{ selectedInput.segments.length }} 段</template>
                      · {{ inputWordCount }} 字
                    </template>
                    <template v-else-if="inputBodyText"> · {{ inputWordCount }} 字 · 约 {{ inputReadingTime }} 分钟阅读</template>
                  </p>
                </header>

                <div v-if="inputMedia.length > 0" class="rv-media">
                  <a
                    v-if="activeMedia?.asset?.present"
                    class="rv-btn rv-btn--text rv-media-download rv-media-tool"
                    :href="`/api/media/${activeMedia.asset.id}/download`"
                  >
                    <Download :size="13" /><span>下载视频</span>
                  </a>
                  <div v-if="inputMedia.length > 1" class="rv-media-tabs">
                    <button
                      v-for="(media, index) in inputMedia"
                      :key="media.id"
                      type="button"
                      :class="{ active: index === activeMediaIndex }"
                      @click="activeMediaIndex = index"
                    >
                      {{ media.label || `视频 ${index + 1}` }}
                    </button>
                  </div>
                  <template v-if="activeMedia">
                    <MediaPlayer
                      v-if="activeMedia.asset?.present"
                      :key="activeMedia.id"
                      :stream-url="mediaStreamUrl(activeMedia)"
                      :title="activeMedia.label"
                      :poster="activeMedia.asset?.meta?.cover"
                      :duration-sec="activeMedia.asset?.durationSec"
                      @failed="(message: string) => toast.error(message)"
                    />
                    <div v-else class="rv-media-missing">
                      <p class="rv-media-missing-title">{{ activeMedia.asset?.title || activeMedia.label || "视频" }}</p>
                      <template v-if="activeMedia.kind === 'bili'">
                        <p class="rv-media-missing-text">视频文件不在本地（备份不含大文件），登录 B 站后可一键重新下载。</p>
                        <div class="rv-media-missing-actions">
                          <button type="button" class="rv-btn rv-media-restore-btn" :disabled="restoreState !== null" @click="restoreMedia(activeMedia)">
                            <RefreshCw :size="13" /><span>{{ restoreState ? "正在下载…" : "重新下载" }}</span>
                          </button>
                          <a
                            v-if="activeMedia.asset?.sourceUrl"
                            class="rv-btn rv-btn--text"
                            :href="activeMedia.asset.sourceUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            在 B 站打开
                          </a>
                        </div>
                        <p v-if="restoreState" class="rv-media-missing-progress tnum">{{ restoreState.message || `下载中 ${restoreState.progress}%` }}</p>
                      </template>
                      <p v-else class="rv-media-missing-text">上传原件已被清理，无法自动恢复；请回到工作流重新上传并重跑该节点。</p>
                    </div>
                  </template>
                </div>

                <div v-if="inputBodyText" class="rv-preview markdown-body" v-html="renderedInputBody" />
                <div v-else-if="inputMedia.length === 0" class="rv-input-empty">
                  <p>这是一个音视频输入，当前没有单独转写文稿。</p>
                  <p>如果这是旧运行记录，重新运行一次即可在输入列表中查看每个音频的独立转写内容。</p>
                </div>
              </article>
            </template>
            <template v-else>
              <article v-if="currentMarkdown || fallbackMediaList.length === 0" class="rv-paper" :style="paperStyle">
                <header class="rv-paper-head">
                  <h1 class="rv-paper-title">{{ currentOutput?.title || "输出文档" }}</h1>
                  <p class="rv-paper-meta">
                    <template v-if="selectedSegment">第 {{ selectedSegment.index + 1 }}/{{ activeSegments.length }} 段 · </template>
                    {{ sourceSummary }} · {{ wordCount }} 字 · 约 {{ readingTime }} 分钟阅读
                  </p>
                </header>

                <template v-if="activeTraceReports.length > 0 && !editing">
                  <TraceReportViewer :reports="activeTraceReports" :sources="traceSources" />
                </template>
                <template v-else>
                  <div v-if="editing" class="rv-edit-grid">
                    <textarea v-model="draft" class="rv-editor" spellcheck="false" aria-label="Markdown 编辑器" />
                    <div class="rv-preview markdown-body" v-html="renderedDraft" />
                  </div>
                  <div v-else class="rv-preview markdown-body" v-html="renderedOutputBody" />

                  <div v-if="editing" class="rv-edit-actions">
                    <button type="button" class="rv-btn rv-btn--text" :disabled="draft === markdown" @click="resetDraft">恢复原始</button>
                    <button type="button" class="rv-btn rv-btn--text" @click="toggleEdit">退出编辑</button>
                    <button type="button" class="rv-btn rv-btn--text" :disabled="!draft" @click="copyMarkdown">复制编辑结果</button>
                  </div>
                </template>
              </article>

              <div v-if="!currentMarkdown && fallbackMediaList.length === 0" class="rv-empty">
                <div class="rv-empty-title">本次运行没有可展示的文本产物</div>
                <div class="rv-empty-sub">可以到「节点流水」查看各节点状态，或「查看日志」定位问题。</div>
                <p v-if="runMediaList.length === 0" class="rv-empty-hint">
                  默认不保存视频文件。需要保存/下载视频时：在来源节点「高级设置 → 保留可播放视频」开启后重新运行，视频会出现在这里，可直接播放并下载。
                </p>
              </div>

              <section v-if="fallbackMediaList.length > 0" class="rv-fallback-media">
                <div class="rv-fallback-media-head">
                  <h2 class="rv-fallback-media-title">素材视频</h2>
                  <a
                    v-if="fallbackMedia?.asset?.present"
                    class="rv-btn rv-btn--text rv-media-download"
                    :href="`/api/media/${fallbackMedia.asset.id}/download`"
                  >
                    <Download :size="13" /><span>下载视频</span>
                  </a>
                </div>
                <div v-if="fallbackMediaList.length > 1" class="rv-media-tabs">
                  <button
                    v-for="(media, index) in fallbackMediaList"
                    :key="media.id"
                    type="button"
                    :class="{ active: index === fallbackMediaIndex }"
                    @click="fallbackMediaIndex = index"
                  >
                    {{ media.label || `视频 ${index + 1}` }}
                  </button>
                </div>
                <template v-if="fallbackMedia">
                  <MediaPlayer
                    v-if="fallbackMedia.asset?.present"
                    :key="fallbackMedia.id"
                    :stream-url="mediaStreamUrl(fallbackMedia)"
                    :title="fallbackMedia.label"
                    :poster="fallbackMedia.asset?.meta?.cover"
                    :duration-sec="fallbackMedia.asset?.durationSec"
                    @failed="(message: string) => toast.error(message)"
                  />
                  <div v-else class="rv-media-missing">
                    <p class="rv-media-missing-title">{{ fallbackMedia.asset?.title || fallbackMedia.label || "视频" }}</p>
                    <template v-if="fallbackMedia.kind === 'bili'">
                      <p class="rv-media-missing-text">视频文件不在本地（备份不含大文件），登录 B 站后可一键重新下载。</p>
                      <div class="rv-media-missing-actions">
                        <button type="button" class="rv-btn rv-media-restore-btn" :disabled="restoreState !== null" @click="restoreMedia(fallbackMedia)">
                          <RefreshCw :size="13" /><span>{{ restoreState ? "正在下载…" : "重新下载" }}</span>
                        </button>
                        <a
                          v-if="fallbackMedia.asset?.sourceUrl"
                          class="rv-btn rv-btn--text"
                          :href="fallbackMedia.asset.sourceUrl"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          在 B 站打开
                        </a>
                      </div>
                      <p v-if="restoreState" class="rv-media-missing-progress tnum">{{ restoreState.message || `下载中 ${restoreState.progress}%` }}</p>
                    </template>
                    <p v-else class="rv-media-missing-text">上传原件已被清理，无法自动恢复；请回到工作流重新上传并重跑该节点。</p>
                  </div>
                </template>
              </section>
            </template>
          </div>

          <!-- 分段大纲（≥1280px）：顺序内容用列表而不是平级标签；当前段左侧墨色标记 -->
          <aside v-if="activeSegments.length > 1 && !railCollapsed && !editing && !comparingDiff" class="rv-rail">
            <div class="rv-rail-head">
              <span class="rv-rail-title">分段</span>
              <span class="rv-rail-count tnum">共 {{ activeSegments.length }} 段</span>
            </div>
            <div v-if="activeSegments.length > 12" class="rv-rail-search">
              <input v-model="segmentFilter" type="search" placeholder="筛选分段标题…" aria-label="筛选分段标题" />
            </div>
            <div ref="railListRef" class="rv-rail-list" role="listbox" aria-label="分段大纲">
              <button
                type="button"
                role="option"
                class="rv-rail-row"
                :class="{ on: segmentIndex < 0 }"
                :aria-selected="segmentIndex < 0"
                data-seg-index="-1"
                @click="selectSegment(-1)"
                @keydown="onRailKeydown($event, -1)"
              >
                <span class="rv-rail-idx tnum">—</span>
                <span class="rv-rail-body">
                  <span class="rv-rail-label">全文（{{ activeSegments.length }} 段合并）</span>
                  <span class="rv-rail-meta tnum">{{ fmtSegmentChars(fullBodyChars) }}</span>
                </span>
              </button>
              <button
                v-for="segment in visibleSegments"
                :key="segment.inputId"
                type="button"
                role="option"
                class="rv-rail-row"
                :class="{ on: segment.index === segmentIndex }"
                :aria-selected="segment.index === segmentIndex"
                :data-seg-index="segment.index"
                @click="selectSegment(segment.index)"
                @keydown="onRailKeydown($event, segment.index)"
              >
                <span class="rv-rail-idx tnum">{{ String(segment.index + 1).padStart(2, "0") }}</span>
                <span class="rv-rail-body">
                  <span class="rv-rail-label" :title="segment.label">{{ segment.label }}</span>
                  <span class="rv-rail-meta tnum">
                    <span v-if="segment.size">{{ fmtSegmentChars(segment.size) }}</span>
                    <span v-if="segment.meta">{{ segment.meta }}</span>
                  </span>
                </span>
              </button>
              <p v-if="visibleSegments.length === 0" class="rv-rail-empty">没有匹配的分段</p>
            </div>
            <div class="rv-rail-foot">
              <div class="rv-rail-pager">
                <button type="button" class="rv-rail-pager-btn" aria-label="上一段" :disabled="segmentIndex <= -1" @click="stepSegment(-1)">‹</button>
                <span class="rv-rail-pos tnum">{{ segmentPositionLabel }}</span>
                <button
                  type="button"
                  class="rv-rail-pager-btn"
                  aria-label="下一段"
                  :disabled="segmentIndex >= activeSegments.length - 1"
                  @click="stepSegment(1)"
                >
                  ›
                </button>
              </div>
              <span class="rv-rail-hint tnum">↑↓ 切段</span>
            </div>
          </aside>
        </div>
        </section>
      </div>
    </template>

    <RunLogDialog
      v-model:open="logDialogOpen"
      :run-id="runId"
      :nodes="run?.nodeResults ?? []"
      :initial-node-id="logDialogNodeId"
      :inputs="run?.inputs ?? []"
      :graph="run?.graph"
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
  position: relative;
  display: flex;
  align-items: stretch;
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
  height: 100%;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--dur-2) var(--ease-out),
    background-color var(--dur-2) var(--ease-out);
}

.rv-tabs button:hover:not(.active) {
  /* 悬停只给很淡的墨色底，避免整条 tab 抢视线 */
  background: var(--color-ink-soft-glass);
  color: var(--color-text);
}

.rv-tabs button:active {
  background: var(--color-ink-soft);
}

.rv-tabs button:focus-visible {
  outline: 2px solid var(--color-border-strong);
  outline-offset: -3px;
}

.rv-tabs button.active {
  color: var(--color-text);
}

/* 滑动墨条：一个元素在 tab 之间平移，切换时不再「跳」 */
.rv-tabs-ink {
  position: absolute;
  left: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--color-text);
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--dur-3) var(--ease-out),
    width var(--dur-3) var(--ease-out),
    opacity var(--dur-2) linear;
}

.rv-tabs-ink.ready {
  opacity: 1;
}

/* 切 tab 后新面板淡入（v-show 保留滚动位置与表格状态，不卸载 DOM） */
.rv-nodes.is-entering,
.rv-mindmap.is-entering,
.rv-body.is-entering {
  animation: rv-pane-in var(--dur-3) var(--ease-out) both;
}

@keyframes rv-pane-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 节点流水 tab 上的失败提示点：不用打开表格就知道有节点失败 */
.rv-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-error);
  flex-shrink: 0;
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
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.rv-output-badge {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--color-brand-soft);
  color: var(--color-brand-hover);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
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
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
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

/* 多输入分段：宽屏走右侧「分段大纲」，窄屏降级为单行标题 + 下拉 */
.rv-doc-area {
  flex: 1;
  min-height: 0;
  display: flex;
}

.rv-segbar {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.rv-segbar-arrow {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.rv-segbar-arrow:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-segbar-arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rv-segbar-select {
  flex: 1;
  min-width: 0;
}

/* 分段大纲栏：顺序内容用列表（而非平级标签），段数到 20+ 也不会退化成轮播 */
.rv-rail {
  width: 268px;
  min-width: 268px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
  min-height: 0;
}

.rv-rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 8px;
  flex-shrink: 0;
}

.rv-rail-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-rail-count {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.rv-rail-search {
  padding: 0 12px 8px;
  flex-shrink: 0;
}

.rv-rail-search input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--color-control-border);
  border-radius: var(--control-radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 12px;
}

.rv-rail-search input::placeholder {
  color: var(--color-control-placeholder);
}

.rv-rail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.rv-rail-row {
  display: flex;
  gap: 9px;
  width: 100%;
  padding: 7px 8px 7px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  position: relative;
}

.rv-rail-row:hover,
.rv-rail-row.on {
  background: var(--color-ink-soft);
}

.rv-rail-row.on::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background: var(--color-text);
}

.rv-rail-row:focus-visible {
  outline: 2px solid var(--color-border-strong);
  outline-offset: -2px;
}

.rv-rail-idx {
  width: 18px;
  flex-shrink: 0;
  padding-top: 1px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.rv-rail-row.on .rv-rail-idx {
  color: var(--color-text);
}

.rv-rail-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.rv-rail-label {
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rv-rail-meta {
  margin-top: 2px;
  display: flex;
  gap: 8px;
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.rv-rail-empty {
  margin: 12px 4px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.rv-rail-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.rv-rail-pager {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rv-rail-pager-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.rv-rail-pager-btn:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-rail-pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rv-rail-pos {
  min-width: 54px;
  text-align: center;
  font-size: 11.5px;
  color: var(--color-text-secondary);
}

.rv-rail-hint {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

@media (max-width: 1280px) {
  .rv-side {
    --rv-side-w: 260px;
  }

  .rv-rail,
  .rv-rail-toggle {
    display: none;
  }

  .rv-segbar {
    display: flex;
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
.rv-media {
  margin-bottom: 18px;
}

.rv-media-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.rv-media-tabs button {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.rv-media-tabs button.active {
  border-color: var(--color-border-strong);
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-media-missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 20px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  background: var(--color-surface-muted);
  text-align: center;
}

.rv-media-missing-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-media-missing-text {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.rv-media-missing-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.rv-media-restore-btn {
  border-color: var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

.rv-media-restore-btn:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-media-restore-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.rv-media-missing-progress {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.rv-fallback-media {
  max-width: 780px;
  margin: 0 auto;
  padding: 40px 32px 96px;
}

.rv-fallback-media-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 14px;
}

.rv-fallback-media-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-media-tool {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.rv-media-download {
  text-decoration: none;
}

.rv-empty-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-tertiary);
}
</style>

