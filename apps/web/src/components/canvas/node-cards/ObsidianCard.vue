<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElOption, ElSelect } from "element-plus";
import { RefreshCw } from "lucide-vue-next";
import { useSettingsStore } from "@/stores/settings";
import NodeFieldLabel from "../NodeFieldLabel.vue";

const props = defineProps<{ folder?: string }>();
const emit = defineEmits<{ update: [value: { folder?: string }] }>();

const store = useSettingsStore();
const folders = computed(() => store.obsidianFolders);
const refreshing = ref(false);

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
      <NodeFieldLabel
        label="保存目录"
        :hint="folders.length === 0 ? '目录列表为空，请先到设置页读取 Obsidian 目录' : '标题 / 来源 / 作者 / 链接自动从上游获取，无需填写'"
      />
      <div class="sf-obsidian-folder-row">
        <ElSelect
          :model-value="folder || ''"
          class="sf-node-control"
          size="small"
          clearable
          filterable
          :loading="refreshing"
          placeholder="选择目录（默认 00-Inbox）"
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
