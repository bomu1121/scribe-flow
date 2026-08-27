<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from "reka-ui";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    loading?: boolean;
  }>(),
  { title: "确认操作", description: "", confirmText: "确定", cancelText: "取消", danger: false, loading: false },
);

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="(v) => (open = v)">
    <AlertDialogPortal>
      <AlertDialogOverlay class="sf-alert-overlay" />
      <AlertDialogContent class="sf-alert-content">
        <AlertDialogTitle class="sf-alert-title">{{ props.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="props.description" class="sf-alert-desc">
          {{ props.description }}
        </AlertDialogDescription>
        <slot />
        <div class="sf-alert-actions">
          <AlertDialogCancel class="sf-alert-btn" @click="emit('cancel')">
            {{ props.cancelText }}
          </AlertDialogCancel>
          <AlertDialogAction
            class="sf-alert-btn"
            :class="{ 'sf-alert-btn--danger': props.danger }"
            :disabled="props.loading"
            @click="emit('confirm')"
          >
            {{ props.loading ? "处理中…" : props.confirmText }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.sf-alert-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 17, 21, 0.4);
  animation: sf-fade-in var(--dur-2) var(--ease-out);
}

.sf-alert-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;
  width: min(420px, calc(100vw - 32px));
  padding: 20px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  animation: sf-dialog-in var(--dur-2) var(--ease-out);
}

.sf-alert-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-alert-desc {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.sf-alert-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.sf-alert-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}

.sf-alert-btn:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}

.sf-alert-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sf-alert-btn--danger {
  background: var(--color-error);
  border-color: var(--color-error);
  color: var(--color-on-error);
}

.sf-alert-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-error) 88%, #000000);
  border-color: color-mix(in srgb, var(--color-error) 88%, #000000);
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
