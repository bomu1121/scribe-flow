<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { toast } from "@/lib/toast";
import { ChevronRight, Folder as FolderIcon, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-vue-next";
import type { ProjectFolder, ProjectListItem } from "@scribe-flow/shared";
import { useProjectsStore } from "@/stores/projects";
import RowMenu, { type RowMenuItem } from "./RowMenu.vue";
import FolderPickerDialog from "./FolderPickerDialog.vue";
import NewProjectDialog from "./NewProjectDialog.vue";
import ProjectItem from "./ProjectItem.vue";
import {
  buildFolderPath,
  collectFolderSubtree,
  consumeSuppressedClick,
  pointerDrag,
  type ProjectSortMode,
  visibleChildFolders,
  visibleChildProjects,
} from "./project-tree-utils";

const props = withDefaults(
  defineProps<{
    folder: ProjectFolder;
    folders: ProjectFolder[];
    projects: ProjectListItem[];
    depth?: number;
    openIds: Set<string>;
    selectedIds: Set<string>;
    search?: string;
    sortMode?: ProjectSortMode;
  }>(),
  { depth: 0, search: "", sortMode: "name" },
);

const emit = defineEmits<{
  toggle: [id: string];
  select: [payload: { id: string; kind: "folder" | "project"; event: MouseEvent }];
  "move-selection": [];
  "delete-selection": [];
}>();

const store = useProjectsStore();
const router = useRouter();

const open = computed(() => props.openIds.has(props.folder.id));
const selected = computed(() => props.selectedIds.has(props.folder.id));
const childFolders = computed(() => visibleChildFolders(props.folders, props.projects, props.folder.id, props.search, props.sortMode));
const childProjects = computed(() => visibleChildProjects(props.projects, props.folder.id, props.search, props.sortMode));

const isDropTarget = computed(
  () => pointerDrag.active && pointerDrag.overFolderId === props.folder.id && !pointerDrag.overChildArea,
);
const isReorderBefore = computed(() => pointerDrag.reorderType === "folder" && pointerDrag.reorderBeforeId === props.folder.id);
const isReorderAfter = computed(() => pointerDrag.reorderType === "folder" && pointerDrag.reorderAfterId === props.folder.id);
const isDragging = computed(() => pointerDrag.draggingKey === `folder:${props.folder.id}`);

function toggle() {
  if (consumeSuppressedClick()) return;
  emit("toggle", props.folder.id);
}

function onRowClick(event: MouseEvent) {
  if (consumeSuppressedClick()) return;
  // Ctrl/Shift 多选已在 pointerdown 阶段处理；普通点击文件夹只负责展开/收起，不进入持久选中。
  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
  toggle();
}

/* 自研拖拽悬停自动展开 */
let expandTimer: ReturnType<typeof setTimeout> | null = null;

function clearExpandTimer() {
  if (expandTimer) {
    clearTimeout(expandTimer);
    expandTimer = null;
  }
}

watch(
  () => [pointerDrag.active, pointerDrag.overFolderId] as const,
  ([active, overId]) => {
    clearExpandTimer();
    if (active && overId === props.folder.id && !open.value) {
      expandTimer = setTimeout(() => {
        expandTimer = null;
        emit("toggle", props.folder.id);
      }, 450);
    }
  },
);

onBeforeUnmount(() => {
  clearExpandTimer();
});

/* ---------- 新建 / 重命名 ---------- */

const renaming = ref(false);
const renameValue = ref("");
const nameInputRef = ref<HTMLInputElement | null>(null);
const creatingChild = ref(false);
const createValue = ref("");
const createInputRef = ref<HTMLInputElement | null>(null);
const newProjectOpen = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function startRename() {
  renaming.value = true;
  renameValue.value = props.folder.name;
  void nextTick(() => {
    nameInputRef.value?.focus();
    nameInputRef.value?.select();
  });
}

async function commitRename() {
  if (!renaming.value) return;
  const name = renameValue.value.trim();
  renaming.value = false;
  if (!name || name === props.folder.name) return;
  try {
    await store.renameFolder(props.folder.id, name);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "重命名失败");
  }
}

function startCreateChild() {
  if (!open.value) emit("toggle", props.folder.id);
  creatingChild.value = true;
  createValue.value = "";
  void nextTick(() => {
    createInputRef.value?.focus();
  });
}

async function commitCreateChild() {
  if (!creatingChild.value) return;
  const name = createValue.value.trim();
  creatingChild.value = false;
  if (!name) return;
  try {
    await store.createFolder(name, props.folder.id);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "创建文件夹失败");
  }
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const project = await store.importProject(file, props.folder.id);
    toast.success(`已导入工程「${project.name}」`);
    if (!open.value) emit("toggle", props.folder.id);
    await router.push(`/project/${project.id}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "导入工程失败");
  }
}

/* ---------- 菜单 ---------- */

const menu = ref<{ x: number; y: number } | null>(null);
const menuItems = ref<RowMenuItem[]>([]);
const moveOpen = ref(false);

function ensureSelected(event: MouseEvent) {
  if (!props.selectedIds.has(props.folder.id)) {
    emit("select", { id: props.folder.id, kind: "folder", event });
  }
}

function openMenuAt(event: MouseEvent) {
  ensureSelected(event);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openMenu(rect.left, rect.bottom + 4);
}

function openContextMenu(event: MouseEvent) {
  ensureSelected(event);
  openMenu(event.clientX, event.clientY);
}

function openMenu(x: number, y: number) {
  const multi = props.selectedIds.size > 1 && props.selectedIds.has(props.folder.id);
  if (multi) {
    menuItems.value = [
      { key: "move-selection", label: `移动选中 ${props.selectedIds.size} 项…`, icon: FolderIcon },
      { key: "delete-selection", label: `删除选中 ${props.selectedIds.size} 项`, icon: Trash2, danger: true, divided: true },
    ];
  } else {
    menuItems.value = [
      { key: "new-project", label: "新建工程…" },
      { key: "new-folder", label: "新建子文件夹", icon: FolderPlus },
      { key: "import", label: "导入工程到此处…", icon: Upload },
      { key: "rename", label: "重命名", icon: Pencil, hint: "F2" },
      { key: "move", label: "移动到…", icon: FolderIcon },
      { key: "delete", label: "删除文件夹", icon: Trash2, danger: true, divided: true },
    ];
  }
  menu.value = { x, y };
}

function onMenuSelect(key: string) {
  switch (key) {
    case "new-project":
      newProjectOpen.value = true;
      break;
    case "new-folder":
      startCreateChild();
      break;
    case "import":
      fileInput.value?.click();
      break;
    case "rename":
      startRename();
      break;
    case "move":
      moveOpen.value = true;
      break;
    case "delete":
      void deleteFolder();
      break;
    case "move-selection":
      emit("move-selection");
      break;
    case "delete-selection":
      emit("delete-selection");
      break;
  }
}

async function deleteFolder() {
  const subCount = collectFolderSubtree(props.folders, props.folder.id).length - 1;
  const detail =
    subCount > 0
      ? `其内 ${subCount} 个子文件夹会一并删除；文件夹里的工程会移回根层级，不会被删除。`
      : "文件夹里的工程会移回根层级，不会被删除。";
  try {
    await ElMessageBox.confirm(detail, `删除文件夹「${props.folder.name}」`, {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    const result = await store.removeFolder(props.folder.id);
    toast.success(result.detachedProjects > 0 ? `已删除文件夹，${result.detachedProjects} 个工程移回根层级` : "已删除文件夹");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "删除文件夹失败");
  }
}

async function onMoveConfirm(folderId: string | null) {
  if (folderId === props.folder.parentId) return;
  try {
    await store.moveFolder(props.folder.id, folderId);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "移动文件夹失败");
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") toggle();
  else if (event.key === "F2") {
    event.preventDefault();
    startRename();
  } else if (event.key === "Delete") {
    event.preventDefault();
    if (props.selectedIds.size > 1 && props.selectedIds.has(props.folder.id)) {
      emit("delete-selection");
    } else {
      void deleteFolder();
    }
  } else if (event.key === "ArrowRight") {
    if (!open.value) {
      event.preventDefault();
      emit("toggle", props.folder.id);
    }
  } else if (event.key === "ArrowLeft") {
    if (open.value) {
      event.preventDefault();
      emit("toggle", props.folder.id);
    } else {
      const parentRow = (event.currentTarget as HTMLElement).closest("li")?.parentElement?.parentElement?.querySelector<HTMLElement>("[data-tree-row]");
      if (parentRow) {
        event.preventDefault();
        parentRow.focus();
      }
    }
  }
}
</script>

<template>
  <li class="wp-folder" :class="{ selected }">
    <div
      class="wp-row"
      :data-tree-row="true"
      :data-drag-source="'folder'"
      :data-drag-id="folder.id"
      :data-drop-folder="folder.id"
      :data-folder-id="folder.id"
      :data-parent-id="folder.parentId ?? ''"
      :class="{ open, selected, 'is-drop': isDropTarget, 'is-drop-before': isReorderBefore, 'is-drop-after': isReorderAfter, 'is-dragging': isDragging }"
      :style="{ paddingLeft: `${2 + depth * 15}px` }"
      tabindex="0"
      @click="onRowClick"
      @keydown="onKeydown"
      @contextmenu.prevent="openContextMenu($event)"
    >
      <span class="wp-row-twist"><ChevronRight :size="12" /></span>
      <span class="wp-row-icon">
        <FolderOpen v-if="open" :size="14" />
        <FolderIcon v-else :size="14" />
      </span>

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
      <span v-else class="wp-row-label" :title="buildFolderPath(folders, folder.id)">{{ folder.name }}</span>

      <button type="button" class="wp-kebab" title="更多操作" aria-label="文件夹操作" @click.stop="openMenuAt($event)">
        <MoreHorizontal :size="13" />
      </button>
    </div>

    <ul v-if="open" class="wp-children">
      <li v-if="creatingChild" class="wp-row wp-row--create" :style="{ paddingLeft: `${2 + (depth + 1) * 15}px` }">
        <span class="wp-row-icon"><FolderPlus :size="14" /></span>
        <input
          ref="createInputRef"
          v-model="createValue"
          class="wp-input"
          placeholder="子文件夹名称"
          maxlength="80"
          @keydown.enter.prevent="commitCreateChild"
          @keydown.esc.prevent="creatingChild = false"
          @blur="commitCreateChild"
        />
      </li>
      <ProjectFolderNode
        v-for="child in childFolders"
        :key="child.id"
        :folder="child"
        :folders="folders"
        :projects="projects"
        :depth="depth + 1"
        :open-ids="openIds"
        :selected-ids="selectedIds"
        :search="search"
        :sort-mode="sortMode"
        @toggle="(id: string) => emit('toggle', id)"
        @select="(payload: { id: string; kind: 'folder' | 'project'; event: MouseEvent }) => emit('select', payload)"
        @move-selection="emit('move-selection')"
        @delete-selection="emit('delete-selection')"
      />
      <ProjectItem
        v-for="project in childProjects"
        :key="project.id"
        :project="project"
        :folders="folders"
        :selected-ids="selectedIds"
        :search="search"
        :sort-mode="sortMode"
        @select="(payload: { id: string; kind: 'project'; event: MouseEvent }) => emit('select', payload)"
        @move-selection="emit('move-selection')"
        @delete-selection="emit('delete-selection')"
      />
      <li v-if="childFolders.length === 0 && childProjects.length === 0" class="wp-state wp-state--inline">文件夹为空</li>
    </ul>

    <input ref="fileInput" type="file" accept=".json,application/json" class="wp-hidden" @change="onImportFile" />
    <RowMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenuSelect" @close="menu = null" />
    <FolderPickerDialog
      v-model:open="moveOpen"
      title="移动文件夹到…"
      :current-id="folder.parentId"
      :blocked-ids="collectFolderSubtree(folders, folder.id)"
      :folders="folders"
      root-label="根层级"
      @confirm="(id: string | null) => onMoveConfirm(id)"
    />
    <NewProjectDialog
      v-model:open="newProjectOpen"
      :default-folder-id="folder.id"
      :folder-label="buildFolderPath(folders, folder.id)"
      @created="(project: { id: string }) => router.push(`/project/${project.id}`)"
    />
  </li>
</template>
