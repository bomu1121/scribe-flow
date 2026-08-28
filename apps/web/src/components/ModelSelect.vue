<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { Component } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";

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
  }>(),
  {
    modelValue: "",
    placeholder: "请选择",
    size: "default",
    prefixIcon: undefined,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "change", value: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const currentIcon = computed(() => props.prefixIcon || selected.value?.icon || props.options[0]?.icon);

function toggle() {
  open.value = !open.value;
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
      <span class="sf-model-select__arrow">
        <ChevronDown :size="14" />
      </span>
    </button>

    <div v-if="open" class="sf-model-select__menu">
      <button
        v-for="option in options"
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

.sf-model-select__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  width: 100%;
  min-width: 100%;
  background: #ffffff;
  border: none;
  border-radius: 12px;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.06),
    0 12px 32px rgba(0, 0, 0, 0.08);
  padding: 6px;
  z-index: 100;
}

.sf-model-select__option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 40px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #212121;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.sf-model-select__option:hover {
  background: #f5f5f5;
}

.sf-model-select__option.is-selected {
  background: #f5f5f5;
  font-weight: 500;
}

.sf-model-select__option-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: #555;
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
  color: #8a8a8a;
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
