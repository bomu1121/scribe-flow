<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElMessage } from "element-plus";
import { ArrowLeft, Check, Copy, Download, LayoutPanelTop, Maximize, MoreHorizontal, Play, Redo2, StopCircle, Trash2, Undo2 } from "lucide-vue-next";
import { emptyGraph, type RunMeta, type WorkflowGraph } from "@scribe-flow/shared";
import FlowCanvas from "@/components/canvas/FlowCanvas.vue";
import NodePalette from "@/components/canvas/NodePalette.vue";
import { api } from "@/lib/api";
import { subscribeRunEvents } from "@/lib/sse";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";

type SaveState = "loading" | "saved" | "saving" | "error";

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();
const runsStore = useRunsStore();

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
const running = ref(false);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let stopRunEvents: (() => void) | null = null;

onMounted(async () => {
  void runsStore.load();
  try {
    const project = await store.getProject(projectId.value);
    projectName.value = project.name;
    description.value = project.description;
    graph.value = project.graph;
    saveState.value = "saved";
  } catch (err) {
    saveState.value = "error";
    showNotice(err instanceof Error ? err.message : "加载工程失败");
  } finally {
    loaded.value = true;
  }
});

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
  if (noticeTimer.value) clearTimeout(noticeTimer.value);
  stopRunEvents?.();
});

function showNotice(message: string) {
  consoleNotice.value = message;
  if (noticeTimer.value) clearTimeout(noticeTimer.value);
  noticeTimer.value = setTimeout(() => {
    consoleNotice.value = "";
  }, 4000);
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
  }
}

function runTitle(run: RunMeta): string {
  return `运行 ${run.id.slice(-6)}`;
}

async function startRun(scope: "all" | "fromNode" | "node", nodeId?: string) {
  if (running.value) {
    showNotice("已有运行正在进行");
    return;
  }
  try {
    running.value = true;
    const run = await api.post<RunMeta>(`/api/projects/${projectId.value}/runs`, { scope, nodeId });
    activeRun.value = run;
    flowCanvasRef.value?.applyRunEvent({ type: "run.started", run });
    stopRunEvents = subscribeRunEvents(run.id, (event) => {
      flowCanvasRef.value?.applyRunEvent(event);
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
        void runsStore.load();
      }
    });
  } catch (err) {
    running.value = false;
    ElMessage.error(err instanceof Error ? err.message : "启动运行失败");
  }
}

function nodeName(nodeId: string): string {
  return graph.value.nodes.find((n) => n.id === nodeId)?.data.label ?? nodeId;
}

async function stopRun() {
  if (!activeRun.value) return;
  try {
    await api.post<{ ok: boolean }>(`/api/runs/${activeRun.value.id}/stop`);
    showNotice("已发送停止指令");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "停止运行失败");
  }
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
        <el-button class="sf-btn" type="primary" :disabled="running" @click="startRun('all')">
          <Play :size="14" />
          <span>运行全部</span>
        </el-button>
        <el-button class="sf-btn" plain :disabled="!selectedNodeId || running" @click="selectedNodeId && startRun('fromNode', selectedNodeId)">
          <Play :size="14" />
          <span>从选中节点运行</span>
        </el-button>
        <el-button class="sf-btn" plain :disabled="!running" @click="stopRun">
          <StopCircle :size="14" />
          <span>停止</span>
        </el-button>
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
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="sf-editor-main">
      <NodePalette @add="(type) => flowCanvasRef?.addNodeAtCenter(type)" />
      <FlowCanvas
        v-if="loaded"
        ref="flowCanvasRef"
        :key="projectId"
        :initial-graph="graph"
        @update:graph="onGraphUpdate"
        @notice="showNotice"
        @history-change="historyState = $event"
        @select="selectedNodeId = $event"
        @run-request="(req) => startRun(req.scope, req.nodeId)"
      />
      <div v-else class="sf-editor-loading">
        <span>{{ saveState === "error" ? "工程加载失败" : "正在加载画布…" }}</span>
      </div>
    </div>

    <footer class="sf-editor-console">
      <span class="sf-console-dot" :class="{ running }" />
      <span class="sf-console-text">
        <template v-if="running && activeRun">{{ runTitle(activeRun) }} · </template>{{ consoleNotice || "就绪" }}
      </span>
    </footer>
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
</style>

<style>
/* 下拉菜单 Teleport 到 body，样式必须全局 */
.sf-dropdown-danger {
  color: var(--color-error);
}
</style>
