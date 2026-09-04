<script setup lang="ts">
import { X } from "lucide-vue-next";
import { toast, useToastState, type ToastType } from "@/lib/toast";

const state = useToastState();

const defaultTitles: Record<ToastType, string> = {
  success: "操作成功",
  error: "操作失败",
  warning: "提示",
  info: "提示",
};

function titleFor(type: ToastType, title?: string) {
  return title || defaultTitles[type];
}
</script>

<template>
  <Teleport to="body">
    <div class="sf-toast-stack" aria-live="polite" aria-label="通知">
      <TransitionGroup name="sf-toast" tag="div" class="sf-toast-list">
        <div v-for="item in state.items" :key="item.id" class="sf-toast" :class="`sf-toast--${item.type}`">
          <span class="sf-toast-icon">
            <svg
              v-if="item.type === 'success'"
              class="sf-toast-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <svg
              v-else-if="item.type === 'error'"
              class="sf-toast-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            <svg
              v-else-if="item.type === 'warning'"
              class="sf-toast-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <svg
              v-else
              class="sf-toast-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 8h.01" />
              <path d="M12 12v4" />
            </svg>
          </span>
          <div class="sf-toast-content">
            <span class="sf-toast-title">{{ titleFor(item.type, item.title) }}</span>
            <span class="sf-toast-message">{{ item.message }}</span>
          </div>
          <button type="button" class="sf-toast-close" aria-label="关闭提示" @click="toast.remove(item.id)">
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.sf-toast-stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: var(--z-dropdown-modal);
  pointer-events: none;
  max-width: min(420px, calc(100vw - 32px));
}

.sf-toast-list {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  width: 100%;
  pointer-events: auto;
}

.sf-toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 340px;
  max-width: 100%;
  padding: 20px 18px 20px 20px;
  border: 1px solid var(--color-border);
  border-radius: 2px;
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}

.sf-toast-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--color-on-error);
  flex-shrink: 0;
}

.sf-toast-svg {
  display: block;
  width: 14px;
  height: 14px;
}

.sf-toast--success .sf-toast-icon {
  background: var(--color-success);
  color: #fff;
}

.sf-toast--error .sf-toast-icon {
  background: var(--color-error);
  color: var(--color-on-error);
}

.sf-toast--warning .sf-toast-icon {
  background: var(--color-warning);
  color: #fff;
}

.sf-toast--info .sf-toast-icon {
  background: var(--color-text-tertiary);
  color: #fff;
}

.sf-toast-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.sf-toast-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-text);
}

.sf-toast-message {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  word-break: break-word;
  white-space: pre-wrap;
}

.sf-toast-close {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-toast-close:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

/* 滑入/滑出：从右侧滑出，列表项移动时平滑让位 */
.sf-toast-enter-active,
.sf-toast-leave-active {
  transition:
    opacity var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out);
}

.sf-toast-enter-from,
.sf-toast-leave-to {
  opacity: 0;
  transform: translateX(120%);
}

.sf-toast-move {
  transition: transform var(--dur-2) var(--ease-out);
}
</style>
