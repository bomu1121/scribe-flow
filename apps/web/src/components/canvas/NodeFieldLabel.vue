<script setup lang="ts">
import { ElTooltip } from "element-plus";
import { CircleHelp } from "lucide-vue-next";

defineProps<{
  label: string;
  hint?: string;
}>();
</script>

<template>
  <span class="sf-node-field-label">
    {{ label }}
    <el-tooltip v-if="hint" :content="hint" placement="top" effect="dark" :show-after="120" :hide-after="0">
      <span class="sf-node-hint-trigger" tabindex="0" aria-label="提示">
        <CircleHelp :size="13" />
      </span>
    </el-tooltip>
  </span>
</template>

<style scoped>
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
