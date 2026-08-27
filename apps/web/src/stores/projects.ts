import { defineStore } from "pinia";
import { ref } from "vue";
import type { ProjectListItem, ProjectMeta, WorkflowGraph } from "@scribe-flow/shared";
import { api } from "@/lib/api";

interface ProjectListResponse {
  items: ProjectListItem[];
}

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

export const useProjectsStore = defineStore("projects", () => {
  const list = ref<ProjectListItem[]>([]);
  const current = ref<ProjectMeta | null>(null);
  const loading = ref(false);
  const error = ref("");

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

  async function createProject(options: { name?: string; templateId?: string } = {}): Promise<ProjectMeta> {
    const project = await api.post<ProjectMeta>("/api/projects", options);
    await loadList();
    return project;
  }

  async function getProject(id: string): Promise<ProjectMeta> {
    current.value = await api.get<ProjectMeta>(`/api/projects/${id}`);
    return current.value;
  }

  async function renameProject(id: string, name: string, description?: string): Promise<ProjectMeta> {
    const project = await api.patch<ProjectMeta>(`/api/projects/${id}`, { name, description });
    await loadList();
    if (current.value?.id === id) current.value = project;
    return project;
  }

  async function removeProject(id: string) {
    await api.delete<{ ok: boolean }>(`/api/projects/${id}`);
    if (current.value?.id === id) current.value = null;
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

  async function importProject(file: File): Promise<ProjectMeta> {
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
      graph: parsed.graph,
    });
    await loadList();
    return project;
  }

  return {
    list,
    current,
    loading,
    error,
    loadList,
    createProject,
    getProject,
    renameProject,
    removeProject,
    duplicateProject,
    saveGraph,
    exportProject,
    importProject,
  };
});
