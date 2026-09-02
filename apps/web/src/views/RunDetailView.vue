<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElButton, ElDialog, ElMessage, ElOption, ElSelect, ElTable, ElTableColumn, ElTag } from "element-plus";
import {
  ArrowLeft,
  Copy,
  Eye,
  FileText,
  ListTree,
  Maximize,
  Minimize,
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
import type { ProjectMeta, RunDetail, RunNodeInput, RunNodeLog, RunNodeResult, WorkflowGraph } from "@scribe-flow/shared";
import { NODE_TYPE_LABELS } from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { subscribeRunEvents } from "@/lib/sse";

const route = useRoute();
const router = useRouter();
const run = ref<RunDetail | null>(null);
const loading = ref(false);
const activeTab = ref<"result" | "nodes">("result");
const markdown = ref("");
const draft = ref("");
const editing = ref(false);
const zoom = ref(100);
const fullscreen = ref(false);
const sideCollapsed = ref(false);
const logs = ref<RunNodeLog[]>([]);
const logsVisible = ref(false);
const logsNodeId = ref("");
const selectedOutputIndex = ref(0);
const selectedInputKey = ref("");
const inputText = ref("");
const resultRootRef = ref<HTMLElement | null>(null);
const docScrollRef = ref<HTMLElement | null>(null);

const runId = String(route.params.runId);
const projectId = String(route.params.id);

let stopRunEvents: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

const isRunning = computed(() => run.value?.status === "running");

const statusMeta: Record<string, { label: string; type: "primary" | "success" | "danger" | "info" }> = {
  running: { label: "运行中", type: "primary" },
  success: { label: "成功", type: "success" },
  done: { label: "完成", type: "success" },
  error: { label: "失败", type: "danger" },
  cancelled: { label: "已取消", type: "info" },
  skipped: { label: "跳过", type: "info" },
};

const logKindLabels: Record<RunNodeLog["kind"], string> = {
  input: "输入文稿",
  "ai-request": "AI 请求",
  "ai-response": "AI 响应",
  info: "信息",
  error: "错误",
};

interface SourceInfo {
  nodeId: string;
  nodeType: string;
  label: string;
  status?: RunNodeResult["status"];
  summary?: string;
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
  const rowMap = new Map<string, RunNodeInput[]>();
  for (const row of rows) {
    if (!upstream.has(row.sourceNodeId)) continue;
    const list = rowMap.get(row.sourceNodeId) ?? [];
    list.push(row);
    rowMap.set(row.sourceNodeId, list);
  }
  // 旧数据没有 inputs 时，仍展示原始素材入口。
  for (const source of visibleSources.value) {
    if (!rowMap.has(source.nodeId)) rowMap.set(source.nodeId, []);
  }

  const items: InputItem[] = [];
  for (const [sourceNodeId, sourceRows] of rowMap) {
    const textRow = sourceRows.find((r) => r.kind === "text" && r.text);
    const audioRow = sourceRows.find((r) => r.kind === "audio");
    const nodeResult = nodeResultMap.value.get(sourceNodeId);
    const graphNode = graph.value?.nodes.find((n) => n.id === sourceNodeId);
    const source = sources.value.find((s) => s.nodeId === sourceNodeId);
    const nodeType = source?.nodeType ?? graphNode?.type ?? nodeResult?.nodeType ?? "";
    const label = source?.label ?? nodeResult?.nodeLabel ?? NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] ?? nodeType;
    const fallbackText = nodeResult?.output && nodeResult.output.kind !== "audio" ? nodeResult.output.text : undefined;
    const defaultKind: InputItem["kind"] = nodeType === "source.text" ? "text" : "audio";
    const moduleRows = sourceRows.filter((r) => r.kind === "text" && (r.text || r.resultText));
    const modules =
      moduleRows.length > 1
        ? moduleRows.map((r, index) => ({
            key: r.id,
            label: `${index + 1}. ${resolveModuleLabel(r, rows, nodeResultMap.value, graph.value, index)}`,
            text: r.text ?? r.resultText ?? "",
          }))
        : undefined;
    const base: InputItem = {
      key: sourceNodeId,
      sourceNodeId,
      nodeId: sourceNodeId,
      nodeType,
      label,
      status: source?.status ?? nodeResult?.status,
      summary: source?.summary ?? nodeResult?.summary,
      kind: textRow ? "text" : audioRow ? "audio" : fallbackText ? "text" : defaultKind,
      text: textRow?.text ?? fallbackText,
      path: audioRow?.path,
      size: textRow?.size ?? audioRow?.size,
      modules,
    };
    items.push({ ...base, ...(source ?? {}) });
  }

  const order = new Map((run.value?.nodeResults ?? []).map((n, idx) => [n.nodeId, idx]));
  items.sort((a, b) => (order.get(a.sourceNodeId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.sourceNodeId) ?? Number.MAX_SAFE_INTEGER));
  return items;
});

const selectedInput = computed(() => inputItems.value.find((i) => i.key === selectedInputKey.value) ?? null);
const viewingInput = computed(() => selectedInput.value !== null);
const currentMarkdown = computed(() => (editing.value ? draft.value : markdown.value));
const activeMarkdown = computed(() => (viewingInput.value ? inputText.value : currentMarkdown.value));
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
});

onBeforeUnmount(() => {
  stopRunEvents?.();
  if (reloadTimer) clearTimeout(reloadTimer);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
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
    ElMessage.error(err instanceof Error ? err.message : "运行详情加载失败");
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
      ElMessage.error(err instanceof Error ? err.message : "输出内容读取失败");
    }
  } else {
    markdown.value = "";
  }
  draft.value = markdown.value;
}

async function selectOutput(index: number) {
  const doc = outputNodes.value[index];
  if (!doc) return;
  selectedInputKey.value = "";
  inputText.value = "";
  selectedOutputIndex.value = index;
  editing.value = false;
  await loadOutputContent(doc.node.nodeId);
}

async function selectInput(key: string) {
  const item = inputItems.value.find((i) => i.key === key);
  if (!item) return;
  selectedInputKey.value = key;
  editing.value = false;
  inputText.value = item.text ?? "";
  // 旧数据没有 run_node_inputs 时，大文本可能只存在输出文件里，按需读取。
  if (!inputText.value) {
    const node = nodeResultMap.value.get(item.sourceNodeId);
    if (node?.output && node.output.kind !== "audio" && node.output.path) {
      try {
        const result = await api.get<{ text: string }>(`/api/runs/${runId}/outputs/${item.sourceNodeId}/content`);
        inputText.value = result.text ?? "";
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : "输入内容读取失败");
      }
    }
  }
}

function refreshSelectedInputText() {
  const item = selectedInput.value;
  inputText.value = item?.text ?? "";
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
  ElMessage.success("已恢复为运行原始输出");
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
    ElMessage.error("全屏切换失败，请检查浏览器权限");
  }
}

function scrollToHeading(id: string) {
  const container = docScrollRef.value;
  const el = container?.querySelector<HTMLElement>(`#${id}`);
  if (!container || !el) return;
  const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12;
  container.scrollTo({ top, behavior: "smooth" });
}

function goBack() {
  const focus = currentOutput.value?.node.nodeId;
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
    ElMessage.success("已复制到剪贴板");
  } catch {
    ElMessage.error("复制失败，请手动选择文本");
  }
}

async function openLogs(nodeId = "") {
  logsVisible.value = true;
  logsNodeId.value = nodeId;
  try {
    const data = await api.get<{ items: RunNodeLog[] }>(`/api/runs/${runId}/logs${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ""}`);
    logs.value = data.items ?? [];
  } catch (err) {
    logs.value = [];
    ElMessage.error(err instanceof Error ? err.message : "日志加载失败");
  }
}

async function retryNode(node: RunNodeResult) {
  try {
    const created = await api.post<{ id: string }>(`/api/runs/${runId}/nodes/${node.nodeId}/retry`);
    ElMessage.success(`已启动重跑：#${created.id.slice(-6)}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "重跑失败");
  }
}

async function stopRun() {
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${runId}/stop`);
    ElMessage.success("已发送停止指令");
    await loadRun(false);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "停止运行失败");
  }
}

async function forceStopRun() {
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${runId}/force-stop`);
    ElMessage.success("已强制结束运行");
    await loadRun(false);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "强制结束失败");
  }
}
</script>

<template>
  <div ref="resultRootRef" class="rv-root">
    <header class="rv-header">
      <div class="rv-header-left">
        <el-button size="small" text @click="goBack"><ArrowLeft :size="14" /><span>返回工作流</span></el-button>
        <div class="rv-title-block">
          <h2 class="rv-title">
            运行结果 <span class="tnum">#{{ runId.slice(-6) }}</span>
            <el-tag v-if="run" :type="statusMeta[run.status]?.type" size="small">{{ statusMeta[run.status]?.label }}</el-tag>
          </h2>
          <p class="rv-sub">
            {{ run ? `${run.projectName ?? ""} · 耗时 ${fmt(run.elapsedMs)} · ${new Date(run.createdAt).toLocaleString("zh-CN")}` : "加载中…" }}
          </p>
        </div>
      </div>
      <div class="rv-actions">
        <template v-if="run?.status === 'running'">
          <el-button size="small" plain @click="stopRun"><StopCircle :size="14" /><span>停止</span></el-button>
          <el-button size="small" plain type="danger" @click="forceStopRun"><StopCircle :size="14" /><span>强制结束</span></el-button>
        </template>
        <el-button size="small" plain @click="openLogs('')"><ScrollText :size="14" /><span>查看日志</span></el-button>
        <el-button size="small" plain :disabled="!activeMarkdown" @click="copyMarkdown"><Copy :size="14" /><span>复制</span></el-button>
        <el-button size="small" type="primary" :disabled="!activeMarkdown" @click="downloadMarkdown"><FileText :size="14" /><span>下载 Markdown</span></el-button>
      </div>
    </header>

    <nav class="rv-tabs" aria-label="运行详情视图切换">
      <button type="button" :class="{ active: activeTab === 'result' }" @click="activeTab = 'result'">结果</button>
      <button type="button" :class="{ active: activeTab === 'nodes' }" @click="activeTab = 'nodes'">节点流水</button>
    </nav>

    <div v-if="loading && !run" class="rv-loading"><div class="rv-loading-text">加载中…</div></div>

    <template v-else-if="run">
      <div v-show="activeTab === 'nodes'" class="rv-nodes page-scroll">
        <el-table :data="run.nodeResults" row-key="nodeId" size="small" class="rv-nodes-table">
          <el-table-column label="节点" min-width="160">
            <template #default="{ row }">{{ asNode(row).nodeLabel || asNode(row).nodeType }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="statusMeta[asNode(row).status]?.type ?? 'info'" size="small">{{ statusMeta[asNode(row).status]?.label ?? asNode(row).status }}</el-tag>
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
              <el-button size="small" text @click="openLogs(asNode(row).nodeId)">日志</el-button>
              <el-button
                v-if="asNode(row).status === 'error'"
                size="small"
                text
                type="primary"
                :disabled="isRunning"
                :title="isRunning ? '运行中不可重跑，请先等待或停止当前运行' : '重跑该节点'"
                @click="retryNode(asNode(row))"
              >
                <RefreshCw :size="13" /><span>重跑</span>
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-show="activeTab === 'result'" class="rv-body">
        <aside class="rv-side" :class="{ collapsed: sideCollapsed }">
          <div class="rv-side-head">
            <span class="rv-side-title">链路输入</span>
            <button type="button" class="rv-side-toggle" :title="sideCollapsed ? '展开侧栏' : '折叠侧栏'" @click="sideCollapsed = !sideCollapsed">
              <PanelLeftClose v-if="!sideCollapsed" :size="14" />
              <PanelLeftOpen v-else :size="14" />
            </button>
          </div>

          <div v-if="!sideCollapsed" class="rv-side-content">
            <div v-if="inputItems.length > 0" class="rv-source-list">
              <button
                v-for="(input, index) in inputItems"
                :key="input.key"
                type="button"
                class="rv-source-card"
                :class="{ active: selectedInputKey === input.key }"
                @click="selectInput(input.key)"
              >
                <div class="rv-source-index tnum">{{ index + 1 }}</div>
                <div class="rv-source-main">
                  <div class="rv-source-label">{{ input.label }}</div>
                  <template v-if="input.nodeType === 'source.bili'">
                    <img v-if="input.cover" :src="input.cover" class="rv-source-cover" alt="" referrerpolicy="no-referrer" loading="lazy" />
                    <div v-if="input.items && input.items.length > 1" class="rv-source-title">{{ input.label || "B站多选" }}</div>
                    <div v-else-if="input.title" class="rv-source-title">{{ input.title }}</div>
                    <div v-else-if="input.url" class="rv-source-url">{{ input.url }}</div>
                    <div class="rv-source-meta tnum">
                      <span v-if="input.uploader">{{ input.uploader }} · </span>
                      <span>{{ fmtDuration(input.duration) }}</span>
                      <span v-if="input.items && input.items.length > 1"> · {{ input.items.length }} 项</span>
                      <span v-else-if="input.pageInfo?.part"> · {{ input.pageInfo.part }}</span>
                    </div>
                  </template>
                  <template v-else-if="input.nodeType === 'source.file'">
                    <div class="rv-source-title">{{ input.fileName || "本地音视频" }}</div>
                    <div class="rv-source-meta tnum">{{ fmtSize(input.size) }}</div>
                  </template>
                  <template v-else-if="input.nodeType === 'source.text'">
                    <div class="rv-source-text">{{ input.textPreview || input.text?.slice(0, 80) || "空文稿" }}</div>
                  </template>
                  <template v-else-if="input.text">
                    <div class="rv-source-text">{{ input.text.slice(0, 80) }}</div>
                  </template>
                  <span v-if="input.text" class="rv-source-hint">点击查看单独内容</span>
                  <el-tag v-if="input.status" :type="statusMeta[input.status]?.type ?? 'info'" size="small" class="rv-source-status">
                    {{ statusMeta[input.status]?.label ?? input.status }}
                  </el-tag>
                </div>
              </button>
            </div>
            <div v-else class="rv-side-empty">本次结果没有可追溯的输入素材</div>

            <div class="rv-side-section-title">输出文档</div>
            <div v-if="outputNodes.length > 0" class="rv-output-list">
              <button
                v-for="(doc, index) in outputNodes"
                :key="doc.node.nodeId"
                type="button"
                class="rv-output-item"
                :class="{ active: index === selectedOutputIndex }"
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
              <button type="button" class="rv-tool-btn" title="缩小" @click="setZoom(-10)"><ZoomOut :size="14" /></button>
              <span class="rv-zoom tnum">{{ zoom }}%</span>
              <button type="button" class="rv-tool-btn" title="放大" @click="setZoom(10)"><ZoomIn :size="14" /></button>
              <button type="button" class="rv-tool-btn" title="重置缩放" @click="resetZoom"><RotateCcw :size="14" /></button>
              <span class="rv-tool-divider" />
              <button type="button" class="rv-tool-btn" :title="fullscreen ? '退出全屏' : '全屏阅读'" @click="toggleFullscreen">
                <Minimize v-if="fullscreen" :size="14" />
                <Maximize v-else :size="14" />
              </button>
              <button v-if="viewingInput" type="button" class="rv-tool-btn" title="返回输出" @click="selectedInputKey = ''; inputText = ''">
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
            <div v-if="toc.length > 0" class="rv-toc">
              <ListTree :size="14" />
              <select class="rv-toc-select" aria-label="文档目录" @change="scrollToHeading(($event.target as HTMLSelectElement).value)">
                <option value="" disabled selected>目录</option>
                <option v-for="item in toc" :key="item.id" :value="item.id">
                  {{ "　".repeat(Math.max(0, item.level - 1)) }}{{ item.text }}
                </option>
              </select>
            </div>
          </div>

          <div ref="docScrollRef" class="rv-doc-scroll">
            <template v-if="viewingInput">
              <article class="rv-paper" :style="paperStyle">
                <header class="rv-paper-head">
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
                  <el-button size="small" plain :disabled="draft === markdown" @click="resetDraft">恢复原始</el-button>
                  <el-button size="small" plain @click="toggleEdit">退出编辑</el-button>
                  <el-button size="small" type="primary" :disabled="!draft" @click="copyMarkdown">复制编辑结果</el-button>
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

    <el-dialog v-model="logsVisible" title="运行日志" width="640px" align-center>
      <el-select v-model="logsNodeId" class="rv-log-filter" size="small" placeholder="全部节点" clearable @change="(v) => openLogs(String(v ?? ''))">
        <el-option v-for="node in run?.nodeResults ?? []" :key="node.nodeId" :label="node.nodeLabel || node.nodeType" :value="node.nodeId" />
      </el-select>
      <div class="rv-log-list">
        <article v-for="log in logs" :key="log.id" class="rv-log-item">
          <header class="rv-log-head">
            <span class="rv-log-node">{{ log.nodeLabel || log.nodeId }}</span>
            <span class="rv-log-kind">{{ logKindLabels[log.kind] }}</span>
            <span class="rv-log-time tnum">{{ new Date(log.createdAt).toLocaleTimeString("zh-CN") }}</span>
          </header>
          <pre class="rv-log-content">{{ log.content }}</pre>
        </article>
        <div v-if="logs.length === 0" class="rv-log-empty">暂无日志</div>
      </div>
    </el-dialog>
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
  height: 56px;
  padding: 0 16px;
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
  color: var(--color-brand);
  border-bottom-color: var(--color-brand);
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

.rv-nodes-table {
  width: 100%;
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
  width: 300px;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
  transition: width var(--dur-2) var(--ease-out), min-width var(--dur-2) var(--ease-out);
}

.rv-side.collapsed {
  width: 44px;
  min-width: 44px;
}

.rv-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.rv-side-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-side-toggle {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.rv-side-toggle:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rv-side-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.rv-source-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rv-source-card {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.rv-source-card:hover {
  border-color: var(--color-border-strong);
}

.rv-source-card.active {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
}

.rv-source-index {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  background: var(--color-ink);
  color: var(--color-surface);
  font-size: 10.5px;
  flex-shrink: 0;
}

.rv-source-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rv-source-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-source-cover {
  width: 100%;
  max-width: 220px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
}

.rv-source-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rv-source-url {
  font-size: 11px;
  color: var(--color-text-tertiary);
  word-break: break-all;
}

.rv-source-meta {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.rv-source-text {
  font-size: 11.5px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rv-source-hint {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.rv-source-status {
  align-self: flex-start;
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
  gap: 6px;
}

.rv-output-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.rv-output-item.active {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
}

.rv-output-name {
  font-size: 12px;
  font-weight: 600;
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
  background: var(--color-brand-soft);
  color: var(--color-brand);
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
  color: var(--color-brand);
}

.rv-toc {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}

.rv-toc-select {
  max-width: 220px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12px;
}

.rv-doc-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}

.rv-paper {
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 48px 56px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  font-size: calc(16px * var(--doc-scale, 1));
}

.rv-paper-head {
  padding-bottom: 16px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--color-border);
}

.rv-paper-title {
  margin: 0;
  font-size: 1.6em;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.rv-paper-meta {
  margin: 6px 0 0;
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
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.85em;
  line-height: 1.7;
  resize: vertical;
  outline: none;
}

.rv-editor:focus {
  border-color: var(--color-brand);
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

.rv-log-filter {
  width: 220px;
  margin-bottom: 10px;
}

.rv-log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 420px;
  overflow-y: auto;
}

.rv-log-item {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.rv-log-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.rv-log-node {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-log-kind {
  font-size: 11px;
  color: var(--color-brand);
}

.rv-log-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.rv-log-content {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.rv-log-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}

@media (max-width: 1280px) {
  .rv-side {
    width: 260px;
    min-width: 260px;
  }
}

@media (max-width: 1024px) {
  .rv-side {
    width: 220px;
    min-width: 220px;
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
    width: 100%;
    min-width: 0;
    max-height: 240px;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }

  .rv-side.collapsed {
    width: 100%;
    min-width: 0;
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

