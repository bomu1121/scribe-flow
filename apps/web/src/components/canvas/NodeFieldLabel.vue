<script setup lang="ts">
import { ElTooltip } from "element-plus/es/components/tooltip/index.mjs";
import { CircleHelp } from "lucide-vue-next";

defineProps<{
  label: string;
  hint?: string;
}>();
</script>

<template>
  <span class="sf-node-field-label">
    <span class="sf-node-field-label-text">{{ label }}</span>
    <el-tooltip v-if="hint" :content="hint" placement="top" effect="dark" :show-after="120" :hide-after="0">
      <span class="sf-node-hint-trigger" tabindex="0" aria-label="提示">
        <CircleHelp :size="13" />
      </span>
    </el-tooltip>
  </span>
</template>

<style scoped>
/*
 * 标签文字单独一层：行式排法里（高级设置的行）标签要与右侧控件抢宽度，
 * 长标签得能先截断，而 ⓘ 不许被压扁。标签在上的排法下容器本就是这个宽度，这层不产生视觉变化。
 */
.sf-node-field-label-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-node-hint-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
  border-radius: 50%;
  cursor: help;
  flex-shrink: 0;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-node-hint-trigger:hover,
.sf-node-hint-trigger:focus-visible {
  color: var(--color-text);
  background: var(--color-ink-soft);
  outline: none;
}
</style>
