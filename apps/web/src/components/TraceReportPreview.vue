<script setup lang="ts">
import { computed } from "vue";
import type { TraceExternalStatus, TraceItem, TraceReport } from "@scribe-flow/shared";
import { TRACE_EXTERNAL_STATUS_LABELS } from "@scribe-flow/shared";
import { summarizeTraceReports, traceStatusTone } from "@/utils/trace-preview";

/**
 * 画布节点浮层里的溯源报告摘要。
 *
 * 报告正文是 JSON，直接当 Markdown 渲染只会得到一屏字段噪音（43k 字符的原始 JSON）。
 * 这里不复刻结果页的完整阅读器（那需要宽度、筛选与原文上下文），只回答浮层该回答的问题：
 * 这份报告有多少条、有几条站不住、先看哪几条。完整分组与逐条引证留给「查看完整输出」。
 */
const props = defineProps<{ reports: TraceReport[] }>();

const summary = computed(() => summarizeTraceReports(props.reports));

/** 单份报告才展示摘要；多份合并时摘要是哪一份的说不清，宁可不说。 */
const intro = computed(() => {
  if (props.reports.length !== 1) return "";
  return props.reports[0]?.summary?.trim() ?? "";
});

function statusLabel(item: TraceItem): string {
  const status = item.external?.status;
  return status ? TRACE_EXTERNAL_STATUS_LABELS[status] : "未联网核查";
}

function statusOf(item: TraceItem): TraceExternalStatus | undefined {
  return item.external?.status;
}
</script>

<template>
  <div class="trp">
    <p class="trp-overview">
      <span class="trp-overview__stat"><b class="tnum">{{ summary.total }}</b> 条主张</span>
      <span v-if="summary.flagged > 0" class="trp-overview__stat trp-overview__stat--flagged">
        <b class="tnum">{{ summary.flagged }}</b> 条需要留意
      </span>
      <span v-if="summary.checked > 0" class="trp-overview__stat"><b class="tnum">{{ summary.checked }}</b> 条经联网核查</span>
      <span v-if="summary.authoritative > 0" class="trp-overview__stat"><b class="tnum">{{ summary.authoritative }}</b> 条有权威来源</span>
    </p>

    <div v-if="summary.chips.length > 0" class="trp-chips">
      <span
        v-for="chip in summary.chips"
        :key="chip.status"
        class="trp-chip"
        :class="`trp-chip--${traceStatusTone(chip.status)}`"
      >
        {{ TRACE_EXTERNAL_STATUS_LABELS[chip.status] }} <span class="tnum">{{ chip.count }}</span>
      </span>
    </div>

    <p v-if="intro" class="trp-intro">{{ intro }}</p>
    <p v-else-if="reports.length > 1" class="trp-intro trp-intro--multi">
      共 {{ reports.length }} 份报告已合并。
    </p>

    <div v-if="summary.priorityItems.length > 0" class="trp-items">
      <div class="trp-items__head">
        <span>重点条目</span>
        <span v-if="summary.total > summary.priorityItems.length" class="tnum">还有 {{ summary.total - summary.priorityItems.length }} 条</span>
      </div>
      <article
        v-for="entry in summary.priorityItems"
        :key="`${entry.reportIndex}-${entry.index}-${entry.item.claim}`"
        class="trp-item"
      >
        <!-- 徽章内联进主张行：状态单独占一行会多吃 16px，浮层里第三条就放不下了 -->
        <p class="trp-item__line">
          <span class="trp-item__index tnum">{{ String(entry.index + 1).padStart(2, "0") }}</span>
          <span class="trp-item__status" :class="`trp-item__status--${traceStatusTone(statusOf(entry.item))}`">
            {{ statusLabel(entry.item) }}
          </span>
          {{ entry.item.claim }}
        </p>
      </article>
    </div>

    <p v-if="summary.uncertainties > 0 || summary.warnings > 0" class="trp-extras">
      <span v-if="summary.uncertainties > 0"><b class="tnum">{{ summary.uncertainties }}</b> 条待核实</span>
      <span v-if="summary.warnings > 0"><b class="tnum">{{ summary.warnings }}</b> 条提醒</span>
    </p>
  </div>
</template>

<style scoped>
.trp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(360px, calc(100vh - 210px));
  padding: 10px 14px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

/*
 * 关键一行：flex 子项默认可压缩，内容超过 max-height 时摘要会被压成 0 高
 * （DOM 在、量出来 h=0，只能用屏幕看出来）。禁止压缩后超出部分才真正进入滚动。
 */
.trp > * {
  flex-shrink: 0;
}

.trp-overview {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 12px;
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.trp-overview__stat b {
  color: var(--color-text);
  font-weight: 600;
}

/* 「需要留意」是这份报告里唯一需要当场看见的数字，给它唯一一处暖色。 */
.trp-overview__stat--flagged {
  color: var(--color-warning);
  font-weight: 600;
}

.trp-overview__stat--flagged b {
  color: var(--color-warning);
}

.trp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.trp-chip {
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  font-size: 10.5px;
  line-height: 17px;
  white-space: nowrap;
}

.trp-chip--danger {
  color: var(--color-error);
  background: var(--color-error-soft);
  border-color: var(--color-error-border);
}

.trp-chip--warning {
  color: var(--color-warning);
  background: var(--color-warning-soft);
  border-color: var(--color-warning-border);
}

.trp-chip--info {
  color: var(--color-info);
  background: var(--color-info-soft);
  border-color: var(--color-info-border);
}

.trp-chip--success {
  color: var(--color-success);
  background: var(--color-success-soft);
  border-color: var(--color-success-border);
}

.trp-chip--muted {
  color: var(--color-text-tertiary);
  background: var(--color-ink-soft);
  border-color: var(--color-border);
}

.trp-intro {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--color-text-tertiary);
  font-size: 11.5px;
}

.trp-intro--multi {
  -webkit-line-clamp: 1;
}

.trp-items {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.trp-items__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.trp-item {
  padding: 5px 8px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

.trp-item__line {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.5;
}

.trp-item__index {
  margin-right: 4px;
  color: var(--color-text-tertiary);
  font-size: 10.5px;
  font-weight: 600;
}

.trp-item__status {
  display: inline-block;
  margin-right: 5px;
  padding: 0 5px;
  border-radius: var(--radius-xs);
  font-size: 10.5px;
  line-height: 16px;
  vertical-align: 1px;
  white-space: nowrap;
}

.trp-item__status--danger {
  color: var(--color-error);
  background: var(--color-error-soft);
}

.trp-item__status--warning {
  color: var(--color-warning);
  background: var(--color-warning-soft);
}

.trp-item__status--info {
  color: var(--color-info);
  background: var(--color-info-soft);
}

.trp-item__status--success {
  color: var(--color-success);
  background: var(--color-success-soft);
}

.trp-item__status--muted {
  color: var(--color-text-tertiary);
  background: var(--color-ink-soft);
}

.trp-extras {
  display: flex;
  gap: 12px;
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.trp-extras b {
  color: var(--color-text-secondary);
  font-weight: 600;
}
</style>
