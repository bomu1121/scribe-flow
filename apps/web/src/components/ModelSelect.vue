<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import type { Component } from "vue";
import { Check, ChevronDown, X } from "lucide-vue-next";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";

export interface ModelSelectOption {
  label: string;
  value: string;
  icon?: Component;
  /**
   * 可选的分组标题。同组的选项必须相邻（传进来之前就排好），分组只切**连续段**、不打乱顺序。
   * 画布的提示词下拉用它按系列分组——「观点提炼」下挂详尽版 / 成文版 / …，是 VS Code Quick Pick
   * 那种「一个下拉里带分组标题」的做法，不是先选系列再选成员的两段式。
   */
  group?: string;
  /**
   * 选项右侧的短后缀（画布提示词下拉用它标产物类别：「笔记」「报告」）。
   *
   * 它回答「选这个会得到什么东西」，而 `label` 回答「这是哪个做法」——两件事，所以分两处写：
   * 拼进 `label` 就没法只按做法名搜索了，而那个下拉是 filterable 的。
   */
  suffix?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    options: ModelSelectOption[];
    placeholder?: string;
    size?: "small" | "default";
    prefixIcon?: Component;
    clearable?: boolean;
    filterable?: boolean;
  }>(),
  {
    modelValue: "",
    placeholder: "请选择",
    size: "default",
    prefixIcon: undefined,
    clearable: false,
    filterable: false,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "change", value: string): void;
}>();

const open = ref(false);
const keyword = ref("");
const rootRef = ref<HTMLElement | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);
const triggerLocalWidth = ref(0);

/** 画布节点由 Vue Flow 的 transform 统一缩放；Teleport 到 body 的浮层需要同步 zoom。 */
const injectedScale = inject<{ value: number } | number>("sf-flow-zoom", 1);
const flowScale = computed(() => (typeof injectedScale === "number" ? injectedScale : injectedScale.value));

const menuStyle = computed<Record<string, string>>(() => ({
  minWidth: `${triggerLocalWidth.value}px`,
  zoom: String(flowScale.value),
}));

const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const currentIcon = computed(() => props.prefixIcon || selected.value?.icon || props.options[0]?.icon);

/**
 * 选项按 `group` 切成若干段，顺序原样保留。
 *
 * 搜索时**按组过滤、整组不匹配才隐藏**（不是把命中的选项抽出来平铺）——VS Code 内置的 quick pick
 * 过滤会连分隔标题一起打散，那是公认的坑：标题一没，几组选项混在一起就认不出哪个是哪个系列的了。
 */
const optionSections = computed<{ title: string; options: ModelSelectOption[] }[]>(() => {
  const q = props.filterable ? keyword.value.trim().toLowerCase() : "";
  const sections: { title: string; options: ModelSelectOption[] }[] = [];
  for (const option of props.options) {
    if (q && !option.label.toLowerCase().includes(q)) continue;
    const title = option.group ?? "";
    const last = sections.at(-1);
    if (last && last.title === title) last.options.push(option);
    else sections.push({ title, options: [option] });
  }
  return sections;
});

const matchedCount = computed(() => optionSections.value.reduce((total, section) => total + section.options.length, 0));

/**
 * 收起时触发器上的文案：带分组的选项补上组名（「观点提炼 · 成文版」）。
 *
 * 菜单展开时分组标题已经说明了系列，项里只写成员名最干净；但菜单收起后没有标题了，
 * 只留「成文版」就认不出是哪个系列——触发器是唯一一直可见的地方，所以那里补全。
 */
const selectedLabel = computed(() => {
  const option = selected.value;
  if (!option) return "";
  return option.group ? `${option.group} · ${option.label}` : option.label;
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  keyword.value = "";

  const screenWidth = rootRef.value?.getBoundingClientRect().width ?? 0;
  const scale = flowScale.value || 1;
  triggerLocalWidth.value = screenWidth / scale;

  nextTick(() => searchRef.value?.focus());
});

function clear() {
  emit("update:modelValue", "");
  emit("change", "");
  open.value = false;
}

function choose(option: ModelSelectOption) {
  emit("update:modelValue", option.value);
  emit("change", option.value);
  open.value = false;
}
</script>

<template>
  <div ref="rootRef" class="sf-model-select" :class="[`is-${size}`, { 'is-open': open }]">
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button type="button" class="sf-model-select__trigger">
          <span v-if="currentIcon" class="sf-model-select__prefix">
            <component :is="currentIcon" :size="size === 'small' ? 14 : 15" />
          </span>
          <span class="sf-model-select__value" :class="{ 'is-placeholder': !selected }">
            {{ selected ? selectedLabel : placeholder }}
          </span>
          <span v-if="clearable && selected" class="sf-model-select__clear" title="清除" @click.stop="clear">
            <X :size="14" />
          </span>
          <span class="sf-model-select__arrow">
            <ChevronDown :size="14" />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          class="sf-model-select__menu"
          :data-size="size"
          side="bottom"
          :side-offset="size === 'small' ? 4 : 6"
          align="start"
          :collision-padding="8"
          :style="menuStyle"
        >
          <div v-if="filterable" class="sf-model-select__search">
            <input
              ref="searchRef"
              v-model="keyword"
              class="sf-model-select__search-input"
              type="text"
              placeholder="搜索…"
            />
          </div>
          <div class="sf-model-select__options">
            <template v-for="(section, index) in optionSections" :key="`${section.title}#${index}`">
              <p v-if="section.title" class="sf-model-select__group">{{ section.title }}</p>
              <button
                v-for="option in section.options"
                :key="option.value"
                type="button"
                class="sf-model-select__option"
                :class="{ 'is-selected': option.value === modelValue }"
                @click="choose(option)"
              >
                <span v-if="option.icon" class="sf-model-select__option-icon">
                  <component :is="option.icon" :size="15" />
                </span>
                <span class="sf-model-select__option-label">{{ option.label }}</span>
                <span v-if="option.suffix" class="sf-model-select__option-suffix">{{ option.suffix }}</span>
                <Check :size="14" class="sf-model-select__check" />
              </button>
            </template>
            <p v-if="matchedCount === 0" class="sf-model-select__empty">无匹配项</p>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>

<style scoped>
.sf-model-select {
  position: relative;
  width: 100%;
}

.sf-model-select__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--control-height);
  padding: 0 var(--control-padding-x);
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  background: var(--control-bg);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--control-font-size);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}

.sf-model-select__trigger:hover {
  border-color: var(--control-border-hover);
}

.sf-model-select.is-open .sf-model-select__trigger {
  border-color: var(--control-border-focus);
  box-shadow: none;
}

.sf-model-select__prefix {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.sf-model-select__value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  color: var(--color-text);
}

.sf-model-select__value.is-placeholder {
  color: var(--color-text-tertiary);
}

.sf-model-select__arrow {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform 0.15s ease;
}

.sf-model-select.is-open .sf-model-select__arrow {
  transform: rotate(180deg);
}

.sf-model-select__clear {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: color 0.12s ease;
}

.sf-model-select__clear:hover {
  color: var(--color-text);
}

.sf-model-select.is-small .sf-model-select__trigger {
  height: var(--control-height-sm);
  font-size: var(--control-font-size-sm);
  border-radius: var(--control-radius);
}
</style>

<style>
/* PopoverContent 经 Teleport 挂到 body：浮层必须用全局样式，不能 scoped */
.sf-model-select__menu {
  z-index: var(--z-dropdown-modal);
  max-width: calc(100vw - 16px);
  max-height: min(360px, calc(100vh - 24px));
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  transform-origin: var(--reka-popper-transform-origin, top center);
  animation: sf-dropdown-in var(--dur-2) var(--ease-out);
}

.sf-model-select__menu[data-state="closed"] {
  animation: sf-dropdown-out var(--dur-1) var(--ease-out);
}

.sf-model-select__search {
  padding: 0 2px 6px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--color-border);
}

.sf-model-select__search-input {
  width: 100%;
  height: var(--control-height-sm);
  padding: 0 var(--control-padding-x);
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius-sm);
  background: var(--control-bg-muted);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--control-font-size-sm);
  outline: none;
  transition: border-color 0.12s ease;
}

.sf-model-select__search-input:focus {
  border-color: var(--control-border-focus);
}

.sf-model-select__search-input::placeholder {
  color: var(--control-placeholder);
}

.sf-model-select__options {
  max-height: 260px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.sf-model-select__group {
  margin: 6px 0 2px;
  padding: 0 10px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-model-select__group:first-child {
  margin-top: 0;
}

.sf-model-select__empty {
  margin: 0;
  padding: 12px 8px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  text-align: center;
}

.sf-model-select__option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.sf-model-select__option:hover {
  background: var(--color-ink-soft);
}

.sf-model-select__option.is-selected {
  background: var(--color-ink-soft);
  font-weight: 500;
}

.sf-model-select__option-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.sf-model-select__option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-model-select__option-suffix {
  flex-shrink: 0;
  margin-left: 6px;
  padding: 0 6px;
  border: 1px solid var(--color-info-border);
  border-radius: 4px;
  background: var(--color-info-soft);
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
}

.sf-model-select__check {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.sf-model-select__option.is-selected .sf-model-select__check {
  opacity: 1;
}

.sf-model-select__menu[data-size="small"] {
  padding: 4px;
}

.sf-model-select__menu[data-size="small"] .sf-model-select__option {
  min-height: 36px;
  font-size: 13px;
}
</style>
