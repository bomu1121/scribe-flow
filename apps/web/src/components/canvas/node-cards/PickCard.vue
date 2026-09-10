<script setup lang="ts">
import { computed } from "vue";
import { ElCheckbox } from "element-plus";
import type { NodePick, SegmentOption } from "@scribe-flow/shared";
import NodeFieldLabel from "../NodeFieldLabel.vue";

/**
 * 「素材挑选」节点卡片。
 *
 * 接在上游模块之后，识别它给出的那一堆素材，只放行勾选的几段。
 * 段标识（segmentKey）是设计与运行之间的接缝：这里勾的键，运行时按同一套键匹配。
 */
const props = defineProps<{
  options: SegmentOption[];
  pick?: NodePick;
  staleKeys?: string[];
  readonly?: boolean;
  /** 已选段数（由父组件按同一套规则算出，避免两处口径不一致）。 */
  selectedCount: number;
}>();

const emit = defineEmits<{ update: [value: NodePick] }>();

/** 该来源的当前选中集：没配过就是全选。 */
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

const total = computed(() => props.options.length);

/** 全选时删掉该来源的键，保持工程数据干净（缺省即全选）。 */
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
  writePick(originNodeId, checked ? [...current, key] : current.filter((item) => item !== key));
}

function toggleGroup(originNodeId: string, checked: boolean) {
  if (props.readonly) return;
  writePick(
    originNodeId,
    checked ? props.options.filter((option) => option.originNodeId === originNodeId).map((option) => option.key) : [],
  );
}

function durationText(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/**
 * 分P 标题：与素材标题重复时不显示。
 * B 站多选卡片里 part 常常就是 title（同一字段被写进两处），重复显示会很吵。
 */
function partText(option: SegmentOption): string {
  const part = String(option.part ?? "").trim();
  if (!part || part === option.title.trim()) return "";
  return part;
}
</script>

<template>
  <div class="sf-pick-card">
    <template v-if="groups.length > 0">
      <div class="sf-pick-head">
        <NodeFieldLabel label="放行哪些素材" hint="未勾选的素材不会流到下游" />
        <span class="sf-pick-count">{{ selectedCount }} / {{ total }} 段</span>
      </div>

      <div v-for="group in groups" :key="group.originNodeId" class="sf-pick-group" :class="{ 'is-only': groups.length === 1 }">
        <div class="sf-pick-group-head">
          <span v-if="groups.length > 1" class="sf-pick-group-name" :title="group.originLabel">{{ group.originLabel }}</span>
          <span v-else class="sf-pick-group-spacer" />
          <button
            type="button"
            class="sf-pick-all"
            :disabled="readonly"
            @click="toggleGroup(group.originNodeId, selectedOf(group.originNodeId).length !== group.items.length)"
          >
            {{ selectedOf(group.originNodeId).length === group.items.length ? "全不选" : "全选" }}
          </button>
        </div>
        <label v-for="option in group.items" :key="option.key" class="sf-pick-item" :title="option.title">
          <el-checkbox
            size="small"
            :model-value="selectedOf(group.originNodeId).includes(option.key)"
            :disabled="readonly"
            @update:model-value="(checked: boolean | string | number) => toggle(group.originNodeId, option.key, Boolean(checked))"
          />
          <span class="sf-pick-item-index">{{ String(option.index).padStart(2, "0") }}</span>
          <span class="sf-pick-item-title">{{ option.title }}</span>
          <span v-if="partText(option)" class="sf-pick-item-part">{{ partText(option) }}</span>
          <span v-if="durationText(option.duration)" class="sf-pick-item-time">{{ durationText(option.duration) }}</span>
        </label>
      </div>

      <p v-if="selectedCount === 0" class="sf-pick-warn">一段都没选，这个节点将无法运行。</p>
      <p v-else-if="staleKeys && staleKeys.length > 0" class="sf-pick-warn">
        有 {{ staleKeys.length }} 段已不在上游（来源卡片可能被改过），保存后会被忽略。
      </p>
    </template>

    <template v-else>
      <p class="sf-node-desc sf-node-desc--block">把上游模块连进来，这里会列出它给出的素材，供你勾选要放行的几段</p>
      <p class="sf-node-desc sf-node-desc--block sf-pick-hint-weak">上游是多份素材时（一张卡多选、或多张卡汇入）才需要挑选</p>
    </template>
  </div>
</template>

<style scoped>
.sf-pick-card {
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

.sf-pick-count {
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
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

/* 只有一个来源时没有分组标题要显示，但仍要把「全不选」推到右侧。 */
.sf-pick-group-spacer {
  flex: 1 1 auto;
}

.sf-pick-group.is-only {
  padding-top: 2px;
  border-top: none;
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

.sf-pick-hint-weak {
  color: var(--color-text-tertiary);
}
</style>
