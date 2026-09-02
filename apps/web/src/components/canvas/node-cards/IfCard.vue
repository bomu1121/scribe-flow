<script setup lang="ts">
import { computed } from "vue";
import { ElInput, ElSelect, ElOption } from "element-plus";

const props = defineProps<{
  condition?: { field: "charCount" | "wordCount" | "contains"; op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains"; value: string };
}>();
const emit = defineEmits<{ update: [value: { field: "charCount" | "wordCount" | "contains"; op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains"; value: string }] }>();

const isContains = computed(() => (props.condition?.field ?? "charCount") === "contains");

function setField(value: string) {
  const field = value as "charCount" | "wordCount" | "contains";
  const op = field === "contains" ? "contains" : "gt";
  emit("update", { field, op, value: props.condition?.value ?? "" });
}

function setOp(value: string) {
  emit("update", {
    field: props.condition?.field ?? "charCount",
    op: value as "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains",
    value: props.condition?.value ?? "",
  });
}

function setValue(value: string | number) {
  emit("update", { ...(props.condition ?? { field: "charCount", op: "gt", value: "" }), value: String(value) });
}
</script>

<template>
  <div class="sf-if-card">
    <label class="sf-node-field">
      <span class="sf-node-field-label">判断字段</span>
      <el-select :model-value="condition?.field ?? 'charCount'" size="small" @update:model-value="setField">
        <el-option label="字数" value="charCount" />
        <el-option label="词数" value="wordCount" />
        <el-option label="包含" value="contains" />
      </el-select>
    </label>
    <label class="sf-node-field">
      <span class="sf-node-field-label">条件</span>
      <el-select :model-value="condition?.op ?? (isContains ? 'contains' : 'gt')" size="small" @update:model-value="setOp">
        <template v-if="isContains">
          <el-option label="包含" value="contains" />
          <el-option label="不包含" value="notContains" />
        </template>
        <template v-else>
          <el-option label="大于" value="gt" />
          <el-option label="大于等于" value="gte" />
          <el-option label="小于" value="lt" />
          <el-option label="小于等于" value="lte" />
          <el-option label="等于" value="eq" />
        </template>
      </el-select>
    </label>
    <label class="sf-node-field">
      <span class="sf-node-field-label">{{ isContains ? "匹配文字" : "比较值" }}</span>
      <el-input
        :model-value="condition?.value ?? ''"
        size="small"
        :placeholder="isContains ? '输入要匹配的文字' : '如 5000'"
        @update:model-value="setValue"
      />
    </label>
    <div class="sf-node-hint">满足走「是」，否则走「否」；未命中分支自动跳过</div>
  </div>
</template>

<style scoped>
.sf-if-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
