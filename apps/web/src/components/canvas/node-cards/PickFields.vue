<script setup lang="ts">
import { computed } from "vue";
import { ElCheckbox } from "element-plus";
import type { NodePick, SegmentOption } from "@scribe-flow/shared";

/**
 * 素材挑选（节点高级设置内）。
 *
 * 只在「上游存在两张及以上来源卡」时才由父组件渲染，因此单素材链路里它根本不出现，
 * 不需要靠藏起来实现「隐蔽」。语义：未勾选的素材不进入本节点，其下游因拿不到数据一并跳过。
 */
const props = defineProps<{
  options: SegmentOption[];
  pick?: NodePick;
  /** 已配置但当前已不存在的素材段标识（上游换了选区时会提醒）。 */
  staleKeys?: string[];
  readonly?: boolean;
}>();

const emit = defineEmits<{ update: [value: NodePick] }>();

/** 该来源的默认选中集：没配过就是全选。 */
function selectedOf(originNodeId: string): string[] {
  const configured = props.pick?.[originNodeId];
  if (configured) return configured;
  return props.options.filter((option) => option.originNodeId === originNodeId).map((option) => option.key);
}

const groups = computed(() => {
  const order: string[] = [];
  const map = new Map<string, { originNodeId: string; originLabel: string; items: SegmentOption[] }>();
  for (const option of props.options) {
    let group = map.get(option.originNodeId);
    if (!group) {
      group = { originNodeId: option.originNodeId, originLabel: option.originLabel, items: [] };
      map.set(option.originNodeId, group);
      order.push(option.originNodeId);
    }
    group.items.push(option);
  }
  return order.map((id) => map.get(id)!);
});

const selectedCount = computed(() => groups.value.reduce((sum, group) => sum + selectedOf(group.originNodeId).length, 0));
const totalCount = computed(() => props.options.length);

/** 全选时删除该来源的键，让工程数据保持干净（缺省即全选）。 */
function writePick(originNodeId: string, keys: string[]) {
  const next: NodePick = { ...(props.pick ?? {}) };
  const all = props.options.filter((option) => option.originNodeId === originNodeId).map((option) => option.key);
  if (keys.length === all.length && all.every((key) => keys.includes(key))) delete next[originNodeId];
  else next[originNodeId] = keys;
  emit("update", next);
}

function toggle(originNodeId: string, key: string, checked: boolean) {
  if (props.readonly) return;
  const current = selectedOf(originNodeId);
  const next = checked ? [...current, key] : current.filter((item) => item !== key);
  writePick(originNodeId, next);
}

function toggleGroup(originNodeId: string, checked: boolean) {
  if (props.readonly) return;
  writePick(originNodeId, checked ? props.options.filter((option) => option.originNodeId === originNodeId).map((option) => option.key) : []);
}

function durationText(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}
</script>

<template>
  <div class="sf-pick-fields">
    <div class="sf-pick-head">
      <span class="sf-pick-title">只加工选中的素材</span>
      <span class="sf-pick-count">{{ selectedCount }} / {{ totalCount }} 段</span>
    </div>
    <p class="sf-pick-hint">未选中的素材不会进入这个节点，它的下游也会一并跳过。</p>

    <div v-for="group in groups" :key="group.originNodeId" class="sf-pick-group">
      <div class="sf-pick-group-head">
        <span class="sf-pick-group-name" :title="group.originLabel">{{ group.originLabel }}</span>
        <button
          type="button"
          class="sf-pick-all"
          :disabled="readonly"
          @click="toggleGroup(group.originNodeId, selectedOf(group.originNodeId).length !== group.items.length)"
        >
          {{ selectedOf(group.originNodeId).length === group.items.length ? "全不选" : "全选" }}
        </button>
      </div>
      <label v-for="option in group.items" :key="option.key" class="sf-pick-item" :title="option.key">
        <el-checkbox
          size="small"
          :model-value="selectedOf(group.originNodeId).includes(option.key)"
          :disabled="readonly"
          @update:model-value="(checked: boolean | string | number) => toggle(group.originNodeId, option.key, Boolean(checked))"
        />
        <span class="sf-pick-item-index">{{ String(option.index).padStart(2, "0") }}</span>
        <span class="sf-pick-item-title">{{ option.title }}</span>
        <span v-if="option.part" class="sf-pick-item-part">{{ option.part }}</span>
        <span v-if="durationText(option.duration)" class="sf-pick-item-time">{{ durationText(option.duration) }}</span>
      </label>
    </div>

    <p v-if="selectedCount === 0" class="sf-pick-warn">一段都没选，这个节点将无法运行。</p>
    <p v-else-if="staleKeys && staleKeys.length > 0" class="sf-pick-warn">
      有 {{ staleKeys.length }} 段已不在上游（来源卡片可能被改过），保存后会被忽略。
    </p>
  </div>
</template>

<style scoped>
.sf-pick-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sf-pick-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.sf-pick-title {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-pick-count {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-pick-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

.sf-pick-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0 2px;
  border-top: 1px solid var(--color-border-subtle, var(--color-border));
}

.sf-pick-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.sf-pick-group-name {
  overflow: hidden;
  font-size: 11px;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-pick-all {
  flex-shrink: 0;
  padding: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  background: none;
  border: none;
}

.sf-pick-all:disabled {
  cursor: default;
  opacity: 0.5;
}

.sf-pick-all:hover:not(:disabled) {
  color: var(--color-text-secondary);
}

.sf-pick-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  cursor: pointer;
}

.sf-pick-item-index {
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-pick-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--color-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-pick-item-part,
.sf-pick-item-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-pick-warn {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-warning, var(--color-text-secondary));
}
</style>
