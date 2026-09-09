<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { FolderTree, PenLine, Workflow } from "lucide-vue-next";
import { useProjectsStore } from "@/stores/projects";
import { useUiStore } from "@/stores/ui";

const router = useRouter();
const store = useProjectsStore();
const uiStore = useUiStore();

const phase = ref<"loading" | "welcome">("loading");

async function redirectIfPossible(): Promise<boolean> {
  if (store.list.length === 0) return false;
  const remembered = store.list.find((p) => p.id === store.lastProjectId);
  const target = remembered ?? store.list[0];
  if (!target) return false;
  await router.replace(`/project/${target.id}`);
  return true;
}

onMounted(async () => {
  await store.loadList();
  const ok = await redirectIfPossible();
  if (!ok) phase.value = "welcome";
});

watch(
  () => store.list.length,
  async (count) => {
    if (phase.value === "welcome" && count > 0) {
      const ok = await redirectIfPossible();
      if (ok) phase.value = "loading";
    }
  },
);

function showPanel() {
  uiStore.openPanel("projects");
}
</script>

<template>
  <div class="sf-home">
    <div v-if="phase === 'loading'" class="sf-home-state">正在打开最近工程…</div>
    <template v-else>
      <div class="sf-home-mark"><PenLine :size="22" /></div>
      <h1 class="sf-home-title">ScribeFlow</h1>
      <p class="sf-home-desc">还没有工程。从左侧工程面板新建一个，或导入已有的工程文件开始编排加工流。</p>

      <div class="sf-home-cards">
        <div class="sf-home-card">
          <span class="sf-home-card-icon"><FolderTree :size="16" /></span>
          <span class="sf-home-card-title">工程与运行库分开展示</span>
          <span class="sf-home-card-text">左侧单面板可在「工程 / 运行库 / 节点」间切换；运行库文件夹用于给运行记录分类。</span>
          <button type="button" class="sf-home-card-btn" @click="showPanel">打开工程面板</button>
        </div>
        <div class="sf-home-card">
          <span class="sf-home-card-icon"><Workflow :size="16" /></span>
          <span class="sf-home-card-title">画布编辑器全屏工作</span>
          <span class="sf-home-card-text">素材 → 转写 → AI 加工 → 笔记成稿，一条画布流跑完。</span>
          <button type="button" class="sf-home-card-btn" @click="showPanel">新建第一个工程</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sf-home {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
  background:
    radial-gradient(circle at 50% 30%, var(--color-surface) 0%, transparent 60%),
    var(--color-canvas);
}

.sf-home-state {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.sf-home-mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 6px;
  border-radius: var(--radius-xl);
  background: var(--color-ink);
  color: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.sf-home-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.sf-home-desc {
  margin: 0 0 20px;
  max-width: 420px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.sf-home-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 260px));
  gap: 12px;
  justify-content: center;
}

.sf-home-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  text-align: left;
  box-shadow: var(--shadow-xs);
}

.sf-home-card-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-bottom: 2px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-home-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-home-card-text {
  min-height: 38px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.sf-home-card-btn {
  margin-top: 8px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-home-card-btn:hover {
  border-color: var(--color-text);
  color: var(--color-text);
  background: var(--color-ink-soft);
}
</style>
