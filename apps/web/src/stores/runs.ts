import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { RunMeta } from "@scribe-flow/shared";
import { api } from "@/lib/api";

const PROJECT_CACHE_LIMIT = 200;

function sortRunsDesc(items: RunMeta[]): RunMeta[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

export const useRunsStore = defineStore("runs", () => {
  /** 全局最近运行（上限 200），供运行计数与编辑器“上次结果”恢复使用。 */
  const runs = ref<RunMeta[]>([]);
  const loading = ref(false);
  /** 工程级运行缓存：每个工程自己的运行库按需加载。 */
  const byProject = ref<Record<string, RunMeta[]>>({});
  const loadedProjects = ref<Record<string, boolean>>({});

  const runningCount = computed(() => runs.value.filter((r) => r.status === "running").length);

  async function load() {
    loading.value = true;
    try {
      const data = await api.get<{ items: RunMeta[] }>("/api/runs?limit=200");
      runs.value = data.items ?? [];
      mergeGlobalIntoProjectCaches();
    } catch {
      // 轮询失败保持上一次列表
    } finally {
      loading.value = false;
    }
  }

  function mergeGlobalIntoProjectCaches() {
    const next = { ...byProject.value };
    for (const run of runs.value) {
      const cached = next[run.projectId];
      if (!cached) continue;
      const index = cached.findIndex((r) => r.id === run.id);
      if (index >= 0) cached[index] = run;
      else cached.unshift(run);
    }
    byProject.value = next;
  }

  /** 读取某工程的运行库（按时间倒序）；force=true 忽略缓存强制刷新。 */
  async function loadByProject(projectId: string, options: { force?: boolean } = {}): Promise<RunMeta[]> {
    if (!options.force && loadedProjects.value[projectId]) return byProject.value[projectId] ?? [];
    const data = await api.get<{ items: RunMeta[] }>(`/api/runs?projectId=${encodeURIComponent(projectId)}&limit=${PROJECT_CACHE_LIMIT}`);
    const items = sortRunsDesc(data.items ?? []);
    byProject.value = { ...byProject.value, [projectId]: items };
    loadedProjects.value = { ...loadedProjects.value, [projectId]: true };
    return items;
  }

  function runsOfProject(projectId: string): RunMeta[] {
    return byProject.value[projectId] ?? [];
  }

  function projectLoaded(projectId: string): boolean {
    return loadedProjects.value[projectId] ?? false;
  }

  async function remove(id: string) {
    await api.delete<{ ok: boolean }>(`/api/runs/${id}`);
    runs.value = runs.value.filter((r) => r.id !== id);
    const next: Record<string, RunMeta[]> = {};
    for (const [projectId, items] of Object.entries(byProject.value)) {
      const filtered = items.filter((r) => r.id !== id);
      if (filtered.length > 0) next[projectId] = filtered;
    }
    byProject.value = next;
    await load();
  }

  function upsert(run: RunMeta) {
    const index = runs.value.findIndex((r) => r.id === run.id);
    if (index >= 0) runs.value[index] = run;
    else runs.value = [run, ...runs.value];
    const cached = byProject.value[run.projectId];
    if (cached) {
      const inner = cached.findIndex((r) => r.id === run.id);
      if (inner >= 0) cached[inner] = run;
      else cached.unshift(run);
      byProject.value = { ...byProject.value, [run.projectId]: cached };
    }
  }

  return {
    runs,
    loading,
    runningCount,
    byProject,
    load,
    loadByProject,
    runsOfProject,
    projectLoaded,
    remove,
    upsert,
  };
});
