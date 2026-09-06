<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { toast } from "@/lib/toast";
import { RefreshCw } from "lucide-vue-next";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";
import RunRow from "./RunRow.vue";

const route = useRoute();
const projectsStore = useProjectsStore();
const runsStore = useRunsStore();

const selectedId = ref<string | null>(null);
const loading = ref(false);

const sortedProjects = computed(() => [...projectsStore.list].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
const selectedProject = computed(() => projectsStore.list.find((p) => p.id === selectedId.value) ?? null);
const runs = computed(() => (selectedId.value ? runsStore.runsOfProject(selectedId.value) : []));
const loaded = computed(() => (selectedId.value ? runsStore.projectLoaded(selectedId.value) : false));

/** 当前路由打开哪个工程，就优先看哪个工程的运行库。 */
function desiredProjectId(): string | null {
  if (route.name === "project-editor" || route.name === "run-detail") {
    const active = String(route.params.id ?? "");
    if (projectsStore.list.some((p) => p.id === active)) return active;
  }
  if (projectsStore.lastProjectId && projectsStore.list.some((p) => p.id === projectsStore.lastProjectId)) {
    return projectsStore.lastProjectId;
  }
  return projectsStore.list[0]?.id ?? null;
}

async function loadRuns(force = false) {
  if (!selectedId.value) return;
  loading.value = true;
  try {
    await runsStore.loadByProject(selectedId.value, { force });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "运行记录加载失败");
  } finally {
    loading.value = false;
  }
}

watch(
  () => projectsStore.list.length,
  async () => {
    if (!selectedId.value || !projectsStore.list.some((p) => p.id === selectedId.value)) {
      selectedId.value = desiredProjectId();
    }
    if (selectedId.value && !loaded.value) await loadRuns();
  },
  { immediate: true },
);

watch(
  () => route.params.id,
  () => {
    const next = desiredProjectId();
    if (next && next !== selectedId.value) {
      selectedId.value = next;
      void loadRuns();
    }
  },
);

onMounted(() => {
  if (projectsStore.list.length === 0) void projectsStore.loadList();
  void runsStore.load();
});

async function refresh() {
  await loadRuns(true);
}
</script>

<template>
  <div class="wp-view wp-runs">
    <div class="wp-toolbar wp-runs-toolbar">
      <select
        v-if="sortedProjects.length > 0"
        v-model="selectedId"
        class="wp-select"
        aria-label="选择工程"
        @change="loadRuns(true)"
      >
        <option v-for="p in sortedProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <button type="button" class="wp-ibtn" title="刷新运行记录" aria-label="刷新运行记录" @click="refresh"><RefreshCw :size="14" /></button>
    </div>

    <div class="wp-runs-head">
      <span v-if="selectedProject" class="wp-runs-title" :title="selectedProject.description || selectedProject.name">
        {{ selectedProject.name }} 的运行库
      </span>
      <span v-else class="wp-runs-title">运行库</span>
      <span v-if="runs.length > 0" class="wp-count tnum">{{ runs.length }}</span>
    </div>

    <div class="wp-scroll">
      <div v-if="sortedProjects.length === 0 && !projectsStore.loading" class="wp-empty">
        <p class="wp-empty-title">还没有工程</p>
        <p class="wp-empty-desc">先在左侧「工程」面板新建或打开一个工程，这里会显示它自己的运行记录。</p>
      </div>

      <div v-else-if="loading && runs.length === 0" class="wp-state">正在加载运行记录…</div>

      <div v-else-if="runs.length === 0 && loaded" class="wp-empty">
        <p class="wp-empty-title">这个工程还没有运行记录</p>
        <p class="wp-empty-desc">在画布中运行一次后，结果会出现在这里。</p>
      </div>

      <ul v-else class="wp-list">
        <RunRow v-for="run in runs" :key="run.id" :run="run" />
      </ul>
    </div>
  </div>
</template>
