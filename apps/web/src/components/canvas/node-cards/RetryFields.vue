<script setup lang="ts">
import { ElInputNumber } from "element-plus/es/components/input-number/index.mjs";

const props = defineProps<{ retry?: { maxRetries?: number; backoffMs?: number } }>();
const emit = defineEmits<{ update: [value: { maxRetries?: number; backoffMs?: number }] }>();

function setMax(value: number | undefined) {
  emit("update", { ...props.retry, maxRetries: value ?? 2 });
}

function setBackoff(value: number | undefined) {
  emit("update", { ...props.retry, backoffMs: value ?? 3000 });
}
</script>

<template>
  <div class="sf-retry-fields">
    <label class="sf-node-field">
      <span class="sf-node-field-label">最大重试</span>
      <el-input-number :model-value="retry?.maxRetries ?? 2" :min="0" :max="10" size="small" @update:model-value="setMax" />
    </label>
    <label class="sf-node-field">
      <span class="sf-node-field-label">退避间隔（ms）</span>
      <el-input-number :model-value="retry?.backoffMs ?? 3000" :min="100" :max="60000" :step="500" size="small" @update:model-value="setBackoff" />
    </label>
  </div>
</template>

<style scoped>
.sf-retry-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/*
 * 与高级设置其余部分同一套行式排法（文案左、控件右），见 ScribeNode 的 .sf-node-advanced。
 * 这两项紧跟「失败重试」小标题，如果还按「标签在上」排会和上面的行走两种节奏。
 */
.sf-retry-fields .sf-node-field {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-height: var(--control-height-sm);
}

.sf-retry-fields .sf-node-field-label {
  flex: 1 1 auto;
  min-width: 0;
}

.sf-retry-fields .el-input-number {
  flex: none;
  width: 108px;
}
</style>
