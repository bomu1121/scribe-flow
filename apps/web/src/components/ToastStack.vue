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

/** 离场前把当前 toast 按视口坐标钉在原位并脱离文档流，让剩余 toast 在离场同时平滑补位。 */
function beforeLeave(el: Element) {
  const toast = el as HTMLElement;
  const rect = toast.getBoundingClientRect();

  toast.style.position = "fixed";
  toast.style.marginTop = "0px";
  toast.style.top = `${rect.top}px`;
  toast.style.left = `${rect.left}px`;
  toast.style.right = "auto";
  toast.style.width = `${rect.width}px`;
  toast.style.maxWidth = "100%";
}
</script>

<template>
  <Teleport to="body">
    <div class="sf-toast-stack" aria-live="polite" aria-label="通知">
      <TransitionGroup name="sf-toast" tag="div" class="sf-toast-list" @before-leave="beforeLeave">
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
  width: 100%;
  pointer-events: auto;
}

.sf-toast + .sf-toast {
  margin-top: 8px;
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
  color: var(--color-on-success);
}

.sf-toast--error .sf-toast-icon {
  background: var(--color-error);
  color: var(--color-on-error);
}

.sf-toast--warning .sf-toast-icon {
  background: var(--color-warning);
  color: var(--color-on-warning);
}

.sf-toast--info .sf-toast-icon {
  background: var(--color-text-tertiary);
  color: var(--color-on-info);
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

/* 入场从右侧滑入；离场只淡出，不再横向滑出。
   离场项在 beforeLeave 中钉住原位置并脱离文档流，剩余 toast 的 move 过渡与淡出同时进行，
   避免“先滑走、再整体跳一下”造成的生硬与抖动。 */
.sf-toast-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.sf-toast-leave-active {
  will-change: opacity;
  transition: opacity 0.3s ease;
}

.sf-toast-enter-from {
  opacity: 0;
  transform: translateX(120%);
}

.sf-toast-leave-to {
  opacity: 0;
}

.sf-toast-move {
  will-change: transform;
  transition: transform 0.3s ease;
}
</style>
