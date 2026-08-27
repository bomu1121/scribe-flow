<script setup lang="ts">
import { DropdownMenuItem } from "reka-ui";

withDefaults(defineProps<{ danger?: boolean; disabled?: boolean }>(), { danger: false, disabled: false });

const emit = defineEmits<{ select: [] }>();
</script>

<template>
  <DropdownMenuItem :disabled="disabled" class="sf-menu-item" :class="{ 'sf-menu-item--danger': danger }" @select="emit('select')">
    <slot />
  </DropdownMenuItem>
</template>

<style scoped>
.sf-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}

.sf-menu-item[data-highlighted] {
  outline: none;
  background: var(--color-ink-soft);
}

.sf-menu-item[data-disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.sf-menu-item--danger {
  color: var(--color-error);
}

.sf-menu-item--danger[data-highlighted] {
  background: var(--color-error-soft);
}
</style>
