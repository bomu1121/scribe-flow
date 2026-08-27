<script setup lang="ts">
import { markRaw, onBeforeUnmount, onMounted, ref } from "vue";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
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
import { NODE_TYPE_LABELS, PORT_TYPES, canConnect, nextEdgeId, nextNodeId, type NodeType, type WorkflowGraph } from "@scribe-flow/shared";
import ScribeNode from "./ScribeNode.vue";
import FlowEdge from "./FlowEdge.vue";
import Dialog from "@/components/ui/Dialog.vue";
import Input from "@/components/ui/Input.vue";
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

const props = defineProps<{ initialGraph: WorkflowGraph }>();
const emit = defineEmits<{
  "update:graph": [graph: WorkflowGraph];
  select: [nodeId: string | null];
  notice: [message: string];
  "history-change": [state: { canUndo: boolean; canRedo: boolean }];
}>();

const nodesRef = ref<ScribeFlowNode[]>([]);
const edgesRef = ref<ScribeFlowEdge[]>([]);
const viewportRef = ref<ViewportTransform>({ x: 0, y: 0, zoom: 1 });

const history = ref<WorkflowGraph[]>([]);
const historyIndex = ref(-1);

const flowRef = ref<{ screenToFlowCoordinate: (p: { x: number; y: number }) => { x: number; y: number }; fitView: (o?: Record<string, unknown>) => void } | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const showNodeSearch = ref(false);
const searchKeyword = ref("");

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
    runNode: () => emit("notice", "运行引擎将在 M3 接入"),
    runFromNode: () => emit("notice", "运行引擎将在 M3 接入"),
    copyOutput: () => emit("notice", "节点输出将在 M3 运行后可用"),
    updateData: (patch: Record<string, unknown>) => updateNodeData(nodeId, patch),
    commit: () => commitHistory(),
  };
}

function initFromGraph(graph: WorkflowGraph) {
  nodesRef.value = toFlowNodes(graph, ctxFor);
  edgesRef.value = toFlowEdges(graph);
  viewportRef.value = { x: graph.viewport.x, y: graph.viewport.y, zoom: graph.viewport.zoom };
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

function onNodesChange(changes: NodeChange[]) {
  nodesRef.value = applyNodeChanges(changes, nodesRef.value as never) as unknown as ScribeFlowNode[];
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
  const from = connection.sourceHandle as (typeof PORT_TYPES)[number] | null;
  const to = connection.targetHandle as (typeof PORT_TYPES)[number] | null;
  if (!from || !to || !PORT_TYPES.includes(from) || !PORT_TYPES.includes(to)) return false;
  return canConnect(from, to);
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
  initFromGraph(graph);
  emitGraph();
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

// ---------- 画布空白双击搜索 ----------

const searchableTypes = Object.keys(NODE_TYPE_LABELS) as NodeType[];
const filteredTypes = ref<NodeType[]>(searchableTypes);

function onCanvasDoubleClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest(".vue-flow__node")) return;
  searchKeyword.value = "";
  filteredTypes.value = searchableTypes;
  showNodeSearch.value = true;
}

function updateSearch(value: string) {
  searchKeyword.value = value;
  const q = value.trim().toLowerCase();
  filteredTypes.value = q ? searchableTypes.filter((type) => NODE_TYPE_LABELS[type].toLowerCase().includes(q)) : searchableTypes;
}

function pickSearchType(type: NodeType) {
  showNodeSearch.value = false;
  addNodeAtCenter(type);
}

const NODE_LAYOUT_WIDTH: Record<NodeType, number> = {
  "source.bili": 380,
  "source.file": 320,
  "source.text": 340,
  "process.transcribe": 224,
  "process.refine": 224,
  "process.prompt": 320,
  "process.merge": 224,
  "process.output": 320,
};

// ---------- 布局 ----------

async function autoLayout() {
  const children = nodesRef.value.map((node) => ({ id: node.id, width: NODE_LAYOUT_WIDTH[node.data.nodeType] ?? 224, height: 120 }));
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

defineExpose({
  addNodeAtCenter,
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
});
</script>

<template>
  <div ref="containerRef" class="sf-flow-canvas" @drop.prevent="onDrop" @dragover.prevent @dblclick="onCanvasDoubleClick">
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
      <Background :gap="12" pattern-color="var(--canvas-dot-color)" />
      <Controls position="bottom-left" />
      <MiniMap position="bottom-right" :pannable="true" :zoomable="true" />
    </VueFlow>

    <Dialog v-model:open="showNodeSearch" title="添加节点" description="输入节点名过滤，回车或点击添加。" width="440px">
      <Input :model-value="searchKeyword" placeholder="搜索节点…" autofocus @update:model-value="updateSearch" />
      <div class="sf-node-search-list">
        <button v-for="type in filteredTypes" :key="type" type="button" class="sf-node-search-item" @click="pickSearchType(type)">
          {{ NODE_TYPE_LABELS[type] }}
        </button>
        <p v-if="filteredTypes.length === 0" class="sf-node-search-empty">没有匹配的节点类型</p>
      </div>
    </Dialog>
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

.sf-node-search-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 10px;
  max-height: 240px;
  overflow-y: auto;
}

.sf-node-search-item {
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.sf-node-search-item:hover {
  background: var(--color-ink-soft);
}

.sf-node-search-empty {
  margin: 0;
  padding: 12px 0;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  text-align: center;
}
</style>
