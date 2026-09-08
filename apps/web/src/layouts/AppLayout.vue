<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { History, LayoutGrid, PenLine, Settings, Shapes } from "lucide-vue-next";
import { useRunsStore } from "@/stores/runs";
import { usePromptsStore } from "@/stores/prompts";
import { useUiStore, type RailTab } from "@/stores/ui";
import WorkspacePanel from "@/components/workspace/WorkspacePanel.vue";

const runsStore = useRunsStore();
const promptsStore = usePromptsStore();
const uiStore = useUiStore();

const panelOpen = computed(() => uiStore.panelOpen);

/** 面板内容首次打开后常驻，保证收起/展开动画期间内容不闪没，也避免冷启动无谓加载。 */
const panelMounted = ref(uiStore.panelOpen);
watch(panelOpen, (open) => {
  if (open) panelMounted.value = true;
});

const railButtons: { tab: RailTab; label: string; icon: unknown }[] = [
  { tab: "projects", label: "工程", icon: LayoutGrid },
  { tab: "runs", label: "运行记录", icon: History },
  { tab: "nodes", label: "节点", icon: Shapes },
];

function onRailClick(tab: RailTab) {
  if (uiStore.panelOpen && uiStore.panelTab === tab) uiStore.closePanel();
  else uiStore.openPanel(tab);
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void runsStore.load();
  void promptsStore.load();
  timer = setInterval(() => void runsStore.load(), 5000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="ws-root" :class="{ 'has-panel': panelOpen }">
    <nav class="ws-rail" aria-label="工作台">
      <div class="ws-rail-top">
        <button type="button" class="ws-logo" title="ScribeFlow" aria-label="ScribeFlow" @click="uiStore.openPanel('projects')">
          <span class="ws-logo-mark"><PenLine :size="15" /></span>
        </button>

        <button
          v-for="btn in railButtons"
          :key="btn.tab"
          type="button"
          class="ws-rail-btn"
          :class="{ active: panelOpen && uiStore.panelTab === btn.tab }"
          :title="btn.label"
          :aria-label="btn.label"
          :aria-current="panelOpen && uiStore.panelTab === btn.tab ? 'page' : undefined"
          @click="onRailClick(btn.tab)"
        >
          <component :is="btn.icon" :size="17" />
        </button>
      </div>

      <div class="ws-rail-bottom">
        <button type="button" class="ws-rail-btn" title="设置" aria-label="设置" @click="uiStore.openSettings()">
          <Settings :size="17" />
        </button>
        <span class="ws-version tnum">v0.1.0 · M8</span>
      </div>
    </nav>

    <aside class="ws-panel" :class="{ open: panelOpen }" :inert="!panelOpen" :aria-hidden="!panelOpen">
      <WorkspacePanel v-if="panelMounted" />
    </aside>

    <div class="ws-scrim" :class="{ open: panelOpen }" @click="uiStore.closePanel()" />

    <main class="ws-main">
      <Transition name="mobile-btn">
        <button
          v-if="!panelOpen"
          type="button"
          class="ws-mobile-panel-btn"
          title="打开工程面板"
          aria-label="打开工程面板"
          @click="uiStore.openPanel('projects')"
        >
          <LayoutGrid :size="17" />
        </button>
      </Transition>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.ws-root {
  position: relative;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
}

.ws-rail {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--rail-width);
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  padding: 8px 0 10px;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.ws-rail-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 100%;
}

.ws-logo {
  display: grid;
  place-items: center;
  padding: 0;
  margin-bottom: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
}

.ws-logo-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--color-ink);
  color: var(--color-surface);
}

.ws-rail-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.ws-rail-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.ws-rail-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.ws-rail-btn.active {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.ws-version {
  display: none;
}

.ws-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--rail-width);
  z-index: 2;
  width: var(--explorer-width);
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow: hidden;
  transform: translateX(-100%);
  visibility: hidden;
  transition:
    transform var(--dur-3) var(--ease-out),
    visibility 0s linear var(--dur-3);
  will-change: transform;
}

.ws-panel.open {
  transform: translateX(0);
  visibility: visible;
  transition:
    transform var(--dur-3) var(--ease-out),
    visibility 0s linear 0s;
}

.ws-main {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: var(--rail-width);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-canvas);
  transition: left var(--dur-3) var(--ease-out);
}

.ws-root.has-panel .ws-main {
  left: calc(var(--rail-width) + var(--explorer-width));
}

.ws-scrim {
  display: none;
}

.ws-mobile-panel-btn {
  display: none;
}

/* 收起后面板完全离场，再淡入移动端“打开面板”按钮，避免它浮在抽屉上。 */
.mobile-btn-enter-active {
  transition: opacity var(--dur-2) var(--ease-out) var(--dur-3);
  pointer-events: none;
}

.mobile-btn-enter-from {
  opacity: 0;
  pointer-events: none;
}

/* 面板抽屉：只动 transform + 主区 left，避免逐帧挤压侧栏内容导致抖动。 */
@media (max-width: 860px) {
  .ws-rail {
    display: none;
  }

  .ws-main,
  .ws-root.has-panel .ws-main {
    left: 0;
    transition: none;
  }

  .ws-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-overlay) - 10);
    background: var(--color-ink);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-3) var(--ease-out);
  }

  .ws-scrim.open {
    display: block;
    opacity: 0.18;
    pointer-events: auto;
  }

  .ws-panel {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(80vw, 320px);
    z-index: var(--z-overlay);
    box-shadow: var(--shadow-overlay);
  }

  .ws-mobile-panel-btn {
    display: grid;
    place-items: center;
    position: absolute;
    top: 10px;
    left: 10px;
    width: 32px;
    height: 32px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    z-index: var(--z-dropdown);
    box-shadow: var(--shadow-card);
  }

  .ws-mobile-panel-btn:hover {
    color: var(--color-brand);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ws-panel,
  .ws-panel.open,
  .ws-scrim,
  .ws-scrim.open,
  .mobile-btn-enter-active {
    transition-delay: 0s !important;
  }
}
</style>
