<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, Check, Copy, Download, LayoutPanelTop, Maximize, MoreHorizontal, Play, Redo2, StopCircle, Trash2, Undo2 } from "lucide-vue-next";
import { emptyGraph, type WorkflowGraph } from "@scribe-flow/shared";
import FlowCanvas from "@/components/canvas/FlowCanvas.vue";
import NodePalette from "@/components/canvas/NodePalette.vue";
import Button from "@/components/ui/Button.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import DropdownMenuItem from "@/components/ui/DropdownMenuItem.vue";
import { useProjectsStore } from "@/stores/projects";

type SaveState = "loading" | "saved" | "saving" | "error";

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();

const projectId = computed(() => String(route.params.id));
const projectName = ref("");
const description = ref("");
const graph = ref<WorkflowGraph>(emptyGraph());
const loaded = ref(false);
const saveState = ref<SaveState>("loading");
const consoleNotice = ref("画布交互按 n8n 行为照搬清单实现；运行引擎将在 M3 接入。");
const historyState = ref({ canUndo: false, canRedo: false });
const flowCanvasRef = ref<InstanceType<typeof FlowCanvas> | null>(null);
const noticeTimer = ref<ReturnType<typeof setTimeout> | null>(null);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
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
    showNotice(`已创建副本「${created.name}」`);
    await router.push(`/project/${created.id}`);
  } catch (err) {
    showNotice(err instanceof Error ? err.message : "复制工程失败");
  }
}

async function exportProject() {
  try {
    await store.exportProject(projectId.value, projectName.value);
  } catch (err) {
    showNotice(err instanceof Error ? err.message : "导出工程失败");
  }
}

function runningPlaceholder() {
  showNotice("运行引擎将在 M3 接入");
}
</script>

<template>
  <div class="sf-editor">
    <header class="sf-editor-bar">
      <div class="sf-editor-bar-left">
        <button type="button" class="sf-icon-btn" title="返回工程列表" @click="router.push('/')">
          <ArrowLeft :size="16" />
        </button>
        <input
          v-model="projectName"
          class="sf-project-name-input"
          aria-label="工程名称"
          @change="onRename"
        />
        <span class="sf-save-state tnum">
          <Check v-if="saveState === 'saved'" :size="12" />
          {{ saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "加载中…" }}
        </span>
      </div>

      <div class="sf-editor-bar-actions">
        <Button variant="primary" @click="runningPlaceholder">
          <Play :size="14" />
          运行全部
        </Button>
        <Button @click="runningPlaceholder">
          <Play :size="14" />
          从选中节点运行
        </Button>
        <Button @click="runningPlaceholder">
          <StopCircle :size="14" />
          停止
        </Button>
        <DropdownMenu>
          <template #trigger>
            <button type="button" class="sf-icon-btn" title="更多操作">
              <MoreHorizontal :size="16" />
            </button>
          </template>
          <DropdownMenuItem @select="flowCanvasRef?.autoLayout()">
            <LayoutPanelTop :size="14" />
            整理画布
          </DropdownMenuItem>
          <DropdownMenuItem @select="flowCanvasRef?.fitView()">
            <Maximize :size="14" />
            适应视图
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!historyState.canUndo" @select="flowCanvasRef?.undo()">
            <Undo2 :size="14" />
            撤销
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!historyState.canRedo" @select="flowCanvasRef?.redo()">
            <Redo2 :size="14" />
            重做
          </DropdownMenuItem>
          <DropdownMenuItem @select="duplicateProject">
            <Copy :size="14" />
            复制工程
          </DropdownMenuItem>
          <DropdownMenuItem @select="exportProject">
            <Download :size="14" />
            导出工程
          </DropdownMenuItem>
          <DropdownMenuItem danger disabled @select="runningPlaceholder">
            <Trash2 :size="14" />
            清空运行记录（M3）
          </DropdownMenuItem>
        </DropdownMenu>
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
      />
      <div v-else class="sf-editor-loading">
        <span>{{ saveState === "error" ? "工程加载失败" : "正在加载画布…" }}</span>
      </div>
    </div>

    <footer class="sf-editor-console">
      <span class="sf-console-dot" />
      <span class="sf-console-text">{{ consoleNotice || "就绪" }}</span>
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
  gap: 8px;
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

.sf-project-name-input {
  width: 240px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
}

.sf-project-name-input:hover {
  border-color: var(--color-border);
}

.sf-project-name-input:focus {
  outline: none;
  border-color: var(--color-brand);
  background: var(--color-surface);
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
