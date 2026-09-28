<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { BookText, History, LayoutGrid, PenLine, Settings, Shapes } from "lucide-vue-next";
import type { RunStatus } from "@scribe-flow/shared";
import { useRunsStore } from "@/stores/runs";
import { usePromptsStore } from "@/stores/prompts";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore, type RailTab } from "@/stores/ui";
import { notifyRunFinished, shouldAlertRunEnd } from "@/utils/run-alert";
import WorkspacePanel from "@/components/workspace/WorkspacePanel.vue";
import QuickCreateDialog from "@/components/workspace/QuickCreateDialog.vue";

const runsStore = useRunsStore();
const promptsStore = usePromptsStore();
const settingsStore = useSettingsStore();
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

/**
 * 运行结束提醒（系统通知 / 提示音，开关在「常规」里）。
 *
 * 挂在工作台外壳而不是画布页：一次运行几分钟到十几分钟，用户多半会切到别的工程、
 * 结果页甚至别的应用去，而这里挂着全局轮询，任何页面上都能看到状态翻到终态。
 *
 * 判定规则是「上一次看到的是 running，这一次不是」：
 * - 首屏加载时列表里那些早就跑完的历史运行，上一次状态是 undefined，不会补弹一遍；
 * - 新起的运行一定先以 running 进列表（画布 startRun 会立刻 upsert），所以不会漏。
 * 已取消的运行不提醒：那是用户自己点的停止，此时人就在屏幕前，再弹一条是噪音。
 */
const knownRunStatus = new Map<string, RunStatus>();

watch(
  () => runsStore.runs,
  (runs) => {
    const seen = new Set<string>();
    for (const run of runs) {
      seen.add(run.id);
      const previous = knownRunStatus.get(run.id);
      knownRunStatus.set(run.id, run.status);
      if (!shouldAlertRunEnd(previous, run.status)) continue;
      const general = settingsStore.settings?.general;
      if (!general) continue;
      notifyRunFinished(
        { runId: run.id, status: run.status, projectName: run.projectName ?? "", error: run.error },
        { notify: general.runEndNotify, sound: general.runEndSound },
      );
    }
    // 列表只保留最近 200 条，被挤出去或已删除的运行要从基线里清掉，否则这个 Map 会一直长。
    for (const id of knownRunStatus.keys()) {
      if (!seen.has(id)) knownRunStatus.delete(id);
    }
  },
  { deep: true },
);

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void runsStore.load();
  void promptsStore.load();
  // 运行结束时要用「常规」里的两个开关，而用户可能从没打开过设置页。
  void settingsStore.ensureLoaded();
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
        <button type="button" class="ws-rail-btn" title="项目文档" aria-label="项目文档" @click="uiStore.openDocs()">
          <BookText :size="17" />
        </button>
        <button type="button" class="ws-rail-btn" title="设置" aria-label="设置" @click="uiStore.openSettings()">
          <Settings :size="17" />
        </button>
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

    <!-- 快捷新建挂在工作台外壳上：工程面板与首页的入口都走 uiStore，画布上也能随时打开。 -->
    <QuickCreateDialog v-model:open="uiStore.quickCreateOpen" :default-folder-id="uiStore.quickCreateFolderId" />
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
  z-index: var(--z-rail);
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

.ws-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--rail-width);
  z-index: var(--z-panel);
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
    color: var(--color-text);
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
