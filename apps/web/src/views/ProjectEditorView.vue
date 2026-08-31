<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElButton, ElDrawer, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElMessage } from "element-plus";
import { ArrowLeft, Check, Copy, Download, ExternalLink, LayoutPanelTop, Maximize, MoreHorizontal, Play, Redo2, StopCircle, Trash2, Undo2 } from "lucide-vue-next";
import { emptyGraph, type RunDetail, type RunMeta, type RunNodeResult, type WorkflowGraph } from "@scribe-flow/shared";
import FlowCanvas from "@/components/canvas/FlowCanvas.vue";
import NodePalette from "@/components/canvas/NodePalette.vue";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { subscribeRunEvents } from "@/lib/sse";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";
import { useSettingsStore } from "@/stores/settings";

type SaveState = "loading" | "saved" | "saving" | "error";

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();
const runsStore = useRunsStore();
const settingsStore = useSettingsStore();

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
const projectRunningRun = computed(() => runsStore.runs.find((r) => r.projectId === projectId.value && r.status === "running") ?? null);
const outputDrawerVisible = ref(false);
const outputDrawerNodeId = ref("");
const outputDrawerRunId = ref("");
const outputDrawerNodeLabel = ref("");
const outputDrawerRunStatus = ref("");
const outputDrawerText = ref("");
const outputDrawerLoading = ref(false);
const renderedOutput = computed(() => renderMarkdown(outputDrawerText.value));
const runStatusLabels: Record<string, string> = {
  running: "运行中",
  success: "成功",
  error: "失败",
  cancelled: "已取消",
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let stopRunEvents: (() => void) | null = null;

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

  const focusNodeId = route.query.focus ? String(route.query.focus) : "";
  if (focusNodeId) {
    await nextTick();
    flowCanvasRef.value?.focusNode(focusNodeId);
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
    case "force-stop":
      void forceStopRun();
      break;
  }
}

function runTitle(run: RunMeta): string {
  return `运行 ${run.id.slice(-6)}`;
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
  if (nodes.some((n) => n.type === "process.refine" || n.type === "process.prompt") && !settingsStore.settings?.ai.hasKey) {
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
  const missing = missingKeyMessage(scope, nodeId);
  if (missing) {
    ElMessage.error(missing);
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
        openOutputDrawer(nodeId, run, nodeResult);
        return;
      }
    }
    ElMessage.warning("没有找到包含该节点输出的运行记录，请先运行该节点");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "打开输出失败");
  }
}

function openOutputDrawer(nodeId: string, run: RunMeta, nodeResult: RunNodeResult) {
  outputDrawerNodeId.value = nodeId;
  outputDrawerRunId.value = run.id;
  outputDrawerRunStatus.value = run.status;
  outputDrawerNodeLabel.value = nodeResult.nodeLabel || nodeResult.nodeType;
  outputDrawerText.value = "";
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

function openFullResult() {
  if (!outputDrawerRunId.value) return;
  void router.push({ path: `/project/${projectId.value}/run/${outputDrawerRunId.value}`, query: { focus: outputDrawerNodeId.value } });
}

async function copyNodeOutput() {
  if (!outputDrawerText.value) return;
  try {
    await navigator.clipboard.writeText(outputDrawerText.value);
    ElMessage.success("已复制节点输出");
  } catch {
    ElMessage.error("复制失败，请手动选择文本");
  }
}

function downloadNodeOutput() {
  if (!outputDrawerText.value) return;
  const blob = new Blob([outputDrawerText.value], { type: "text/markdown; charset=utf-8" });
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

        <div v-loading="outputDrawerLoading" class="sf-output-drawer-body">
          <div v-if="outputDrawerText" class="sf-output-drawer-preview markdown-body" v-html="renderedOutput" />
          <div v-else-if="!outputDrawerLoading" class="sf-output-drawer-empty">该节点本次运行没有文本输出。</div>
        </div>

        <div class="sf-output-drawer-actions">
          <el-button size="small" plain :disabled="!outputDrawerText" @click="copyNodeOutput">
            <Copy :size="13" />
            <span>复制</span>
          </el-button>
          <el-button size="small" plain :disabled="!outputDrawerText" @click="downloadNodeOutput">
            <Download :size="13" />
            <span>下载</span>
          </el-button>
        </div>
      </template>
    </el-drawer>
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
