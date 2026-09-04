<script setup lang="ts">
import { computed } from "vue";
import { ElInput } from "element-plus";
import ModelSelect from "../../ModelSelect.vue";
import NodeFieldLabel from "../NodeFieldLabel.vue";

const props = defineProps<{
  condition?: { field: "charCount" | "wordCount" | "contains"; op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains"; value: string };
}>();
const emit = defineEmits<{ update: [value: { field: "charCount" | "wordCount" | "contains"; op: "gt" | "gte" | "lt" | "lte" | "eq" | "contains" | "notContains"; value: string }] }>();

const isContains = computed(() => (props.condition?.field ?? "charCount") === "contains");

const fieldOptions = [
  { label: "字数", value: "charCount" },
  { label: "词数", value: "wordCount" },
  { label: "包含", value: "contains" },
];

const numericOpOptions = [
  { label: "大于", value: "gt" },
  { label: "大于等于", value: "gte" },
  { label: "小于", value: "lt" },
  { label: "小于等于", value: "lte" },
  { label: "等于", value: "eq" },
];

const containsOpOptions = [
  { label: "包含", value: "contains" },
  { label: "不包含", value: "notContains" },
];

const opOptions = computed(() => (isContains.value ? containsOpOptions : numericOpOptions));

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
    <div class="sf-node-field">
      <NodeFieldLabel label="判断字段" hint="满足走「是」，否则走「否」；未命中分支自动跳过" />
      <ModelSelect :model-value="condition?.field ?? 'charCount'" :options="fieldOptions" size="small" @update:model-value="setField" />
    </div>
    <div class="sf-node-field">
      <span class="sf-node-field-label">条件</span>
      <ModelSelect :model-value="condition?.op ?? (isContains ? 'contains' : 'gt')" :options="opOptions" size="small" @update:model-value="setOp" />
    </div>
    <label class="sf-node-field">
      <NodeFieldLabel
        :label="isContains ? '匹配文字' : '比较值'"
        :hint="isContains ? '输入要匹配的文字' : '例如：5000'"
      />
      <el-input
        :model-value="condition?.value ?? ''"
        size="small"
        placeholder="输入内容…"
        @update:model-value="setValue"
      />
    </label>
  </div>
</template>

<style scoped>
.sf-if-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
