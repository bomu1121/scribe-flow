<script setup lang="ts">
import { ElInputNumber } from "element-plus";

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
  gap: 8px;
}
</style>
