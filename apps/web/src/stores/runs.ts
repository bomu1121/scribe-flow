import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { RunMeta } from "@scribe-flow/shared";

/** M3 接 /api/runs；M0 仅提供顶栏「运行中 N」与运行记录页状态骨架。 */
export const useRunsStore = defineStore("runs", () => {
  const runs = ref<RunMeta[]>([]);

  const runningCount = computed(() => runs.value.filter((r) => r.status === "running").length);

  return { runs, runningCount };
});
