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
import { cn } from "@/utils/cn";

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
    class?: string;
  }>(),
  { placeholder: "请选择", disabled: false, size: "md", class: "" },
);

const model = defineModel<string | null>({ default: null });

function onUpdate(value: unknown) {
  model.value = value == null || value === "" ? null : String(value);
}
</script>

<template>
  <SelectRoot :model-value="model" @update:model-value="onUpdate">
    <SelectTrigger
      data-slot="select-trigger"
      :disabled="props.disabled"
      :class="
        cn(
          'group flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background text-sm shadow-xs transition-[color,box-shadow] outline-none',
          'data-[placeholder]:text-muted-foreground',
          'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
          'data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          props.size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
          '[&_svg]:pointer-events-none [&_svg]:shrink-0',
          props.class,
        )
      "
    >
      <SelectValue data-slot="select-value" :placeholder="props.placeholder" class="min-w-0 flex-1 text-left data-[placeholder]:text-muted-foreground" />
      <SelectIcon as-child>
        <ChevronDown class="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 group-data-[state=open]:text-ring" />
      </SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        data-slot="select-content"
        :side-offset="6"
        position="popper"
        class="sf-select-content relative z-[var(--z-select)] max-h-[var(--reka-select-content-available-height,320px)] min-w-[var(--reka-select-trigger-width,8rem)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-[var(--shadow-overlay)]"
      >
        <SelectScrollUpButton class="flex cursor-default items-center justify-center py-1 text-muted-foreground">
          <ChevronUp class="size-4" />
        </SelectScrollUpButton>
        <SelectViewport class="p-1">
          <SelectItem
            v-for="opt in props.options"
            :key="String(opt.value)"
            data-slot="select-item"
            :value="String(opt.value)"
            :disabled="opt.disabled"
            class="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:text-primary focus:bg-accent focus:text-accent-foreground"
          >
            <SelectItemText>{{ opt.label }}</SelectItemText>
            <SelectItemIndicator class="absolute right-2 inline-flex size-3.5 items-center justify-center text-primary">
              <Check class="size-4" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
        <SelectScrollDownButton class="flex cursor-default items-center justify-center py-1 text-muted-foreground">
          <ChevronDown class="size-4" />
        </SelectScrollDownButton>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
/* 浮层经 Teleport 挂到 body：开合动画必须用全局样式 */
.sf-select-content[data-state="open"] {
  animation: sf-select-in var(--dur-2) var(--ease-out);
}

.sf-select-content[data-state="closed"] {
  animation: sf-select-out var(--dur-1) var(--ease-out);
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
