<script setup lang="ts">
import { Check, ChevronDown, ChevronUp } from "lucide-vue-next";
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectScrollDownButton,
  SelectScrollUpButton,
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

const model = defineModel<string | null>({ default: null });

function onUpdate(value: unknown) {
  model.value = value == null || value === "" ? null : String(value);
}
</script>

<template>
  <SelectRoot :model-value="model" @update:model-value="onUpdate">
    <SelectTrigger class="sf-select-trigger" :class="`sf-select-trigger--${props.size}`" :disabled="props.disabled">
      <SelectValue :placeholder="props.placeholder" class="sf-select-value" />
      <SelectIcon as-child>
        <ChevronDown :size="14" class="sf-select-chevron" />
      </SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="sf-select-content" position="popper" :side-offset="6">
        <SelectScrollUpButton class="sf-select-scroll-btn">
          <ChevronUp :size="14" />
        </SelectScrollUpButton>
        <SelectViewport class="sf-select-viewport">
          <SelectItem
            v-for="opt in props.options"
            :key="String(opt.value)"
            :value="String(opt.value)"
            :disabled="opt.disabled"
            class="sf-select-item"
          >
            <SelectItemText>{{ opt.label }}</SelectItemText>
            <SelectItemIndicator class="sf-select-indicator">
              <Check :size="14" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
        <SelectScrollDownButton class="sf-select-scroll-btn">
          <ChevronDown :size="14" />
        </SelectScrollDownButton>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
/* 浮层经 Teleport 挂到 body：样式必须全局，不能 scoped */
.sf-select-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  cursor: pointer;
  user-select: none;
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-select-trigger--sm {
  height: 30px;
  padding: 0 8px;
  font-size: 12.5px;
}

.sf-select-trigger--md {
  height: 34px;
  padding: 0 10px;
  font-size: 13px;
}

.sf-select-trigger:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}

.sf-select-trigger:focus-visible {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}

.sf-select-trigger[data-state="open"] {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}

.sf-select-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sf-select-value {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-select-value[data-placeholder] {
  color: var(--color-text-tertiary);
}

.sf-select-chevron {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform var(--dur-2) var(--ease-out);
}

.sf-select-trigger[data-state="open"] .sf-select-chevron {
  transform: rotate(180deg);
  color: var(--color-brand);
}

.sf-select-content {
  z-index: var(--z-select);
  min-width: var(--reka-select-trigger-width, 160px);
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.sf-select-content[data-state="open"] {
  animation: sf-select-in var(--dur-2) var(--ease-out);
}

.sf-select-content[data-state="closed"] {
  animation: sf-select-out var(--dur-1) var(--ease-out);
}

.sf-select-viewport {
  max-height: var(--reka-select-content-available-height, 320px);
  overflow-y: auto;
  padding: 4px;
}

.sf-select-scroll-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 0;
  color: var(--color-text-tertiary);
  cursor: default;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-select-scroll-btn:hover {
  color: var(--color-text);
  background: var(--color-ink-soft);
}

.sf-select-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 28px 7px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-text);
  cursor: pointer;
  outline: none;
  user-select: none;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-select-item[data-highlighted],
.sf-select-item:focus-visible {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-select-item[data-state="checked"] {
  color: var(--color-brand);
  font-weight: 500;
}

.sf-select-item[data-disabled] {
  opacity: 0.45;
  pointer-events: none;
}

.sf-select-indicator {
  position: absolute;
  right: 8px;
  display: inline-flex;
  align-items: center;
  color: var(--color-brand);
}

@keyframes sf-select-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes sf-select-out {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-3px) scale(0.99);
  }
}
</style>
