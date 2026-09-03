<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElButton, ElDrawer, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElMessage } from "element-plus";
import { ArrowLeft, Check, Copy, Download, ExternalLink, History, LayoutPanelTop, Maximize, MoreHorizontal, Play, Redo2, StopCircle, Trash2, Undo2 } from "lucide-vue-next";
import { NODE_TYPE_LABELS, emptyGraph, type NodeType, type RunDetail, type RunMeta, type RunNodeInput, type RunNodeResult, type SourceVideoItem, type WorkflowGraph } from "@scribe-flow/shared";
import FlowCanvas from "@/components/canvas/FlowCanvas.vue";
import NodePalette from "@/components/canvas/NodePalette.vue";
import SourcePickerDialog from "@/components/canvas/SourcePickerDialog.vue";
import DiffViewer from "@/components/DiffViewer.vue";
import BiliAccountButton from "@/components/auth/BiliAccountButton.vue";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { subscribeRunEvents } from "@/lib/sse";
import { useAuthStore } from "@/stores/auth";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";
import { useSettingsStore } from "@/stores/settings";

type SaveState = "loading" | "saved" | "saving" | "error";
type OutputDrawerInputMode = "result" | "raw" | "diff";

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();
const runsStore = useRunsStore();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();

const projectId = computed(() => String(route.params.id));
const projectName = ref("");
const description = ref("");
const graph = ref<WorkflowGraph>(emptyGraph());
const loaded = ref(false);
const saveState = ref<SaveState>("loading");
const consoleNotice = ref("就绪");
const historyState = ref({ canUndo: false, canRedo: false });
const flowCanvasRef = ref<InstanceType<typeof FlowCanvas> | null>(null);
const noticeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const selectedNodeId = ref<string | null>(null);
const activeRun = ref<RunMeta | null>(null);
const lastRun = ref<RunMeta | null>(null);
const running = ref(false);
const projectRunningRun = computed(() => runsStore.runs.find((r) => r.projectId === projectId.value && r.status === "running") ?? null);
const outputDrawerVisible = ref(false);
const outputDrawerNodeId = ref("");
const outputDrawerRunId = ref("");
const outputDrawerNodeLabel = ref("");
const outputDrawerRunStatus = ref("");
const outputDrawerText = ref("");
const outputDrawerLoading = ref(false);
const outputDrawerInputs = ref<RunNodeInput[]>([]);
const outputDrawerNodeResults = ref<RunNodeResult[]>([]);
const outputDrawerGraph = ref<WorkflowGraph | null>(null);
const outputDrawerView = ref<"output" | "input">("output");
const outputDrawerSelectedInputKey = ref("");
const outputDrawerInputMode = ref<OutputDrawerInputMode>("result");
const outputDrawerInputText = ref("");
const biliPickerVisible = ref(false);
const renderedOutput = computed(() => renderMarkdown(outputDrawerText.value));
const renderedOutputInput = computed(() => renderMarkdown(outputDrawerInputText.value));
const outputDrawerActiveText = computed(() => (outputDrawerView.value === "input" ? outputDrawerInputText.value : outputDrawerText.value));
const runStatusLabels: Record<string, string> = {
  running: "运行中",
  success: "成功",
  error: "失败",
  cancelled: "已取消",
};

interface OutputDrawerInputItem extends RunNodeInput {
  label: string;
  key: string;
}

function upstreamNodeIds(graph: WorkflowGraph, nodeId: string): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const edge of graph.edges) {
      if (edge.target === id && !result.has(edge.source)) {
        result.add(edge.source);
        visit(edge.source);
      }
    }
  };
  visit(nodeId);
  return result;
}

const outputDrawerInputItems = computed<OutputDrawerInputItem[]>(() => {
  const graph = outputDrawerGraph.value;
  if (!graph || !outputDrawerNodeId.value) return [];
  const upstream = upstreamNodeIds(graph, outputDrawerNodeId.value);
  const resultMap = new Map(outputDrawerNodeResults.value.map((n) => [n.nodeId, n]));
  const order = new Map(outputDrawerNodeResults.value.map((n, idx) => [n.nodeId, idx]));
  const items = outputDrawerInputs.value
    .filter((input) => upstream.has(input.sourceNodeId))
    .map((input) => {
      const node = resultMap.get(input.sourceNodeId);
      const graphNode = graph.nodes.find((n) => n.id === input.sourceNodeId);
      const data = (graphNode?.data ?? {}) as Record<string, unknown>;
      let label = node?.nodeLabel || NODE_TYPE_LABELS[node?.nodeType as keyof typeof NODE_TYPE_LABELS] || node?.nodeType || input.sourceNodeId;
      if (graphNode?.type === "source.bili") {
        const items = Array.isArray(data.items) ? (data.items as { title?: string }[]) : [];
        if (items.length > 1) label = String(data.label ?? NODE_TYPE_LABELS[graphNode.type] ?? "B站多选");
        else if (typeof data.title === "string" && data.title) label = data.title;
      } else if (graphNode?.type === "source.file" && typeof data.fileName === "string" && data.fileName) label = data.fileName;
      return { ...input, label, key: input.id };
    });
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.sourceNodeId, (counts.get(item.sourceNodeId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return items
    .map((item) => {
      if ((counts.get(item.sourceNodeId) ?? 0) > 1) {
        const index = (seen.get(item.sourceNodeId) ?? 0) + 1;
        seen.set(item.sourceNodeId, index);
        const graphNode = graph.nodes.find((n) => n.id === item.sourceNodeId);
        const data = (graphNode?.data ?? {}) as Record<string, unknown>;
        const biliItems = Array.isArray(data.items) ? (data.items as { title?: string; part?: string; page?: number }[]) : [];
        let itemLabel = item.label;
        if (graphNode?.type === "source.bili" && biliItems.length >= index) {
          const entry = biliItems[index - 1];
          if (entry) {
            itemLabel = entry.title || (typeof data.title === "string" ? data.title : "") || item.label;
            if (entry.part) itemLabel = `${itemLabel} · P${entry.page} ${entry.part}`;
          }
        }
        return { ...item, label: `${itemLabel} #${index}` };
      }
      return item;
    })
    .sort((a, b) => (order.get(a.sourceNodeId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.sourceNodeId) ?? Number.MAX_SAFE_INTEGER));
});

const selectedOutputDrawerInput = computed(() => outputDrawerInputItems.value.find((i) => i.key === outputDrawerSelectedInputKey.value) ?? null);

/** 可用的“变更对比”：优先对比该输入的原始文本与 AI 处理结果；没有独立 resultText 时，若只有一个上游输入，则对比原始输入与当前节点输出。 */
const outputDrawerDiff = computed<{ before: string; after: string } | null>(() => {
  const item = selectedOutputDrawerInput.value;
  if (!item) return null;
  const before = item.text ?? "";
  const after = item.resultText ?? (outputDrawerInputItems.value.length === 1 ? outputDrawerText.value : "");
  if (!before.trim() || !after.trim()) return null;
  return { before, after };
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let stopRunEvents: (() => void) | null = null;
let pendingRunSnapshot: RunNodeResult[] | null = null;
let disposed = false;
let subscribedRunId: string | null = null;
let restoredLastRunId: string | null = null;

onMounted(async () => {
  void runsStore.load();
  void settingsStore.load();
  try {
    const project = await store.getProject(projectId.value);
    projectName.value = project.name;
    description.value = project.description;
    graph.value = {
      ...project.graph,
      nodes: project.graph.nodes.map((n) => {
        const data = { ...(n.data as Record<string, unknown>) };
        delete data.status;
        delete data.summary;
        delete data.preview;
        delete data.delta;
        return { ...n, data } as typeof n;
      }),
    };
    saveState.value = "saved";
  } catch (err) {
    saveState.value = "error";
    showNotice(err instanceof Error ? err.message : "加载工程失败");
  } finally {
    loaded.value = true;
  }

  await nextTick();
  if (pendingRunSnapshot) {
    flowCanvasRef.value?.applyRunSnapshot(pendingRunSnapshot);
    pendingRunSnapshot = null;
  }

  const focusNodeId = route.query.focus ? String(route.query.focus) : "";
  if (focusNodeId) {
    await nextTick();
    flowCanvasRef.value?.focusNode(focusNodeId);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  if (saveTimer) clearTimeout(saveTimer);
  if (noticeTimer.value) clearTimeout(noticeTimer.value);
  stopRunEvents?.();
  stopRunEvents = null;
  subscribedRunId = null;
});

watch(
  projectRunningRun,
  (run) => {
    if (run) {
      if (activeRun.value?.id !== run.id) void resumeRun(run);
    } else {
      if (running.value && activeRun.value) void reconcileActiveRun();
      else void restoreLastRun();
    }
  },
  { immediate: true },
);

function showNotice(message: string) {
  consoleNotice.value = message;
  if (noticeTimer.value) clearTimeout(noticeTimer.value);
  noticeTimer.value = setTimeout(() => {
    consoleNotice.value = "";
  }, 4000);
}

function onPaletteAdd(type: NodeType | "source.biliCollection") {
  if (type === "source.biliCollection") {
    if (!authStore.loggedIn) {
      ElMessage.info("请先点击右上角 B 站头像扫码登录");
      return;
    }
    biliPickerVisible.value = true;
    return;
  }
  flowCanvasRef.value?.addNodeAtCenter(type);
}

function onBiliPickerConfirm(videos: SourceVideoItem[]) {
  if (videos.length > 0) {
    flowCanvasRef.value?.addBiliVideos(videos);
    ElMessage.success(videos.length > 1 ? `已添加 1 张多选卡片（${videos.length} 个视频）` : "已添加 1 个视频来源");
  }
}

function onGraphUpdate(next: WorkflowGraph) {
  graph.value = next;
  scheduleSave();
}

function scheduleSave() {
  saveState.value = "saving";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await store.saveGraph(projectId.value, graph.value);
      saveState.value = "saved";
    } catch (err) {
      saveState.value = "error";
      showNotice(err instanceof Error ? err.message : "保存失败");
    }
  }, 500);
}

function onRename() {
  const name = projectName.value.trim();
  if (!name) {
    projectName.value = store.current?.name ?? "";
    return;
  }
  void store
    .renameProject(projectId.value, name, description.value)
    .then(() => {
      saveState.value = "saved";
    })
    .catch((err) => showNotice(err instanceof Error ? err.message : "重命名失败"));
}

async function duplicateProject() {
  try {
    const created = await store.duplicateProject(projectId.value);
    ElMessage.success(`已创建副本「${created.name}」`);
    await router.push(`/project/${created.id}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "复制工程失败");
  }
}

async function exportProject() {
  try {
    await store.exportProject(projectId.value, projectName.value);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "导出工程失败");
  }
}

function onMoreCommand(command: string) {
  switch (command) {
    case "layout":
      void flowCanvasRef.value?.autoLayout();
      break;
    case "fit":
      flowCanvasRef.value?.fitView();
      break;
    case "undo":
      flowCanvasRef.value?.undo();
      break;
    case "redo":
      flowCanvasRef.value?.redo();
      break;
    case "duplicate":
      void duplicateProject();
      break;
    case "export":
      void exportProject();
      break;
    case "clear-runs":
      ElMessage.info("清空运行记录将在 M4 接入");
      break;
    case "force-stop":
      void forceStopRun();
      break;
  }
}

function runTitle(run: RunMeta): string {
  return `运行 ${run.id.slice(-6)}`;
}

/** 重新进入工程页时，若服务端仍有 running 运行，恢复画布进度并重新订阅 SSE。 */
async function resumeRun(run: RunMeta) {
  if (activeRun.value?.id === run.id && (stopRunEvents || subscribedRunId === run.id)) return;
  stopRunEvents?.();
  subscribedRunId = null;
  activeRun.value = run;
  running.value = true;
  showNotice(`检测到运行 #${run.id.slice(-6)} 正在进行，正在恢复进度…`);
  try {
    const detail = await api.get<RunDetail>(`/api/runs/${run.id}`);
    if (disposed) return;
    if (detail.status !== "running") {
      running.value = false;
      activeRun.value = null;
      const snapshot = await mergedNodeResults(detail);
      flowCanvasRef.value?.applyRunSnapshot(snapshot);
      showNotice(`运行 #${run.id.slice(-6)} 已结束：${runStatusLabels[detail.status] ?? detail.status}`);
      void runsStore.load();
      return;
    }
    const snapshot = await mergedNodeResults(detail);
    pendingRunSnapshot = snapshot;
    if (flowCanvasRef.value) {
      flowCanvasRef.value.applyRunSnapshot(snapshot);
      pendingRunSnapshot = null;
    }
    showNotice(`已恢复运行中 #${run.id.slice(-6)} 的实时进度`);
  } catch (err) {
    showNotice(err instanceof Error ? err.message : "恢复运行状态失败");
  }
  if (disposed) return;

  stopRunEvents = subscribeRunEvents(run.id, (event) => {
    // run.started 在 startRun/resumeRun 中已提前应用过，避免重复清空/打断正在恢复的运行状态。
    if (event.type !== "run.started") flowCanvasRef.value?.applyRunEvent(event);
    if (event.type === "node.started") showNotice(`${nodeName(event.nodeId)} 开始执行`);
    else if (event.type === "node.progress") showNotice(event.message);
    else if (event.type === "node.done") showNotice(`${nodeName(event.nodeId)} 完成`);
    else if (event.type === "node.error") {
      showNotice(`${nodeName(event.nodeId)} 失败：${event.error}`);
      ElMessage.error(`${nodeName(event.nodeId)} 失败：${event.error}`);
    } else if (event.type === "run.done") {
      running.value = false;
      activeRun.value = { ...(activeRun.value as RunMeta), status: event.status };
      showNotice(`运行结束：${event.status}`);
      stopRunEvents?.();
      stopRunEvents = null;
      subscribedRunId = null;
      void syncFinalRun(event.runId);
      void runsStore.load();
    }
  });
  subscribedRunId = run.id;
}

/** 全局轮询发现运行已不在 running 列表时，主动向服务端核对一次，避免 SSE 断线导致界面卡在运行中。 */
async function reconcileActiveRun() {
  const run = activeRun.value;
  if (!run || !running.value) return;
  try {
    const detail = await api.get<RunDetail>(`/api/runs/${run.id}`);
    if (disposed) return;
    if (detail.status !== "running") {
      running.value = false;
      activeRun.value = { ...run, status: detail.status };
      stopRunEvents?.();
      stopRunEvents = null;
      subscribedRunId = null;
      showNotice(`运行结束：${runStatusLabels[detail.status] ?? detail.status}`);
      const snapshot = await mergedNodeResults(detail);
      if (flowCanvasRef.value) flowCanvasRef.value.applyRunSnapshot(snapshot);
      void runsStore.load();
    } else if (!stopRunEvents) {
      await resumeRun(run);
    }
  } catch {
    // 暂时无法确认状态，保持当前显示，等待下一次轮询或 SSE 重连。
  }
}

/** 局部运行的结果只包含本次执行节点；把更早运行中“缺失节点”的成功结果合并回来，避免上游结果从图上消失。 */
async function mergedNodeResults(detail: RunDetail): Promise<RunNodeResult[]> {
  const expectedIds = new Set((detail.graph?.nodes ?? graph.value.nodes).map((n) => n.id));
  const resultMap = new Map<string, RunNodeResult>();
  for (const nr of detail.nodeResults ?? []) resultMap.set(nr.nodeId, nr);
  if (detail.scope === "all" || resultMap.size >= expectedIds.size) return [...resultMap.values()];

  try {
    const list = await api.get<{ items: RunMeta[] }>(`/api/runs?projectId=${encodeURIComponent(detail.projectId)}&limit=200`);
    let sawCurrent = false;
    for (const run of list.items) {
      if (!sawCurrent) {
        if (run.id === detail.id) sawCurrent = true;
        continue;
      }
      if (resultMap.size >= expectedIds.size) break;
      if (run.status !== "success") continue;
      const older = await api.get<RunDetail>(`/api/runs/${run.id}`);
      for (const nr of older.nodeResults ?? []) {
        if (expectedIds.has(nr.nodeId) && nr.status === "done" && !resultMap.has(nr.nodeId)) {
          resultMap.set(nr.nodeId, nr);
        }
      }
    }
  } catch {
    // 合并失败时保留当前快照，不阻塞界面。
  }
  return [...resultMap.values()];
}

/** 运行结束后主动拉取最终快照并同步到画布，避免 SSE 丢事件导致下游节点停留在旧状态。 */
async function syncFinalRun(runId: string) {
  try {
    const detail = await api.get<RunDetail>(`/api/runs/${runId}`);
    if (disposed) return;
    const snapshot = await mergedNodeResults(detail);
    if (flowCanvasRef.value) flowCanvasRef.value.applyRunSnapshot(snapshot);
  } catch {
    // 同步失败不打断主流程，后续可通过刷新/上次结果恢复。
  }
}

/** 没有进行中的运行时，把最近一次已完成/失败/取消的运行快照恢复到画布，方便刷新后直接查看上次结果。 */
async function restoreLastRun() {
  if (projectRunningRun.value) return;
  const latest = runsStore.runs.find((r) => r.projectId === projectId.value);
  if (!latest || latest.status === "running" || restoredLastRunId === latest.id) return;
  restoredLastRunId = latest.id;
  try {
    const detail = await api.get<RunDetail>(`/api/runs/${latest.id}`);
    if (disposed) return;
    if (detail.status === "running") return;
    lastRun.value = latest;
    const snapshot = await mergedNodeResults(detail);
    pendingRunSnapshot = snapshot;
    if (flowCanvasRef.value) {
      flowCanvasRef.value.applyRunSnapshot(snapshot);
      pendingRunSnapshot = null;
    }
    showNotice(`已载入上次运行 #${latest.id.slice(-6)}：${runStatusLabels[detail.status] ?? detail.status}`);
  } catch {
    restoredLastRunId = null;
  }
}

function nodeIdsForScope(scope: "all" | "fromNode" | "node", nodeId?: string): Set<string> {
  const all = new Set(graph.value.nodes.map((n) => n.id));
  if (scope === "node" && nodeId) return new Set([nodeId]);
  if (scope === "fromNode" && nodeId) {
    const result = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.value.edges) {
        if (result.has(edge.source) && !result.has(edge.target)) {
          result.add(edge.target);
          changed = true;
        }
      }
    }
    return result;
  }
  return all;
}

function missingKeyMessage(scope: "all" | "fromNode" | "node", nodeId?: string): string | null {
  const ids = nodeIdsForScope(scope, nodeId);
  const nodes = graph.value.nodes.filter((n) => ids.has(n.id));
  if (nodes.some((n) => n.type === "process.refine" || n.type === "process.prompt" || n.type === "process.mindmap") && !settingsStore.settings?.ai.hasKey) {
    return "未配置 AI 模型密钥，请先到设置页填写";
  }
  if (nodes.some((n) => n.type === "process.transcribe") && !settingsStore.settings?.asr.hasKey) {
    return "未配置语音识别密钥，请先到设置页填写";
  }
  return null;
}

async function startRun(scope: "all" | "fromNode" | "node", nodeId?: string) {
  if (running.value) {
    showNotice("已有运行正在进行");
    return;
  }
  if (!settingsStore.settings) {
    try {
      await settingsStore.load();
    } catch {
      ElMessage.error("设置加载失败，请先到设置页确认密钥");
      return;
    }
  }
  if (disposed) return;
  const missing = missingKeyMessage(scope, nodeId);
  if (missing) {
    ElMessage.error(missing);
    return;
  }
  // 先落盘当前画布，避免运行服务端读到上一次保存的旧图（例如刚粘贴的 B 站链接还没到自动保存）。
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await store.saveGraph(projectId.value, graph.value);
    if (disposed) return;
    saveState.value = "saved";
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败，请稍后重试");
    return;
  }
  try {
    running.value = true;
    const run = await api.post<RunMeta>(`/api/projects/${projectId.value}/runs`, { scope, nodeId });
    if (disposed) return;
    activeRun.value = run;
    if (subscribedRunId !== run.id) {
      stopRunEvents?.();
      stopRunEvents = null;
      subscribedRunId = null;
      flowCanvasRef.value?.applyRunEvent({ type: "run.started", run });
      stopRunEvents = subscribeRunEvents(run.id, (event) => {
        // 上面已手动应用过 run.started，SSE 的首个 run.started 不再重复清空节点。
        if (event.type !== "run.started") flowCanvasRef.value?.applyRunEvent(event);
        if (event.type === "node.started") showNotice(`${nodeName(event.nodeId)} 开始执行`);
        else if (event.type === "node.progress") showNotice(event.message);
        else if (event.type === "node.done") showNotice(`${nodeName(event.nodeId)} 完成`);
        else if (event.type === "node.error") {
          showNotice(`${nodeName(event.nodeId)} 失败：${event.error}`);
          ElMessage.error(`${nodeName(event.nodeId)} 失败：${event.error}`);
        } else if (event.type === "run.done") {
          running.value = false;
          activeRun.value = { ...(activeRun.value as RunMeta), status: event.status };
          showNotice(`运行结束：${event.status}`);
          stopRunEvents?.();
          stopRunEvents = null;
          subscribedRunId = null;
          void syncFinalRun(event.runId);
          void runsStore.load();
        }
      });
      subscribedRunId = run.id;
    }
  } catch (err) {
    running.value = false;
    ElMessage.error(err instanceof Error ? err.message : "启动运行失败");
  }
}

function nodeName(nodeId: string): string {
  return graph.value.nodes.find((n) => n.id === nodeId)?.data.label ?? nodeId;
}

async function stopRun() {
  const target = activeRun.value ?? projectRunningRun.value;
  if (!target) return;
  try {
    if (activeRun.value) {
      await api.post<{ ok: boolean }>(`/api/runs/${target.id}/stop`);
      showNotice("已发送停止指令");
    } else {
      await api.post<{ ok: boolean }>(`/api/runs/${target.id}/force-stop`);
      ElMessage.success("已强制结束中断的运行");
      await runsStore.load();
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "停止运行失败");
  }
}

async function forceStopRun() {
  const target = activeRun.value ?? projectRunningRun.value;
  if (!target) return;
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${target.id}/force-stop`);
    ElMessage.success("已强制结束运行");
    if (activeRun.value) activeRun.value = { ...activeRun.value, status: "cancelled" };
    running.value = false;
    await runsStore.load();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "强制结束失败");
  }
}

async function viewOutput(nodeId: string) {
  try {
    const data = await api.get<{ items: RunMeta[] }>(`/api/runs?projectId=${encodeURIComponent(projectId.value)}&limit=20`);
    const runs = data.items ?? [];
    if (runs.length === 0) {
      ElMessage.warning("还没有运行记录，请先运行工作流");
      return;
    }
    for (const run of runs) {
      const detail = await api.get<RunDetail>(`/api/runs/${run.id}`);
      const nodeResult = detail.nodeResults.find((node) => node.nodeId === nodeId);
      if (nodeResult) {
        if (nodeResult.nodeType === "process.mindmap") {
          router.push({ path: `/project/${projectId.value}/run/${run.id}`, query: { focus: nodeId, tab: "mindmap" } });
          return;
        }
        openOutputDrawer(nodeId, run, nodeResult, detail);
        return;
      }
    }
    ElMessage.warning("没有找到包含该节点输出的运行记录，请先运行该节点");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "打开输出失败");
  }
}

function openOutputDrawer(nodeId: string, run: RunMeta, nodeResult: RunNodeResult, detail: RunDetail) {
  outputDrawerNodeId.value = nodeId;
  outputDrawerRunId.value = run.id;
  outputDrawerRunStatus.value = run.status;
  outputDrawerNodeLabel.value = nodeResult.nodeLabel || nodeResult.nodeType;
  outputDrawerText.value = "";
  outputDrawerInputs.value = detail.inputs ?? [];
  outputDrawerNodeResults.value = detail.nodeResults;
  outputDrawerGraph.value = detail.graph ?? graph.value;
  outputDrawerView.value = "output";
  outputDrawerSelectedInputKey.value = "";
  outputDrawerInputText.value = "";
  outputDrawerVisible.value = true;
  void loadNodeOutput(nodeId, run.id, nodeResult);
}

async function loadNodeOutput(nodeId: string, runId: string, nodeResult: RunNodeResult) {
  outputDrawerLoading.value = true;
  try {
    if (nodeResult.output?.text) {
      outputDrawerText.value = nodeResult.output.text;
    } else if (nodeResult.output?.path) {
      const result = await api.get<{ text: string }>(`/api/runs/${runId}/outputs/${nodeId}/content`);
      outputDrawerText.value = result.text ?? "";
    } else {
      outputDrawerText.value = "";
    }
  } catch (err) {
    outputDrawerText.value = "";
    ElMessage.error(err instanceof Error ? err.message : "节点输出读取失败");
  } finally {
    outputDrawerLoading.value = false;
  }
}

function selectOutputDrawerOutput() {
  outputDrawerView.value = "output";
  outputDrawerSelectedInputKey.value = "";
  outputDrawerInputText.value = "";
}

function selectOutputDrawerInput(item: OutputDrawerInputItem) {
  outputDrawerView.value = "input";
  outputDrawerSelectedInputKey.value = item.key;
  outputDrawerInputMode.value = item.resultText ? "result" : "raw";
  outputDrawerInputText.value = item.resultText ?? item.text ?? "";
}

function selectOutputDrawerInputMode(mode: OutputDrawerInputMode) {
  const item = selectedOutputDrawerInput.value;
  if (!item) return;
  outputDrawerInputMode.value = mode;
  outputDrawerInputText.value = mode === "raw" ? item.text ?? "" : item.resultText ?? item.text ?? "";
}

function openFullResult() {
  if (!outputDrawerRunId.value) return;
  void router.push({ path: `/project/${projectId.value}/run/${outputDrawerRunId.value}`, query: { focus: outputDrawerNodeId.value } });
}

async function copyNodeOutput() {
  if (!outputDrawerActiveText.value) return;
  try {
    await navigator.clipboard.writeText(outputDrawerActiveText.value);
    ElMessage.success("已复制节点内容");
  } catch {
    ElMessage.error("复制失败，请手动选择文本");
  }
}

function downloadNodeOutput() {
  if (!outputDrawerActiveText.value) return;
  const blob = new Blob([outputDrawerActiveText.value], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${outputDrawerNodeLabel.value || "node"}-${outputDrawerRunId.value.slice(-6)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="sf-editor">
    <header class="sf-editor-bar">
      <div class="sf-editor-bar-left">
        <button type="button" class="sf-icon-btn" title="返回工程列表" @click="router.push('/')">
          <ArrowLeft :size="16" />
        </button>
        <el-input
          v-model="projectName"
          class="sf-project-name-input"
          size="small"
          aria-label="工程名称"
          @change="onRename"
        />
        <span class="sf-save-state tnum">
          <Check v-if="saveState === 'saved'" :size="12" />
          {{ saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "加载中…" }}
        </span>
      </div>

      <div class="sf-editor-bar-actions">
        <el-button v-if="lastRun" class="sf-btn" plain @click="router.push(`/project/${projectId}/run/${lastRun.id}`)">
          <History :size="14" />
          <span>上次结果</span>
        </el-button>
        <el-button class="sf-btn" type="primary" :disabled="running" @click="startRun('all')">
          <Play :size="14" />
          <span>运行全部</span>
        </el-button>
        <el-button class="sf-btn" plain :disabled="!selectedNodeId || running" @click="selectedNodeId && startRun('fromNode', selectedNodeId)">
          <Play :size="14" />
          <span>从选中节点运行</span>
        </el-button>
        <el-button class="sf-btn" plain :disabled="!running && !projectRunningRun" @click="stopRun">
          <StopCircle :size="14" />
          <span>停止</span>
        </el-button>
        <BiliAccountButton compact />
        <el-dropdown trigger="click" @command="(cmd) => onMoreCommand(String(cmd))">
          <button type="button" class="sf-icon-btn" title="更多操作">
            <MoreHorizontal :size="16" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="layout"><LayoutPanelTop :size="14" />整理画布</el-dropdown-item>
              <el-dropdown-item command="fit"><Maximize :size="14" />适应视图</el-dropdown-item>
              <el-dropdown-item command="undo" :disabled="!historyState.canUndo"><Undo2 :size="14" />撤销</el-dropdown-item>
              <el-dropdown-item command="redo" :disabled="!historyState.canRedo"><Redo2 :size="14" />重做</el-dropdown-item>
              <el-dropdown-item command="duplicate" divided><Copy :size="14" />复制工程</el-dropdown-item>
              <el-dropdown-item command="export"><Download :size="14" />导出工程</el-dropdown-item>
              <el-dropdown-item command="clear-runs" disabled class="sf-dropdown-danger"><Trash2 :size="14" />清空运行记录（M4）</el-dropdown-item>
              <el-dropdown-item command="force-stop" :disabled="!running && !projectRunningRun" class="sf-dropdown-danger" divided><StopCircle :size="14" />强制结束运行</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="sf-editor-main">
      <div class="sf-mobile-hint">画布编辑器需要桌面端（≥1024px）。当前仅作只读预览，请在电脑上打开以编辑。</div>
      <NodePalette @add="onPaletteAdd" />
      <FlowCanvas
        v-if="loaded"
        ref="flowCanvasRef"
        :key="projectId"
        :initial-graph="graph"
        :running="running"
        @update:graph="onGraphUpdate"
        @notice="showNotice"
        @history-change="historyState = $event"
        @select="selectedNodeId = $event"
        @run-request="(req) => startRun(req.scope, req.nodeId)"
        @view-output="viewOutput"
      />
      <div v-else class="sf-editor-loading">
        <span>{{ saveState === "error" ? "工程加载失败" : "正在加载画布…" }}</span>
      </div>
    </div>

    <footer class="sf-editor-console" aria-live="polite">
      <span class="sf-console-dot" :class="{ running }" />
      <span class="sf-console-text">
        <template v-if="running && activeRun">{{ runTitle(activeRun) }} · </template>{{ consoleNotice || "就绪" }}
      </span>
    </footer>

    <el-drawer v-model="outputDrawerVisible" size="520px" :with-header="false" class="sf-output-drawer">
      <template #default>
        <div class="sf-output-drawer-head">
          <div class="sf-output-drawer-head-main">
            <div class="sf-output-drawer-title">{{ outputDrawerNodeLabel || "节点输出" }}</div>
            <div class="sf-output-drawer-meta tnum">
              <template v-if="outputDrawerRunId">运行 #{{ outputDrawerRunId.slice(-6) }} · {{ runStatusLabels[outputDrawerRunStatus] ?? outputDrawerRunStatus }}</template>
              <template v-else>尚未选择运行</template>
            </div>
          </div>
          <el-button size="small" type="primary" plain :disabled="!outputDrawerRunId" @click="openFullResult">
            <ExternalLink :size="13" />
            <span>完整结果页</span>
          </el-button>
        </div>

        <div v-if="outputDrawerInputItems.length > 0" class="sf-output-drawer-tabs">
          <button type="button" :class="{ active: outputDrawerView === 'output' }" @click="selectOutputDrawerOutput">输出</button>
          <button
            v-for="item in outputDrawerInputItems"
            :key="item.key"
            type="button"
            :class="{ active: outputDrawerView === 'input' && outputDrawerSelectedInputKey === item.key }"
            @click="selectOutputDrawerInput(item)"
          >
            {{ item.label }}
          </button>
        </div>

        <div v-loading="outputDrawerLoading" class="sf-output-drawer-body">
          <div v-if="outputDrawerView === 'input' && outputDrawerDiff" class="sf-output-drawer-input-modes">
            <button type="button" :class="{ active: outputDrawerInputMode === 'result' }" @click="selectOutputDrawerInputMode('result')">处理结果</button>
            <button type="button" :class="{ active: outputDrawerInputMode === 'raw' }" @click="selectOutputDrawerInputMode('raw')">原始输入</button>
            <button type="button" :class="{ active: outputDrawerInputMode === 'diff' }" @click="selectOutputDrawerInputMode('diff')">变更对比</button>
          </div>
          <DiffViewer v-if="outputDrawerView === 'input' && outputDrawerInputMode === 'diff' && outputDrawerDiff" :before="outputDrawerDiff.before" :after="outputDrawerDiff.after" />
          <div v-else-if="outputDrawerView === 'input' && outputDrawerInputText" class="sf-output-drawer-preview markdown-body" v-html="renderedOutputInput" />
          <div v-else-if="outputDrawerView === 'input' && !outputDrawerLoading" class="sf-output-drawer-empty">该输入暂无独立文本（可能是音视频或旧记录）。</div>
          <div v-else-if="outputDrawerView === 'output' && outputDrawerText" class="sf-output-drawer-preview markdown-body" v-html="renderedOutput" />
          <div v-else-if="!outputDrawerLoading" class="sf-output-drawer-empty">该节点本次运行没有文本输出。</div>
        </div>

        <div class="sf-output-drawer-actions">
          <el-button size="small" plain :disabled="!outputDrawerActiveText" @click="copyNodeOutput">
            <Copy :size="13" />
            <span>复制</span>
          </el-button>
          <el-button size="small" plain :disabled="!outputDrawerActiveText" @click="downloadNodeOutput">
            <Download :size="13" />
            <span>下载</span>
          </el-button>
        </div>
      </template>
    </el-drawer>

    <SourcePickerDialog v-model:open="biliPickerVisible" @confirm="onBiliPickerConfirm" />
  </div>
</template>

<style scoped>
.sf-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas);
}

.sf-editor-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.sf-editor-bar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sf-editor-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.sf-btn {
  gap: 6px;
}

.sf-icon-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-icon-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-project-name-input {
  width: 240px;
}

.sf-save-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-editor-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

.sf-mobile-hint {
  display: none;
}

@media (max-width: 1024px) {
  .sf-mobile-hint {
    display: block;
    position: absolute;
    left: 50%;
    top: 60px;
    transform: translateX(-50%);
    z-index: var(--z-popover);
    padding: 8px 14px;
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-warning);
    font-size: 12px;
    pointer-events: none;
  }

  .sf-editor-main > :deep(.sf-palette) {
    display: none;
  }
}

.sf-editor-loading {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.sf-editor-console {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.sf-console-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-border-strong);
  flex-shrink: 0;
}

.sf-console-dot.running {
  background: var(--color-brand);
  animation: sf-console-pulse 1.2s var(--ease-out) infinite alternate;
}

@keyframes sf-console-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}

.sf-console-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sf-output-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border);
}

.sf-output-drawer-head-main {
  min-width: 0;
}

.sf-output-drawer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-output-drawer-meta {
  margin-top: 3px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-output-drawer-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 20px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.sf-output-drawer-tabs button {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.sf-output-drawer-tabs button:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-output-drawer-tabs button.active {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.sf-output-drawer-input-modes {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.sf-output-drawer-input-modes button {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.sf-output-drawer-input-modes button.active {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.sf-output-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
}

.sf-output-drawer-preview {
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-text);
  word-break: break-word;
}

.sf-output-drawer-empty {
  padding: 32px 16px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  font-size: 12.5px;
  text-align: center;
}

.sf-output-drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--color-border);
}
</style>

<style>
/* 下拉菜单 Teleport 到 body，样式必须全局 */
.sf-dropdown-danger {
  color: var(--color-error);
}

/* 节点输出抽屉：Element Plus Drawer 内容挂到 body，内部布局需要全局样式 */
.sf-output-drawer .el-drawer__body {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
</style>
