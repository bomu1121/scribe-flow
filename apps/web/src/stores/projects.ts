import { defineStore } from "pinia";
import { ref } from "vue";
import type { ProjectListItem } from "@scribe-flow/shared";

/** M1 接 /api/projects；M0 仅提供页面状态骨架。 */
export const useProjectsStore = defineStore("projects", () => {
  const list = ref<ProjectListItem[]>([]);
  const loading = ref(false);
  const error = ref("");

  return { list, loading, error };
});
