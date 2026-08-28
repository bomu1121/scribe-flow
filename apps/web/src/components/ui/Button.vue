<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/utils/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    block?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  { variant: "secondary", size: "md", block: false, disabled: false, type: "button" },
);

const classes = computed(() =>
  cn("sf-button", `sf-button--${props.variant}`, `sf-button--${props.size}`, {
    "sf-button--block": props.block,
    "sf-button--disabled": props.disabled,
  }),
);
</script>

<template>
  <button data-slot="button" :type="type" :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.sf-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-button:disabled,
.sf-button--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sf-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}

.sf-button--sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.sf-button--md {
  height: 34px;
  padding: 0 14px;
  font-size: 13px;
}
.sf-button--lg {
  height: 40px;
  padding: 0 18px;
  font-size: 14px;
}

.sf-button--primary {
  background: var(--color-brand);
  color: var(--color-on-brand);
}
.sf-button--primary:hover:not(:disabled) {
  background: var(--color-brand-hover);
}

.sf-button--primary:active:not(:disabled) {
  background: var(--color-brand-pressed);
}

.sf-button--secondary {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-text);
}
.sf-button--secondary:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}

.sf-button--secondary:active:not(:disabled) {
  border-color: var(--color-brand-border);
  color: var(--color-brand);
}

.sf-button--outline {
  background: transparent;
  border-color: var(--color-brand-border);
  color: var(--color-brand);
}
.sf-button--outline:hover:not(:disabled) {
  background: var(--color-brand-soft);
}

.sf-button--ghost {
  background: transparent;
  color: var(--color-text-secondary);
}
.sf-button--ghost:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-button--ghost:active:not(:disabled) {
  color: var(--color-brand);
}

.sf-button--danger {
  background: var(--color-error);
  color: var(--color-on-error);
}
.sf-button--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error) 88%, #000000);
}

.sf-button--danger:active:not(:disabled) {
  background: color-mix(in srgb, var(--color-error) 78%, #000000);
}

.sf-button--block {
  width: 100%;
}
</style>
