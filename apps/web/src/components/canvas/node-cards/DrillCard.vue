<script setup lang="ts">
import { computed } from "vue";
import { ElCheckbox, ElInput, ElInputNumber, ElSwitch } from "element-plus";
import { DRILL_KINDS, DRILL_KIND_LABELS, type DrillDifficulty, type DrillKind } from "@scribe-flow/shared";
import ModelSelect from "../../ModelSelect.vue";
import NodeFieldLabel from "../NodeFieldLabel.vue";

const props = defineProps<{
  pointCount?: number;
  kinds?: DrillKind[];
  difficulty?: DrillDifficulty;
  withExtensions?: boolean;
  focus?: string;
  hasInput?: boolean;
}>();

const emit = defineEmits<{
  update: [
    value: { pointCount?: number; kinds?: DrillKind[]; difficulty?: DrillDifficulty; withExtensions?: boolean; focus?: string },
  ];
  /** 提交历史：文本框类字段失焦时调用，与其它卡片一致。 */
  commit: [];
}>();

const DEFAULT_KINDS: DrillKind[] = ["single", "judge", "cloze"];

const difficultyOptions = [
  { label: "基础（没接触过也能答）", value: "basic" },
  { label: "适中（理解原文即可）", value: "medium" },
  { label: "挑战（需要推理）", value: "hard" },
];

const selectedKinds = computed<DrillKind[]>(() => props.kinds ?? DEFAULT_KINDS);

function setPointCount(value: number | undefined) {
  emit("update", { pointCount: clampCount(value) });
  emit("commit");
}

function toggleKind(kind: DrillKind, checked: boolean) {
  const next = checked ? [...selectedKinds.value, kind] : selectedKinds.value.filter((item) => item !== kind);
  // 至少保留一种题型：取消最后一种时回滚，避免运行期无题可出。
  const kinds = next.length > 0 ? DRILL_KINDS.filter((item) => next.includes(item)) : selectedKinds.value;
  emit("update", { kinds: [...kinds] });
  emit("commit");
}

function setDifficulty(value: string) {
  emit("update", { difficulty: value as DrillDifficulty });
  emit("commit");
}

function setWithExtensions(value: boolean) {
  emit("update", { withExtensions: value });
  emit("commit");
}

function setFocus(value: string) {
  emit("update", { focus: value });
}

function clampCount(value: number | undefined): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 6;
  return Math.min(12, Math.max(3, Math.round(num)));
}
</script>

<template>
  <div class="sf-drill-card">
    <label class="sf-node-field">
      <NodeFieldLabel label="考察点数量" hint="先提炼可考察的知识点，再按知识点出题" />
      <el-input-number :model-value="pointCount ?? 6" :min="3" :max="12" size="small" @update:model-value="setPointCount" />
    </label>

    <div class="sf-node-field">
      <NodeFieldLabel label="题型" hint="至少选一种；判断题固定「正确 / 错误」" />
      <div class="sf-drill-kinds">
        <el-checkbox
          v-for="kind in DRILL_KINDS"
          :key="kind"
          :model-value="selectedKinds.includes(kind)"
          size="small"
          @update:model-value="(checked: boolean | string | number) => toggleKind(kind, Boolean(checked))"
        >
          {{ DRILL_KIND_LABELS[kind] }}
        </el-checkbox>
      </div>
    </div>

    <div class="sf-node-field">
      <NodeFieldLabel label="难度" />
      <ModelSelect :model-value="difficulty ?? 'medium'" :options="difficultyOptions" size="small" @update:model-value="setDifficulty" />
    </div>

    <label class="sf-node-field sf-node-field--row">
      <span class="sf-node-field-label">输出延伸问题</span>
      <el-switch
        :model-value="withExtensions ?? true"
        size="small"
        @update:model-value="(value: string | number | boolean) => setWithExtensions(Boolean(value))"
      />
    </label>

    <label class="sf-node-field">
      <span class="sf-node-field-label">考察侧重（可选）</span>
      <el-input
        class="sf-node-control"
        size="small"
        :model-value="focus ?? ''"
        placeholder="如：只考察数据与结论"
        @update:model-value="(v: string | number) => setFocus(String(v))"
        @blur="emit('commit')"
      />
    </label>

    <p v-if="hasInput === false" class="sf-node-desc sf-node-desc--block">把一段文稿或笔记连进来</p>
    <p v-else class="sf-node-desc sf-node-desc--block">运行后在结果页「练一练」答题</p>
  </div>
</template>

<style scoped>
.sf-drill-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sf-drill-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.sf-node-field--row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
</style>
