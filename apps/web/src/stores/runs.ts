import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { RunMeta } from "@scribe-flow/shared";
import { api } from "@/lib/api";

export const useRunsStore = defineStore("runs", () => {
  const runs = ref<RunMeta[]>([]);
  const loading = ref(false);

  const runningCount = computed(() => runs.value.filter((r) => r.status === "running").length);

  async function load() {
    loading.value = true;
    try {
      const data = await api.get<{ items: RunMeta[] }>("/api/runs");
      runs.value = data.items ?? [];
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: string) {
    await api.delete<{ ok: boolean }>(`/api/runs/${id}`);
    await load();
  }

  function upsert(run: RunMeta) {
    const index = runs.value.findIndex((r) => r.id === run.id);
    if (index >= 0) runs.value[index] = run;
    else runs.value = [run, ...runs.value];
  }

  return { runs, loading, runningCount, load, remove, upsert };
});
