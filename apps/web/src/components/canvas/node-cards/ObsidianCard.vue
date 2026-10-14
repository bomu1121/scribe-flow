<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElOption, ElSelect } from "element-plus/es/components/select/index.mjs";
import { RefreshCw } from "lucide-vue-next";
import { useSettingsStore } from "@/stores/settings";
import NodeFieldLabel from "../NodeFieldLabel.vue";

defineProps<{ folder?: string }>();
const emit = defineEmits<{ update: [value: { folder?: string }] }>();

/**
 * 画布缩放（由节点外壳 provide）：这个 el-select 的浮层会被 Teleport 到 body，
 * 出了 Vue Flow 的 transform 子树，所以得把缩放一路写进浮层里 —— 口径与自研 ModelSelect 一致，
 * 落点与理由见 element-theme.css 的 `.sf-canvas-zoom-popper` 那条。
 */
const flowZoom = inject<{ value: number } | number>("sf-flow-zoom", 1);
const canvasZoom = computed(() => (typeof flowZoom === "number" ? flowZoom : flowZoom.value));
const popperStyle = computed(() => ({ "--sf-canvas-zoom": String(canvasZoom.value) }));

const store = useSettingsStore();
const folders = computed(() => store.obsidianFolders);
const refreshing = ref(false);
/**
 * 设置页里的默认保存目录：节点留空时实际写到这儿。
 *
 * 占位文案必须说的是这件事——早先写死成「默认 00-Inbox」，而 00-Inbox 只是产品默认值，
 * 用户改了设置之后卡片仍显示这个名字，看起来像"它擅自放了一个我库里没有的目录"。
 */
const defaultFolder = computed(() => store.settings?.obsidian.folder || "");

const hint = computed(() => {
  if (folders.value.length === 0) return "目录列表为空，请先到设置页读取 Obsidian 目录";
  return defaultFolder.value
    ? `留空即跟随设置里的默认目录（${defaultFolder.value}）；标题 / 来源 / 作者 / 链接自动从上游获取`
    : "留空即跟随设置里的默认目录；标题 / 来源 / 作者 / 链接自动从上游获取";
});

async function refreshFolders() {
  refreshing.value = true;
  try {
    await store.loadObsidianFolders();
  } finally {
    refreshing.value = false;
  }
}

function onFolderChange(value: string | number | undefined) {
  emit("update", { folder: value ? String(value) : "" });
}
</script>

<template>
  <div class="sf-obsidian-card">
    <div class="sf-node-field">
      <NodeFieldLabel label="保存目录" :hint="hint" />
      <div class="sf-obsidian-folder-row">
        <ElSelect
          :model-value="folder || ''"
          class="sf-node-control"
          size="small"
          clearable
          filterable
          popper-class="sf-canvas-zoom-popper"
          :popper-style="popperStyle"
          :loading="refreshing"
          :placeholder="defaultFolder ? `跟随设置：${defaultFolder}` : '跟随设置'"
          @update:model-value="onFolderChange"
        >
          <ElOption v-for="dir in folders" :key="dir" :label="dir" :value="dir" />
        </ElSelect>
        <ElButton size="small" text :loading="refreshing" title="重新读取目录" @click="refreshFolders">
          <RefreshCw :size="13" />
        </ElButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sf-obsidian-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sf-obsidian-folder-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
