<script setup lang="ts">
import { computed } from "vue";
import { ElInput, ElSelect, ElOption } from "element-plus";

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

function setOperation(value: string) {
  emit("update", { operation: value as "findReplace" | "regexReplace" | "template" | "cleanup" });
}

function patch(p: Record<string, string>) {
  emit("update", { operation: operation.value, find: props.find, replace: props.replace, pattern: props.pattern, flags: props.flags, template: props.template, ...p });
}
</script>

<template>
  <div class="sf-text-tool-card">
    <label class="sf-node-field">
      <span class="sf-node-field-label">操作</span>
      <el-select :model-value="operation" size="small" @update:model-value="setOperation">
        <el-option label="查找替换" value="findReplace" />
        <el-option label="正则替换" value="regexReplace" />
        <el-option label="模板渲染" value="template" />
        <el-option label="清理" value="cleanup" />
      </el-select>
    </label>

    <template v-if="operation === 'findReplace'">
      <label class="sf-node-field">
        <span class="sf-node-field-label">查找</span>
        <el-input :model-value="find ?? ''" size="small" placeholder="要查找的文字" @update:model-value="(v: string | number) => patch({ find: String(v) })" />
      </label>
      <label class="sf-node-field">
        <span class="sf-node-field-label">替换为</span>
        <el-input :model-value="replace ?? ''" size="small" placeholder="留空表示删除" @update:model-value="(v: string | number) => patch({ replace: String(v) })" />
      </label>
    </template>

    <template v-else-if="operation === 'regexReplace'">
      <label class="sf-node-field">
        <span class="sf-node-field-label">正则</span>
        <el-input :model-value="pattern ?? ''" size="small" placeholder="如 \s+" @update:model-value="(v: string | number) => patch({ pattern: String(v) })" />
      </label>
      <label class="sf-node-field">
        <span class="sf-node-field-label">替换为</span>
        <el-input :model-value="replace ?? ''" size="small" placeholder="如（空格）" @update:model-value="(v: string | number) => patch({ replace: String(v) })" />
      </label>
      <label class="sf-node-field">
        <span class="sf-node-field-label">标志</span>
        <el-input :model-value="flags ?? ''" size="small" placeholder="如 gi" @update:model-value="(v: string | number) => patch({ flags: String(v) })" />
      </label>
    </template>

    <template v-else-if="operation === 'template'">
      <label class="sf-node-field">
        <span v-pre class="sf-node-field-label">模板（{{input}} 为正文）</span>
        <el-input
          :model-value="template ?? ''"
          type="textarea"
          :rows="3"
          size="small"
          :placeholder="'例如：以下是整理后的笔记：\\n\\n{{input}}'"
          @update:model-value="(v: string | number) => patch({ template: String(v) })"
        />
      </label>
    </template>

    <div v-else class="sf-node-hint">去除首尾空白、压缩连续空行、删除行尾空格</div>
  </div>
</template>

<style scoped>
.sf-text-tool-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
