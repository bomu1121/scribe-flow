<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElOption, ElSelect } from "element-plus";
import { Copy, X } from "lucide-vue-next";
import type { PromptBlock } from "@scribe-flow/shared";
import { toast } from "@/lib/toast";
import DiffViewer from "./DiffViewer.vue";

const props = defineProps<{
  open: boolean;
  blocks: PromptBlock[];
  initialBlockId?: string;
}>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const ALL_SERIES = "__all__";
const seriesFilter = ref("");
const leftId = ref("");
const rightId = ref("");

function blockSeries(block: PromptBlock): string {
  return block.series || (block.builtin ? "其他内置" : "自定义");
}

function blockOptionLabel(block: PromptBlock): string {
  const version = block.version ? ` · ${block.version}` : "";
  const recommended = block.recommended ? " · 推荐" : "";
  return `${block.name}${version}${recommended}`;
}

function blockMetaLabel(block: PromptBlock | undefined): string {
  if (!block) return "未选择";
  return block.version ? `${block.name}（${block.version}）` : block.name;
}

function blockRecipeSummary(block: PromptBlock | undefined): string {
  if (!block?.recipe?.steps?.length) return "无配方（单次调用）";
  return block.recipe.steps.map((step) => `${step.id} · ${step.label}`).join(" → ");
}

function blockComparableContent(block: PromptBlock | undefined): string {
  if (!block) return "";
  const prompt = block.prompt ?? "";
  if (!block.recipe?.steps?.length) return prompt;
  const recipe = [
    "【配方 / Recipe】",
    `步骤数：${block.recipe.steps.length}`,
    ...block.recipe.steps.map((step, index) => {
      const expects = step.expects ? `\n期望输出：${step.expects.kind}${step.expects.asserts?.length ? `（${step.expects.asserts.length} 条断言）` : ""}` : "";
      return `\n[步骤 ${index + 1} / ${step.id}] ${step.label}${expects}\n${step.system}`;
    }),
  ].join("\n");
  return `${prompt}\n\n${recipe}`;
}

const seriesOptions = computed(() => {
  if (props.blocks.length < 2) return [];
  const counts = new Map<string, number>();
  for (const block of props.blocks) {
    const series = blockSeries(block);
    counts.set(series, (counts.get(series) ?? 0) + 1);
  }
  const options: Array<{ value: string; label: string }> = [{ value: ALL_SERIES, label: "全部系列（可跨块对比）" }];
  for (const [series, count] of counts) {
    if (count >= 2) options.push({ value: series, label: `${series}（${count}）` });
  }
  return options;
});

const compareBlocks = computed(() => {
  if (seriesFilter.value === ALL_SERIES) return props.blocks;
  return props.blocks.filter((block) => blockSeries(block) === seriesFilter.value);
});

const leftBlock = computed(() => props.blocks.find((block) => block.id === leftId.value));
const rightBlock = computed(() => props.blocks.find((block) => block.id === rightId.value));
const leftContent = computed(() => blockComparableContent(leftBlock.value));
const rightContent = computed(() => blockComparableContent(rightBlock.value));
const leftLabel = computed(() => blockMetaLabel(leftBlock.value));
const rightLabel = computed(() => blockMetaLabel(rightBlock.value));

function resetCompare(blockId?: string) {
  const initial = props.blocks.find((block) => block.id === blockId);
  const initialSeries = initial ? blockSeries(initial) : "";

  if (initialSeries && seriesOptions.value.some((option) => option.value === initialSeries)) {
    seriesFilter.value = initialSeries;
  } else if (!seriesOptions.value.some((option) => option.value === seriesFilter.value)) {
    seriesFilter.value = seriesOptions.value[0]?.value ?? "";
  }

  const group = compareBlocks.value;
  if (group.length < 2) {
    leftId.value = group[0]?.id ?? "";
    rightId.value = "";
    return;
  }

  const preferred = initial && group.some((block) => block.id === initial.id) ? initial.id : group.find((block) => block.recommended)?.id ?? group[0]?.id ?? "";
  leftId.value = preferred;
  rightId.value = group.find((block) => block.id !== preferred)?.id ?? "";
}

function ensureDistinct() {
  const group = compareBlocks.value;
  if (!group.some((block) => block.id === leftId.value)) leftId.value = group[0]?.id ?? "";
  if (!group.some((block) => block.id === rightId.value)) {
    rightId.value = group.find((block) => block.id !== leftId.value)?.id ?? "";
  }
  if (leftId.value && leftId.value === rightId.value) {
    rightId.value = group.find((block) => block.id !== leftId.value)?.id ?? "";
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetCompare(props.initialBlockId);
      document.body.classList.add("pbd-lock");
      window.addEventListener("keydown", onKeydown);
    } else {
      document.body.classList.remove("pbd-lock");
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

watch(
  () => props.initialBlockId,
  (blockId) => {
    if (props.open) resetCompare(blockId);
  },
);

watch(seriesFilter, ensureDistinct);
watch(leftId, ensureDistinct);
watch(rightId, ensureDistinct);

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.open) emit("update:open", false);
}

onBeforeUnmount(() => {
  document.body.classList.remove("pbd-lock");
  window.removeEventListener("keydown", onKeydown);
});

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}

function copyBlock(block: PromptBlock | undefined) {
  if (!block) return;
  const content = blockComparableContent(block);
  const label = block.version ? `${block.name} ${block.version}` : block.name;
  void copyText(content, `已复制「${label}」的提示词${block.recipe ? "与配方" : ""}`);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="pbd-fade">
      <div v-if="open" class="pbd-overlay" @click.self="emit('update:open', false)">
        <section class="pbd-panel" role="dialog" aria-modal="true" aria-label="提示词块版本对比">
          <header class="pbd-header">
            <div class="pbd-heading">
              <h2 class="pbd-title">提示词块对比</h2>
              <p class="pbd-sub">对比内容包含「提示词 + 配方步骤」，同一系列版本差异会高亮显示。</p>
            </div>
            <button type="button" class="pbd-close" aria-label="关闭对比" @click="emit('update:open', false)">
              <X :size="16" />
            </button>
          </header>

          <div v-if="seriesOptions.length === 0" class="pbd-state">当前没有可对比的系列（同一系列至少需要 2 个块）。</div>
          <template v-else>
            <div class="pbd-controls">
              <label class="pbd-field">
                <span class="pbd-field-label">模板系列</span>
                <el-select v-model="seriesFilter" class="pbd-select" size="small">
                  <el-option v-for="series in seriesOptions" :key="series.value" :label="series.label" :value="series.value" />
                </el-select>
              </label>
              <label class="pbd-field">
                <span class="pbd-field-label">左侧（基准）</span>
                <el-select v-model="leftId" class="pbd-select pbd-select--wide" size="small">
                  <el-option v-for="block in compareBlocks" :key="block.id" :label="blockOptionLabel(block)" :value="block.id" />
                </el-select>
              </label>
              <span class="pbd-arrow">→</span>
              <label class="pbd-field">
                <span class="pbd-field-label">右侧（对照）</span>
                <el-select v-model="rightId" class="pbd-select pbd-select--wide" size="small">
                  <el-option v-for="block in compareBlocks" :key="block.id" :label="blockOptionLabel(block)" :value="block.id" />
                </el-select>
              </label>
            </div>

            <div class="pbd-meta">
              <article class="pbd-block-meta" :class="{ 'is-recommended': leftBlock?.recommended }">
                <header class="pbd-meta-head">
                  <span class="pbd-meta-name">{{ leftBlock?.name ?? "未选择" }}</span>
                  <span v-if="leftBlock?.version" class="pbd-chip">{{ leftBlock.version }}</span>
                  <span v-if="leftBlock?.builtin" class="pbd-chip pbd-chip--info">内置</span>
                  <span v-if="leftBlock?.recommended" class="pbd-chip pbd-chip--success">推荐</span>
                </header>
                <p v-if="leftBlock?.description" class="pbd-desc">{{ leftBlock.description }}</p>
                <p class="pbd-recipe">{{ blockRecipeSummary(leftBlock) }}</p>
                <button type="button" class="pbd-copy" :disabled="!leftBlock" @click="copyBlock(leftBlock)">
                  <Copy :size="13" /><span>复制左侧</span>
                </button>
              </article>
              <span class="pbd-vs">对比</span>
              <article class="pbd-block-meta" :class="{ 'is-recommended': rightBlock?.recommended }">
                <header class="pbd-meta-head">
                  <span class="pbd-meta-name">{{ rightBlock?.name ?? "未选择" }}</span>
                  <span v-if="rightBlock?.version" class="pbd-chip">{{ rightBlock.version }}</span>
                  <span v-if="rightBlock?.builtin" class="pbd-chip pbd-chip--info">内置</span>
                  <span v-if="rightBlock?.recommended" class="pbd-chip pbd-chip--success">推荐</span>
                </header>
                <p v-if="rightBlock?.description" class="pbd-desc">{{ rightBlock.description }}</p>
                <p class="pbd-recipe">{{ blockRecipeSummary(rightBlock) }}</p>
                <button type="button" class="pbd-copy" :disabled="!rightBlock" @click="copyBlock(rightBlock)">
                  <Copy :size="13" /><span>复制右侧</span>
                </button>
              </article>
            </div>

            <div class="pbd-diff">
              <DiffViewer
                :before="leftContent"
                :after="rightContent"
                :before-label="leftLabel"
                :after-label="rightLabel"
                same-message="两者内容完全一致（提示词与配方均相同）"
              />
            </div>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* 提示词块对比浮层：与运行日志浮层保持同一套纸面风格。 */
.pbd-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--el-overlay-color-lighter);
}

.pbd-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1080px, calc(100vw - 48px));
  height: min(780px, calc(100vh - 64px));
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.pbd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.pbd-heading {
  min-width: 0;
}

.pbd-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-text);
}

.pbd-sub {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--color-text-secondary);
}

.pbd-close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.pbd-close:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.pbd-state {
  display: grid;
  place-items: center;
  min-height: 240px;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.pbd-controls {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.pbd-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pbd-field-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.pbd-select {
  width: 150px;
}

.pbd-select--wide {
  width: 240px;
}

.pbd-arrow {
  align-self: center;
  padding-bottom: 6px;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.pbd-meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.pbd-block-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.pbd-block-meta.is-recommended {
  border-color: var(--color-success-border);
}

.pbd-meta-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pbd-meta-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.pbd-chip {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-warning-soft);
  color: var(--color-warning);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.pbd-chip--info {
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
}

.pbd-chip--success {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.pbd-desc {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  line-height: 1.55;
}

.pbd-recipe {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

.pbd-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  height: 24px;
  padding: 0 7px;
  margin-top: auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.pbd-copy:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.pbd-copy:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pbd-vs {
  align-self: center;
  color: var(--color-text-tertiary);
  font-size: 12px;
  white-space: nowrap;
}

.pbd-diff {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  background: var(--color-canvas);
}

.pbd-diff .sf-diff-list {
  max-height: none;
}

body.pbd-lock {
  overflow: hidden;
}

.pbd-fade-enter-active,
.pbd-fade-leave-active {
  transition: opacity var(--dur-2) var(--ease-out);
}

.pbd-fade-enter-from,
.pbd-fade-leave-to {
  opacity: 0;
}

@media (max-width: 960px) {
  .pbd-overlay {
    padding: 12px;
  }

  .pbd-panel {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .pbd-meta {
    grid-template-columns: 1fr;
  }

  .pbd-vs {
    display: none;
  }

  .pbd-controls {
    align-items: stretch;
  }

  .pbd-field,
  .pbd-select,
  .pbd-select--wide {
    width: 100%;
  }

  .pbd-arrow {
    display: none;
  }
}
</style>
