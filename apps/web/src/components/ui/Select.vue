<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

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
    size?: "sm" | "default";
  }>(),
  { placeholder: "请选择", disabled: false, size: "default" },
);

const model = defineModel<string | null>({ default: null });

function onUpdate(value: unknown) {
  model.value = value == null || value === "" ? null : String(value);
}
</script>

<template>
  <Select :model-value="model" @update:model-value="onUpdate">
    <SelectTrigger :disabled="props.disabled" :size="props.size" class="w-full">
      <SelectValue :placeholder="props.placeholder" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem
        v-for="opt in props.options"
        :key="String(opt.value)"
        :value="String(opt.value)"
        :disabled="opt.disabled"
      >
        {{ opt.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
