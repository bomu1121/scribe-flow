<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { toast } from "@/lib/toast";
import { MoreHorizontal, Pencil, Trash2, Workflow } from "lucide-vue-next";
import type { ProjectFolder, ProjectListItem } from "@scribe-flow/shared";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";
import { formatRelativeTime } from "@/lib/run-meta";
import RowMenu, { type RowMenuItem } from "./RowMenu.vue";
import FolderPickerDialog from "./FolderPickerDialog.vue";
import { consumeSuppressedClick, pointerDrag } from "./project-tree-utils";

const props = defineProps<{
  project: ProjectListItem;
  folders: ProjectFolder[];
}>();

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();
const runsStore = useRunsStore();

const isActive = computed(
  () =>
    (route.name === "project-editor" || route.name === "run-detail") &&
    String(route.params.id ?? "") === props.project.id,
);

const renaming = ref(false);
const renameValue = ref("");
const nameInputRef = ref<HTMLInputElement | null>(null);
const menu = ref<{ x: number; y: number } | null>(null);
const menuItems = ref<RowMenuItem[]>([]);
const moveOpen = ref(false);

function openProject() {
  if (consumeSuppressedClick()) return;
  void router.push(`/project/${props.project.id}`);
}

function startRename() {
  renaming.value = true;
  renameValue.value = props.project.name;
  void nextTick(() => {
    nameInputRef.value?.focus();
    nameInputRef.value?.select();
  });
}

async function commitRename() {
  if (!renaming.value) return;
  const name = renameValue.value.trim();
  renaming.value = false;
  if (!name || name === props.project.name) return;
  try {
    await store.renameProject(props.project.id, name);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "重命名失败");
  }
}

async function duplicate() {
  try {
    const created = await store.duplicateProject(props.project.id);
    toast.success(`已创建副本「${created.name}」`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "复制工程失败");
  }
}

async function exportProject() {
  try {
    await store.exportProject(props.project.id, props.project.name);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "导出工程失败");
  }
}

async function removeProject() {
  try {
    await ElMessageBox.confirm(`运行记录与产物文件会一并删除，此操作无法恢复。`, `删除工程「${props.project.name}」`, {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    await store.removeProject(props.project.id);
    toast.success(`已删除工程「${props.project.name}」`);
    if (isActive.value) await router.replace("/");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "删除工程失败");
  }
}

function isRunning(): boolean {
  return runsStore.runs.some((r) => r.projectId === props.project.id && r.status === "running");
}

function openMenuAt(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openMenu(rect.left, rect.bottom + 4);
}

function openContextMenu(event: MouseEvent) {
  openMenu(event.clientX, event.clientY);
}

function openMenu(x: number, y: number) {
  const running = isRunning();
  menuItems.value = [
    { key: "open", label: "打开画布", icon: Workflow, hint: "Enter" },
    { key: "rename", label: "重命名", icon: Pencil, hint: "F2" },
    { key: "duplicate", label: "复制工程" },
    { key: "export", label: "导出工程" },
    { key: "move", label: "移动到文件夹…" },
    { key: "delete", label: "删除工程", icon: Trash2, danger: true, divided: true, disabled: running, hint: running ? "运行中不可删除" : "Delete" },
  ];
  menu.value = { x, y };
}

function onMenuSelect(key: string) {
  switch (key) {
    case "open":
      openProject();
      break;
    case "rename":
      startRename();
      break;
    case "duplicate":
      void duplicate();
      break;
    case "export":
      void exportProject();
      break;
    case "move":
      moveOpen.value = true;
      break;
    case "delete":
      if (!isRunning()) void removeProject();
      break;
  }
}

async function onMoveConfirm(folderId: string | null) {
  if (folderId === (props.project.folderId ?? null)) return;
  try {
    await store.moveProject(props.project.id, folderId);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "移动工程失败");
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") openProject();
  else if (event.key === "F2") {
    event.preventDefault();
    startRename();
  } else if (event.key === "Delete") {
    event.preventDefault();
    if (!isRunning()) void removeProject();
  }
}
</script>

<template>
  <li
    class="wp-item"
    :class="{ active: isActive, 'is-dragging': pointerDrag.draggingKey === `project:${project.id}` }"
    :data-project-id="project.id"
    :data-tree-row="true"
    :data-drag-source="'project'"
    :data-drag-id="project.id"
    tabindex="0"
    @click="openProject"
    @keydown="onKeydown($event)"
    @contextmenu.prevent="openContextMenu($event)"
  >
    <span class="wp-item-icon"><Workflow :size="14" /></span>

    <input
      v-if="renaming"
      ref="nameInputRef"
      v-model="renameValue"
      class="wp-input"
      maxlength="80"
      @click.stop
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="renaming = false"
      @blur="commitRename"
    />
    <template v-else>
      <span class="wp-item-name" :title="`${project.name}\n${project.nodeCount} 个节点 · 更新于 ${new Date(project.updatedAt).toLocaleString('zh-CN')}`">
        {{ project.name }}
      </span>
      <span class="wp-item-meta">{{ formatRelativeTime(project.updatedAt) }}</span>
    </template>

    <button type="button" class="wp-kebab" title="更多操作" aria-label="更多操作" @click.stop="openMenuAt($event)">
      <MoreHorizontal :size="14" />
    </button>

    <RowMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenuSelect" @close="menu = null" />
    <FolderPickerDialog
      v-model:open="moveOpen"
      title="移动工程到文件夹"
      :current-id="project.folderId ?? null"
      :folders="folders"
      root-label="根层级"
      @confirm="(id: string | null) => onMoveConfirm(id)"
    />
  </li>
</template>
