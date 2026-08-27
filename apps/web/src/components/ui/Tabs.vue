<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from "reka-ui";

export interface TabsItem {
  value: string;
  label: string;
  disabled?: boolean;
}

defineProps<{
  items: TabsItem[];
}>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <TabsRoot :model-value="model" @update:model-value="(v) => (model = v as string)" class="sf-tabs">
    <TabsList class="sf-tabs-list">
      <TabsTrigger v-for="item in items" :key="item.value" :value="item.value" :disabled="item.disabled" class="sf-tabs-trigger">
        {{ item.label }}
      </TabsTrigger>
    </TabsList>
    <slot />
  </TabsRoot>
</template>

<style scoped>
.sf-tabs {
  width: 100%;
}

.sf-tabs-list {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.sf-tabs-trigger {
  padding: 5px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-tabs-trigger:hover:not(:disabled) {
  color: var(--color-text);
}

.sf-tabs-trigger[data-state="active"] {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-xs);
}
</style>
