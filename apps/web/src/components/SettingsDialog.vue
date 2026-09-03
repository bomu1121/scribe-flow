<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, watch } from "vue";
import { Settings, X } from "lucide-vue-next";
import { useUiStore } from "@/stores/ui";

const SettingsView = defineAsyncComponent(() => import("@/views/SettingsView.vue"));

const ui = useUiStore();

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && ui.settingsOpen) ui.closeSettings();
}

watch(
  () => ui.settingsOpen,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="sf-settings-fade">
      <div v-if="ui.settingsOpen" class="sf-settings-overlay" @click.self="ui.closeSettings()">
        <section class="sf-settings-panel" role="dialog" aria-modal="true" aria-label="设置">
          <header class="sf-settings-panel-head">
            <div class="sf-settings-panel-title">
              <span class="sf-settings-panel-title-icon">
                <Settings :size="15" />
              </span>
              <span>设置</span>
            </div>
            <button type="button" class="sf-settings-panel-close" aria-label="关闭设置" @click="ui.closeSettings()">
              <X :size="16" />
            </button>
          </header>

          <div class="sf-settings-panel-body">
            <SettingsView v-if="ui.settingsOpen" />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* 自定义设置弹窗：不再使用 Element Plus 默认 Dialog 骨架，避免默认边框/圆角/头部模板干扰。 */
.sf-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--el-overlay-color-lighter);
}

.sf-settings-panel {
  display: flex;
  flex-direction: column;
  width: min(920px, calc(100vw - 32px));
  height: min(680px, calc(100vh - 96px));
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.sf-settings-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 52px;
  padding: 0 12px 0 20px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.sf-settings-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-settings-panel-title-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
}

.sf-settings-panel-close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-settings-panel-close:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-settings-panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.sf-settings-panel-body .sf-settings {
  width: 100%;
  height: 100%;
  border-radius: 0;
  grid-template-columns: 184px minmax(0, 1fr) !important;
  background: var(--color-surface) !important;
}

.sf-settings-panel-body .sf-settings-nav {
  width: 184px !important;
  padding: 12px 8px !important;
  border-right: 1px solid var(--color-border) !important;
  background: var(--color-surface-muted) !important;
}

.sf-settings-panel-body .sf-settings-nav-item {
  margin: 0 0 2px !important;
  padding: 9px 12px !important;
  border-radius: var(--radius-sm) !important;
  font-size: 12.5px !important;
  color: var(--color-text-secondary) !important;
}

.sf-settings-panel-body .sf-settings-nav-item:hover {
  background: var(--color-ink-soft) !important;
  color: var(--color-text) !important;
}

.sf-settings-panel-body .sf-settings-nav-item.active {
  background: var(--color-brand-soft) !important;
  color: var(--color-brand) !important;
  font-weight: 600 !important;
}

.sf-settings-panel-body .sf-settings-body {
  padding: 22px 26px 32px !important;
  max-width: none !important;
  background: var(--color-surface) !important;
}

.sf-settings-panel-body .sf-settings-title {
  font-size: 17px !important;
  letter-spacing: -0.01em !important;
}

.sf-settings-panel-body .sf-settings-desc {
  color: var(--color-text-secondary) !important;
}

.sf-settings-fade-enter-active,
.sf-settings-fade-leave-active {
  transition: opacity var(--dur-2) var(--ease-out);
}

.sf-settings-fade-enter-from,
.sf-settings-fade-leave-to {
  opacity: 0;
}
</style>
