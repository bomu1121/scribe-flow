<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    disabled?: boolean;
    type?: string;
    autofocus?: boolean;
  }>(),
  { placeholder: "", disabled: false, type: "text", autofocus: false },
);

const model = defineModel<string>({ default: "" });

const classes = computed(() => ({
  "sf-input": true,
  "sf-input--disabled": props.disabled,
}));
</script>

<template>
  <input
    v-model="model"
    :class="classes"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :autofocus="autofocus"
  />
</template>

<style scoped>
.sf-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

.sf-input::placeholder {
  color: var(--color-text-tertiary);
}

.sf-input:hover:not(:disabled) {
  border-color: var(--color-border-strong);
}

.sf-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}

.sf-input--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
