<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { toast } from "@/lib/toast";
import { MoreHorizontal, Trash2, Workflow } from "lucide-vue-next";
import type { RunMeta } from "@scribe-flow/shared";
import { useRunsStore } from "@/stores/runs";
import { useUiStore } from "@/stores/ui";
import { RUN_STATUS_META, formatRelativeTime, runShortId } from "@/lib/run-meta";
import RowMenu, { type RowMenuItem } from "./RowMenu.vue";

const props = defineProps<{ run: RunMeta }>();

const route = useRoute();
const router = useRouter();
const runsStore = useRunsStore();
const uiStore = useUiStore();

const isActive = computed(
  () => route.name === "run-detail" && String(route.params.runId ?? "") === props.run.id,
);

const meta = RUN_STATUS_META[props.run.status];
const menu = ref<{ x: number; y: number } | null>(null);
const menuItems = ref<RowMenuItem[]>([]);

function openRun() {
  void router.push(`/project/${props.run.projectId}/run/${props.run.id}`);
}

function openProjectCanvas() {
  uiStore.openPanel("projects");
  void router.push(`/project/${props.run.projectId}`);
}

function openMenuAt(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openMenu(rect.left, rect.bottom + 4);
}

function openContextMenu(event: MouseEvent) {
  openMenu(event.clientX, event.clientY);
}

function openMenu(x: number, y: number) {
  const running = props.run.status === "running";
  menuItems.value = [
    { key: "open", label: "查看运行详情", icon: Workflow },
    { key: "canvas", label: "打开工程画布" },
    { key: "delete", label: "删除运行", icon: Trash2, danger: true, divided: true, disabled: running, hint: running ? "运行中不可删除" : undefined },
  ];
  menu.value = { x, y };
}

function onMenuSelect(key: string) {
  switch (key) {
    case "open":
      openRun();
      break;
    case "canvas":
      openProjectCanvas();
      break;
    case "delete":
      if (props.run.status !== "running") void removeRun();
      break;
  }
}

async function removeRun() {
  try {
    await ElMessageBox.confirm(`相关节点结果与产物文件会一并删除。`, `删除运行 #${runShortId(props.run.id)}`, {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    await runsStore.remove(props.run.id);
    toast.success("已删除运行");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "删除运行失败");
  }
}
</script>

<template>
  <li
    class="wp-run"
    :class="{ active: isActive }"
    :title="`${run.summary || meta.label}${run.error ? ' · ' + run.error : ''}`"
    @click="openRun"
    @contextmenu.prevent="openContextMenu($event)"
  >
    <span class="wp-run-status" :class="`is-${run.status}`" :style="{ background: meta.color }" :title="meta.label" />
    <span class="wp-run-main">
      <span class="wp-run-id tnum">#{{ runShortId(run.id) }}</span>
      <span class="wp-run-meta">{{ run.summary || meta.label }}</span>
    </span>
    <span class="wp-run-time tnum">{{ formatRelativeTime(run.createdAt) }}</span>
    <button type="button" class="wp-kebab" title="更多操作" aria-label="运行操作" @click.stop="openMenuAt($event)">
      <MoreHorizontal :size="13" />
    </button>

    <RowMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenuSelect" @close="menu = null" />
  </li>
</template>
