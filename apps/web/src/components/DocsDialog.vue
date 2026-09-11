<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { BookText, FileWarning, RefreshCw, Search } from "lucide-vue-next";
import { ElInput } from "element-plus";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { useUiStore } from "@/stores/ui";
import { DOC_CLASS_LABELS, type DocClass, type DocSummary, docClassOfDir } from "@scribe-flow/shared";

interface DocDetail extends DocSummary {
  body: string;
  archived: boolean;
}

interface Group {
  key: string;
  label: string;
  items: DocSummary[];
}

const ui = useUiStore();

const items = ref<DocSummary[]>([]);
const available = ref(true);
const listError = ref("");
const listLoading = ref(false);

const activePath = ref("");
const detail = ref<DocDetail | null>(null);
const detailError = ref("");
const detailLoading = ref(false);
const keyword = ref("");
const paneRef = ref<HTMLElement | null>(null);

/** 已读过的正文缓存：来回切换文档时不重复请求。 */
const cache = new Map<string, DocDetail>();

const GROUP_LABELS: Record<string, string> = {
  docs: "现状",
  "docs/decisions": "决策",
  "docs/plans": "计划",
  "docs/evidence": "证据",
  "docs/research": "调研",
  "docs/research/raw": "调研原文（存档）",
  "docs/samples": "样例",
};

const GROUP_ORDER = [
  "docs",
  "docs/decisions",
  "docs/plans",
  "docs/evidence",
  "docs/research",
  "docs/samples",
  "docs/research/raw",
];

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return items.value;
  return items.value.filter(
    (item) =>
      item.title.toLowerCase().includes(kw) ||
      item.path.toLowerCase().includes(kw) ||
      (item.frontMatter?.class ?? "").toLowerCase().includes(kw),
  );
});

/** 按目录分组；目录顺序固定，组内保持列表原有的路径序。 */
const groups = computed<Group[]>(() => {
  const byDir = new Map<string, DocSummary[]>();
  for (const item of filtered.value) {
    const list = byDir.get(item.dir) ?? [];
    list.push(item);
    byDir.set(item.dir, list);
  }
  const keys = [...byDir.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, "zh");
  });
  return keys.map((key) => ({
    key,
    label: GROUP_LABELS[key] ?? key,
    items: byDir.get(key) ?? [],
  }));
});

const renderedBody = computed(() => {
  const doc = detail.value;
  if (!doc) return "";
  // 宽表格外面套一层滚动容器（markdown 里的表格不会嵌套，字符串替换是安全的）
  return renderMarkdown(stripLeadingTitle(doc.body, doc.title))
    .replace(/<table>/g, '<div class="sf-docs-table"><table>')
    .replace(/<\/table>/g, "</table></div>");
});

/**
 * 这些文档的正文几乎都以与标题相同的 H1 开头，而标题已经在头部单独呈现过了。
 * 不去掉的话，读起来像同一个标题连着出现两次。
 * 只在 H1 与标题实质相同（忽略空白与强调符号）时才剥离，避免误删承载信息的标题。
 */
function stripLeadingTitle(body: string, title: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  const m = /^#\s+(.+?)\s*$/.exec(lines[i] ?? "");
  if (!m) return body;
  const normalize = (text: string) => text.replace(/[\s`*_]/g, "").toLowerCase();
  if (normalize(m[1]) !== normalize(title)) return body;
  return lines.slice(i + 1).join("\n");
}

/** 按目录推出的分类；front matter 里没写时用它兜底显示。 */
function classOf(item: DocSummary): DocClass | null {
  const declared = item.frontMatter?.class;
  if (declared && declared in DOC_CLASS_LABELS) return declared as DocClass;
  return docClassOfDir(item.dir);
}

function classLabel(item: DocSummary): string {
  const cls = classOf(item);
  return cls ? DOC_CLASS_LABELS[cls] : "未分类";
}

/** 缺 front matter 是真实问题（门禁会报 R1），列表里直接标出来。 */
const missingFrontMatter = (item: DocSummary) => !item.frontMatter;

/** front matter 里的字段按关注度排序展示；空值不占位。 */
const metaRows = computed(() => {
  const fm = detail.value?.frontMatter;
  if (!fm) return [];
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  if (fm.title) rows.push({ label: "标题", value: fm.title });
  if (fm.owner) rows.push({ label: "责任人", value: fm.owner });
  if (fm.status) rows.push({ label: "状态", value: fm.status, mono: true });
  if (fm.last_reviewed) rows.push({ label: "最后复核", value: fm.last_reviewed, mono: true });
  if (fm.review_days) rows.push({ label: "复核阈值", value: `${fm.review_days} 天`, mono: true });
  if (fm.frozen_at) rows.push({ label: "冻结于", value: fm.frozen_at, mono: true });
  if (fm.content_hash) rows.push({ label: "内容指纹", value: fm.content_hash, mono: true });
  if (fm.supersedes) rows.push({ label: "取代", value: fm.supersedes, mono: true });
  if (fm.superseded_by) rows.push({ label: "被取代", value: fm.superseded_by, mono: true });
  return rows;
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadList() {
  listLoading.value = true;
  listError.value = "";
  try {
    const data = await api.get<{ available: boolean; items: DocSummary[] }>("/api/docs");
    items.value = data.items;
    available.value = data.available;
    if (data.available && !activePath.value) await select(items.value[0]?.path ?? "");
  } catch (err) {
    listError.value = err instanceof Error ? err.message : "文档列表加载失败";
  } finally {
    listLoading.value = false;
  }
}

async function select(path: string) {
  if (!path) return;
  activePath.value = path;
  detailError.value = "";
  const cached = cache.get(path);
  if (cached) {
    detail.value = cached;
    paneRef.value?.scrollTo({ top: 0 });
    return;
  }
  detailLoading.value = true;
  detail.value = null;
  try {
    const data = await api.get<DocDetail>(`/api/docs/file?path=${encodeURIComponent(path)}`);
    cache.set(path, data);
    // 期间用户可能已经切到别的文档，避免把旧结果盖上去
    if (activePath.value !== path) return;
    detail.value = data;
    paneRef.value?.scrollTo({ top: 0 });
  } catch (err) {
    if (activePath.value !== path) return;
    detailError.value = err instanceof Error ? err.message : "文档加载失败";
  } finally {
    detailLoading.value = false;
  }
}

/**
 * 正文里的相对链接指向的是仓库内的另一个文档，点开应当在阅读器内跳转，
 * 而不是让浏览器在当前页面里去找那个路径（必然 404）。
 */
function onPaneClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement | null)?.closest("a");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = anchor.getAttribute("href") ?? "";
  if (!href || /^(?:https?:|mailto:)/i.test(href)) return;
  event.preventDefault();
  const target = href.split("#")[0];
  if (!target) return;
  // 正文里的链接是相对当前文档所在目录写的，先归一成仓库相对路径
  const baseDir = activePath.value.slice(0, activePath.value.lastIndexOf("/"));
  const resolved = normalizePosix(`${baseDir}/${target}`);
  const hit = items.value.find((item) => item.path === resolved);
  if (hit) void select(hit.path);
}

/** 极简的 posix 路径归一（只处理 . 与 ..），避免依赖 node:path。 */
function normalizePosix(input: string): string {
  const out: string[] = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && ui.docsOpen) ui.closeDocs();
}

watch(
  () => ui.docsOpen,
  (open) => {
    if (open) {
      window.addEventListener("keydown", onKeydown);
      // 每次打开都从完整列表开始：上次留下的筛选词会让"文档怎么少了"变成困惑。
      keyword.value = "";
      if (items.value.length === 0) void loadList();
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="sf-docs-fade">
      <div v-if="ui.docsOpen" class="sf-docs-overlay" @click.self="ui.closeDocs()">
        <section class="sf-docs-panel" role="dialog" aria-modal="true" aria-label="项目文档">
          <header class="sf-docs-head">
            <span class="sf-docs-head-icon"><BookText :size="15" /></span>
            <h2 class="sf-docs-head-title">项目文档</h2>
            <span class="sf-docs-head-count tnum">{{ items.length }} 篇</span>
            <button type="button" class="sf-docs-head-close" aria-label="关闭项目文档" @click="ui.closeDocs()">
              关闭
            </button>
          </header>

          <div class="sf-docs-body">
            <aside class="sf-docs-side">
              <div class="sf-docs-search">
                <ElInput v-model="keyword" placeholder="搜索标题或路径" clearable size="small">
                  <template #prefix><Search :size="13" /></template>
                </ElInput>
              </div>

              <div class="sf-docs-list">
                <p v-if="listLoading" class="sf-docs-hint">正在读取文档目录…</p>
                <p v-else-if="listError" class="sf-docs-hint sf-docs-hint-error">{{ listError }}</p>
                <p v-else-if="!available" class="sf-docs-hint">
                  当前部署未包含文档目录，因此没有可预览的内容。开发环境下请确认仓库根的
                  <code>docs/</code> 目录存在。
                </p>
                <p v-else-if="groups.length === 0" class="sf-docs-hint">没有匹配「{{ keyword }}」的文档。</p>

                <template v-for="group in groups" :key="group.key">
                  <p class="sf-docs-group">{{ group.label }}</p>
                  <button
                    v-for="item in group.items"
                    :key="item.path"
                    type="button"
                    class="sf-docs-item"
                    :class="{ active: item.path === activePath }"
                    :aria-current="item.path === activePath ? 'true' : undefined"
                    @click="select(item.path)"
                  >
                    <span class="sf-docs-item-title">{{ item.title }}</span>
                    <span class="sf-docs-item-meta">
                      <span class="sf-docs-item-class">{{ classLabel(item) }}</span>
                      <span v-if="item.frontMatter?.status" class="sf-docs-item-status">{{ item.frontMatter.status }}</span>
                      <span v-if="missingFrontMatter(item)" class="sf-docs-item-warn" title="缺少 front matter：文档门禁会报 R1">
                        <FileWarning :size="11" /> 无元数据
                      </span>
                    </span>
                  </button>
                </template>
              </div>
            </aside>

            <section ref="paneRef" class="sf-docs-pane">
              <p v-if="detailLoading" class="sf-docs-hint">正在读取…</p>

              <div v-else-if="detailError" class="sf-docs-pane-error">
                <p>{{ detailError }}</p>
                <button type="button" class="sf-docs-retry" @click="select(activePath)">
                  <RefreshCw :size="13" /> 重试
                </button>
              </div>

              <article v-else-if="detail" class="sf-docs-article">
                <header class="sf-docs-article-head">
                  <h1 class="sf-docs-article-title">{{ detail.title }}</h1>
                  <p class="sf-docs-article-path">
                    <code>{{ detail.path }}</code>
                    <span class="sf-docs-dot">·</span>
                    <span>{{ formatSize(detail.size) }}</span>
                  </p>
                  <dl v-if="metaRows.length" class="sf-docs-meta">
                    <div v-for="row in metaRows" :key="row.label" class="sf-docs-meta-row">
                      <dt>{{ row.label }}</dt>
                      <dd :class="{ mono: row.mono }">{{ row.value }}</dd>
                    </div>
                  </dl>
                  <p v-else class="sf-docs-meta-empty">
                    这篇文档没有 front matter——门禁会报 R1，可按 AGENTS.md 的 schema 补上。
                  </p>
                </header>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div class="markdown-body sf-docs-prose" @click="onPaneClick" v-html="renderedBody" />
              </article>

              <p v-else class="sf-docs-hint">从左侧选择一篇文档开始阅读。</p>
            </section>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/*
 * 自定义浮层（与设置浮层同构）：不使用 Element Plus 默认 Dialog 骨架。
 * 注意本组件用了 Teleport，样式必须是全局的——这是 ui-lint 的铁律。
 */
.sf-docs-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--color-scrim);
}

.sf-docs-panel {
  display: flex;
  flex-direction: column;
  width: min(1320px, calc(100vw - 32px));
  height: min(880px, calc(100vh - 32px));
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
}

.sf-docs-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.sf-docs-head-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  border-radius: var(--radius-sm);
}

.sf-docs-head-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-docs-head-count {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.sf-docs-head-close {
  margin-left: auto;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  transition: color var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
}

.sf-docs-head-close:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
}

.sf-docs-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

/* ---------------------------------------------------------------- 左列表 */

.sf-docs-side {
  display: flex;
  flex-direction: column;
  flex: 0 0 288px;
  min-height: 0;
  border-right: 1px solid var(--color-border);
}

.sf-docs-search {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
}

.sf-docs-list {
  flex: 1 1 auto;
  min-height: 0;
  padding: 6px 8px 14px;
  overflow-y: auto;
}

.sf-docs-group {
  margin: 10px 0 4px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  letter-spacing: 0.04em;
}

.sf-docs-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 7px 8px;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  transition: background var(--dur-2) var(--ease-out);
}

.sf-docs-item:hover {
  background: var(--color-ink-soft-glass);
}

.sf-docs-item.active {
  background: var(--color-ink-soft);
}

.sf-docs-item-title {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--color-text);
}

.sf-docs-item.active .sf-docs-item-title {
  font-weight: 600;
}

.sf-docs-item-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-docs-item-status {
  font-family: var(--font-mono);
  color: var(--color-text-tertiary);
}

.sf-docs-item-warn {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  color: var(--color-warning);
}

/* ---------------------------------------------------------------- 右正文 */

.sf-docs-pane {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
}

.sf-docs-article {
  /* 阅读舒适度的关键：限制行宽。正文再长也不横跨整屏。
     取 84ch 是在"中文单行 40 字左右"与"表格不至于被挤碎"之间的折中。 */
  max-width: 84ch;
  padding: 28px 32px 72px;
  margin: 0 auto;
}

.sf-docs-article-head {
  padding-bottom: 14px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--color-border);
}

.sf-docs-article-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-text);
}

.sf-docs-article-path {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.sf-docs-article-path code {
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}

.sf-docs-dot {
  color: var(--color-border-strong);
}

.sf-docs-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 12px 0 0;
}

.sf-docs-meta-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11.5px;
}

.sf-docs-meta-row dt {
  color: var(--color-text-tertiary);
}

.sf-docs-meta-row dd {
  margin: 0;
  color: var(--color-text-secondary);
}

.sf-docs-meta-row dd.mono {
  font-family: var(--font-mono);
}

.sf-docs-meta-empty {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--color-warning);
}

/* 正文复用结果页的 .markdown-body 排版，保证两处阅读体验一致 */
.sf-docs-prose {
  font-size: 13.5px;
  line-height: 1.75;
}

/* 这些文档的表格常有 4-5 列且含长路径。用滚动容器兜住，
   既不挤压表格（改用 display:block 会丢掉表格布局语义），也不撑破正文。 */
.sf-docs-table {
  max-width: 100%;
  overflow-x: auto;
}

.sf-docs-hint {
  padding: 24px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--color-text-tertiary);
}

.sf-docs-hint code {
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}

.sf-docs-hint-error {
  color: var(--color-error);
}

.sf-docs-pane-error {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
  padding: 24px;
  font-size: 12.5px;
  color: var(--color-error);
}

.sf-docs-retry {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.sf-docs-retry:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
}

.sf-docs-fade-enter-active,
.sf-docs-fade-leave-active {
  transition: opacity var(--dur-2) var(--ease-out);
}

.sf-docs-fade-enter-from,
.sf-docs-fade-leave-to {
  opacity: 0;
}

/* 窄屏：列表收窄，正文留出更多空间 */
@media (max-width: 860px) {
  .sf-docs-side {
    flex-basis: 208px;
  }

  .sf-docs-article {
    padding: 20px 18px 56px;
  }
}
</style>
