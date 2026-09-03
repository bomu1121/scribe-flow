<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Activity, LayoutGrid, PenLine, Settings } from "lucide-vue-next";
import { useRunsStore } from "@/stores/runs";
import { usePromptsStore } from "@/stores/prompts";
import { useUiStore } from "@/stores/ui";
import BiliAccountButton from "@/components/auth/BiliAccountButton.vue";

const route = useRoute();
const router = useRouter();
const runsStore = useRunsStore();
const promptsStore = usePromptsStore();
const uiStore = useUiStore();

const isImmersive = computed(() => route.meta.immersive === true);

const navItems = [
  { to: "/", label: "工程", icon: LayoutGrid },
  { to: "/runs", label: "运行记录", icon: Activity },
];

const pageTitle = computed(() => String(route.meta.title ?? "ScribeFlow"));

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
  <div class="app-root" :class="{ 'app-root--immersive': isImmersive }">
    <aside v-if="!isImmersive" class="sf-side">
      <div class="sf-brand" title="ScribeFlow">
        <span class="sf-brand-mark"><PenLine :size="16" /></span>
        <div class="sf-brand-text">
          <span class="sf-brand-name">ScribeFlow</span>
          <span class="sf-brand-sub">笔记处理画布流</span>
        </div>
      </div>

      <nav class="sf-nav" aria-label="主导航">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="sf-nav-item" :title="item.label">
          <component :is="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sf-side-foot">
        <BiliAccountButton compact />
        <button type="button" class="sf-rail-btn" title="设置" aria-label="设置" @click="uiStore.openSettings()">
          <Settings :size="17" />
        </button>
        <span class="sf-version tnum">v0.1.0 · M0</span>
      </div>
    </aside>

    <main class="sf-main">
      <header v-if="!isImmersive" class="sf-topbar">
        <h1 class="sf-topbar-title">{{ pageTitle }}</h1>
        <div class="sf-topbar-right">
          <button type="button" class="sf-running-pill tnum" title="查看运行记录" aria-label="查看运行记录" @click="router.push('/runs')">
            运行中 {{ runsStore.runningCount }}
          </button>
        </div>
      </header>
      <div class="sf-content">
        <slot />
      </div>
    </main>

    <nav v-if="!isImmersive" class="sf-bottom-nav" aria-label="移动端导航">
      <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="sf-bottom-nav-item">
        <component :is="item.icon" :size="18" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.app-root--immersive {
  grid-template-columns: minmax(0, 1fr);
}

.sf-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.sf-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}

.sf-brand-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--color-ink);
  color: var(--color-surface);
  flex-shrink: 0;
}

.sf-brand-text {
  display: none;
}

.sf-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 10px 0;
  overflow-y: auto;
}

.sf-nav-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  text-decoration: none;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-nav-item span {
  display: none;
}

.sf-nav-item:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-nav-item.router-link-active {
  background: var(--color-ink);
  color: var(--color-surface);
}

.sf-side-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px 0;
  border-top: 1px solid var(--color-border);
}

.sf-version {
  display: none;
}

.sf-rail-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
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

.sf-rail-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.sf-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-height);
  padding: 0 20px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.sf-topbar-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-running-pill {
  height: 26px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sf-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sf-bottom-nav {
  display: none;
}

@media (max-width: 768px) {
  .app-root {
    grid-template-columns: 1fr;
  }

  .app-root--immersive {
    grid-template-columns: 1fr;
  }

  .sf-side {
    display: none;
  }

  .sf-bottom-nav {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 56px;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
    z-index: var(--z-overlay);
  }

  .sf-bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 10.5px;
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .sf-bottom-nav-item.router-link-active {
    color: var(--color-brand);
  }

  .sf-content {
    padding-bottom: 56px;
  }

  .app-root--immersive .sf-content {
    padding-bottom: 0;
  }
}
</style>
