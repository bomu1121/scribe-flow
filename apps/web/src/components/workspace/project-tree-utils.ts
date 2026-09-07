import { reactive } from "vue";
import type { ProjectFolder, ProjectListItem } from "@scribe-flow/shared";

/** 工程树（文件夹组织工程）拖拽 MIME（保留兼容，实际使用自研指针拖拽）。 */
export const PROJECT_TREE_DND_MIME = "application/scribe-flow-project-tree";

export interface ProjectTreeDragPayload {
  kind: "folder" | "project";
  id: string;
}

export const projectTreeDragState = reactive<{ payload: ProjectTreeDragPayload | null }>({
  payload: null,
});

/**
 * 自研指针拖拽运行时（pointerdown→move→up）。
 * 不依赖浏览器原生 HTML5 DnD，鼠标与触摸行为一致，也便于精确控制落点语义。
 */
export interface PointerDragState {
  active: boolean;
  payload: ProjectTreeDragPayload | null;
  /** 当前悬停的目标文件夹 id；null 且 overRoot=false 表示不在任何落点上。 */
  overFolderId: string | null;
  /** 悬停在该文件夹的展开子区域（而非文件夹行本身）。 */
  overChildArea: boolean;
  /** 悬停在根层级区域上。 */
  overRoot: boolean;
  /** 正在拖拽的行（用于置灰源行）。 */
  draggingKey: string | null;
  /** 正在进行的同层重排：目标父级与类型；beforeId/afterId 表示插到哪一行前后。 */
  reorderParentId: string | null;
  reorderType: "folder" | "project" | null;
  reorderBeforeId: string | null;
  reorderAfterId: string | null;
}

export const pointerDrag = reactive<PointerDragState>({
  active: false,
  payload: null,
  overFolderId: null,
  overChildArea: false,
  overRoot: false,
  draggingKey: null,
  reorderParentId: null,
  reorderType: null,
  reorderBeforeId: null,
  reorderAfterId: null,
});

/* 拖拽完成后抑制紧随其后的 click（避免误打开工程/误折叠文件夹） */
let suppressClickFlag = false;

export function suppressNextClick() {
  suppressClickFlag = true;
  // 若浏览器在拖拽后不派发 click，下一轮宏任务自动解除，避免吞掉后续点击
  window.setTimeout(() => {
    suppressClickFlag = false;
  }, 0);
}

export function consumeSuppressedClick(): boolean {
  const v = suppressClickFlag;
  suppressClickFlag = false;
  return v;
}

export function clearClickSuppression() {
  suppressClickFlag = false;
}

export function resetPointerDrag() {
  pointerDrag.active = false;
  pointerDrag.payload = null;
  pointerDrag.overFolderId = null;
  pointerDrag.overChildArea = false;
  pointerDrag.overRoot = false;
  pointerDrag.draggingKey = null;
  pointerDrag.reorderParentId = null;
  pointerDrag.reorderType = null;
  pointerDrag.reorderBeforeId = null;
  pointerDrag.reorderAfterId = null;
}

export function readProjectTreeDrag(event: DragEvent): ProjectTreeDragPayload | null {
  try {
    const raw = event.dataTransfer?.getData(PROJECT_TREE_DND_MIME);
    if (raw) return JSON.parse(raw) as ProjectTreeDragPayload;
  } catch {
    // 外部拖拽或读取受限时忽略并回落
  }
  return projectTreeDragState.payload;
}

export function sortFoldersByName(folders: ProjectFolder[]): ProjectFolder[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function folderChildrenOf(folders: ProjectFolder[], parentId: string | null): ProjectFolder[] {
  return sortFoldersByName(folders.filter((f) => (f.parentId ?? null) === parentId));
}

export function collectFolderSubtree(folders: ProjectFolder[], folderId: string): string[] {
  const result: string[] = [];
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const child of folderChildrenOf(folders, current)) queue.push(child.id);
  }
  return result;
}

export function buildFolderPath(folders: ProjectFolder[], folderId: string | null): string {
  if (!folderId) return "根层级";
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: string[] = [];
  let cursor = byId.get(folderId) ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor.name);
    cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
  }
  return chain.join(" / ");
}

/* ---------- 搜索 / 排序 / 多选辅助 ---------- */

export type ProjectSortMode = "manual" | "name" | "updated";

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function nameMatches(name: string, query: string): boolean {
  return name.toLocaleLowerCase().includes(query);
}

/** 文件夹自身或其子孙工程/文件夹是否命中搜索词。 */
export function folderMatchesQuery(
  folders: ProjectFolder[],
  projects: ProjectListItem[],
  folderId: string,
  query: string,
): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const folder = byId.get(folderId);
  if (!folder) return false;
  if (nameMatches(folder.name, q)) return true;
  for (const child of folderChildrenOf(folders, folderId)) {
    if (folderMatchesQuery(folders, projects, child.id, query)) return true;
  }
  return projects.some((p) => (p.folderId ?? null) === folderId && nameMatches(p.name, q));
}

/** 当前父级下应该显示的文件夹（搜索时只保留自身或后代命中者）。 */
export function visibleChildFolders(
  folders: ProjectFolder[],
  projects: ProjectListItem[],
  parentId: string | null,
  query: string,
  mode: ProjectSortMode = "manual",
): ProjectFolder[] {
  let all = folderChildrenOf(folders, parentId);
  const q = normalizeQuery(query);
  if (q) all = all.filter((folder) => folderMatchesQuery(folders, projects, folder.id, query));
  if (mode === "manual") {
    return all.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "zh-CN"));
  }
  return sortFoldersByName(all);
}

export function sortProjects(list: ProjectListItem[], mode: ProjectSortMode): ProjectListItem[] {
  const sorted = [...list];
  if (mode === "updated") {
    sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  } else if (mode === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } else {
    sorted.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "zh-CN"));
  }
  return sorted;
}

/** 当前父级下应该显示的工程（搜索时按名称过滤，再按排序模式排序）。 */
export function visibleChildProjects(
  projects: ProjectListItem[],
  parentId: string | null,
  query: string,
  mode: ProjectSortMode,
): ProjectListItem[] {
  const q = normalizeQuery(query);
  const inParent = projects.filter((p) => (p.folderId ?? null) === parentId);
  const filtered = q ? inParent.filter((p) => nameMatches(p.name, q)) : inParent;
  return sortProjects(filtered, mode);
}

/** 从一批选中的文件夹里去掉“已有选中祖先”的文件夹，得到需要实际操作的顶层文件夹。 */
export function selectedFolderRoots(
  folders: ProjectFolder[],
  selectedFolderIds: Iterable<string>,
): string[] {
  const selected = new Set(selectedFolderIds);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const roots = new Set(selected);
  for (const id of selected) {
    let cursor = byId.get(id)?.parentId ?? null;
    while (cursor) {
      if (selected.has(cursor)) {
        roots.delete(id);
        break;
      }
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  return [...roots];
}

/** 工程是否位于给定文件夹集合的子树内。 */
export function projectInsideFolders(
  folders: ProjectFolder[],
  projectFolderId: string | null | undefined,
  folderIds: Iterable<string>,
): boolean {
  const target = new Set(folderIds);
  if (!projectFolderId) return false;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cursor: string | null = projectFolderId ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (target.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/**
 * 计算一次批量移动/删除的有效载荷：
 * - 选中的文件夹只保留顶层者；
 * - 位于这些文件夹子树内的选中工程不再单独处理（会随文件夹一起移动/被文件夹删除逻辑处理）。
 */
export function effectiveSelection(
  folders: ProjectFolder[],
  projects: ProjectListItem[],
  selectedProjectIds: Iterable<string>,
  selectedFolderIds: Iterable<string>,
): { projectIds: string[]; folderIds: string[] } {
  const folderIds = selectedFolderRoots(folders, selectedFolderIds);
  const projectIdSet = new Set(selectedProjectIds);
  const projectIds = [...projectIdSet].filter((pid) => {
    const project = projects.find((p) => p.id === pid);
    if (!project) return false;
    return !projectInsideFolders(folders, project.folderId, folderIds);
  });
  return { projectIds, folderIds };
}

/* ---------- 行内编辑失焦辅助 ---------- */

/**
 * 行内编辑（重命名 / 内联新建）的失焦辅助。
 *
 * 工程树容器为了支持自研拖拽与框选，会在 pointerdown 上统一 preventDefault，
 * 这会让浏览器默认的“按下别处 → 当前输入框失焦”不生效，导致点击其他行/空白/画布
 * 都无法结束行内编辑（输入框上的 @blur 提交/取消不会触发）。
 *
 * 编辑激活期间调用本函数：挂一个 window 捕获期 pointerdown 监听，当按下点落在
 * 输入框之外时主动 blur 输入框，让组件既有的 @blur 逻辑照常执行。
 * 返回的卸载函数用于编辑结束 / 组件卸载时移除监听。
 */
export function bindInlineEditBlur(getInput: () => HTMLInputElement | null): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const input = getInput();
    // 输入框可能已被移除（编辑刚结束）：此时无需处理，监听随后会被 watcher 卸载。
    if (!input || !input.isConnected) return;
    const target = event.target;
    if (target instanceof Node && input.contains(target)) return;
    input.blur();
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
  };
}
