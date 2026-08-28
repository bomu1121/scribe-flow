<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Activity, LayoutGrid, PenLine, Settings } from "lucide-vue-next";
import { useRunsStore } from "@/stores/runs";
import { usePromptsStore } from "@/stores/prompts";
import BiliAccountButton from "@/components/auth/BiliAccountButton.vue";

const route = useRoute();
const router = useRouter();
const runsStore = useRunsStore();
const promptsStore = usePromptsStore();

const navItems = [
  { to: "/", label: "工程", icon: LayoutGrid },
  { to: "/runs", label: "运行记录", icon: Activity },
  { to: "/settings", label: "设置", icon: Settings },
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
  <div class="app-root">
    <aside class="sf-side">
      <div class="sf-brand">
        <span class="sf-brand-mark"><PenLine :size="16" /></span>
        <div class="sf-brand-text">
          <span class="sf-brand-name">ScribeFlow</span>
          <span class="sf-brand-sub">笔记处理画布流</span>
        </div>
      </div>

      <nav class="sf-nav">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="sf-nav-item">
          <component :is="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sf-side-foot">
        <BiliAccountButton />
        <span class="sf-version tnum">v0.1.0 · M0</span>
      </div>
    </aside>

    <main class="sf-main">
      <header class="sf-topbar">
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

    <nav class="sf-bottom-nav" aria-label="移动端导航">
      <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="sf-bottom-nav-item">
        <component :is="item.icon" :size="18" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.sf-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.sf-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 14px;
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
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  min-width: 0;
}

.sf-brand-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.sf-brand-sub {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.sf-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  overflow-y: auto;
}

.sf-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
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
  gap: 6px;
  padding: 10px;
  border-top: 1px solid var(--color-border);
}

.sf-version {
  font-size: 10px;
  color: var(--color-text-tertiary);
  text-align: center;
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
}
</style>
