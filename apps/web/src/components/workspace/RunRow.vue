<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { toast } from "@/lib/toast";
import { Pencil, Trash2, Workflow } from "lucide-vue-next";
import { RUN_NAME_MAX_LENGTH, type RunMeta } from "@scribe-flow/shared";
import { useRunsStore } from "@/stores/runs";
import { useUiStore } from "@/stores/ui";
import { RUN_STATUS_META, formatRunTime, resolveRenameRequest, runDisplayName, runRowTooltip, runShortId } from "@/lib/run-meta";
import RowMenu, { type RowMenuItem } from "./RowMenu.vue";

const props = defineProps<{ run: RunMeta }>();

const route = useRoute();
const router = useRouter();
const runsStore = useRunsStore();
const uiStore = useUiStore();

const isActive = computed(
  () => route.name === "run-detail" && String(route.params.runId ?? "") === props.run.id,
);

/** 必须是 computed：同一个 id 的行会原地换状态（跑完、被停），算一次就不再更新了。 */
const meta = computed(() => RUN_STATUS_META[props.run.status]);
/** 只显示你起的名字。没起名就空着——左侧栏不报状态，理由见 runDisplayName 的注释。 */
const name = computed(() => runDisplayName(props.run));
const time = computed(() => formatRunTime(props.run.createdAt));
/**
 * 只有「运行中」才在行首画点：那是"它正在动"，不是成败评价。
 * 终态一律不画——成功/中断的标记在这一栏里只会盖住名字与时间。
 */
const isRunning = computed(() => props.run.status === "running");
const menu = ref<{ x: number; y: number } | null>(null);
const menuItems = ref<RowMenuItem[]>([]);

/* 行内改名：与工程/文件夹行同一套（就地输入框，回车提交、Esc 取消、失焦提交），不弹对话框。 */
const renaming = ref(false);
const renameValue = ref("");
const nameInputRef = ref<HTMLInputElement | null>(null);

function openRun() {
  // 编辑态下点行内空白处只是"确认改名"，不该顺手跳到结果页。
  if (renaming.value) return;
  void router.push(`/project/${props.run.projectId}/run/${props.run.id}`);
}

function openProjectCanvas() {
  uiStore.openPanel("projects");
  void router.push(`/project/${props.run.projectId}`);
}

function startRename() {
  renaming.value = true;
  renameValue.value = name.value;
  void nextTick(() => {
    nameInputRef.value?.focus();
    nameInputRef.value?.select();
  });
}

async function commitRename() {
  if (!renaming.value) return;
  const request = resolveRenameRequest(name.value, renameValue.value);
  renaming.value = false;
  if (!request) return;
  try {
    await runsStore.rename(props.run.id, request.name);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "重命名失败");
  }
}

function openContextMenu(event: MouseEvent) {
  openMenu(event.clientX, event.clientY);
}

function openMenu(x: number, y: number) {
  const running = props.run.status === "running";
  menuItems.value = [
    { key: "open", label: "查看运行详情", icon: Workflow },
    { key: "rename", label: name.value ? "重命名" : "起个名字", icon: Pencil },
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
    case "rename":
      startRename();
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
    await ElMessageBox.confirm(`相关节点结果与产物文件会一并删除。`, `删除运行「${name.value || `#${runShortId(props.run.id)}`}」`, {
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
    :title="renaming ? undefined : runRowTooltip(run)"
    @click="openRun"
    @contextmenu.prevent="openContextMenu($event)"
  >
    <span v-if="isRunning" class="wp-run-status is-running" :style="{ background: meta.color }" :title="meta.hint" />
    <input
      v-if="renaming"
      ref="nameInputRef"
      v-model="renameValue"
      class="wp-input wp-run-input"
      :maxlength="RUN_NAME_MAX_LENGTH"
      placeholder="留空则只按时间显示"
      @click.stop
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="renaming = false"
      @blur="commitRename"
    />
    <template v-else>
      <span class="wp-run-label">{{ name }}</span>
      <span class="wp-run-time tnum">{{ time }}</span>
    </template>

    <RowMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenuSelect" @close="menu = null" />
  </li>
</template>
