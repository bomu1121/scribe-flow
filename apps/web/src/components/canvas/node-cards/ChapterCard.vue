<script setup lang="ts">
import { ElInputNumber, ElSelect, ElOption } from "element-plus";

const props = defineProps<{ granularity?: "coarse" | "medium" | "fine"; maxChapters?: number }>();
const emit = defineEmits<{ update: [value: { granularity: "coarse" | "medium" | "fine"; maxChapters: number }] }>();

function setGranularity(value: string) {
  emit("update", { granularity: value as "coarse" | "medium" | "fine", maxChapters: props.maxChapters ?? 20 });
}

function setMaxChapters(value: number | undefined) {
  emit("update", { granularity: props.granularity ?? "medium", maxChapters: value ?? 20 });
}
</script>

<template>
  <div class="sf-chapter-card">
    <label class="sf-node-field">
      <span class="sf-node-field-label">粒度</span>
      <el-select :model-value="granularity ?? 'medium'" size="small" @update:model-value="setGranularity">
        <el-option label="粗（少章节）" value="coarse" />
        <el-option label="中（默认）" value="medium" />
        <el-option label="细（多章节）" value="fine" />
      </el-select>
    </label>
    <label class="sf-node-field">
      <span class="sf-node-field-label">最多章节</span>
      <el-input-number :model-value="maxChapters ?? 20" :min="1" :max="50" size="small" @update:model-value="setMaxChapters" />
    </label>
    <div class="sf-node-hint">输出多个「章节」笔记块，可接合并节点生成带目录笔记</div>
  </div>
</template>

<style scoped>
.sf-chapter-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
