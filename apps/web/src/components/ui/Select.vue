<script setup lang="ts">
import { Check, ChevronDown } from "lucide-vue-next";
import {
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";

export interface SelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md";
  }>(),
  { placeholder: "请选择", disabled: false, size: "md" },
);

const model = defineModel<string | number | null>({ default: null });
</script>

<template>
  <SelectRoot :model-value="model" @update:model-value="(v) => (model = v as string | number | null)">
    <SelectTrigger class="sf-select-trigger" :class="`sf-select-trigger--${props.size}`" :disabled="props.disabled">
      <SelectValue :placeholder="props.placeholder" />
      <ChevronDown :size="14" class="sf-select-chevron" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="sf-select-content" position="popper">
        <SelectViewport class="sf-select-viewport">
          <SelectItem
            v-for="opt in props.options"
            :key="String(opt.value)"
            :value="String(opt.value)"
            :disabled="opt.disabled"
            class="sf-select-item"
          >
            {{ opt.label }}
            <Check :size="14" class="sf-select-check" />
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
.sf-select-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

.sf-select-trigger--sm {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
}

.sf-select-trigger--md {
  height: 34px;
  padding: 0 10px;
  font-size: 13px;
}

.sf-select-trigger:hover:not(:disabled) {
  border-color: var(--color-border-strong);
}

.sf-select-trigger:focus-visible {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}

.sf-select-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sf-select-chevron {
  color: var(--color-text-tertiary);
}

.sf-select-content {
  z-index: 1100;
  min-width: 160px;
  max-height: 320px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}

.sf-select-viewport {
  max-height: 300px;
  overflow-y: auto;
}

.sf-select-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}

.sf-select-item[data-highlighted] {
  outline: none;
  background: var(--color-ink-soft);
}

.sf-select-item[data-state="checked"] {
  color: var(--color-brand);
}

.sf-select-check {
  visibility: hidden;
  color: var(--color-brand);
}

.sf-select-item[data-state="checked"] .sf-select-check {
  visibility: visible;
}
</style>
