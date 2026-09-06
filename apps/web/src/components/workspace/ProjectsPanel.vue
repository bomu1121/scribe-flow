<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "@/lib/toast";
import { FolderPlus, Plus, RefreshCw, Upload } from "lucide-vue-next";
import type { ProjectListItem } from "@scribe-flow/shared";
import { useProjectsStore } from "@/stores/projects";
import NewProjectDialog from "./NewProjectDialog.vue";
import ProjectFolderNode from "./ProjectFolderNode.vue";
import ProjectItem from "./ProjectItem.vue";
import {
  collectFolderSubtree,
  folderChildrenOf,
  pointerDrag,
  resetPointerDrag,
  suppressNextClick,
  type ProjectTreeDragPayload,
} from "./project-tree-utils";

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();

const newOpen = ref(false);
const creatingRoot = ref(false);
const rootName = ref("");
const rootInputRef = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const treeAreaRef = ref<HTMLElement | null>(null);

const rootFolders = computed(() => folderChildrenOf(store.folders, null));
const rootProjects = computed<ProjectListItem[]>(() =>
  [...store.list]
    .filter((p) => (p.folderId ?? null) === null)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
);

const activeProjectId = computed(() => {
  const name = route.name;
  return name === "project-editor" || name === "run-detail" ? String(route.params.id ?? "") : "";
});

/** 活动工程所在文件夹的祖先链（含该文件夹），需要保持展开。 */
const forceOpenFolderIds = computed<string[]>(() => {
  if (!activeProjectId.value) return [];
  const project = store.list.find((p) => p.id === activeProjectId.value);
  if (!project?.folderId) return [];
  const byId = new Map(store.folders.map((f) => [f.id, f]));
  const chain: string[] = [];
  let cursor = byId.get(project.folderId) ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor.id);
    cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
  }
  return chain;
});

onMounted(() => {
  if (store.list.length === 0) void store.loadList();
  if (store.folders.length === 0) void store.loadFolders();
});

async function refresh() {
  await Promise.all([store.loadList(), store.loadFolders()]);
}

function startCreateRootFolder() {
  creatingRoot.value = true;
  rootName.value = "";
  void nextTick(() => {
    rootInputRef.value?.focus();
  });
}

async function commitCreateRootFolder() {
  const name = rootName.value.trim();
  creatingRoot.value = false;
  if (!name) return;
  try {
    await store.createFolder(name, null);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "创建文件夹失败");
  }
}

function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void (async () => {
    try {
      const project = await store.importProject(file, null);
      toast.success(`已导入工程「${project.name}」`);
      await router.push(`/project/${project.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入工程失败");
    }
  })();
}

function onCreated(project: { id: string }) {
  void router.push(`/project/${project.id}`);
}

/* ---------- 树内键盘导航（焦点在行间移动，Enter/F2 由行自身处理） ---------- */

function treeRows(): HTMLElement[] {
  return Array.from(treeAreaRef.value?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? []);
}

function onTreeKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
  const rows = treeRows();
  const current = rows.indexOf(target);
  if (current < 0) return;

  let nextIndex = -1;
  if (event.key === "ArrowDown") nextIndex = current + 1;
  else if (event.key === "ArrowUp") nextIndex = current - 1;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = rows.length - 1;
  if (nextIndex < 0) return;

  event.preventDefault();
  const next = rows[Math.max(0, Math.min(nextIndex, rows.length - 1))];
  next.focus();
}

/* ---------- 自研指针拖拽（替代原生 HTML5 DnD，鼠标/触摸一致） ---------- */

interface PointerPending {
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
  kind: "project" | "folder";
  id: string;
  moved: boolean;
}

const pointerPending = ref<PointerPending | null>(null);

/** 判定鼠标当前位置的落点：根层级条 / 文件夹行 / 文件夹展开后的子区域。 */
function dropTargetAt(x: number, y: number): { kind: "root" } | { kind: "folder"; id: string } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  if (el.closest(".wp-root-drop")) return { kind: "root" };
  const folderRow = el.closest<HTMLElement>("[data-drop-folder]") ?? el.closest("li.wp-folder")?.querySelector<HTMLElement>("[data-drop-folder]");
  if (folderRow?.dataset.folderId) return { kind: "folder", id: folderRow.dataset.folderId };
  return null;
}

/** 目标是否可落（防自拖、防拖进自己的子孙）。 */
function dropValid(payload: ProjectTreeDragPayload, target: { kind: "folder"; id: string }): boolean {
  if (payload.kind === "project") return true;
  const targetSubtree = collectFolderSubtree(store.folders, target.id);
  if (targetSubtree.includes(payload.id)) return false;
  return !collectFolderSubtree(store.folders, payload.id).includes(target.id);
}

function refreshPointerDrop(x: number, y: number) {
  const payload = pointerDrag.payload;
  if (!payload) return;
  const target = dropTargetAt(x, y);
  pointerDrag.overRoot = target?.kind === "root";
  pointerDrag.overFolderId = target?.kind === "folder" && dropValid(payload, target) ? target.id : null;
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || pointerPending.value || pointerDrag.active) return;
  const origin = event.target as HTMLElement;
  if (origin.closest("button, input, textarea, select, [data-no-drag]")) return;
  const source = origin.closest<HTMLElement>("[data-drag-source]");
  const kind = source?.dataset.dragSource;
  if (!source || (kind !== "project" && kind !== "folder")) return;
  pointerPending.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, source, kind, id: source.dataset.dragId ?? "", moved: false };
  try {
    treeAreaRef.value?.setPointerCapture(event.pointerId);
  } catch {
    // 指针可能已抬起，忽略
  }
}

function onPointerMove(event: PointerEvent) {
  const pending = pointerPending.value;
  if (!pending) {
    if (pointerDrag.active) refreshPointerDrop(event.clientX, event.clientY);
    return;
  }
  const dx = event.clientX - pending.startX;
  const dy = event.clientY - pending.startY;
  if (!pending.moved && Math.hypot(dx, dy) < 6) return; // 拖拽阈值：小位移视为点击
  if (!pending.moved) {
    pending.moved = true;
    pointerDrag.active = true;
    pointerDrag.payload = { kind: pending.kind, id: pending.id };
    pointerDrag.draggingKey = `${pending.kind}:${pending.id}`;
  }
  refreshPointerDrop(event.clientX, event.clientY);
}

async function onPointerUp(event: PointerEvent) {
  const pending = pointerPending.value;
  const wasDrag = pointerDrag.active;
  const payload = pointerDrag.payload;
  const targetFolder = pointerDrag.overFolderId;
  const toRoot = pointerDrag.overRoot;

  if (pending) {
    try {
      treeAreaRef.value?.releasePointerCapture(event.pointerId);
    } catch {
      // 忽略
    }
    pointerPending.value = null;
  }

  if (wasDrag && payload) {
    const moved = Boolean(pending?.moved);
    resetPointerDrag();
    if (moved) suppressNextClick();
    if (targetFolder) {
      try {
        if (payload.kind === "project") {
          await store.moveProject(payload.id, targetFolder);
          toast.success("已移动到文件夹");
        } else {
          await store.moveFolder(payload.id, targetFolder);
          toast.success("已移动文件夹");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "移动失败");
      }
    } else if (toRoot) {
      try {
        if (payload.kind === "project") await store.moveProject(payload.id, null);
        else await store.moveFolder(payload.id, null);
        toast.success("已移动到根层级");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "移动失败");
      }
    }
    return;
  }

  if (pending) {
    // 未达拖拽阈值：作为普通点击放行（由行的 click 处理器打开工程等）
    pointerPending.value = null;
  }
}

function onPointerCancel() {
  pointerPending.value = null;
  resetPointerDrag();
}

onBeforeUnmount(() => {
  if (pointerDrag.active) resetPointerDrag();
});
</script>

<template>
  <div class="wp-view wp-projects">
    <div class="wp-toolbar">
      <button type="button" class="wp-btn wp-btn--primary" @click="newOpen = true"><Plus :size="13" /><span>新建工程</span></button>
      <button type="button" class="wp-btn" title="新建文件夹" @click="startCreateRootFolder"><FolderPlus :size="13" /><span>文件夹</span></button>
      <button type="button" class="wp-ibtn" title="导入工程" aria-label="导入工程" @click="fileInput?.click()"><Upload :size="15" /></button>
      <button type="button" class="wp-ibtn" title="刷新" aria-label="刷新" @click="refresh"><RefreshCw :size="14" /></button>
    </div>

    <input ref="fileInput" type="file" accept=".json,application/json" class="wp-hidden" @change="onImportFile" />

    <div v-if="pointerDrag.active" class="wp-root-drop" :class="{ active: pointerDrag.overRoot }">
      <span>拖到这里移回根层级</span>
    </div>

    <div
      ref="treeAreaRef"
      class="wp-scroll"
      @keydown="onTreeKeydown"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <div v-if="store.loading && store.list.length === 0" class="wp-state">正在加载工程…</div>

      <div v-else-if="store.list.length > 0 || store.folders.length > 0">
        <div v-if="creatingRoot" class="wp-row wp-row--create wp-create-root">
          <span class="wp-row-icon"><FolderPlus :size="14" /></span>
          <input
            ref="rootInputRef"
            v-model="rootName"
            class="wp-input"
            placeholder="文件夹名称"
            maxlength="80"
            @keydown.enter.prevent="commitCreateRootFolder"
            @keydown.esc.prevent="creatingRoot = false"
            @blur="commitCreateRootFolder"
          />
        </div>

        <ul class="wp-list">
          <ProjectFolderNode
            v-for="folder in rootFolders"
            :key="folder.id"
            :folder="folder"
            :folders="store.folders"
            :projects="store.list"
            :depth="0"
            :force-open-ids="forceOpenFolderIds"
          />
          <ProjectItem v-for="project in rootProjects" :key="project.id" :project="project" :folders="store.folders" />
        </ul>
      </div>

      <div v-else-if="store.error" class="wp-empty">
        <p class="wp-empty-title">加载失败</p>
        <p class="wp-empty-desc">{{ store.error }}</p>
        <button type="button" class="wp-btn" @click="refresh"><RefreshCw :size="13" />重试</button>
      </div>

      <div v-else class="wp-empty">
        <p class="wp-empty-title">还没有工程</p>
        <p class="wp-empty-desc">新建一个工程开始编排加工流；也可以先建文件夹，把工程分门别类。</p>
        <div class="wp-empty-actions">
          <button type="button" class="wp-btn wp-btn--primary" @click="newOpen = true"><Plus :size="13" />新建工程</button>
          <button type="button" class="wp-btn" @click="startCreateRootFolder"><FolderPlus :size="13" />新建文件夹</button>
          <button type="button" class="wp-btn" @click="fileInput?.click()"><Upload :size="13" />导入</button>
        </div>
      </div>
    </div>

    <NewProjectDialog v-model:open="newOpen" @created="(project: { id: string }) => onCreated(project)" />
  </div>
</template>
