<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElButton, ElInput } from "element-plus";
import { toast } from "@/lib/toast";
import { Check, Clock3, FolderHeart, ListVideo, PlaySquare, RotateCw, Search, X } from "lucide-vue-next";
import type { SourceCollection, SourceVideoItem, VideoPreview } from "@scribe-flow/shared";
import ModelSelect from "../ModelSelect.vue";
import { api } from "@/lib/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; confirm: [items: SourceVideoItem[]] }>();

type TabKey = "fav" | "season" | "toview" | "history";

const dialogVisible = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

const activeTab = ref<TabKey>("fav");
const loading = ref(false);
const confirming = ref(false);
const errorMessage = ref("");
const searchKeyword = ref("");
const page = ref(1);
const hasMore = ref(false);

const folders = ref<SourceCollection[]>([]);
const collections = ref<SourceCollection[]>([]);
const selectedFolder = ref("");
const selectedCollection = ref("");
const items = ref<SourceVideoItem[]>([]);
const selected = ref<SourceVideoItem[]>([]);
const historyCursor = ref({ max: 0, viewAt: 0 });

const tabs: { key: TabKey; label: string; icon: typeof FolderHeart }[] = [
  { key: "fav", label: "收藏夹", icon: FolderHeart },
  { key: "season", label: "我的合集", icon: ListVideo },
  { key: "toview", label: "稍后再看", icon: Clock3 },
  { key: "history", label: "B站历史", icon: PlaySquare },
];

const activeTabMeta = computed(() => tabs.find((tab) => tab.key === activeTab.value) ?? tabs[0]);

const selectedFolderLabel = computed(() => folders.value.find((folder) => folder.id === selectedFolder.value)?.title ?? "");
const selectedCollectionLabel = computed(() => collections.value.find((collection) => collection.id === selectedCollection.value)?.title ?? "");

const headerSubtitle = computed(() => {
  const sourceName =
    activeTab.value === "fav"
      ? selectedFolderLabel.value
      : activeTab.value === "season"
        ? selectedCollectionLabel.value
        : "";
  return [activeTabMeta.value.label, sourceName].filter(Boolean).join(" · ");
});

const displayItems = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();
  if (!keyword) return items.value;
  return items.value.filter(
    (item) => item.title.toLowerCase().includes(keyword) || item.uploader.toLowerCase().includes(keyword),
  );
});

const emptyText = computed(() => {
  if (errorMessage.value) return "";
  if (activeTab.value === "fav") return folders.value.length > 0 ? "这个收藏夹暂时没有视频" : "还没有收藏夹";
  if (activeTab.value === "season") return collections.value.length > 0 ? "这个合集暂时没有视频" : "还没有我的合集";
  if (activeTab.value === "toview") return searchKeyword.value ? "没有匹配的视频" : "稍后再看是空的";
  return "没有找到历史记录";
});

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s} 秒`;
}

function isSelected(item: SourceVideoItem): boolean {
  return selected.value.some((row) => row.bvid === item.bvid);
}

function toggleSelect(item: SourceVideoItem) {
  const index = selected.value.findIndex((row) => row.bvid === item.bvid);
  if (index >= 0) selected.value.splice(index, 1);
  else selected.value.push(item);
}

const allVisibleSelected = computed(() => displayItems.value.length > 0 && displayItems.value.every((item) => isSelected(item)));

function toggleSelectVisible() {
  if (allVisibleSelected.value) {
    const visibleBvids = new Set(displayItems.value.map((item) => item.bvid));
    selected.value = selected.value.filter((row) => !visibleBvids.has(row.bvid));
  } else {
    const selectedBvids = new Set(selected.value.map((row) => row.bvid));
    selected.value = [...selected.value, ...displayItems.value.filter((item) => !selectedBvids.has(item.bvid))];
  }
}

function clearSelection() {
  selected.value = [];
}

async function loadFolders() {
  const data = await api.get<{ items: SourceCollection[] }>("/api/bilibili/fav/folders");
  folders.value = data.items ?? [];
  if (folders.value.length > 0 && !selectedFolder.value) {
    selectedFolder.value = folders.value[0].id;
  }
}

async function loadCollections() {
  const data = await api.get<{ items: SourceCollection[]; total: number }>("/api/bilibili/seasons");
  collections.value = data.items ?? [];
  if (collections.value.length > 0 && !selectedCollection.value) {
    selectedCollection.value = collections.value[0].id;
  }
}

async function loadFavVideos() {
  if (!selectedFolder.value) {
    items.value = [];
    return;
  }
  const params = new URLSearchParams({ page: String(page.value), keyword: searchKeyword.value.trim() });
  const data = await api.get<{ items: SourceVideoItem[]; hasMore: boolean }>(
    `/api/bilibili/fav/folders/${selectedFolder.value}/videos?${params.toString()}`,
  );
  items.value = data.items ?? [];
  hasMore.value = Boolean(data.hasMore);
}

async function loadCollectionVideos() {
  if (!selectedCollection.value) {
    items.value = [];
    return;
  }
  const params = new URLSearchParams({ page: String(page.value), keyword: searchKeyword.value.trim() });
  const data = await api.get<{ items: SourceVideoItem[]; hasMore: boolean }>(
    `/api/bilibili/collections/${selectedCollection.value}/videos?${params.toString()}`,
  );
  items.value = data.items ?? [];
  hasMore.value = Boolean(data.hasMore);
}

async function loadToview() {
  const data = await api.get<{ items: SourceVideoItem[] }>("/api/bilibili/watch-later");
  items.value = data.items ?? [];
  hasMore.value = false;
}

async function loadHistory() {
  const params = new URLSearchParams({ max: String(historyCursor.value.max), viewAt: String(historyCursor.value.viewAt) });
  const data = await api.get<{ items: SourceVideoItem[]; next: { max: number; viewAt: number }; hasMore: boolean }>(
    `/api/bilibili/history?${params.toString()}`,
  );
  items.value = data.items ?? [];
  hasMore.value = Boolean(data.hasMore);
  if (data.next) historyCursor.value = data.next;
}

async function loadTab() {
  loading.value = true;
  errorMessage.value = "";
  page.value = 1;
  historyCursor.value = { max: 0, viewAt: 0 };
  searchKeyword.value = "";
  clearSelection();
  try {
    if (activeTab.value === "fav") {
      await loadFolders();
      await loadFavVideos();
    } else if (activeTab.value === "season") {
      await loadCollections();
      await loadCollectionVideos();
    } else if (activeTab.value === "toview") {
      await loadToview();
    } else {
      await loadHistory();
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "加载失败";
    items.value = [];
  } finally {
    loading.value = false;
  }
}

async function reloadVideos() {
  loading.value = true;
  errorMessage.value = "";
  clearSelection();
  try {
    if (activeTab.value === "fav") await loadFavVideos();
    else if (activeTab.value === "season") await loadCollectionVideos();
    else if (activeTab.value === "toview") await loadToview();
    else await loadHistory();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function goPage(next: number) {
  if (next < 1) return;
  if (activeTab.value === "history") {
    if (next <= page.value) return;
  }
  page.value = next;
  await reloadVideos();
}

async function confirmSelection() {
  if (confirming.value) return;
  if (selected.value.length === 0) {
    toast.warning("请先选择至少一个视频");
    return;
  }
  confirming.value = true;
  try {
    const items = await Promise.all(
      selected.value.map(async (item) => {
        // 收藏夹/合集列表接口不返回 cid，选中后先补齐分 P 信息，避免生成“缺 cid”的卡片。
        if (item.cid || item.pages?.some((p) => p.cid)) return { ...item };
        const preview = await api.post<VideoPreview>("/api/videos/preview", {
          url: `https://www.bilibili.com/video/${item.bvid}`,
        });
        return {
          ...item,
          bvid: preview.bvid,
          cid: preview.cid,
          pages: preview.pages,
          pageCount: preview.pages.length,
          title: item.title || preview.title,
          cover: item.cover || preview.cover,
          uploader: item.uploader || preview.uploader,
          duration: item.duration || preview.duration,
        };
      }),
    );
    emit("confirm", items);
    dialogVisible.value = false;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "解析视频信息失败，请稍后重试");
  } finally {
    confirming.value = false;
  }
}

function close() {
  if (confirming.value) return;
  dialogVisible.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.open) close();
}

function setBodyLock(locked: boolean) {
  document.body.classList.toggle("sp-lock", locked);
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchKeyword, () => {
  if (activeTab.value === "toview") return; // 稍后再看本地过滤，无需请求
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void reloadVideos();
  }, 400);
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      activeTab.value = "fav";
      selectedFolder.value = "";
      selectedCollection.value = "";
      setBodyLock(true);
      window.addEventListener("keydown", onKeydown);
      void loadTab();
    } else {
      setBodyLock(false);
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

watch([selectedFolder, selectedCollection], () => {
  if (activeTab.value === "fav" && selectedFolder.value) {
    page.value = 1;
    void reloadVideos();
  } else if (activeTab.value === "season" && selectedCollection.value) {
    page.value = 1;
    void reloadVideos();
  }
});

watch(activeTab, () => void loadTab());

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
  setBodyLock(false);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="sp-fade">
      <div v-if="dialogVisible" class="sp-overlay" @click.self="close">
        <section class="sp-panel" role="dialog" aria-modal="true" aria-label="从我的 B 站选择视频">
          <header class="sp-header">
            <span class="sp-header-icon"><FolderHeart :size="18" /></span>
            <div class="sp-header-copy">
              <h2 class="sp-title">从我的 B 站选择视频</h2>
              <p class="sp-sub">{{ headerSubtitle }}</p>
            </div>
            <button type="button" class="sp-close" aria-label="关闭选择器" @click="close">
              <X :size="16" />
            </button>
          </header>

          <div class="sp-tabs" role="tablist" aria-label="选择视频来源">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              role="tab"
              class="sp-tab"
              :class="{ active: activeTab === tab.key }"
              :aria-selected="activeTab === tab.key"
              @click="activeTab = tab.key"
            >
              <component :is="tab.icon" :size="14" />
              <span>{{ tab.label }}</span>
            </button>
          </div>

          <div class="sp-toolbar">
            <div v-if="activeTab === 'fav'" class="sp-folder">
              <ModelSelect
                v-model="selectedFolder"
                :options="folders.map((folder) => ({ label: `${folder.title}（${folder.count}）`, value: folder.id }))"
                size="small"
                placeholder="选择收藏夹"
                :prefix-icon="FolderHeart"
              />
            </div>
            <div v-else-if="activeTab === 'season'" class="sp-folder">
              <ModelSelect
                v-model="selectedCollection"
                :options="collections.map((collection) => ({ label: `${collection.title}（${collection.count}）`, value: collection.id }))"
                size="small"
                placeholder="选择合集"
                :prefix-icon="ListVideo"
              />
            </div>

            <div v-if="activeTab !== 'history'" class="sp-source-search">
              <el-input v-model="searchKeyword" size="small" clearable placeholder="搜索标题 / UP 主" aria-label="搜索视频">
                <template #prefix><Search :size="14" /></template>
              </el-input>
            </div>

            <button type="button" class="sp-icon-btn" title="刷新当前列表" aria-label="刷新当前列表" @click="reloadVideos">
              <RotateCw :size="14" />
            </button>
          </div>

          <div v-if="displayItems.length > 0" class="sp-list-head">
            <span class="sp-list-count tnum">本页 {{ displayItems.length }} 个视频</span>
            <button type="button" class="sp-text-btn" @click="toggleSelectVisible">
              {{ allVisibleSelected ? "取消全选本页" : "全选本页" }}
            </button>
          </div>

          <div class="sp-body">
            <div v-if="loading" class="sp-state">
              <span class="sp-spinner" aria-hidden="true" />
              <span>加载视频中…</span>
            </div>
            <div v-else-if="errorMessage" class="sp-state sp-state--error">
              <span>{{ errorMessage }}</span>
              <button type="button" class="sp-text-btn" @click="reloadVideos">重试</button>
            </div>
            <div v-else-if="displayItems.length === 0" class="sp-state">{{ emptyText }}</div>
            <div v-else class="sp-list">
              <button
                v-for="item in displayItems"
                :key="item.bvid"
                type="button"
                class="sp-row"
                :class="{ selected: isSelected(item) }"
                :aria-pressed="isSelected(item)"
                @click="toggleSelect(item)"
              >
                <span class="sp-check" :class="{ checked: isSelected(item) }" aria-hidden="true">
                  <Check v-if="isSelected(item)" :size="13" />
                </span>
                <img :src="item.cover" class="sp-cover" alt="" referrerpolicy="no-referrer" loading="lazy" />
                <span class="sp-row-main">
                  <span class="sp-row-title">{{ item.title || "（无标题）" }}</span>
                  <span class="sp-row-meta tnum">
                    {{ item.uploader || "UP 主未知" }} · {{ fmtDuration(item.duration) }}<template v-if="item.pageCount > 1"> · {{ item.pageCount }}P</template>
                  </span>
                </span>
              </button>
            </div>
          </div>

          <footer class="sp-footer">
            <div class="sp-pager">
              <el-button size="small" :disabled="loading || page <= 1 || activeTab === 'history'" @click="goPage(page - 1)">上一页</el-button>
              <span class="sp-page tnum">{{ page }}</span>
              <el-button size="small" :disabled="loading || !hasMore" @click="goPage(page + 1)">下一页</el-button>
            </div>
            <div class="sp-confirm">
              <span class="sp-count tnum">已选 {{ selected.length }} 项</span>
              <el-button size="small" text :disabled="selected.length === 0" @click="clearSelection">清空</el-button>
              <el-button size="small" type="primary" class="sp-confirm-btn" :disabled="selected.length === 0 || confirming" @click="confirmSelection">
                {{ confirming ? "解析视频信息…" : "生成来源节点" }}
              </el-button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* 从 B 站选择视频：独立 Teleport 浮层，样式跟随 RunLog/Settings 的纸面工作台，不再使用 EP Dialog 默认骨架。 */
.sp-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--el-overlay-color-lighter);
}

.sp-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(880px, calc(100vw - 48px));
  height: min(720px, calc(100vh - 64px));
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.sp-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.sp-header-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sp-header-copy {
  flex: 1;
  min-width: 0;
}

.sp-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-text);
}

.sp-sub {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-close {
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

.sp-close:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sp-tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}

.sp-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

.sp-tab:hover {
  color: var(--color-text);
  background: var(--color-ink-soft);
}

.sp-tab.active {
  background: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-xs);
}

.sp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.sp-folder {
  width: 220px;
  flex-shrink: 0;
}

.sp-source-search {
  flex: 1;
  min-width: 0;
}

.sp-source-search .el-input {
  width: 100%;
}

.sp-icon-btn {
  display: grid;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--control-radius);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sp-icon-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sp-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  padding: 6px 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}

.sp-list-count {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sp-text-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sp-text-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sp-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--color-canvas);
}

.sp-list {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px 12px;
}

.sp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  min-height: 68px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

.sp-row:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-xs);
}

.sp-row.selected {
  background: var(--color-ink-soft);
  border-color: var(--color-text);
}

.sp-check {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  color: var(--color-surface);
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}

.sp-row.selected .sp-check,
.sp-check.checked {
  background: var(--color-ink);
  border-color: var(--color-ink);
}

.sp-cover {
  width: 112px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
}

.sp-row-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sp-row-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
  color: var(--color-text);
}

.sp-row-meta {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.sp-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.sp-state--error {
  color: var(--color-error);
}

.sp-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-text-secondary);
  animation: sp-rotate 0.8s linear infinite;
}

@keyframes sp-rotate {
  to {
    transform: rotate(360deg);
  }
}

.sp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.sp-pager,
.sp-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sp-page {
  min-width: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sp-count {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* 主操作按钮：不使用品牌蓝，改为与 Settings 保存按钮一致的墨色主按钮 */
.sp-confirm-btn.el-button--primary {
  --el-button-bg-color: var(--color-ink);
  --el-button-border-color: var(--color-ink);
  --el-button-text-color: var(--color-surface);
  --el-button-hover-bg-color: var(--color-text);
  --el-button-hover-border-color: var(--color-text);
  --el-button-hover-text-color: var(--color-surface);
  --el-button-active-bg-color: var(--color-ink);
  --el-button-active-border-color: var(--color-ink);
  --el-button-active-text-color: var(--color-surface);
  --el-button-disabled-bg-color: var(--color-border-strong);
  --el-button-disabled-border-color: var(--color-border-strong);
  --el-button-disabled-text-color: var(--color-surface);
}

body.sp-lock {
  overflow: hidden;
}

.sp-fade-enter-active,
.sp-fade-leave-active {
  transition: opacity var(--dur-2) var(--ease-out);
}

.sp-fade-enter-from,
.sp-fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .sp-overlay {
    padding: 12px;
  }

  .sp-panel {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .sp-tabs {
    padding: 8px 10px;
  }

  .sp-tab {
    flex-direction: column;
    gap: 2px;
    height: auto;
    padding: 6px 2px;
    font-size: 11.5px;
  }

  .sp-toolbar {
    flex-wrap: wrap;
  }

  .sp-folder {
    width: 100%;
  }

  .sp-source-search {
    min-width: 180px;
  }

  .sp-footer {
    flex-wrap: wrap;
  }
}
</style>
