<script setup lang="ts">
import { markRaw, onBeforeUnmount, onMounted, ref } from "vue";
import {
  addEdge,
  applyEdgeChanges,
  VueFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeMouseEvent,
  type ViewportTransform,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import { NODE_CARD_WIDTH, NODE_PORTS, canConnectSpecs, nextEdgeId, nextNodeId, type BiliSourceItem, type NodeType, type PortSpec, type ResultDelta, type RunNodeResult, type WorkflowGraph } from "@scribe-flow/shared";
import ScribeNode from "./ScribeNode.vue";
import FlowEdge from "./FlowEdge.vue";
import {
  cloneGraph,
  emptyNodeData,
  SCRIBE_EDGE_TYPE,
  SCRIBE_NODE_TYPE,
  toBusinessGraph,
  toFlowEdges,
  toFlowNodes,
  type ScribeFlowEdge,
  type ScribeFlowNode,
  type ScribeNodeData,
} from "@/utils/flow";

const props = defineProps<{ initialGraph: WorkflowGraph; running?: boolean }>();
const emit = defineEmits<{
  "update:graph": [graph: WorkflowGraph];
  select: [nodeId: string | null];
  notice: [message: string];
  "history-change": [state: { canUndo: boolean; canRedo: boolean }];
  "run-request": [request: { scope: "all" | "fromNode" | "node"; nodeId?: string }];
  "view-output": [nodeId: string];
}>();

const nodesRef = ref<ScribeFlowNode[]>([]);
const edgesRef = ref<ScribeFlowEdge[]>([]);
const viewportRef = ref<ViewportTransform>({ x: 0, y: 0, zoom: 1 });

const history = ref<WorkflowGraph[]>([]);
const historyIndex = ref(-1);

const flowRef = ref<{
  screenToFlowCoordinate: (p: { x: number; y: number }) => { x: number; y: number };
  fitView: (o?: Record<string, unknown>) => void;
  setViewport: (transform: ViewportTransform) => Promise<boolean>;
  setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => Promise<boolean>;
} | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

const nodeTypes = { [SCRIBE_NODE_TYPE]: markRaw(ScribeNode) };
const edgeTypes = { [SCRIBE_EDGE_TYPE]: markRaw(FlowEdge) };

function snapshot(): WorkflowGraph {
  return toBusinessGraph(nodesRef.value, edgesRef.value, viewportRef.value);
}

function snapshotNow(): WorkflowGraph {
  return cloneGraph(snapshot());
}

function pushHistory() {
  const next = history.value.slice(0, historyIndex.value + 1);
  next.push(snapshotNow());
  if (next.length > 50) next.shift();
  history.value = next;
  historyIndex.value = next.length - 1;
  emitHistory();
}

function emitHistory() {
  emit("history-change", { canUndo: historyIndex.value > 0, canRedo: historyIndex.value < history.value.length - 1 });
}

function emitGraph() {
  emit("update:graph", snapshot());
}

function ctxFor(nodeId: string) {
  return {
    duplicate: () => duplicateNodes([nodeId]),
    remove: () => removeNodes([nodeId]),
    runNode: () => emit("run-request", { scope: "node", nodeId }),
    runFromNode: () => emit("run-request", { scope: "fromNode", nodeId }),
    running: props.running,
    copyOutput: () => emit("notice", "节点输出将在运行后可用"),
    viewOutput: () => emit("view-output", nodeId),
    updateData: (patch: Record<string, unknown>) => updateNodeData(nodeId, patch),
    commit: () => commitHistory(),
    addSourceVideos: (videos: import("@scribe-flow/shared").SourceVideoItem[]) => addSourceVideos(nodeId, videos),
  };
}

function applyGraph(graph: WorkflowGraph) {
  nodesRef.value = toFlowNodes(graph, ctxFor);
  edgesRef.value = toFlowEdges(graph);
  viewportRef.value = { x: graph.viewport.x, y: graph.viewport.y, zoom: graph.viewport.zoom };
  flowRef.value?.setViewport({ x: graph.viewport.x, y: graph.viewport.y, zoom: graph.viewport.zoom });
}

function initFromGraph(graph: WorkflowGraph) {
  applyGraph(graph);
  history.value = [cloneGraph(graph)];
  historyIndex.value = 0;
  emitHistory();
}

onMounted(() => {
  initFromGraph(props.initialGraph);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

// ---------- Vue Flow 事件 ----------

// Vue Flow 的 applyNodeChanges 依赖内部节点上的 computedPosition 才会更新 position；
// 我们的受控节点是纯业务节点，需要自己把 position/select/remove/add 同步回 nodesRef。
function applyScribeNodeChanges(changes: NodeChange[], nodes: ScribeFlowNode[]): ScribeFlowNode[] {
  const removedIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
  const idChanges = changes.filter((change): change is NodeChange & { id: string } => "id" in change);
  let next = nodes
    .filter((node) => !removedIds.has(node.id))
    .map((node) => {
      const change = idChanges.find((c) => c.id === node.id);
      if (!change) return node;
      if (change.type === "position" && change.position) {
        return { ...node, position: { ...change.position } };
      }
      if (change.type === "select") {
        return { ...node, selected: change.selected };
      }
      return node;
    });

  for (const change of changes) {
    if (change.type === "add" && change.item) {
      const item = change.item as unknown as ScribeFlowNode;
      if (!next.some((node) => node.id === item.id)) {
        next = [...next, item];
      }
    }
  }
  return next;
}

function onNodesChange(changes: NodeChange[]) {
  nodesRef.value = applyScribeNodeChanges(changes, nodesRef.value);
  emitGraph();
  syncSelection();
}

function onEdgesChange(changes: EdgeChange[]) {
  edgesRef.value = applyEdgeChanges(changes, edgesRef.value as never) as unknown as ScribeFlowEdge[];
  emitGraph();
}

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return;
  const duplicate = edgesRef.value.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      edge.sourceHandle === connection.sourceHandle &&
      edge.targetHandle === connection.targetHandle,
  );
  if (duplicate) return;

  const edge: ScribeFlowEdge = {
    id: nextEdgeId(),
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
    type: SCRIBE_EDGE_TYPE,
  };
  edgesRef.value = addEdge(edge, edgesRef.value as never) as unknown as ScribeFlowEdge[];
  pushHistory();
  emitGraph();
}

function validateConnection(connection: Connection): boolean {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  const sourceNode = nodesRef.value.find((n) => n.id === connection.source);
  const targetNode = nodesRef.value.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;
  const from: PortSpec | undefined = NODE_PORTS[sourceNode.data.nodeType]?.outputs.find((p) => p.id === connection.sourceHandle);
  const to: PortSpec | undefined = NODE_PORTS[targetNode.data.nodeType]?.inputs.find((p) => p.id === connection.targetHandle);
  if (!from || !to) return false;
  return canConnectSpecs(from, to);
}

function onNodeClick(event: NodeMouseEvent) {
  emit("select", event.node.id);
}

function onPaneClick() {
  emit("select", null);
}

function onNodeDragStop() {
  pushHistory();
  emitGraph();
}

function onViewportChange(viewport: ViewportTransform) {
  viewportRef.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  emitGraph();
}

function syncSelection() {
  const selected = nodesRef.value.filter((node) => node.selected).map((node) => node.id);
  if (selected.length === 1) emit("select", selected[0]);
  else if (selected.length === 0) emit("select", null);
}

// ---------- 节点操作 ----------

function makeNode(type: NodeType, position: { x: number; y: number }): ScribeFlowNode {
  const data: ScribeFlowNode["data"] = {
    ...(emptyNodeData(type) as Record<string, unknown>),
    nodeType: type,
    ctx: ctxFor(""),
  } as ScribeFlowNode["data"];
  return {
    id: nextNodeId("n"),
    type: SCRIBE_NODE_TYPE,
    position,
    selected: false,
    data,
  };
}

function centerPosition(): { x: number; y: number } {
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect || !flowRef.value) return { x: 0, y: 0 };
  return flowRef.value.screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
}

function addNodeAt(type: NodeType, position?: { x: number; y: number }) {
  if (nodesRef.value.length >= 200) {
    emit("notice", "节点数量已达 200 上限，请拆分工程");
    return;
  }
  const node = makeNode(type, position ?? centerPosition());
  // ctx 需要绑定最终 id
  node.data.ctx = ctxFor(node.id);
  nodesRef.value = [...nodesRef.value, node];
  pushHistory();
  emitGraph();
  emit("select", node.id);
}

function addNodeAtCenter(type: NodeType) {
  addNodeAt(type, centerPosition());
}

function duplicateNodes(ids: string[]) {
  const sources = nodesRef.value.filter((node) => ids.includes(node.id));
  if (sources.length === 0) return;
  const created: ScribeFlowNode[] = sources.map((node, index) => {
    const id = nextNodeId("n");
    const clone: ScribeFlowNode = {
      ...node,
      id,
      position: { x: node.position.x + 24 + index * 12, y: node.position.y + 24 + index * 12 },
      selected: false,
      data: { ...node.data, ctx: ctxFor(id) },
    };
    return clone;
  });
  nodesRef.value = [...nodesRef.value, ...created];
  pushHistory();
  emitGraph();
}

function removeNodes(ids: string[]) {
  if (ids.length === 0) return;
  nodesRef.value = nodesRef.value.filter((node) => !ids.includes(node.id));
  edgesRef.value = edgesRef.value.filter((edge) => !ids.includes(edge.source) && !ids.includes(edge.target));
  pushHistory();
  emitGraph();
  emit("select", null);
}

function selectedNodeIds(): string[] {
  return nodesRef.value.filter((node) => node.selected).map((node) => node.id);
}

function deleteSelection() {
  const nodeIds = selectedNodeIds();
  const edgeIds = edgesRef.value.filter((edge) => edge.selected).map((edge) => edge.id);
  if (nodeIds.length === 0 && edgeIds.length === 0) return;

  nodesRef.value = nodesRef.value.filter((node) => !nodeIds.includes(node.id));
  edgesRef.value = edgesRef.value.filter(
    (edge) => !edgeIds.includes(edge.id) && !nodeIds.includes(edge.source) && !nodeIds.includes(edge.target),
  );
  pushHistory();
  emitGraph();
  emit("select", null);
}

function duplicateSelection() {
  duplicateNodes(selectedNodeIds());
}

function updateNodeData(id: string, patch: Record<string, unknown>) {
  nodesRef.value = nodesRef.value.map((node) =>
    node.id === id
      ? { ...node, data: { ...node.data, ...patch, nodeType: node.data.nodeType, ctx: node.data.ctx } as ScribeNodeData }
      : node,
  );
  emitGraph();
}

function commitHistory() {
  pushHistory();
}

function sourcePatchFor(video: import("@scribe-flow/shared").SourceVideoItem): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    url: `https://www.bilibili.com/video/${video.bvid}`,
    bvid: video.bvid,
    title: video.title,
    cover: video.cover,
    uploader: video.uploader,
    duration: video.duration,
  };
  const firstPage = video.pages?.find((p) => p.cid) ?? video.pages?.[0];
  if (firstPage?.cid) {
    patch.pageInfo = firstPage;
  } else if (video.cid) {
    patch.pageInfo = { cid: video.cid, page: 1, part: "", duration: video.duration };
  }
  return patch;
}

function sourceItemFor(video: import("@scribe-flow/shared").SourceVideoItem): BiliSourceItem {
  const page = video.pages?.find((p) => p.cid) ?? video.pages?.[0] ?? (video.cid ? { cid: video.cid, page: 1, part: "", duration: video.duration } : undefined);
  return {
    bvid: video.bvid,
    cid: page?.cid ?? 0,
    page: page?.page ?? 1,
    part: page?.part ?? "",
    title: video.title,
    cover: video.cover,
    uploader: video.uploader,
    duration: page?.duration ?? video.duration,
  };
}

function sourceItemsFor(videos: import("@scribe-flow/shared").SourceVideoItem[]): BiliSourceItem[] {
  return videos.map(sourceItemFor);
}

function multiSourcePatch(items: BiliSourceItem[], label = "B站多选"): Record<string, unknown> {
  const first = items[0];
  return {
    label,
    items,
    url: `https://www.bilibili.com/video/${first.bvid}`,
    bvid: first.bvid,
    title: first.title,
    cover: first.cover,
    uploader: first.uploader,
    duration: first.duration,
    pageInfo: { cid: first.cid, page: first.page, part: first.part, duration: first.duration ?? 0 },
  };
}

/**
 * 多选合并：把多个 B 站视频/分P 写入当前节点，生成一张“多选卡片”。
 * 后续运行逻辑仍按每个 item 逐个产出音频，等价于多张独立来源卡片。
 */
function addSourceVideos(nodeId: string, videos: import("@scribe-flow/shared").SourceVideoItem[]) {
  if (videos.length === 0) return;
  const target = nodesRef.value.find((node) => node.id === nodeId);
  if (!target) return;

  const items = sourceItemsFor(videos);
  updateNodeData(nodeId, multiSourcePatch(items));
  pushHistory();
  emitGraph();
  emit("select", nodeId);
}

/** 从“B站收藏”来源入口：单选生成普通 B 站链接节点，多选合并为一张多选卡片。 */
function addBiliVideos(videos: import("@scribe-flow/shared").SourceVideoItem[]) {
  if (videos.length === 0) return;
  if (nodesRef.value.length >= 200) {
    emit("notice", "节点数量已达 200 上限，请拆分工程");
    return;
  }
  const base = centerPosition();
  const node = makeNode("source.bili", { x: base.x, y: base.y });
  const patch = videos.length === 1 ? sourcePatchFor(videos[0]) : multiSourcePatch(sourceItemsFor(videos), "B站收藏");
  node.data = { ...node.data, ...patch, ctx: ctxFor(node.id) } as ScribeFlowNode["data"];
  nodesRef.value = [...nodesRef.value, node];
  pushHistory();
  emitGraph();
  emit("select", node.id);
}

// ---------- 撤销 / 重做 ----------

function undo() {
  if (historyIndex.value <= 0) return;
  historyIndex.value -= 1;
  applyHistory();
}

function redo() {
  if (historyIndex.value >= history.value.length - 1) return;
  historyIndex.value += 1;
  applyHistory();
}

function applyHistory() {
  const graph = history.value[historyIndex.value];
  if (!graph) return;
  applyGraph(graph);
  emitGraph();
  emitHistory();
}

// ---------- 键盘 ----------

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;

  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (mod && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && key === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (mod && key === "d") {
    event.preventDefault();
    duplicateSelection();
    return;
  }
  if (key === "delete" || key === "backspace") {
    deleteSelection();
  }
}

// ---------- 拖入 ----------

function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData("application/scribe-node") as NodeType | "";
  if (!type) return;
  event.preventDefault();
  const position = flowRef.value?.screenToFlowCoordinate({ x: event.clientX, y: event.clientY }) ?? centerPosition();
  addNodeAt(type, position);
}

// ---------- 布局 ----------

async function autoLayout() {
  const children = nodesRef.value.map((node) => ({ id: node.id, width: NODE_CARD_WIDTH[node.data.nodeType] ?? 224, height: 120 }));
  const edges = edgesRef.value.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }));
  try {
    const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
    const elk = new ELK();
    const layout = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "40",
        "elk.layered.spacing.nodeNodeBetweenLayers": "140",
      },
      children,
      edges,
    });
    const positions = new Map((layout.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]));
    nodesRef.value = nodesRef.value.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    });
    pushHistory();
    emitGraph();
    flowRef.value?.fitView({ padding: 0.15 });
  } catch (error) {
    emit("notice", `自动布局失败：${String(error)}`);
  }
}

function fitView() {
  flowRef.value?.fitView({ padding: 0.15 });
}

/** 从结果页返回时定位并选中指定节点。 */
function focusNode(nodeId: string) {
  const node = nodesRef.value.find((n) => n.id === nodeId);
  if (!node) return;
  nodesRef.value = nodesRef.value.map((n) => ({ ...n, selected: n.id === nodeId }));
  void flowRef.value?.setCenter(node.position.x + 100, node.position.y + 60, { zoom: 1.2, duration: 300 });
}

/** 计算一次运行中会真正被执行的节点；不在范围内的节点应保留上次状态，避免局部运行时被误清空。 */
function runScopeNodeIds(scope: "all" | "fromNode" | "node", nodeId?: string): Set<string> {
  const all = new Set(nodesRef.value.map((n) => n.id));
  if (scope === "node" && nodeId) return new Set([nodeId]);
  if (scope === "fromNode" && nodeId) {
    const result = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edgesRef.value) {
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

/** 运行事件驱动节点状态；不触发自动保存（运行态不进 graph 快照）。 */
function applyRunEvent(event: import("@scribe-flow/shared").RunEvent) {
  if (event.type === "run.started") {
    const resetIds = runScopeNodeIds(event.run.scope, event.run.nodeId);
    nodesRef.value = nodesRef.value.map((node) => {
      if (!resetIds.has(node.id)) return node;
      return { ...node, data: { ...node.data, status: "idle", summary: undefined, preview: undefined, delta: undefined } };
    });
    return;
  }
  if (!("nodeId" in event)) return;
  const patch: Record<string, unknown> = {};
  if (event.type === "node.started") patch.status = "running";
  else if (event.type === "node.progress") {
    patch.status = "running";
    patch.summary = `${event.message} ${event.progress}%`;
  } else if (event.type === "node.retry") {
    patch.status = "running";
    patch.summary = `重试 ${event.attempt}/${event.maxRetries}…`;
  } else if (event.type === "node.skipped") {
    patch.status = "skipped";
    patch.summary = event.reason;
  } else if (event.type === "node.done") {
    const target = nodesRef.value.find((n) => n.id === event.nodeId);
    patch.status = "done";
    patch.summary = event.summary;
    patch.delta = event.delta;
    if (target && target.data.nodeType !== "process.output" && target.data.nodeType !== "process.mindmap") {
      patch.preview = event.preview;
    } else {
      patch.preview = undefined;
    }
  } else if (event.type === "node.error") {
    patch.status = "error";
    patch.summary = event.error;
    patch.delta = undefined;
  }
  nodesRef.value = nodesRef.value.map((node) =>
    node.id === event.nodeId ? { ...node, data: { ...node.data, ...patch } as ScribeNodeData } : node,
  );
}

/** 生成选中节点展开用的结构化摘要：保留 Markdown 换行/标题，截取前几段而不是拍平成一行。 */
function previewText(text: string): string | undefined {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return undefined;
  return clean.slice(0, 320) || undefined;
}

function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 运行快照恢复时按“直接上游文本”计算差异徽标，刷新后也能显示。 */
function snapshotDelta(result: RunNodeResult, byId: Map<string, RunNodeResult>): ResultDelta | undefined {
  if (result.status !== "done" || !result.output?.text) return undefined;
  const currentText = result.output.text;
  const upstreamTexts = edgesRef.value
    .filter((edge) => edge.target === result.nodeId)
    .map((edge) => byId.get(edge.source)?.output?.text)
    .filter((text): text is string => Boolean(text?.trim()))
    .map((text) => text.trim());
  if (upstreamTexts.length === 0) return { label: "新生成", tone: "new" };
  const upstreamText = upstreamTexts.join("\n\n");
  if (upstreamText.trim() === currentText.trim()) return { label: "与上游一致", tone: "same" };
  const diff = countChars(currentText) - countChars(upstreamText);
  if (diff === 0) return { label: "较上游内容变化", tone: "changed" };
  return { label: `较上游 ${diff > 0 ? "+" : ""}${diff} 字`, tone: diff > 0 ? "up" : "down" };
}

/** 重新进入画布时用运行快照恢复节点状态（不触发自动保存）。 */
function applyRunSnapshot(nodeResults: RunNodeResult[]) {
  const byId = new Map(nodeResults.map((n) => [n.nodeId, n]));
  nodesRef.value = nodesRef.value.map((node) => {
    const result = byId.get(node.id);
    if (!result) return node;
    const patch: Record<string, unknown> = {};
    const status =
      result.status === "running"
        ? "running"
        : result.status === "done"
          ? "done"
          : result.status === "error"
            ? "error"
            : result.status === "skipped"
              ? "skipped"
              : result.status === "cancelled"
                ? "cancelled"
                : "idle";
    patch.status = status;
    if (result.summary) patch.summary = result.summary;
    if (result.error) patch.summary = result.error;
    patch.delta = status === "done" ? snapshotDelta(result, byId) : undefined;
    if (result.nodeType === "process.mindmap" || result.nodeType === "process.output") {
      patch.preview = undefined;
    } else if (result.output?.text && (result.output.kind === "text" || result.output.kind === "noteBlock" || result.output.kind === "noteDoc")) {
      const preview = previewText(result.output.text);
      if (preview) patch.preview = preview;
    }
    return { ...node, data: { ...node.data, ...patch } as ScribeNodeData };
  });
}

defineExpose({
  addNodeAtCenter,
  addBiliVideos,
  updateNodeData,
  commitHistory,
  duplicateSelection,
  deleteSelection,
  undo,
  redo,
  canUndo: () => historyIndex.value > 0,
  canRedo: () => historyIndex.value < history.value.length - 1,
  fitView,
  autoLayout,
  focusNode,
  applyRunEvent,
  applyRunSnapshot,
});
</script>

<template>
  <div ref="containerRef" class="sf-flow-canvas" @drop.prevent="onDrop" @dragover.prevent>
    <VueFlow
      ref="flowRef"
      :nodes="nodesRef"
      :edges="edgesRef"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :default-viewport="viewportRef"
      :min-zoom="0.25"
      :max-zoom="4"
      :delete-key-code="null"
      :zoom-on-double-click="false"
      :snap-to-grid="true"
      :snap-grid="[8, 8]"
      multi-selection-key-code="Shift"
      :is-valid-connection="validateConnection"
      :fit-view-on-init="true"
      @nodes-change="onNodesChange"
      @edges-change="onEdgesChange"
      @connect="onConnect"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
      @node-drag-stop="onNodeDragStop"
      @viewport-change="onViewportChange"
    >
      <Background :gap="12" :size="2" pattern-color="var(--canvas-dot-color)" />
      <Controls position="bottom-left" />
      <MiniMap position="bottom-right" :pannable="true" :zoomable="true" />
    </VueFlow>
  </div>
</template>

<style scoped>
.sf-flow-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: var(--color-canvas);
}
</style>
