<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessageBox } from "element-plus";
import { toast } from "@/lib/toast";
import { Activity, Check, Copy, Download, History, LayoutPanelTop, Maximize, MoreHorizontal, Play, Redo2, StopCircle, Trash2, Undo2 } from "lucide-vue-next";
import { emptyGraph, type NodeType, type RunDetail, type RunMeta, type RunNodeResult, type SourceVideoItem, type WorkflowGraph } from "@scribe-flow/shared";
import FlowCanvas from "@/components/canvas/FlowCanvas.vue";
import SourcePickerDialog from "@/components/canvas/SourcePickerDialog.vue";
import BiliAccountButton from "@/components/auth/BiliAccountButton.vue";
import { api } from "@/lib/api";
import { subscribeRunEvents } from "@/lib/sse";
import type { NodePreviewOutput } from "@/utils/flow";
import { buildNodeSegments, type RunSegment } from "@/utils/run-segments";
import { useAuthStore } from "@/stores/auth";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

type SaveState = "loading" | "saved" | "saving" | "error";

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();
const runsStore = useRunsStore();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();
const uiStore = useUiStore();

const projectId = computed(() => String(route.params.id));
/** 顶部栏工程名跟随工程列表/store.current 响应式更新，左侧栏重命名后立即同步。 */
const projectName = computed(() => {
  const item = store.list.find((p) => p.id === projectId.value);
  if (item) return item.name;
  return store.current?.id === projectId.value ? store.current.name : "";
});
const graph = ref<WorkflowGraph>(emptyGraph());
const loaded = ref(false);
const suppressRunWatch = ref(false);
const saveState = ref<SaveState>("loading");
const historyState = ref({ canUndo: false, canRedo: false });
const flowCanvasRef = ref<InstanceType<typeof FlowCanvas> | null>(null);
const selectedNodeId = ref<string | null>(null);
const activeRun = ref<RunMeta | null>(null);
const lastRun = ref<RunMeta | null>(null);
const running = ref(false);
const projectRunningRun = computed(() => runsStore.runs.find((r) => r.projectId === projectId.value && r.status === "running") ?? null);
/** 当前工程有运行进行中：画布进入只读，避免编辑无法影响本次运行的节点造成歧义。 */
const canvasRunning = computed(() => running.value || Boolean(projectRunningRun.value));
const activeTaskCount = computed(() => {
  const localActive = running.value && activeRun.value && !runsStore.runs.some((r) => r.id === activeRun.value?.id && r.status === "running") ? 1 : 0;
  return runsStore.runningCount + localActive;
});
const biliPickerVisible = ref(false);

/**
 * 节点最近一次输出的解析缓存。
 * 悬停预览会高频触发，不能每次都在 runs 列表上逐条拉详情；
 * 每次开始/结束/恢复运行时清空，避免返回旧运行的内容。
 */
interface CachedNodeOutputMeta {
  run: RunMeta;
  nodeResult: RunNodeResult;
  /** 该节点产出被拆成的分段（一个输入一份结果时才有），供预览浮层直接切换。 */
  segments: RunSegment[];
}
const nodeOutputMetaCache = new Map<string, CachedNodeOutputMeta | null>();
const nodeOutputTextCache = new Map<string, string>();

function clearNodeOutputCache() {
  nodeOutputMetaCache.clear();
  nodeOutputTextCache.clear();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let stopRunEvents: (() => void) | null = null;
let pendingRunSnapshot: RunNodeResult[] | null = null;
let disposed = false;
let subscribedRunId: string | null = null;
let restoredLastRunId: string | null = null;
let loadProjectToken = 0;

async function loadProject() {
  const id = projectId.value;
  const token = ++loadProjectToken;
  suppressRunWatch.value = true;

  // 工程间切换：保留现有壳与画布实例，先停掉上一个工程的运行订阅/浮层状态，避免残留闪烁。
  if (loaded.value) {
    stopRunEvents?.();
    stopRunEvents = null;
    subscribedRunId = null;
    running.value = false;
    activeRun.value = null;
    lastRun.value = null;
    restoredLastRunId = null;
    selectedNodeId.value = null;
  } else {
    saveState.value = "loading";
  }

  try {
    const project = await store.getProject(id);
    if (disposed || token !== loadProjectToken || projectId.value !== id) return;
    const nextGraph = {
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
    graph.value = nextGraph;
    lastSavedNodeCount = nextGraph.nodes.length;
    guardProjectId = id;
    saveState.value = "saved";
    loaded.value = true;
    await nextTick();
    if (flowCanvasRef.value) flowCanvasRef.value.loadGraph(nextGraph);
  } catch (err) {
    if (disposed || token !== loadProjectToken) return;
    saveState.value = "error";
    loaded.value = true;
    toast.error(err instanceof Error ? err.message : "加载工程失败");
  }

  if (disposed || token !== loadProjectToken) return;

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

  suppressRunWatch.value = false;
  if (projectRunningRun.value) void resumeRun(projectRunningRun.value);
  else void restoreLastRun();
}

onMounted(() => {
  void (async () => {
    await runsStore.load();
    await settingsStore.load();
    await loadProject();
  })();
});

onBeforeUnmount(() => {
  disposed = true;
  if (saveTimer) clearTimeout(saveTimer);
  stopRunEvents?.();
  stopRunEvents = null;
  subscribedRunId = null;
});

watch(
  () => route.params.id,
  () => {
    suppressRunWatch.value = true;
  },
  { flush: "sync" },
);

watch(
  () => route.params.id,
  (id, oldId) => {
    if (id && id !== oldId) void loadProject();
  },
);

watch(
  projectRunningRun,
  (run) => {
    if (suppressRunWatch.value) return;
    if (run) {
      if (activeRun.value?.id !== run.id) void resumeRun(run);
    } else {
      if (running.value && activeRun.value) void reconcileActiveRun();
      else void restoreLastRun();
    }
  },
  { immediate: true },
);

/** 单面板节点库（点击添加）经 ui store 总线转到这里执行。 */
watch(
  () => uiStore.nodeAddRequest,
  (request) => {
    if (request) onPaletteAdd(request.type as NodeType | "source.biliCollection");
  },
);

function onPaletteAdd(type: NodeType | "source.biliCollection") {
  if (canvasRunning.value) {
    toast.info("工程运行中，画布为只读状态，暂不能添加节点");
    return;
  }
  if (type === "source.biliCollection") {
    if (!authStore.loggedIn) {
      toast.info("请先点击右上角 B 站头像扫码登录");
      return;
    }
    biliPickerVisible.value = true;
    return;
  }
  if (!flowCanvasRef.value) {
    toast.info("画布还在加载，请稍后再添加节点");
    return;
  }
  flowCanvasRef.value?.addNodeAtCenter(type);
}

function onBiliPickerConfirm(videos: SourceVideoItem[]) {
  if (canvasRunning.value) {
    toast.info("工程运行中，画布为只读状态，暂不能添加节点");
    return;
  }
  if (videos.length > 0) {
    flowCanvasRef.value?.addBiliVideos(videos);
    toast.success(videos.length > 1 ? `已添加 1 张多选卡片（${videos.length} 个视频）` : "已添加 1 个视频来源");
  }
}

function onGraphUpdate(next: WorkflowGraph) {
  graph.value = next;
  scheduleSave();
}

/**
 * 防误清空护栏：最近一次成功落盘的节点数。
 * 画布被清空（误触删除、全选删除、渲染异常）时，防抖自动保存会把空 nodes 写回服务端，
 * 覆盖掉唯一一份工程图——刷新后节点就永久消失（2026-09-10 实际发生过一次）。
 * 因此写成空画布前先让用户确认：取消则本次不落盘、服务端保留上一版非空图（刷新即可恢复）。
 */
let lastSavedNodeCount = 0;
let guardProjectId = "";
let emptyGraphConfirming = false;

function scheduleSave() {
  saveState.value = "saving";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (graph.value.nodes.length === 0 && lastSavedNodeCount > 0 && guardProjectId === projectId.value) {
      if (emptyGraphConfirming) return;
      emptyGraphConfirming = true;
      try {
        await ElMessageBox.confirm("画布已没有任何节点，确定要清空这个工程的画布并保存吗？", "清空画布确认", {
          confirmButtonText: "清空并保存",
          cancelButtonText: "取消",
          type: "warning",
          confirmButtonClass: "el-button--danger",
        });
      } catch {
        saveState.value = "saved";
        toast.warning("已取消：空画布未保存，刷新页面即可恢复上一版画布。");
        return;
      } finally {
        emptyGraphConfirming = false;
      }
      if (disposed || !loaded.value) return;
    }
    try {
      await store.saveGraph(projectId.value, graph.value);
      lastSavedNodeCount = graph.value.nodes.length;
      saveState.value = "saved";
    } catch (err) {
      saveState.value = "error";
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  }, 500);
}

async function duplicateProject() {
  try {
    const created = await store.duplicateProject(projectId.value);
    toast.success(`已创建副本「${created.name}」`);
    await router.push(`/project/${created.id}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "复制工程失败");
  }
}

async function exportProject() {
  try {
    await store.exportProject(projectId.value, projectName.value);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "导出工程失败");
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
      toast.info("清空运行记录将在 M4 接入");
      break;
    case "force-stop":
      void forceStopRun();
      break;
  }
}

/** 重新进入工程页时，若服务端仍有 running 运行，恢复画布进度并重新订阅 SSE。 */
async function resumeRun(run: RunMeta) {
  if (activeRun.value?.id === run.id && (stopRunEvents || subscribedRunId === run.id)) return;
  stopRunEvents?.();
  subscribedRunId = null;
  clearNodeOutputCache();
  activeRun.value = run;
  running.value = true;
  try {
    const detail = await api.get<RunDetail>(`/api/runs/${run.id}`);
    if (disposed) return;
    if (detail.status !== "running") {
      running.value = false;
      runsStore.upsert({ ...run, status: detail.status });
      activeRun.value = null;
      const snapshot = await mergedNodeResults(detail);
      flowCanvasRef.value?.applyRunSnapshot(snapshot);
      void runsStore.load();
      return;
    }
    const snapshot = await mergedNodeResults(detail);
    pendingRunSnapshot = snapshot;
    if (flowCanvasRef.value) {
      flowCanvasRef.value.applyRunSnapshot(snapshot);
      pendingRunSnapshot = null;
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "恢复运行状态失败");
  }
  if (disposed) return;

  stopRunEvents = subscribeRunEvents(run.id, (event) => {
    // run.started 在 startRun/resumeRun 中已提前应用过，避免重复清空/打断正在恢复的运行状态。
    if (event.type !== "run.started") flowCanvasRef.value?.applyRunEvent(event);
    if (event.type === "node.error") {
      toast.error(`${nodeName(event.nodeId)} 失败：${event.error}`);
    } else if (event.type === "run.done") {
      running.value = false;
      activeRun.value = { ...(activeRun.value as RunMeta), status: event.status };
      runsStore.upsert(activeRun.value);
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
      runsStore.upsert(activeRun.value);
      stopRunEvents?.();
      stopRunEvents = null;
      subscribedRunId = null;
      clearNodeOutputCache();
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
  clearNodeOutputCache();
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
  clearNodeOutputCache();
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
  if (canvasRunning.value) {
    toast.warning("已有运行正在进行");
    return;
  }
  if (!settingsStore.settings) {
    try {
      await settingsStore.load();
    } catch {
      toast.error("设置加载失败，请先到设置页确认密钥");
      return;
    }
  }
  if (disposed) return;
  const missing = missingKeyMessage(scope, nodeId);
  if (missing) {
    toast.error(missing);
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
    toast.error(err instanceof Error ? err.message : "保存失败，请稍后重试");
    return;
  }
  clearNodeOutputCache();
  try {
    running.value = true;
    const run = await api.post<RunMeta>(`/api/projects/${projectId.value}/runs`, { scope, nodeId });
    if (disposed) return;
    activeRun.value = run;
    runsStore.upsert(run);
    toast.clear();
    if (subscribedRunId !== run.id) {
      stopRunEvents?.();
      stopRunEvents = null;
      subscribedRunId = null;
      flowCanvasRef.value?.applyRunEvent({ type: "run.started", run });
      stopRunEvents = subscribeRunEvents(run.id, (event) => {
        // 上面已手动应用过 run.started，SSE 的首个 run.started 不再重复清空节点。
        if (event.type !== "run.started") flowCanvasRef.value?.applyRunEvent(event);
        if (event.type === "node.error") {
          toast.error(`${nodeName(event.nodeId)} 失败：${event.error}`);
        } else if (event.type === "run.done") {
          running.value = false;
          activeRun.value = { ...(activeRun.value as RunMeta), status: event.status };
          runsStore.upsert(activeRun.value);
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
    toast.error(err instanceof Error ? err.message : "启动运行失败");
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
      toast.success("已发送停止指令");
    } else {
      await api.post<{ ok: boolean }>(`/api/runs/${target.id}/force-stop`);
      toast.success("已强制结束中断的运行");
      await runsStore.load();
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "停止运行失败");
  }
}

async function forceStopRun() {
  const target = activeRun.value ?? projectRunningRun.value;
  if (!target) return;
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${target.id}/force-stop`);
    toast.success("已强制结束运行");
    const cancelled = activeRun.value ? { ...activeRun.value, status: "cancelled" as const } : { ...target, status: "cancelled" as const };
    if (activeRun.value) activeRun.value = cancelled;
    runsStore.upsert(cancelled);
    running.value = false;
    await runsStore.load();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "强制结束失败");
  }
}

/**
 * 找到包含该节点输出的最近一次运行（与 viewOutput 同源，带缓存供悬停预览复用）。
 */
async function findLatestNodeOutput(nodeId: string): Promise<CachedNodeOutputMeta | null> {
  if (nodeOutputMetaCache.has(nodeId)) return nodeOutputMetaCache.get(nodeId) ?? null;
  const data = await api.get<{ items: RunMeta[] }>(`/api/runs?projectId=${encodeURIComponent(projectId.value)}&limit=20`);
  const runs = data.items ?? [];
  for (const run of runs) {
    const detail = await api.get<RunDetail>(`/api/runs/${run.id}`);
    const nodeResult = detail.nodeResults.find((node) => node.nodeId === nodeId);
    if (nodeResult) {
      // 一个输入一份结果时（如 8 个视频经同一个转写节点），预览浮层按分段切换而不是首尾相接。
      const resultMap = new Map(detail.nodeResults.map((node) => [node.nodeId, node]));
      const meta: CachedNodeOutputMeta = {
        run,
        nodeResult,
        segments: buildNodeSegments(nodeId, detail.inputs ?? [], resultMap, detail.graph),
      };
      nodeOutputMetaCache.set(nodeId, meta);
      return meta;
    }
  }
  nodeOutputMetaCache.set(nodeId, null);
  return null;
}

/** 读取节点输出全文：小文本内联直取，大文本走 content 接口；按 (runId, nodeId) 缓存。 */
async function readNodeOutputText(nodeResult: RunNodeResult, runId: string): Promise<string> {
  const key = `${runId}::${nodeResult.nodeId}`;
  const cached = nodeOutputTextCache.get(key);
  if (cached !== undefined) return cached;
  let text = "";
  if (nodeResult.output?.text) {
    text = nodeResult.output.text;
  } else if (nodeResult.output?.path) {
    const result = await api.get<{ text: string }>(`/api/runs/${runId}/outputs/${nodeResult.nodeId}/content`);
    text = result.text ?? "";
  }
  nodeOutputTextCache.set(key, text);
  return text;
}

/** 画布悬停预览的数据源：最近一次运行里该节点的完整文本输出 + 分段。 */
async function fetchCanvasNodeOutput(nodeId: string): Promise<NodePreviewOutput | null> {
  const found = await findLatestNodeOutput(nodeId);
  if (!found || found.nodeResult.status !== "done") return null;
  const text = await readNodeOutputText(found.nodeResult, found.run.id);
  return {
    runId: found.run.id,
    nodeLabel: found.nodeResult.nodeLabel || found.nodeResult.nodeType,
    text,
    segments: found.segments,
  };
}

async function viewOutput(nodeId: string, segmentIndex?: number) {
  try {
    const found = await findLatestNodeOutput(nodeId);
    if (!found) {
      toast.warning("没有找到包含该节点输出的运行记录，请先运行该节点");
      return;
    }
    const { run, nodeResult } = found;
    const query: Record<string, string> = { focus: nodeId };
    if (nodeResult.nodeType === "process.mindmap") query.tab = "mindmap";
    // 从浮层的某一段跳转时，结果页直接打开同一段。
    if (typeof segmentIndex === "number" && segmentIndex >= 0 && segmentIndex < found.segments.length) {
      query.seg = String(segmentIndex);
    }
    void router.push({ path: `/project/${projectId.value}/run/${run.id}`, query });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "打开结果页失败");
  }
}
</script>

<template>
  <div class="sf-editor">
    <header class="sf-editor-bar">
      <div class="sf-editor-bar-left">
        <span class="sf-project-name" :title="projectName">{{ projectName }}</span>
        <span class="sf-save-state tnum">
          <Check v-if="saveState === 'saved'" :size="12" />
          {{ saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "加载中…" }}
        </span>
      </div>

      <div class="sf-editor-bar-actions">
        <BiliAccountButton compact />
        <el-dropdown trigger="click" @command="(cmd) => onMoreCommand(String(cmd))">
          <button type="button" class="sf-icon-btn" title="更多操作">
            <MoreHorizontal :size="16" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="layout" :disabled="canvasRunning"><LayoutPanelTop :size="14" />整理画布</el-dropdown-item>
              <el-dropdown-item command="fit"><Maximize :size="14" />适应视图</el-dropdown-item>
              <el-dropdown-item command="undo" :disabled="canvasRunning || !historyState.canUndo"><Undo2 :size="14" />撤销</el-dropdown-item>
              <el-dropdown-item command="redo" :disabled="canvasRunning || !historyState.canRedo"><Redo2 :size="14" />重做</el-dropdown-item>
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
      <div class="sf-canvas-wrap">
        <div v-if="loaded" class="sf-editor-float-actions">
          <button type="button" class="sf-float-btn sf-float-run" :disabled="canvasRunning" @click="startRun('all')">
            <Play :size="13" />
            <span>运行</span>
          </button>
          <button v-if="lastRun" type="button" class="sf-float-btn sf-float-ghost" @click="router.push(`/project/${projectId}/run/${lastRun.id}`)">
            <History :size="13" />
            <span>上次结果</span>
          </button>
          <span class="sf-float-task" title="当前所有运行中的任务数">
            <Activity :size="13" />
            <span>活动任务 {{ activeTaskCount }}</span>
          </span>
          <button
            type="button"
            class="sf-float-btn sf-float-stop"
            :disabled="!running && !projectRunningRun"
            :title="running || projectRunningRun ? '停止运行' : '当前没有运行中的任务'"
            aria-label="停止运行"
            @click="stopRun"
          >
            <StopCircle :size="13" />
            <span>停止</span>
          </button>
        </div>
        <FlowCanvas
          v-if="loaded"
          ref="flowCanvasRef"
          :initial-graph="graph"
          :running="canvasRunning"
          :fetch-node-output="fetchCanvasNodeOutput"
          @update:graph="onGraphUpdate"
          @history-change="historyState = $event"
          @select="selectedNodeId = $event"
          @run-request="(req) => startRun(req.scope, req.nodeId)"
          @view-output="viewOutput"
        />
        <div v-else class="sf-editor-loading">
          <div v-if="saveState === 'error'" class="sf-editor-loading__hint">
            <span>工程加载失败</span>
          </div>
          <div v-else class="sf-editor-loading__inner" aria-label="正在加载画布">
            <div class="sf-editor-loading__bar" aria-hidden="true" />
            <div class="sf-editor-loading__hint">
              <span class="sf-editor-loading__spinner" aria-hidden="true" />
              <span>正在加载画布</span>
            </div>
          </div>
        </div>
      </div>
    </div>

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

.sf-project-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
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

.sf-canvas-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.sf-editor-float-actions {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: var(--z-dropdown);
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 6px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.sf-float-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    opacity var(--dur-1) var(--ease-out);
}

.sf-float-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sf-float-run {
  background: transparent;
  color: var(--color-text);
}

.sf-float-run:hover:not(:disabled),
.sf-float-run:active:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-float-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}

.sf-float-ghost:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-float-task {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  white-space: nowrap;
}

.sf-float-stop {
  background: transparent;
  color: var(--color-text-secondary);
}

.sf-float-stop:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
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
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sf-editor-loading__inner {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
}

.sf-editor-loading__bar {
  position: absolute;
  top: 0;
  left: 0;
  width: 34%;
  height: 2px;
  border-radius: 0 999px 999px 0;
  background: linear-gradient(90deg, transparent, var(--color-brand), transparent);
  animation: sf-loading-bar 1.2s var(--ease-out) infinite;
}

.sf-editor-loading__hint {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.sf-editor-loading__spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-text-secondary);
  animation: sf-loading-spin 0.8s linear infinite;
}

@keyframes sf-loading-bar {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(420%);
  }
}

@keyframes sf-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style>
/* 下拉菜单 Teleport 到 body，样式必须全局 */
.sf-dropdown-danger {
  color: var(--color-error);
}
</style>
