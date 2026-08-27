<script setup lang="ts">
import { X } from "lucide-vue-next";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    width?: string;
    closable?: boolean;
  }>(),
  { title: "", description: "", width: "480px", closable: true },
);

const open = defineModel<boolean>("open", { required: true });
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => (open = v)">
    <DialogPortal>
      <DialogOverlay class="sf-dialog-overlay" />
      <DialogContent class="sf-dialog-content" :style="{ maxWidth: props.width }">
        <div v-if="props.title" class="sf-dialog-head">
          <DialogTitle class="sf-dialog-title">{{ props.title }}</DialogTitle>
          <DialogDescription v-if="props.description" class="sf-dialog-desc">
            {{ props.description }}
          </DialogDescription>
        </div>
        <DialogClose v-if="props.closable" class="sf-dialog-close" aria-label="关闭">
          <X :size="16" />
        </DialogClose>
        <div class="sf-dialog-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="sf-dialog-footer">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.sf-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 17, 21, 0.4);
  animation: sf-fade-in var(--dur-2) var(--ease-out);
}

.sf-dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;
  width: calc(100vw - 32px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  animation: sf-dialog-in var(--dur-2) var(--ease-out);
}

.sf-dialog-head {
  padding: 18px 20px 0;
}

.sf-dialog-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-dialog-desc {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-dialog-close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-dialog-close:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-dialog-body {
  padding: 16px 20px;
}

.sf-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 18px;
}

@keyframes sf-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes sf-dialog-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 8px));
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}
</style>
