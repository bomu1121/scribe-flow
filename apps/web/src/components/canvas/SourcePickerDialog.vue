<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElMessage, ElTabPane, ElTable, ElTableColumn, ElTabs, type TableInstance } from "element-plus";
import { Clock3, FolderHeart, ListVideo, PlaySquare } from "lucide-vue-next";
import type { SourceCollection, SourceVideoItem } from "@scribe-flow/shared";
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

const tableRef = ref<TableInstance | null>(null);

const tabs = [
  { key: "fav" as const, label: "收藏夹", icon: FolderHeart },
  { key: "season" as const, label: "我的合集", icon: ListVideo },
  { key: "toview" as const, label: "稍后再看", icon: Clock3 },
  { key: "history" as const, label: "B站历史", icon: PlaySquare },
];

const displayItems = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();
  if (!keyword) return items.value;
  return items.value.filter(
    (item) => item.title.toLowerCase().includes(keyword) || item.uploader.toLowerCase().includes(keyword),
  );
});

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s} 秒`;
}

function asVideo(row: unknown): SourceVideoItem {
  return row as SourceVideoItem;
}

function clearSelection() {
  selected.value = [];
  tableRef.value?.clearSelection();
}

function onSelectionChange(rows: SourceVideoItem[]) {
  selected.value = rows;
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

function confirmSelection() {
  if (selected.value.length === 0) {
    ElMessage.warning("请先选择至少一个视频");
    return;
  }
  emit("confirm", selected.value.map((item) => ({ ...item })));
  dialogVisible.value = false;
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
      void loadTab();
    }
  },
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
});
</script>

<template>
  <el-dialog v-model="dialogVisible" title="从我的 B 站选择视频" width="560px" :close-on-click-modal="false" align-center>
    <el-tabs v-model="activeTab" class="sf-picker-tabs">
      <el-tab-pane v-for="tab in tabs" :key="tab.key" :name="tab.key">
        <template #label>
          <span class="sf-tab-label"><component :is="tab.icon" :size="13" />{{ tab.label }}</span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <div class="sf-picker-toolbar">
      <div v-if="activeTab === 'fav'" class="sf-picker-folder">
        <ModelSelect
          v-model="selectedFolder"
          :options="folders.map((folder) => ({ label: `${folder.title}（${folder.count}）`, value: folder.id }))"
          size="small"
          placeholder="选择收藏夹"
          :prefix-icon="FolderHeart"
        />
      </div>
      <div v-else-if="activeTab === 'season'" class="sf-picker-folder">
        <ModelSelect
          v-model="selectedCollection"
          :options="collections.map((collection) => ({ label: `${collection.title}（${collection.count}）`, value: collection.id }))"
          size="small"
          placeholder="选择合集"
          :prefix-icon="ListVideo"
        />
      </div>
      <el-input v-if="activeTab !== 'history'" v-model="searchKeyword" size="small" clearable placeholder="搜索标题 / UP 主" class="sf-picker-search" />
    </div>

    <p v-if="errorMessage" class="sf-picker-error">{{ errorMessage }}</p>

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="displayItems"
      row-key="bvid"
      height="280"
      size="small"
      class="sf-picker-table"
      empty-text="这里还没有可选择的视频"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="36" />
      <el-table-column label="视频" min-width="260">
        <template #default="{ row }">
          <div class="sf-video-cell">
            <img :src="asVideo(row).cover" class="sf-video-cover" alt="" referrerpolicy="no-referrer" loading="lazy" />
            <div class="sf-video-main">
              <span class="sf-video-title">{{ asVideo(row).title || "（无标题）" }}</span>
              <span class="sf-video-meta tnum">
                {{ asVideo(row).uploader || "UP 主未知" }} · {{ fmtDuration(asVideo(row).duration) }}<template v-if="asVideo(row).pageCount > 1"> · {{ asVideo(row).pageCount }}P</template>
              </span>
            </div>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="sf-picker-footer">
      <div class="sf-picker-pager">
        <el-button size="small" :disabled="loading || page <= 1" @click="goPage(page - 1)">上一页</el-button>
        <span class="sf-picker-page tnum">{{ page }}</span>
        <el-button size="small" :disabled="loading || !hasMore" @click="goPage(page + 1)">下一页</el-button>
      </div>
      <div class="sf-picker-confirm">
        <span class="sf-picker-count tnum">已选 {{ selected.length }} 项</span>
        <el-button type="primary" :disabled="selected.length === 0" @click="confirmSelection">生成来源节点</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.sf-picker-tabs {
  margin-bottom: 4px;
}

.sf-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sf-picker-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.sf-picker-folder {
  width: 200px;
  flex-shrink: 0;
}

.sf-picker-search {
  flex: 1;
}

.sf-picker-error {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--color-error);
}

.sf-video-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sf-video-cover {
  width: 72px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-xs);
  background: var(--color-ink-soft);
  flex-shrink: 0;
}

.sf-video-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sf-video-title {
  font-size: 12.5px;
  color: var(--color-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.sf-video-meta {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}

.sf-picker-pager {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-picker-page {
  min-width: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-picker-confirm {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sf-picker-count {
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
