import { defineStore } from "pinia";
import { ref } from "vue";
import type { FolderDeleteResult, ProjectFolder, ProjectListItem, ProjectMeta, WorkflowGraph } from "@scribe-flow/shared";
import { api } from "@/lib/api";

interface ProjectListResponse {
  items: ProjectListItem[];
}

interface FolderListResponse {
  items: ProjectFolder[];
}

const LAST_PROJECT_KEY = "scribe-flow.lastProjectId";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "工程";
}

function readLastProject(): string {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastProject(id: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // 隐私模式等场景静默降级
  }
}

export const useProjectsStore = defineStore("projects", () => {
  const list = ref<ProjectListItem[]>([]);
  const folders = ref<ProjectFolder[]>([]);
  const current = ref<ProjectMeta | null>(null);
  const loading = ref(false);
  const foldersLoading = ref(false);
  const error = ref("");

  const lastProjectId = ref(readLastProject());

  async function loadList() {
    loading.value = true;
    error.value = "";
    try {
      const data = await api.get<ProjectListResponse>("/api/projects");
      list.value = data.items;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "加载工程列表失败";
    } finally {
      loading.value = false;
    }
  }

  async function loadFolders() {
    foldersLoading.value = true;
    try {
      const data = await api.get<FolderListResponse>("/api/folders");
      folders.value = data.items;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "加载文件夹列表失败";
    } finally {
      foldersLoading.value = false;
    }
  }

  function rememberLastProject(id: string) {
    lastProjectId.value = id;
    writeLastProject(id);
  }

  async function createProject(options: { name?: string; templateId?: string; folderId?: string | null } = {}): Promise<ProjectMeta> {
    const project = await api.post<ProjectMeta>("/api/projects", options);
    await loadList();
    return project;
  }

  async function getProject(id: string): Promise<ProjectMeta> {
    current.value = await api.get<ProjectMeta>(`/api/projects/${id}`);
    rememberLastProject(id);
    return current.value;
  }

  async function renameProject(id: string, name: string, description?: string): Promise<ProjectMeta> {
    const project = await api.patch<ProjectMeta>(`/api/projects/${id}`, { name, description });
    await loadList();
    if (current.value?.id === id) current.value = project;
    return project;
  }

  /** 移动工程到指定文件夹（null 表示根层级）。 */
  async function moveProject(id: string, folderId: string | null): Promise<ProjectMeta> {
    const project = await api.patch<ProjectMeta>(`/api/projects/${id}`, { folderId });
    const item = list.value.find((p) => p.id === id);
    if (item) item.folderId = folderId;
    if (current.value?.id === id) current.value = { ...current.value, folderId };
    return project;
  }

  async function removeProject(id: string) {
    await api.delete<{ ok: boolean }>(`/api/projects/${id}`);
    if (current.value?.id === id) current.value = null;
    if (lastProjectId.value === id) rememberLastProject("");
    await loadList();
  }

  async function duplicateProject(id: string): Promise<ProjectMeta> {
    const project = await api.post<ProjectMeta>(`/api/projects/${id}/duplicate`);
    await loadList();
    return project;
  }

  async function saveGraph(id: string, graph: WorkflowGraph) {
    await api.put<{ ok: boolean }>(`/api/projects/${id}/graph`, { graph });
  }

  async function exportProject(id: string, name: string) {
    const data = await api.get<Record<string, unknown>>(`/api/projects/${id}/export`);
    download(`${safeFilename(name)}.scribe-flow.json`, JSON.stringify(data, null, 2), "application/json");
  }

  async function importProject(file: File, folderId?: string | null): Promise<ProjectMeta> {
    const text = await file.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("文件不是有效的 JSON");
    }
    if (parsed.kind !== "scribe-flow.project" || parsed.schemaVersion !== 1 || typeof parsed.name !== "string" || !parsed.graph) {
      throw new Error("不是有效的 ScribeFlow 工程文件");
    }
    const project = await api.post<ProjectMeta>("/api/projects/import", {
      name: parsed.name,
      description: typeof parsed.description === "string" ? parsed.description : "",
      folderId: folderId ?? undefined,
      graph: parsed.graph,
    });
    await loadList();
    return project;
  }

  /* ---------- 工程文件夹 ---------- */

  async function createFolder(name: string, parentId: string | null): Promise<ProjectFolder> {
    const folder = await api.post<ProjectFolder>("/api/folders", { name, parentId });
    await loadFolders();
    return folder;
  }

  async function renameFolder(id: string, name: string): Promise<ProjectFolder> {
    const folder = await api.patch<ProjectFolder>(`/api/folders/${id}`, { name });
    await loadFolders();
    return folder;
  }

  async function moveFolder(id: string, parentId: string | null): Promise<ProjectFolder> {
    const folder = await api.patch<ProjectFolder>(`/api/folders/${id}`, { parentId });
    await loadFolders();
    return folder;
  }

  async function removeFolder(id: string): Promise<FolderDeleteResult> {
    const result = await api.delete<FolderDeleteResult>(`/api/folders/${id}`);
    await Promise.all([loadFolders(), loadList()]);
    return result;
  }

  return {
    list,
    folders,
    current,
    loading,
    foldersLoading,
    error,
    lastProjectId,
    loadList,
    loadFolders,
    rememberLastProject,
    createProject,
    getProject,
    renameProject,
    moveProject,
    removeProject,
    duplicateProject,
    saveGraph,
    exportProject,
    importProject,
    createFolder,
    renameFolder,
    moveFolder,
    removeFolder,
  };
});
