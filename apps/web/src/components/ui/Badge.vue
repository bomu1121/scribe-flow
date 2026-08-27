<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/utils/cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "error" | "info" | "pink" | "indigo";

const props = withDefaults(defineProps<{ tone?: Tone }>(), { tone: "neutral" });

const classes = computed(() => cn("sf-badge", `sf-badge--${props.tone}`));
</script>

<template>
  <span :class="classes"><slot /></span>
</template>

<style scoped>
.sf-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}

.sf-badge--neutral {
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
}
.sf-badge--brand {
  background: var(--color-brand-soft);
  color: var(--color-brand-pressed);
}
.sf-badge--success {
  background: var(--color-success-soft);
  color: var(--color-success);
}
.sf-badge--warning {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}
.sf-badge--error {
  background: var(--color-error-soft);
  color: var(--color-error);
}
.sf-badge--info {
  background: var(--color-info-soft);
  color: var(--color-info);
}
.sf-badge--pink {
  background: var(--color-accent-pink-soft);
  color: var(--color-accent-pink);
}
.sf-badge--indigo {
  background: var(--color-accent-indigo-soft);
  color: var(--color-accent-indigo);
}
</style>
