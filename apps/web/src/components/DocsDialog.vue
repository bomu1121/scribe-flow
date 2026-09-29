<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { BookText, FileWarning, RefreshCw, Search } from "lucide-vue-next";
import { ElInput } from "element-plus";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { formatBytes } from "@/lib/bytes";
import { useUiStore } from "@/stores/ui";
import { DOC_CLASS_LABELS, type DocClass, type DocSummary, docClassOfDir } from "@scribe-flow/shared";

interface DocDetail extends DocSummary {
  body: string;
}

/** 列表项：`body` 只在服务端支持聚合请求时一起回来（旧进程可能还没有）。 */
interface DocEntry extends DocSummary {
  body?: string;
}

interface Group {
  key: string;
  label: string;
  items: DocSummary[];
}

const ui = useUiStore();

const items = ref<DocEntry[]>([]);
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

const busy = computed(() => listLoading.value || detailLoading.value);

/**
 * 加载指示延迟出现，短于这个时长的加载什么都不显示。
 *
 * 本地打开阅读器实测约 60 ms，指示灯一闪而过比不显示更刺眼——「突兀」正是这么来的。
 * 超过这个时长才说明真的在等，这时才给提示。（数值取全站动效令牌里的 --dur-2 一档。）
 */
const BUSY_HINT_DELAY = 180;
const showBusyHint = ref(false);
let busyHintTimer: number | undefined;

watch(
  busy,
  (loading) => {
    window.clearTimeout(busyHintTimer);
    if (!loading) {
      showBusyHint.value = false;
      return;
    }
    busyHintTimer = window.setTimeout(() => {
      showBusyHint.value = true;
    }, BUSY_HINT_DELAY);
  },
  { immediate: true },
);

/** 还没有任何正文可显示时才占位；有旧正文时只压暗（见模板里的 is-loading）。 */
const showPanePlaceholder = computed(() => showBusyHint.value && !detail.value);

const GROUP_LABELS: Record<string, string> = {
  docs: "现状",
  "docs/decisions": "决策",
  "docs/research": "调研",
  "docs/samples": "样例",
};

const GROUP_ORDER = ["docs", "docs/decisions", "docs/research", "docs/samples"];

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

/**
 * front matter 里的字段按关注度排序展示；空值不占位。
 * front matter 只有 title / class / status 三个字段（见 packages/shared/src/docs.ts）；
 * 责任人、最后复核、内容指纹这些字段已随文档门禁瘦身删除，界面不再展示。
 */
const metaRows = computed(() => {
  const fm = detail.value?.frontMatter;
  if (!fm) return [];
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  if (fm.title) rows.push({ label: "标题", value: fm.title });
  if (fm.status) rows.push({ label: "状态", value: fm.status, mono: true });
  return rows;
});

/**
 * 一次请求把列表与全部正文都取回来。
 *
 * 「列表 + 逐篇取正文」是两次串行请求，而第二个请求通常要新建一条 TCP 连接——开发环境里对
 * `localhost:5173` 新建连接要等约 205 ms（Vite 只监听 IPv4，`localhost` 先解析到 `::1`，
 * 见 AGENTS.md 的「别踩的坑」）。正文合计几百 KB 且全是纯文本，并进同一次请求几乎不加成本，
 * 换来打开只剩一次请求、之后每次切换文档都是 0 次（实测打开到正文可读 355 → 62 ms）。
 */
async function loadDocs() {
  listLoading.value = true;
  listError.value = "";
  try {
    const data = await api.get<{ available: boolean; items: DocEntry[] }>("/api/docs?body=1");
    available.value = data.available;
    items.value = data.items;
    for (const item of data.items) {
      // 服务端没跟上（例如后端进程还是旧版）时 body 缺失，退回逐篇取正文
      if (typeof item.body === "string") cache.set(item.path, item as DocDetail);
    }
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
    scrollPaneToTop();
    return;
  }
  detailLoading.value = true;
  try {
    const data = await api.get<DocDetail>(`/api/docs/file?path=${encodeURIComponent(path)}`);
    cache.set(path, data);
    // 期间用户可能已经切到别的文档，避免把旧结果盖上去
    if (activePath.value !== path) return;
    detail.value = data;
    scrollPaneToTop();
  } catch (err) {
    if (activePath.value !== path) return;
    detailError.value = err instanceof Error ? err.message : "文档加载失败";
  } finally {
    if (activePath.value === path) detailLoading.value = false;
  }
}

function scrollPaneToTop() {
  paneRef.value?.scrollTo({ top: 0 });
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
      if (items.value.length === 0) void loadDocs();
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
            <span v-if="items.length > 0" class="sf-docs-head-count tnum">{{ items.length }} 篇</span>
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
                <div v-if="listLoading && items.length === 0" class="sf-docs-state">
                  <span v-if="showBusyHint" class="sf-loading-hint">
                    <span class="sf-loading-spinner" aria-hidden="true" />
                    <span>正在读取文档目录…</span>
                  </span>
                </div>
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

            <section ref="paneRef" class="sf-docs-pane" :aria-busy="busy ? 'true' : undefined">
              <div v-if="showPanePlaceholder" class="sf-docs-state">
                <span class="sf-loading-hint">
                  <span class="sf-loading-spinner" aria-hidden="true" />
                  <span>正在读取…</span>
                </span>
              </div>

              <div v-else-if="detailError" class="sf-docs-pane-error">
                <p>{{ detailError }}</p>
                <button type="button" class="sf-docs-retry" @click="select(activePath)">
                  <RefreshCw :size="13" /> 重试
                </button>
              </div>

              <article v-else-if="detail" class="sf-docs-article" :class="{ 'is-loading': busy }">
                <header class="sf-docs-article-head">
                  <h1 class="sf-docs-article-title">{{ detail.title }}</h1>
                  <p class="sf-docs-article-path">
                    <code>{{ detail.path }}</code>
                    <span class="sf-docs-dot">·</span>
                    <span>{{ formatBytes(detail.size) }}</span>
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
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
}

/*
 * 加载占位：用全站统一的那套（`.sf-loading-hint` + `.sf-loading-spinner`，定义在 styles/app.css，
 * 画布节点与小卡预览也是它）。这里只负责占位与居中——自己造骨架屏/进度条会与其它地方不一致。
 * 注意指示灯本身是**延迟出现**的（见 BUSY_HINT_DELAY），短暂加载期间这里就是一块空的底色。
 */
.sf-docs-state {
  display: grid;
  place-items: center;
  /* 撑满所在栏：指示灯落在这块空白的正中，而不是贴着顶部（大块空白里贴顶读起来像残留元素）。 */
  min-height: 100%;
  padding: 24px;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
}

/* 旧正文保留在屏上但压暗：切换文档时不再"整块消失 → 重新出现"，
   用户能看出是在换内容，而不是以为点空了。 */
.sf-docs-article.is-loading {
  opacity: 0.45;
  transition: opacity var(--dur-2) var(--ease-out);
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
