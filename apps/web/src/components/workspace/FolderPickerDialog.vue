<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog } from "element-plus";
import { Folder, FolderOpen, Inbox } from "lucide-vue-next";
import type { ProjectFolder } from "@scribe-flow/shared";
import { buildFolderPath, folderChildrenOf } from "./project-tree-utils";

const props = defineProps<{
  open: boolean;
  title: string;
  /** 当前所在文件夹（移动到该处视为未变更，置灰）。 */
  currentId?: string | null;
  /** 移动文件夹时禁止落入的文件夹 ID 集合（自身 + 子孙）。 */
  blockedIds?: string[];
  folders: ProjectFolder[];
  /** 根层级文案。 */
  rootLabel?: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  confirm: [folderId: string | null];
}>();

const selected = ref<string | null>(null);

const dialogVisible = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

watch(
  () => props.open,
  (open) => {
    if (open) selected.value = props.currentId ?? null;
  },
);

function close() {
  emit("update:open", false);
}

function isBlocked(folderId: string): boolean {
  return Boolean(props.blockedIds?.includes(folderId));
}

const rows = computed(() => {
  const list: { folder: ProjectFolder | null; depth: number }[] = [{ folder: null, depth: 0 }];
  const walk = (parentId: string | null, depth: number) => {
    for (const child of folderChildrenOf(props.folders, parentId)) {
      list.push({ folder: child, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 1);
  return list;
});

function confirm() {
  emit("confirm", selected.value);
  close();
}
</script>

<template>
  <ElDialog v-model="dialogVisible" :title="title" width="420px" align-center @closed="selected = null">
    <p class="fp-hint">选择目标文件夹；放在根层级表示「{{ rootLabel || "根层级" }}」。</p>
    <div class="fp-list" role="listbox" aria-label="目标文件夹">
      <button
        v-for="row in rows"
        :key="row.folder ? row.folder.id : '__root__'"
        type="button"
        role="option"
        class="fp-item"
        :class="{ active: selected === (row.folder ? row.folder.id : null), disabled: Boolean(row.folder && (row.folder.id === currentId || isBlocked(row.folder.id))) }"
        :disabled="Boolean(row.folder && (row.folder.id === currentId || isBlocked(row.folder.id)))"
        :style="{ paddingLeft: `${10 + row.depth * 18}px` }"
        @click="selected = row.folder ? row.folder.id : null"
      >
        <Inbox v-if="!row.folder" :size="14" class="fp-icon" />
        <Folder v-else :size="14" class="fp-icon" />
        <span class="fp-name">{{ row.folder ? row.folder.name : rootLabel || "根层级" }}</span>
        <span v-if="row.folder" class="fp-path">{{ buildFolderPath(folders, row.folder.parentId) }}</span>
        <FolderOpen v-if="selected === (row.folder ? row.folder.id : null)" :size="14" class="fp-check" />
      </button>
    </div>
    <template #footer>
      <el-button plain @click="close">取消</el-button>
      <el-button type="primary" @click="confirm">移动</el-button>
    </template>
  </ElDialog>
</template>
