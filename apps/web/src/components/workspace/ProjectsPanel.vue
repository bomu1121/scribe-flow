<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { toast } from "@/lib/toast";
import {
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Workflow,
  X,
} from "lucide-vue-next";
import type { ProjectListItem } from "@scribe-flow/shared";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";
import NewProjectDialog from "./NewProjectDialog.vue";
import ProjectFolderNode from "./ProjectFolderNode.vue";
import ProjectItem from "./ProjectItem.vue";
import FolderPickerDialog from "./FolderPickerDialog.vue";
import RowMenu, { type RowMenuItem } from "./RowMenu.vue";
import {
  collectFolderSubtree,
  effectiveSelection,
  pointerDrag,
  resetPointerDrag,
  suppressNextClick,
  type ProjectSortMode,
  visibleChildFolders,
  visibleChildProjects,
} from "./project-tree-utils";

const route = useRoute();
const router = useRouter();
const store = useProjectsStore();
const runsStore = useRunsStore();

/* ---------- 搜索 / 排序 / 多选 / 展开状态 ---------- */

const newOpen = ref(false);
const creatingRoot = ref(false);
const rootName = ref("");
const rootInputRef = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const treeAreaRef = ref<HTMLElement | null>(null);
const rootMenu = ref<{ x: number; y: number } | null>(null);
const rootMenuItems = ref<RowMenuItem[]>([]);

const search = ref("");
const sortMode = ref<ProjectSortMode>("manual");
const selectedIds = ref<Set<string>>(new Set());
const anchorKey = ref<string | null>(null);

const EXPANDED_KEY = "scribe-flow.expandedProjectFolders";
const COLLAPSED_KEY = "scribe-flow.collapsedProjectFolders";

function readStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

const expandedIds = ref<Set<string>>(readStringSet(EXPANDED_KEY));
const collapsedIds = ref<Set<string>>(readStringSet(COLLAPSED_KEY));

function persistExpanded() {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedIds.value]));
  } catch {
    // 隐私模式等场景静默降级
  }
}

function persistCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedIds.value]));
  } catch {
    // 隐私模式等场景静默降级
  }
}

watch(expandedIds, persistExpanded);
watch(collapsedIds, persistCollapsed);

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

/** 实际参与渲染的展开集合：用户展开 + 活动工程祖先 + 搜索时全展开，再减去用户手动收起的覆盖。 */
const openIds = computed(() => {
  const next = new Set(expandedIds.value);
  if (search.value.trim()) {
    for (const folder of store.folders) next.add(folder.id);
  }
  for (const id of forceOpenFolderIds.value) next.add(id);
  for (const id of collapsedIds.value) next.delete(id);
  return next;
});

const rootFolders = computed(() => visibleChildFolders(store.folders, store.list, null, search.value, sortMode.value));
const rootProjects = computed<ProjectListItem[]>(() => visibleChildProjects(store.list, null, search.value, sortMode.value));

function toggleFolder(id: string) {
  const isOpen = openIds.value.has(id);
  const nextExpanded = new Set(expandedIds.value);
  const nextCollapsed = new Set(collapsedIds.value);
  if (isOpen) {
    nextExpanded.delete(id);
    nextCollapsed.add(id);
  } else {
    nextExpanded.add(id);
    nextCollapsed.delete(id);
  }
  expandedIds.value = nextExpanded;
  collapsedIds.value = nextCollapsed;
}

interface VisibleRow {
  key: string;
  id: string;
  kind: "folder" | "project";
}

function collectVisibleRows(parentId: string | null, out: VisibleRow[] = []): VisibleRow[] {
  for (const folder of visibleChildFolders(store.folders, store.list, parentId, search.value, sortMode.value)) {
    out.push({ key: `folder:${folder.id}`, id: folder.id, kind: "folder" });
    if (openIds.value.has(folder.id)) collectVisibleRows(folder.id, out);
  }
  for (const project of visibleChildProjects(store.list, parentId, search.value, sortMode.value)) {
    out.push({ key: `project:${project.id}`, id: project.id, kind: "project" });
  }
  return out;
}

const visibleRows = computed(() => collectVisibleRows(null));

function keyOf(kind: "folder" | "project", id: string): string {
  return `${kind}:${id}`;
}

function handleSelect(payload: { id: string; kind: "folder" | "project"; event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean } }) {
  const { id, kind, event } = payload;
  const key = keyOf(kind, id);
  if (event.shiftKey && anchorKey.value) {
    const keys = visibleRows.value.map((row) => row.key);
    const a = keys.indexOf(anchorKey.value);
    const b = keys.indexOf(key);
    if (a >= 0 && b >= 0) {
      const [start, end] = a <= b ? [a, b] : [b, a];
      const next = new Set<string>();
      for (let i = start; i <= end; i++) next.add(keys[i]);
      selectedIds.value = next;
    }
  } else if (event.ctrlKey || event.metaKey) {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  } else if (!selectedIds.value.has(id)) {
    selectedIds.value = new Set([id]);
  }
  if (!event.shiftKey) anchorKey.value = key;
}

function clearSelection() {
  selectedIds.value = new Set();
  anchorKey.value = null;
}

/** 右键菜单关闭后恢复打开前的多选状态，避免临时高亮残留。 */
function restoreSelection(ids: string[]) {
  selectedIds.value = new Set(ids);
  anchorKey.value = null;
}

/** 数据增删后清理已不存在的选中项。 */
function pruneSelection() {
  const valid = new Set<string>();
  for (const p of store.list) valid.add(p.id);
  for (const f of store.folders) valid.add(f.id);
  const next = new Set([...selectedIds.value].filter((id) => valid.has(id)));
  if (next.size !== selectedIds.value.size) selectedIds.value = next;
}

watch([() => store.list, () => store.folders], pruneSelection);

function splitSelection(): { projectIds: string[]; folderIds: string[] } {
  const projectIds: string[] = [];
  const folderIds: string[] = [];
  for (const id of selectedIds.value) {
    if (id.startsWith("fld_")) folderIds.push(id);
    else projectIds.push(id);
  }
  return { projectIds, folderIds };
}

function isRunningProject(id: string): boolean {
  return runsStore.runs.some((r) => r.projectId === id && r.status === "running");
}

/* ---------- 批量操作 ---------- */

const moveOpen = ref(false);
const moveBlockedIds = ref<string[]>([]);

function openMoveSelection() {
  if (selectedIds.value.size === 0) return;
  const { folderIds } = splitSelection();
  moveBlockedIds.value = folderIds.flatMap((id) => collectFolderSubtree(store.folders, id));
  moveOpen.value = true;
}

async function onMoveSelectionConfirm(folderId: string | null) {
  const { projectIds, folderIds } = effectiveSelection(store.folders, store.list, projectIdsOfSelection(), folderIdsOfSelection());
  const projectIdsToMove = projectIds.filter((pid) => (store.list.find((p) => p.id === pid)?.folderId ?? null) !== folderId);
  const folderIdsToMove = folderIds.filter((fid) => (store.folders.find((f) => f.id === fid)?.parentId ?? null) !== folderId);
  const movedAny = projectIdsToMove.length > 0 || folderIdsToMove.length > 0;
  if (!movedAny) return;
  if (folderIdsToMove.length > 0) await store.moveFolders(folderIdsToMove, folderId);
  if (projectIdsToMove.length > 0) await store.moveProjects(projectIdsToMove, folderId);
  toast.success(projectIdsToMove.length + folderIdsToMove.length > 1 ? `已移动 ${projectIdsToMove.length + folderIdsToMove.length} 项` : "已移动");
  clearSelection();
}

function projectIdsOfSelection(): string[] {
  return splitSelection().projectIds;
}

function folderIdsOfSelection(): string[] {
  return splitSelection().folderIds;
}

async function deleteSelection() {
  if (selectedIds.value.size === 0) return;
  const { projectIds, folderIds } = effectiveSelection(store.folders, store.list, projectIdsOfSelection(), folderIdsOfSelection());
  const projectIdsToDelete = projectIds.filter((id) => !isRunningProject(id));
  if (folderIds.length === 0 && projectIdsToDelete.length === 0) {
    toast.info("选中的工程正在运行，无法删除");
    return;
  }
  const parts: string[] = [];
  if (folderIds.length > 0) parts.push(`${folderIds.length} 个文件夹（文件夹内工程会移回根层级）`);
  if (projectIdsToDelete.length > 0) parts.push(`${projectIdsToDelete.length} 个工程（运行记录与产物会一并删除）`);
  try {
    await ElMessageBox.confirm(`${parts.join("，")}。此操作不可恢复。`, `删除选中的 ${selectedIds.value.size} 项`, {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    if (folderIds.length > 0) await store.removeFolders(folderIds);
    if (projectIdsToDelete.length > 0) await store.removeProjects(projectIdsToDelete);
    toast.success("已删除选中项");
    clearSelection();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "删除失败");
  }
}

/* ---------- 加载 / 新建 / 导入 ---------- */

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

function openRootContextMenu(event: MouseEvent) {
  const target = event.target as HTMLElement;
  // 只在根目录的空白区域打开根目录菜单；文件夹内部空白与行内右键仍走各自逻辑。
  if (target.closest("[data-tree-row], .wp-folder, button, input, textarea, select, .wp-menu")) return;
  clearSelection();
  rootMenuItems.value = [
    { key: "new-project", label: "新建工程", icon: Plus },
    { key: "new-folder", label: "新建文件夹", icon: FolderPlus },
    { key: "import", label: "导入工程…", icon: Upload },
    { key: "refresh", label: "刷新", icon: RefreshCw },
  ];
  rootMenu.value = { x: event.clientX, y: event.clientY };
}

function onRootMenuSelect(key: string) {
  switch (key) {
    case "new-project":
      newOpen.value = true;
      break;
    case "new-folder":
      startCreateRootFolder();
      break;
    case "import":
      fileInput.value?.click();
      break;
    case "refresh":
      void refresh();
      break;
  }
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

/* ---------- 自研指针拖拽（支持多选批量拖拽） ---------- */

interface PointerPending {
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
  kind: "project" | "folder";
  id: string;
  moved: boolean;
}

interface DragGhostState {
  visible: boolean;
  x: number;
  y: number;
  count: number;
  label: string;
}

const pointerPending = ref<PointerPending | null>(null);
const dragGhost = ref<DragGhostState>({ visible: false, x: 0, y: 0, count: 1, label: "" });
const showRootZone = ref(false);

let autoScrollTimer: ReturnType<typeof setInterval> | null = null;
let autoScrollDir = 0;

function stopAutoScroll() {
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  }
  autoScrollDir = 0;
}

function updateAutoScroll(x: number, y: number) {
  const area = treeAreaRef.value;
  if (!area || !pointerDrag.active) {
    stopAutoScroll();
    return;
  }
  const rect = area.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top - 8 || y > rect.bottom + 8) {
    stopAutoScroll();
    return;
  }
  const edge = 28;
  const dir = y < rect.top + edge ? -1 : y > rect.bottom - edge ? 1 : 0;
  if (dir === autoScrollDir) return;
  stopAutoScroll();
  autoScrollDir = dir;
  if (dir === 0) return;
  autoScrollTimer = setInterval(() => {
    const el = treeAreaRef.value;
    if (!el || !pointerDrag.active) {
      stopAutoScroll();
      return;
    }
    el.scrollTop += dir * 8;
  }, 16);
}

type DropTarget =
  | { kind: "root" }
  | { kind: "folder"; id: string; childArea: boolean }
  | { kind: "reorder"; parentId: string | null; type: "folder" | "project"; beforeId: string | null; afterId: string | null }
  | null;

function previousSiblingId(type: "folder" | "project", parentId: string | null, rowId: string): string | null {
  const ids =
    type === "folder"
      ? visibleChildFolders(store.folders, store.list, parentId, "", "manual").map((f) => f.id)
      : visibleChildProjects(store.list, parentId, "", "manual").map((p) => p.id);
  const index = ids.indexOf(rowId);
  return index > 0 ? ids[index - 1] : null;
}

function dropTargetAt(x: number, y: number): DropTarget {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  if (!el.closest(".wp-scroll")) return null;
  const payload = pointerDrag.payload;
  const canReorder = payload && sortMode.value === "manual" && !search.value.trim() && selectedIds.value.size <= 1;

  // 直接命中某个行（工程行或文件夹行）
  const rowEl = el.closest<HTMLElement>("[data-project-id], [data-folder-id]");
  if (rowEl) {
    const rowId = rowEl.dataset.projectId || rowEl.dataset.folderId || "";
    const rowKind: "project" | "folder" | null = rowEl.hasAttribute("data-project-id") ? "project" : rowEl.hasAttribute("data-folder-id") ? "folder" : null;
    const rowParent = rowEl.dataset.parentId ? rowEl.dataset.parentId : null;
    if (canReorder && rowKind && rowId !== payload.id) {
      const rect = rowEl.getBoundingClientRect();
      // 工程拖到工程行：始终在项目与项目之间显示插入线。
      // 同目录 = 排序；跨目录 = 移入该目录并插入到对应位置。
      if (payload.kind === "project" && rowKind === "project") {
        const isBefore = y < rect.top + rect.height / 2;
        if (isBefore) {
          const prev = previousSiblingId("project", rowParent, rowId);
          // 同一间隙只保留一个落点：插到上一项后面；没有上一项才插到该项前面。
          return {
            kind: "reorder",
            parentId: rowParent,
            type: "project",
            beforeId: prev ? null : rowId,
            afterId: prev ?? null,
          };
        }
        return {
          kind: "reorder",
          parentId: rowParent,
          type: "project",
          beforeId: null,
          afterId: rowId,
        };
      }
      // 文件夹拖到文件夹行：边缘是插入线，中间仍表示拖入该文件夹。
      if (payload.kind === "folder" && rowKind === "folder") {
        const topEdge = rect.top + rect.height * 0.25;
        const bottomEdge = rect.bottom - rect.height * 0.25;
        if (y >= topEdge && y <= bottomEdge) {
          return { kind: "folder", id: rowId, childArea: false };
        }
        if (y < topEdge) {
          const prev = previousSiblingId("folder", rowParent, rowId);
          return {
            kind: "reorder",
            parentId: rowParent,
            type: "folder",
            beforeId: prev ? null : rowId,
            afterId: prev ?? null,
          };
        }
        return {
          kind: "reorder",
          parentId: rowParent,
          type: "folder",
          beforeId: null,
          afterId: rowId,
        };
      }
    }

    // 工程拖到文件夹行中间 = 移入该文件夹；文件夹拖到文件夹行中间同样移入。
    if (rowKind === "folder") {
      return { kind: "folder", id: rowId, childArea: false };
    }
  }

  // 不在行上时，若落在某个文件夹的展开子区域：
  // 只有空文件夹才用“整块”作为移入点；有子项时不再高亮整块容器。
  const folderLi = el.closest<HTMLElement>("li.wp-folder");
  const rowInLi = folderLi?.querySelector<HTMLElement>("[data-drop-folder]");
  if (rowInLi?.dataset.folderId) {
    const folderId = rowInLi.dataset.folderId;
    const childArea = folderLi?.querySelector<HTMLElement>(":scope > ul.wp-children");
    const hasChildRows = Boolean(childArea?.querySelector("[data-project-id], [data-folder-id]"));
    if (!hasChildRows) {
      return { kind: "folder", id: folderId, childArea: true };
    }
    return null;
  }
  return { kind: "root" };
}

function dropValid(payloadKind: "folder" | "project", folderId: string): boolean {
  if (payloadKind === "project") return true;
  const movingFolders = effectiveSelection(store.folders, store.list, [], folderIdsOfSelection()).folderIds;
  const folderSubtree = collectFolderSubtree(store.folders, folderId);
  return !movingFolders.some((id) => folderSubtree.includes(id));
}

/** 插入线目标是否合法：文件夹不能插到自己的子孙目录里。 */
function reorderValid(payload: { kind: "folder" | "project"; id: string }, targetParentId: string | null): boolean {
  if (payload.kind === "project") return true;
  const source = store.folders.find((f) => f.id === payload.id);
  if (!source) return false;
  if ((source.parentId ?? null) === targetParentId) return true;
  if (targetParentId && collectFolderSubtree(store.folders, targetParentId).includes(payload.id)) return false;
  return true;
}

function refreshPointerDrop(x: number, y: number) {
  const payload = pointerDrag.payload;
  if (!payload) return;
  const target = dropTargetAt(x, y);
  const valid = target?.kind === "folder" ? dropValid(payload.kind, target.id) : true;
  const reorderOk = target?.kind === "reorder" ? reorderValid(payload, target.parentId) : false;
  pointerDrag.overRoot = target?.kind === "root" && selectionCanMoveToRoot();
  pointerDrag.overFolderId = target?.kind === "folder" && valid ? target.id : null;
  pointerDrag.overChildArea = target?.kind === "folder" && pointerDrag.overFolderId === target.id && target.childArea && valid;
  pointerDrag.reorderParentId = target?.kind === "reorder" && reorderOk ? target.parentId : null;
  pointerDrag.reorderType = target?.kind === "reorder" && reorderOk ? target.type : null;
  pointerDrag.reorderBeforeId = target?.kind === "reorder" && reorderOk ? target.beforeId : null;
  pointerDrag.reorderAfterId = target?.kind === "reorder" && reorderOk ? target.afterId : null;
  const area = treeAreaRef.value;
  const nearTop = area ? y < area.getBoundingClientRect().top + 64 : false;
  showRootZone.value = target?.kind === "root" && selectionCanMoveToRoot() && nearTop;
  if (dragGhost.value.visible) {
    dragGhost.value.x = x + 12;
    dragGhost.value.y = y + 10;
  }
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || pointerPending.value || pointerDrag.active) return;
  const origin = event.target as HTMLElement;
  if (origin.closest("button, input, textarea, select, [data-no-drag]")) return;
  const source = origin.closest<HTMLElement>("[data-drag-source]");
  const kind = source?.dataset.dragSource;
  if (!source || (kind !== "project" && kind !== "folder")) return;
  const id = source.dataset.dragId ?? "";
  const isModifier = event.ctrlKey || event.metaKey || event.shiftKey;

  // Ctrl/Shift 点击用于多选，直接在 pointerdown 阶段完成，不进入拖拽 pending；
  // 因为 preventDefault 在部分浏览器/修饰键组合下会吞掉后续 click，不能再依赖 click 来多选。
  if (isModifier) {
    handleSelect({ id, kind, event });
    return;
  }

  event.preventDefault();

  // 普通按住工程时先把它变成唯一选中项；文件夹普通点击只展开/收起，不进入持久选中。
  if (kind === "project" && !selectedIds.value.has(id)) {
    selectedIds.value = new Set([id]);
    anchorKey.value = keyOf(kind, id);
  }

  pointerPending.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    source,
    kind,
    id,
    moved: false,
  };
  try {
    // 捕获到“源行”而不是滚动容器：这样普通点击的 pointerup/click 仍落在行上，
    // 行内的打开/折叠逻辑才能触发；拖拽出面板时事件仍会通过捕获回源行并冒泡到树区域。
    source.setPointerCapture(event.pointerId);
  } catch {
    // 指针可能已抬起，忽略
  }
}

function onPointerMove(event: PointerEvent) {
  const pending = pointerPending.value;
  if (!pending) {
    if (pointerDrag.active) {
      refreshPointerDrop(event.clientX, event.clientY);
      updateAutoScroll(event.clientX, event.clientY);
    }
    return;
  }
  const dx = event.clientX - pending.startX;
  const dy = event.clientY - pending.startY;
  if (!pending.moved && Math.hypot(dx, dy) < 6) return;
  if (!pending.moved) {
    pending.moved = true;
    pointerDrag.active = true;
    pointerDrag.payload = { kind: pending.kind, id: pending.id };
    pointerDrag.draggingKey = `${pending.kind}:${pending.id}`;
    // 文件夹普通点击不持久选中，但真正拖拽开始时需要把它纳入选区。
    if (!selectedIds.value.has(pending.id)) {
      selectedIds.value = new Set([pending.id]);
      anchorKey.value = keyOf(pending.kind, pending.id);
    }
    const count = selectedIds.value.size || 1;
    const firstName = pending.source.querySelector<HTMLElement>(".wp-item-name, .wp-row-label")?.textContent?.trim() ?? "";
    dragGhost.value = {
      visible: true,
      x: event.clientX + 12,
      y: event.clientY + 10,
      count,
      label: count > 1 ? `${count} 项` : firstName,
    };
  }
  refreshPointerDrop(event.clientX, event.clientY);
  updateAutoScroll(event.clientX, event.clientY);
}

function sameTarget(payloadKind: "folder" | "project", id: string, folderId: string): boolean {
  if (payloadKind === "project") {
    return (store.list.find((p) => p.id === id)?.folderId ?? null) === folderId;
  }
  return (store.folders.find((f) => f.id === id)?.parentId ?? null) === folderId;
}

function atRoot(payloadKind: "folder" | "project", id: string): boolean {
  if (payloadKind === "project") {
    return (store.list.find((p) => p.id === id)?.folderId ?? null) == null;
  }
  return (store.folders.find((f) => f.id === id)?.parentId ?? null) == null;
}

/** 当前选区是否真的有需要“移回根层级”的项；全是根级项时不再显示根落点提示。 */
function selectionCanMoveToRoot(): boolean {
  const { projectIds, folderIds } = effectiveSelection(store.folders, store.list, projectIdsOfSelection(), folderIdsOfSelection());
  return projectIds.some((id) => !atRoot("project", id)) || folderIds.some((id) => !atRoot("folder", id));
}

async function performReorder(
  type: "folder" | "project",
  parentId: string | null,
  sourceId: string,
  beforeId: string | null,
  afterId: string | null,
) {
  // 目标间隙就是源项自己所在的位置时，无需任何操作。
  if (beforeId === sourceId || afterId === sourceId) return;
  const sourceParent =
    type === "project"
      ? store.list.find((p) => p.id === sourceId)?.folderId ?? null
      : store.folders.find((f) => f.id === sourceId)?.parentId ?? null;

  // 跨目录插入：先移动到目标目录，再在目标目录里排到精确位置。
  if ((sourceParent ?? null) !== (parentId ?? null)) {
    if (type === "project") await store.moveProjects([sourceId], parentId);
    else await store.moveFolders([sourceId], parentId);
  }

  const current =
    type === "folder"
      ? visibleChildFolders(store.folders, store.list, parentId, "", "manual").map((f) => f.id)
      : visibleChildProjects(store.list, parentId, "", "manual").map((p) => p.id);
  const without = current.filter((id) => id !== sourceId);
  let index = -1;
  if (beforeId) index = without.indexOf(beforeId);
  else if (afterId) index = without.indexOf(afterId) + 1;
  if (index < 0) index = without.length;
  without.splice(index, 0, sourceId);
  if (without.join("|") === current.join("|")) return;
  if (type === "folder") await store.reorderFolders(parentId, without);
  else await store.reorderProjects(parentId, without);
}

async function onPointerUp(event: PointerEvent) {
  const pending = pointerPending.value;
  const wasDrag = pointerDrag.active;
  const payload = pointerDrag.payload;
  const targetFolder = pointerDrag.overFolderId;
  const toRoot = pointerDrag.overRoot;
  const reorderType = pointerDrag.reorderType;
  const reorderParentId = pointerDrag.reorderParentId;
  const reorderBeforeId = pointerDrag.reorderBeforeId;
  const reorderAfterId = pointerDrag.reorderAfterId;
  const moved = Boolean(pending?.moved);

  if (pending) {
    try {
      pending.source.releasePointerCapture(event.pointerId);
    } catch {
      // 忽略
    }
    pointerPending.value = null;
  }
  stopAutoScroll();
  dragGhost.value.visible = false;

  if (wasDrag && payload) {
    resetPointerDrag();
    if (moved) suppressNextClick();

    let movedAny = false;
    try {
      if (reorderType && payload) {
        await performReorder(reorderType, reorderParentId, payload.id, reorderBeforeId, reorderAfterId);
        movedAny = true;
        toast.success("已调整顺序");
      } else if (targetFolder) {
        const { projectIds, folderIds } = effectiveSelection(store.folders, store.list, projectIdsOfSelection(), folderIdsOfSelection());
        const projectIdsToMove = projectIds.filter((pid) => !sameTarget("project", pid, targetFolder));
        const folderIdsToMove = folderIds.filter((fid) => !sameTarget("folder", fid, targetFolder));
        movedAny = projectIdsToMove.length > 0 || folderIdsToMove.length > 0;
        if (folderIdsToMove.length > 0) await store.moveFolders(folderIdsToMove, targetFolder);
        if (projectIdsToMove.length > 0) await store.moveProjects(projectIdsToMove, targetFolder);
        if (movedAny) {
          toast.success(projectIdsToMove.length + folderIdsToMove.length > 1 ? "已移动到文件夹" : "已移动");
        }
      } else if (toRoot) {
        const { projectIds, folderIds } = effectiveSelection(store.folders, store.list, projectIdsOfSelection(), folderIdsOfSelection());
        const projectIdsToRoot = projectIds.filter((pid) => !atRoot("project", pid));
        const folderIdsToRoot = folderIds.filter((fid) => !atRoot("folder", fid));
        movedAny = projectIdsToRoot.length > 0 || folderIdsToRoot.length > 0;
        if (folderIdsToRoot.length > 0) await store.moveFolders(folderIdsToRoot, null);
        if (projectIdsToRoot.length > 0) await store.moveProjects(projectIdsToRoot, null);
        if (movedAny) {
          toast.success(projectIdsToRoot.length + folderIdsToRoot.length > 1 ? "已移动到根层级" : "已移动");
        }
      }
      if (movedAny) clearSelection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移动失败");
    }
    return;
  }

  if (pending) {
    pending.source.focus({ preventScroll: true });
    pointerPending.value = null;
  }
}

function onPointerCancel() {
  pointerPending.value = null;
  stopAutoScroll();
  dragGhost.value.visible = false;
  resetPointerDrag();
}

onBeforeUnmount(() => {
  stopAutoScroll();
  dragGhost.value.visible = false;
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

    <div class="wp-filter">
      <div class="wp-search">
        <Search :size="13" class="wp-search-icon" />
        <input v-model="search" class="wp-search-input" type="search" placeholder="筛选工程或文件夹" />
        <button v-if="search" type="button" class="wp-search-clear" aria-label="清除搜索" @click="search = ''">
          <X :size="12" />
        </button>
      </div>
      <select v-model="sortMode" class="wp-sort" aria-label="排序方式" title="排序方式">
        <option value="manual">手动</option>
        <option value="name">名称</option>
        <option value="updated">最近更新</option>
      </select>
    </div>

    <div v-if="selectedIds.size > 1" class="wp-selectionbar">
      <span class="wp-selection-count tnum">{{ selectedIds.size }} 项已选</span>
      <button type="button" class="wp-btn" @click="openMoveSelection"><FolderIcon :size="13" />移动</button>
      <button type="button" class="wp-btn wp-btn--danger-text" @click="deleteSelection"><Trash2 :size="13" />删除</button>
      <button type="button" class="wp-ibtn" title="取消选择" aria-label="取消选择" @click="clearSelection"><X :size="14" /></button>
    </div>

    <input ref="fileInput" type="file" accept=".json,application/json" class="wp-hidden" @change="onImportFile" />

    <Teleport to="body">
      <div
        v-if="dragGhost.visible"
        class="wp-drag-ghost"
        :class="{ 'is-multi': dragGhost.count > 1 }"
        :style="{ left: `${dragGhost.x}px`, top: `${dragGhost.y}px` }"
      >
        <span class="wp-drag-ghost-icon">
          <FolderIcon v-if="dragGhost.count === 1 && dragGhost.label === ''" :size="13" />
          <Workflow v-else :size="13" />
        </span>
        <span class="wp-drag-ghost-name">{{ dragGhost.label }}</span>
        <span v-if="dragGhost.count > 1" class="wp-drag-ghost-count tnum">{{ dragGhost.count }}</span>
      </div>
    </Teleport>

    <div
      ref="treeAreaRef"
      class="wp-scroll"
      @keydown="onTreeKeydown"
      @contextmenu.prevent="openRootContextMenu"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <div v-if="pointerDrag.active && showRootZone" class="wp-root-drop-inline" :class="{ active: pointerDrag.overRoot }">
        <span>松开移出到根层级</span>
      </div>

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
            :open-ids="openIds"
            :selected-ids="selectedIds"
            :search="search"
            :sort-mode="sortMode"
            @toggle="toggleFolder"
            @select="handleSelect"
            @move-selection="openMoveSelection"
            @delete-selection="deleteSelection"
            @restore-selection="restoreSelection"
          />
          <ProjectItem
            v-for="project in rootProjects"
            :key="project.id"
            :project="project"
            :folders="store.folders"
            :selected-ids="selectedIds"
            :search="search"
            :sort-mode="sortMode"
            @select="handleSelect"
            @move-selection="openMoveSelection"
            @delete-selection="deleteSelection"
            @restore-selection="restoreSelection"
          />
        </ul>
        <div v-if="rootFolders.length === 0 && rootProjects.length === 0 && search" class="wp-state">没有匹配的工程或文件夹</div>
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

    <RowMenu
      v-if="rootMenu"
      :x="rootMenu.x"
      :y="rootMenu.y"
      :items="rootMenuItems"
      @select="onRootMenuSelect"
      @close="rootMenu = null"
    />
    <NewProjectDialog v-model:open="newOpen" @created="(project: { id: string }) => onCreated(project)" />
    <FolderPickerDialog
      v-model:open="moveOpen"
      title="移动选中项到…"
      :current-id="null"
      :blocked-ids="moveBlockedIds"
      :folders="store.folders"
      root-label="根层级"
      @confirm="(id: string | null) => onMoveSelectionConfirm(id)"
    />
  </div>
</template>
