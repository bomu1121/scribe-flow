<script setup lang="ts">
import { X } from "lucide-vue-next";
import { toast, useToastState, type ToastType } from "@/lib/toast";

const state = useToastState();

const glyphMap: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  warning: "!",
  info: "i",
};

const defaultTitles: Record<ToastType, string> = {
  success: "操作成功",
  error: "操作失败",
  warning: "提示",
  info: "提示",
};

function glyphFor(type: ToastType) {
  return glyphMap[type];
}

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
            <span class="sf-toast-glyph">{{ glyphFor(item.type) }}</span>
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
  gap: 10px;
  width: 360px;
  max-width: 100%;
  padding: 12px 10px 12px 12px;
  border: 1px solid var(--color-border);
  border-radius: 2px;
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}

.sf-toast-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--color-on-error);
  flex-shrink: 0;
}

.sf-toast-glyph {
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  user-select: none;
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
  gap: 2px;
  min-width: 0;
  flex: 1;
  padding-top: 2px;
}

.sf-toast-title {
  font-size: 13px;
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
