<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { Component } from "vue";
import { Check, ChevronDown, X } from "lucide-vue-next";

export interface ModelSelectOption {
  label: string;
  value: string;
  icon?: Component;
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

const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const currentIcon = computed(() => props.prefixIcon || selected.value?.icon || props.options[0]?.icon);
const filteredOptions = computed(() => {
  if (!props.filterable) return props.options;
  const q = keyword.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(q));
});

function toggle() {
  if (!open.value) keyword.value = "";
  open.value = !open.value;
}

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

function onDocumentClick(event: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    open.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="rootRef" class="sf-model-select" :class="[`is-${size}`, { 'is-open': open }]">
    <button type="button" class="sf-model-select__trigger" @click="toggle">
      <span v-if="currentIcon" class="sf-model-select__prefix">
        <component :is="currentIcon" :size="size === 'small' ? 14 : 15" />
      </span>
      <span class="sf-model-select__value" :class="{ 'is-placeholder': !selected }">
        {{ selected?.label || placeholder }}
      </span>
      <span v-if="clearable && selected" class="sf-model-select__clear" title="清除" @click.stop="clear">
        <X :size="14" />
      </span>
      <span class="sf-model-select__arrow">
        <ChevronDown :size="14" />
      </span>
    </button>

    <div v-if="open" class="sf-model-select__menu">
      <div v-if="filterable" class="sf-model-select__search">
        <input v-model="keyword" class="sf-model-select__search-input" type="text" placeholder="搜索…" @click.stop />
      </div>
      <div class="sf-model-select__options">
        <button
          v-for="option in filteredOptions"
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
          <Check :size="14" class="sf-model-select__check" />
        </button>
        <p v-if="filteredOptions.length === 0" class="sf-model-select__empty">无匹配项</p>
      </div>
    </div>
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
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}

.sf-model-select__trigger:hover {
  border-color: var(--color-border-strong);
}

.sf-model-select.is-open .sf-model-select__trigger {
  border-color: var(--color-border-strong);
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

.sf-model-select__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  width: 100%;
  min-width: 100%;
  background: var(--color-surface);
  border: none;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  padding: 6px;
  z-index: var(--z-dropdown);
}

.sf-model-select__search {
  padding: 0 2px 6px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--color-border);
}

.sf-model-select__search-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-family: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 0.12s ease;
}

.sf-model-select__search-input:focus {
  border-color: var(--color-border-strong);
}

.sf-model-select__search-input::placeholder {
  color: var(--color-text-tertiary);
}

.sf-model-select__options {
  max-height: 220px;
  overflow-y: auto;
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
  height: 40px;
  padding: 0 10px;
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

.sf-model-select__check {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.sf-model-select__option.is-selected .sf-model-select__check {
  opacity: 1;
}

.sf-model-select.is-small .sf-model-select__trigger {
  height: 32px;
  font-size: 12px;
  border-radius: 8px;
}

.sf-model-select.is-small .sf-model-select__menu {
  top: calc(100% + 4px);
}

.sf-model-select.is-small .sf-model-select__option {
  height: 36px;
  font-size: 13px;
}
</style>
