import { reactive } from "vue";
import type { ProjectFolder } from "@scribe-flow/shared";

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
  /** 悬停在“根层级”落点条上。 */
  overRoot: boolean;
  /** 正在拖拽的行（用于置灰源行）。 */
  draggingKey: string | null;
}

export const pointerDrag = reactive<PointerDragState>({
  active: false,
  payload: null,
  overFolderId: null,
  overRoot: false,
  draggingKey: null,
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
  pointerDrag.overRoot = false;
  pointerDrag.draggingKey = null;
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
