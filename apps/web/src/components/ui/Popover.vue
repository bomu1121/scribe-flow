<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";

withDefaults(defineProps<{ align?: "start" | "center" | "end" }>(), { align: "start" });
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="sf-popover-content" :side-offset="6" :align="align">
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
/* 浮层经 Teleport 挂到 body：样式必须全局，不能 scoped */
.sf-popover-content {
  z-index: var(--z-popover);
  max-width: 360px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
  animation: sf-popover-in var(--dur-2) var(--ease-out);
}

@keyframes sf-popover-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
