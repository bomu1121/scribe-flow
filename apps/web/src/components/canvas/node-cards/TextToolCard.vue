<script setup lang="ts">
import { computed } from "vue";
import { ElInput } from "element-plus";
import ModelSelect from "../../ModelSelect.vue";
import NodeFieldLabel from "../NodeFieldLabel.vue";

const props = defineProps<{
  operation?: "findReplace" | "regexReplace" | "template" | "cleanup";
  find?: string;
  replace?: string;
  pattern?: string;
  flags?: string;
  template?: string;
}>();
const emit = defineEmits<{
  update: [value: { operation: "findReplace" | "regexReplace" | "template" | "cleanup"; find?: string; replace?: string; pattern?: string; flags?: string; template?: string }];
}>();

const operation = computed(() => props.operation ?? "findReplace");

const operationOptions = [
  { label: "查找替换", value: "findReplace" },
  { label: "正则替换", value: "regexReplace" },
  { label: "模板渲染", value: "template" },
  { label: "清理", value: "cleanup" },
];

function setOperation(value: string) {
  emit("update", { operation: value as "findReplace" | "regexReplace" | "template" | "cleanup" });
}

function patch(p: Record<string, string>) {
  emit("update", { operation: operation.value, find: props.find, replace: props.replace, pattern: props.pattern, flags: props.flags, template: props.template, ...p });
}
</script>

<template>
  <div class="sf-text-tool-card">
    <div class="sf-node-field">
      <NodeFieldLabel label="操作" :hint="operation === 'cleanup' ? '去除首尾空白、压缩连续空行、删除行尾空格' : undefined" />
      <ModelSelect :model-value="operation" :options="operationOptions" size="small" @update:model-value="setOperation" />
    </div>

    <template v-if="operation === 'findReplace'">
      <label class="sf-node-field">
        <NodeFieldLabel label="查找" hint="要查找的文字" />
        <el-input :model-value="find ?? ''" size="small" placeholder="输入内容…" @update:model-value="(v: string | number) => patch({ find: String(v) })" />
      </label>
      <label class="sf-node-field">
        <NodeFieldLabel label="替换为" hint="留空表示删除" />
        <el-input :model-value="replace ?? ''" size="small" placeholder="输入内容…" @update:model-value="(v: string | number) => patch({ replace: String(v) })" />
      </label>
    </template>

    <template v-else-if="operation === 'regexReplace'">
      <label class="sf-node-field">
        <NodeFieldLabel label="正则" hint="例如：\s+" />
        <el-input :model-value="pattern ?? ''" size="small" placeholder="输入内容…" @update:model-value="(v: string | number) => patch({ pattern: String(v) })" />
      </label>
      <label class="sf-node-field">
        <NodeFieldLabel label="替换为" hint="例如：空格" />
        <el-input :model-value="replace ?? ''" size="small" placeholder="输入内容…" @update:model-value="(v: string | number) => patch({ replace: String(v) })" />
      </label>
      <label class="sf-node-field">
        <NodeFieldLabel label="标志" hint="例如：gi" />
        <el-input :model-value="flags ?? ''" size="small" placeholder="输入内容…" @update:model-value="(v: string | number) => patch({ flags: String(v) })" />
      </label>
    </template>

    <template v-else-if="operation === 'template'">
      <label class="sf-node-field">
        <NodeFieldLabel :label="'模板（{{input}} 为正文）'" :hint="'例如：以下是整理后的笔记：\\n\\n{{input}}'" />
        <el-input
          :model-value="template ?? ''"
          type="textarea"
          :rows="3"
          size="small"
          placeholder="输入内容…"
          @update:model-value="(v: string | number) => patch({ template: String(v) })"
        />
      </label>
    </template>
  </div>
</template>

<style scoped>
.sf-text-tool-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
