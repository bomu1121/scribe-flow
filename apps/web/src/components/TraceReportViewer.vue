<script setup lang="ts">
import { computed, ref } from "vue";
import { Search } from "lucide-vue-next";
import type { TraceCategory, TraceConfidence, TraceEvidence, TraceItem, TraceReport } from "@scribe-flow/shared";
import { TRACE_CATEGORY_LABELS, TRACE_CONFIDENCE_LABELS, TRACE_EXTERNAL_STATUS_LABELS } from "@scribe-flow/shared";

interface TraceSource {
  key: string;
  label: string;
  text: string;
}

const props = defineProps<{
  reports: TraceReport[];
  sources?: TraceSource[];
}>();

const search = ref("");
const activeCategory = ref<TraceCategory | "all">("all");
const activeConfidence = ref<TraceConfidence | "all">("all");
const expandedContext = ref<Record<string, boolean>>({});
const categoryKeys = Object.keys(TRACE_CATEGORY_LABELS) as TraceCategory[];
const confidenceKeys = Object.keys(TRACE_CONFIDENCE_LABELS) as TraceConfidence[];

interface DisplayItem {
  reportIndex: number;
  item: TraceItem;
}

const allItems = computed<DisplayItem[]>(() =>
  props.reports.flatMap((report, reportIndex) => report.items.map((item) => ({ reportIndex, item }))),
);

const stats = computed(() => {
  const items = allItems.value;
  const confirmed = items.filter((entry) => entry.item.confidence === "confirmed").length;
  const likely = items.filter((entry) => entry.item.confidence === "likely").length;
  const uncertain = items.filter((entry) => entry.item.confidence === "uncertain").length;
  const uncertainties = props.reports.reduce((sum, report) => sum + (report.uncertainties?.length ?? 0), 0);
  const warnings = props.reports.reduce((sum, report) => sum + (report.warnings?.length ?? 0), 0);
  return { total: items.length, confirmed, likely, uncertain, uncertainties, warnings };
});

const categoryCounts = computed(() => {
  const counts = new Map<TraceCategory, number>();
  for (const entry of allItems.value) {
    counts.set(entry.item.category, (counts.get(entry.item.category) ?? 0) + 1);
  }
  return counts;
});

const confidenceCounts = computed(() => {
  const counts = new Map<TraceConfidence, number>();
  for (const entry of allItems.value) {
    counts.set(entry.item.confidence, (counts.get(entry.item.confidence) ?? 0) + 1);
  }
  return counts;
});

function normalize(text: string): string {
  return text.trim().toLocaleLowerCase();
}

function itemMatches(item: TraceItem): boolean {
  const keyword = normalize(search.value);
  if (keyword) {
    const evidenceText = [
      item.claim,
      item.basis ?? "",
      item.note ?? "",
      ...item.evidence.map((evidence) => `${evidence.quote} ${evidence.locator ?? ""} ${evidence.source?.name ?? ""} ${evidence.source?.locator ?? ""} ${evidence.note ?? ""}`),
      ...(item.mentions ?? []).map((mention) => `${mention.quote} ${mention.source?.name ?? ""} ${mention.locator ?? ""}`),
    ].join(" ");
    if (!normalize(evidenceText).includes(keyword)) return false;
  }
  if (activeCategory.value !== "all" && item.category !== activeCategory.value) return false;
  if (activeConfidence.value !== "all" && item.confidence !== activeConfidence.value) return false;
  return true;
}

const filteredItems = computed(() => allItems.value.filter((entry) => itemMatches(entry.item)));

function reportTitle(reportIndex: number): string {
  const report = props.reports[reportIndex];
  return report?.title?.trim() || (props.reports.length > 1 ? `溯源报告 ${reportIndex + 1}` : "信息溯源报告");
}

function evidenceKey(entry: DisplayItem, evidenceIndex: number, prefix = "evidence"): string {
  return `${prefix}-${entry.reportIndex}-${entry.item.id ?? entry.item.claim}-${evidenceIndex}`;
}

function toggleContext(key: string): void {
  expandedContext.value = { ...expandedContext.value, [key]: !expandedContext.value[key] };
}

interface QuoteContext {
  sourceKey: string;
  sourceLabel: string;
  before: string;
  quote: string;
  after: string;
}

function findQuoteContext(quote: string): QuoteContext | null {
  const normalizedQuote = quote.replace(/\s+/g, " ").trim();
  if (!normalizedQuote) return null;
  for (const source of props.sources ?? []) {
    if (!source.text?.trim()) continue;
    const normalizedSource = source.text.replace(/\s+/g, " ").trim();
    const index = normalizedSource.indexOf(normalizedQuote);
    if (index < 0) continue;
    const start = Math.max(0, index - 120);
    const end = Math.min(normalizedSource.length, index + normalizedQuote.length + 160);
    return {
      sourceKey: source.key,
      sourceLabel: source.label || source.key,
      before: normalizedSource.slice(start, index),
      quote: normalizedSource.slice(index, index + normalizedQuote.length),
      after: normalizedSource.slice(index + normalizedQuote.length, end),
    };
  }
  return null;
}

function contextFor(entry: DisplayItem, evidenceIndex: number): QuoteContext | null {
  const evidence = entry.item.evidence[evidenceIndex];
  if (!evidence) return null;
  return findQuoteContext(evidence.quote);
}

function sourceNameFor(evidence: TraceEvidence, entry?: DisplayItem, evidenceIndex?: number): string {
  if (evidence.source?.name?.trim()) return evidence.source.name.trim();
  if (entry !== undefined && evidenceIndex !== undefined) {
    const ctx = contextFor(entry, evidenceIndex);
    if (ctx) return ctx.sourceLabel;
  }
  return "当前输入素材";
}

function sourceLocatorFor(evidence: TraceEvidence): string {
  return evidence.locator?.trim() || evidence.source?.locator?.trim() || "";
}

function attributionText(item: TraceItem): string {
  if (!item.attribution) return "";
  if (item.attribution.kind === "external") {
    return `外部归因：${item.attribution.name ?? "未指明"}${item.attribution.detail ? `（${item.attribution.detail}）` : ""}`;
  }
  if (item.attribution.kind === "self") return "内部观点：视频作者/讲述者本人提出";
  return "归属不明：无法判断是作者原创还是转述外部来源";
}

function resetFilters(): void {
  search.value = "";
  activeCategory.value = "all";
  activeConfidence.value = "all";
}
</script>

<template>
  <div class="trv">
    <template v-if="reports.length > 1">
      <div class="trv-report-tabs">
        <span v-for="(report, index) in reports" :key="index" class="trv-report-tab">{{ report.title?.trim() || `溯源报告 ${index + 1}` }}</span>
      </div>
    </template>

    <header v-if="reports.length > 0" class="trv-head">
      <div>
        <h2 class="trv-title">{{ reports.length === 1 ? reportTitle(0) : "信息溯源报告" }}</h2>
        <p v-if="reports[0]?.summary" class="trv-summary">{{ reports[0].summary }}</p>
      </div>
      <div class="trv-stats">
        <span class="trv-stat"><b class="tnum">{{ stats.total }}</b> 条</span>
        <span class="trv-stat"><b class="tnum">{{ stats.confirmed }}</b> 原文可见</span>
        <span class="trv-stat"><b class="tnum">{{ stats.likely }}</b> 间接推断</span>
        <span class="trv-stat"><b class="tnum">{{ stats.uncertain + stats.uncertainties }}</b> 待核实</span>
        <span v-if="stats.warnings > 0" class="trv-stat"><b class="tnum">{{ stats.warnings }}</b> 提醒</span>
      </div>
    </header>

    <div class="trv-toolbar">
      <div class="trv-search">
        <Search :size="14" class="trv-search-icon" />
        <input v-model="search" type="search" class="trv-search-input" placeholder="搜索主张 / 引用 / 来源…" aria-label="搜索溯源信息" />
      </div>
      <div class="trv-filters">
        <span class="trv-filter-label">类型</span>
        <button
          type="button"
          class="trv-filter"
          :class="{ active: activeCategory === 'all' }"
          @click="activeCategory = 'all'"
        >
          全部 <span class="tnum">{{ allItems.length }}</span>
        </button>
        <button
          v-for="category in categoryKeys"
          :key="category"
          type="button"
          class="trv-filter"
          :class="{ active: activeCategory === category }"
          @click="activeCategory = activeCategory === category ? 'all' : category"
        >
          {{ TRACE_CATEGORY_LABELS[category] }} <span class="tnum">{{ categoryCounts.get(category) ?? 0 }}</span>
        </button>
        <span class="trv-filter-divider" />
        <span class="trv-filter-label">可信度</span>
        <button
          v-for="confidence in confidenceKeys"
          :key="confidence"
          type="button"
          class="trv-filter"
          :class="{ active: activeConfidence === confidence }"
          @click="activeConfidence = activeConfidence === confidence ? 'all' : confidence"
        >
          {{ TRACE_CONFIDENCE_LABELS[confidence] }} <span class="tnum">{{ confidenceCounts.get(confidence) ?? 0 }}</span>
        </button>
      </div>
    </div>

    <div v-if="reports.length === 0" class="trv-empty">
      本次运行没有生成可展示的结构化溯源报告。
    </div>

    <div v-else-if="filteredItems.length === 0 && stats.total > 0" class="trv-empty">
      没有符合当前筛选条件的溯源信息。
      <button type="button" class="trv-empty-action" @click="resetFilters">清除筛选</button>
    </div>

    <div v-else-if="filteredItems.length === 0" class="trv-empty">
      本次内容没有可直接引用的信息条目，请查看下方待核实与提醒。
    </div>

    <div v-else class="trv-list">
      <article
        v-for="(entry, itemIndex) in filteredItems"
        :key="`${entry.reportIndex}-${entry.item.id ?? entry.item.claim}-${itemIndex}`"
        class="trv-entry"
      >
        <header class="trv-entry-head">
          <span class="trv-index tnum">{{ String(itemIndex + 1).padStart(2, "0") }}</span>
          <div class="trv-entry-heading">
            <h3 class="trv-claim">{{ entry.item.claim }}</h3>
            <p class="trv-entry-meta">
              <span>{{ TRACE_CATEGORY_LABELS[entry.item.category] }}</span>
              <span>·</span>
              <span>{{ TRACE_CONFIDENCE_LABELS[entry.item.confidence] }}</span>
              <span v-if="reports.length > 1" class="trv-report-label">{{ reportTitle(entry.reportIndex) }}</span>
            </p>
          </div>
        </header>

        <p v-if="entry.item.basis" class="trv-basis">判断依据：{{ entry.item.basis }}</p>
        <p v-if="entry.item.attribution" class="trv-basis">{{ attributionText(entry.item) }}</p>
        <p v-if="entry.item.note" class="trv-note">{{ entry.item.note }}</p>

        <div v-if="entry.item.external" class="trv-external">
          <div class="trv-external-head">
            <span class="trv-external-status">外部核查：{{ TRACE_EXTERNAL_STATUS_LABELS[entry.item.external.status] }}</span>
            <span v-if="entry.item.external.query" class="trv-external-query tnum">检索：{{ entry.item.external.query }}</span>
          </div>
          <p v-if="entry.item.external.summary" class="trv-external-summary">{{ entry.item.external.summary }}</p>
          <ul v-if="(entry.item.external.sources ?? []).length > 0" class="trv-external-sources">
            <li v-for="(source, sourceIndex) in entry.item.external.sources ?? []" :key="sourceIndex">
              <a v-if="source.url" :href="source.url" target="_blank" rel="noreferrer">{{ source.title || source.url }}</a>
              <span v-else>{{ source.title || source.url }}</span>
              <span v-if="source.snippet" class="trv-external-snippet">{{ source.snippet }}</span>
            </li>
          </ul>
          <p v-if="entry.item.external.note" class="trv-external-note">{{ entry.item.external.note }}</p>
        </div>

        <div v-if="entry.item.evidence.length > 0" class="trv-evidence-list">
          <section
            v-for="(evidence, evidenceIndex) in entry.item.evidence"
            :key="evidenceIndex"
            class="trv-evidence"
          >
            <div class="trv-evidence-source">
              <span class="trv-source-name">{{ sourceNameFor(evidence, entry, evidenceIndex) }}</span>
              <span v-if="evidence.source?.url" class="trv-source-url">
                <a :href="evidence.source.url" target="_blank" rel="noreferrer">原链接</a>
              </span>
              <span v-if="sourceLocatorFor(evidence)" class="trv-source-locator tnum">{{ sourceLocatorFor(evidence) }}</span>
            </div>
            <blockquote class="trv-quote">{{ evidence.quote }}</blockquote>
            <div class="trv-evidence-meta">
              <span v-if="evidence.note" class="trv-evidence-note">{{ evidence.note }}</span>
              <button
                type="button"
                class="trv-context-toggle"
                @click="toggleContext(evidenceKey(entry, evidenceIndex))"
              >
                {{ expandedContext[evidenceKey(entry, evidenceIndex)] ? "收起原文上下文" : "看原文上下文" }}
              </button>
            </div>
            <div v-if="expandedContext[evidenceKey(entry, evidenceIndex)]" class="trv-source-context">
              <template v-if="contextFor(entry, evidenceIndex)">
                <p class="trv-source-context-text">
                  <span>{{ contextFor(entry, evidenceIndex)?.before }}</span>
                  <mark class="trv-source-highlight">{{ contextFor(entry, evidenceIndex)?.quote }}</mark>
                  <span>{{ contextFor(entry, evidenceIndex)?.after }}</span>
                </p>
              </template>
              <p v-else class="trv-source-missing">当前输入素材中未定位到该原文片段。</p>
            </div>
          </section>
        </div>
        <p v-else class="trv-no-evidence">本条无直接原文引用，请结合“判断依据 / 备注”谨慎使用。</p>

        <div v-if="(entry.item.mentions ?? []).length > 0" class="trv-mentions">
          <div class="trv-mentions-title">其他位置 / 其他来源的提及</div>
          <ul class="trv-mentions-list">
            <li v-for="(mention, mentionIndex) in entry.item.mentions ?? []" :key="mentionIndex" class="trv-mention">
              <span class="trv-mention-source">{{ sourceNameFor(mention) }}<template v-if="sourceLocatorFor(mention)"> · {{ sourceLocatorFor(mention) }}</template></span>
              <span class="trv-mention-quote">“{{ mention.quote }}”</span>
              <span v-if="mention.note" class="trv-mention-note">{{ mention.note }}</span>
            </li>
          </ul>
        </div>
      </article>
    </div>

    <section v-if="reports.some((report) => (report.uncertainties?.length ?? 0) > 0)" class="trv-uncertain">
      <h3 class="trv-section-title">待核实问题</h3>
      <ul class="trv-uncertain-list">
        <li v-for="(uncertainty, index) in reports.flatMap((report) => report.uncertainties ?? [])" :key="index" class="trv-uncertain-item">
          <span class="trv-uncertain-claim">{{ uncertainty.claim }}</span>
          <span class="trv-uncertain-reason">{{ uncertainty.reason }}</span>
        </li>
      </ul>
    </section>

    <section v-if="reports.some((report) => (report.warnings?.length ?? 0) > 0)" class="trv-warnings">
      <h3 class="trv-section-title">提醒</h3>
      <ul class="trv-warnings-list">
        <li v-for="(warning, index) in reports.flatMap((report) => report.warnings ?? [])" :key="index" class="trv-warning-item">{{ warning }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.trv {
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.75;
}

.trv-report-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.trv-report-tab {
  padding: 3px 0;
  border-bottom: 1px solid var(--color-border-strong);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.trv-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--color-border);
}

.trv-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.trv-summary {
  margin: 6px 0 0;
  max-width: 680px;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.trv-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex-shrink: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.trv-stat b {
  font-weight: 600;
  color: var(--color-text);
}

.trv-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.trv-search {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 420px;
}

.trv-search-icon {
  position: absolute;
  left: 8px;
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.trv-search-input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 30px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color var(--dur-1) var(--ease-out);
}

.trv-search-input:focus {
  border-color: var(--color-text-tertiary);
}

.trv-filters {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  font-size: 12px;
}

.trv-filter-label {
  margin-right: 6px;
  color: var(--color-text-tertiary);
}

.trv-filter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.trv-filter span {
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.trv-filter:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.trv-filter.active {
  background: var(--color-ink);
  color: var(--color-surface);
}

.trv-filter.active span {
  color: var(--color-surface);
  opacity: 0.7;
}

.trv-filter-divider {
  width: 1px;
  height: 14px;
  margin: 0 8px;
  background: var(--color-border);
}

.trv-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  border: 1px dashed var(--color-border-strong);
  color: var(--color-text-secondary);
  font-size: 13px;
}

.trv-empty-action {
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.trv-list {
  display: flex;
  flex-direction: column;
}

.trv-entry {
  padding: 18px 0 20px;
  border-bottom: 1px solid var(--color-border);
}

.trv-entry:last-child {
  border-bottom: none;
}

.trv-entry-head {
  display: flex;
  gap: 14px;
}

.trv-index {
  flex: 0 0 auto;
  padding-top: 3px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 600;
}

.trv-entry-heading {
  min-width: 0;
}

.trv-claim {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.6;
  color: var(--color-text);
}

.trv-entry-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.trv-report-label {
  color: var(--color-text-tertiary);
}

.trv-basis {
  margin: 8px 0 0 32px;
  padding-left: 10px;
  border-left: 2px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.trv-note {
  margin: 8px 0 0 32px;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.trv-evidence-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 12px 0 0 32px;
}

.trv-evidence {
  padding-left: 12px;
  border-left: 2px solid var(--color-border-strong);
}

.trv-evidence-source {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.trv-source-name {
  font-weight: 500;
  color: var(--color-text);
}

.trv-source-url a {
  color: var(--color-text-secondary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.trv-source-url a:hover {
  color: var(--color-text);
}

.trv-source-locator {
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.trv-quote {
  margin: 6px 0 0;
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.8;
}

.trv-evidence-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.trv-evidence-note {
  color: var(--color-text-tertiary);
}

.trv-context-toggle {
  border: none;
  background: none;
  padding: 0;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.trv-context-toggle:hover {
  color: var(--color-text);
}

.trv-source-context {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--color-surface-muted);
  border-radius: 6px;
}

.trv-source-context-text {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.trv-source-highlight {
  padding: 0 2px;
  background: var(--color-brand-soft);
  color: var(--color-text);
  font-weight: 500;
}

.trv-source-missing {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.trv-external {
  margin: 10px 0 0 32px;
  padding: 10px 12px;
  background: var(--color-surface-muted);
  border-radius: 6px;
  font-size: 12px;
}

.trv-external-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.trv-external-status {
  font-weight: 600;
  color: var(--color-text);
}

.trv-external-query {
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.trv-external-summary {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.trv-external-sources {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.trv-external-sources li {
  padding: 4px 0;
  border-top: 1px solid var(--color-border);
}

.trv-external-sources a {
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.trv-external-sources a:hover {
  color: var(--color-text-secondary);
}

.trv-external-snippet {
  display: block;
  margin-top: 2px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.6;
}

.trv-external-note {
  margin: 6px 0 0;
  color: var(--color-text-tertiary);
}

.trv-no-evidence {
  margin: 8px 0 0 32px;
  color: var(--color-warning);
  font-size: 12px;
}

.trv-mentions {
  margin: 12px 0 0 32px;
  padding: 10px 12px;
  background: var(--color-surface-muted);
  border-radius: 6px;
}

.trv-mentions-title {
  margin-bottom: 6px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 500;
}

.trv-mentions-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.trv-mention {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
  border-top: 1px solid var(--color-border);
  font-size: 12px;
}

.trv-mention:first-child {
  border-top: none;
}

.trv-mention-source {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.trv-mention-quote {
  color: var(--color-text);
}

.trv-mention-note {
  color: var(--color-text-tertiary);
}

.trv-uncertain,
.trv-warnings {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}

.trv-section-title {
  margin: 0 0 8px;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
}

.trv-uncertain-list,
.trv-warnings-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.trv-uncertain-item,
.trv-warning-item {
  display: flex;
  gap: 10px;
  padding: 5px 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.trv-uncertain-claim {
  flex: 0 0 auto;
  max-width: 45%;
  color: var(--color-text);
  font-weight: 500;
}

.trv-uncertain-reason {
  color: var(--color-text-tertiary);
}

.trv-warning-item {
  color: var(--color-warning);
}

@media (max-width: 760px) {
  .trv-head {
    flex-direction: column;
    gap: 10px;
  }

  .trv-stats {
    justify-content: flex-start;
  }

  .trv-evidence-list,
  .trv-mentions,
  .trv-basis,
  .trv-note,
  .trv-external {
    margin-left: 0;
  }
}
</style>
