<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElCollapse, ElCollapseItem, ElOption, ElSelect, ElTable, ElTableColumn } from "element-plus";
import { ArrowLeftRight, Bot, Copy, RefreshCw, TriangleAlert } from "lucide-vue-next";
import {
  DIFF_MAX_LINES,
  compareAnalysisToMarkdown,
  compareTexts,
  type CompareAnalysis,
  type TextMetrics,
} from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import DiffViewer from "@/components/DiffViewer.vue";
import type { CompareOption } from "@/utils/run-compare";

const props = defineProps<{
  options: CompareOption[];
  leftKey: string;
  rightKey: string;
  /** 没配 AI 密钥时把按钮点亮成禁用并说明原因，别让用户点了才被拒。 */
  aiReady: boolean;
}>();

const emit = defineEmits<{
  "update:leftKey": [key: string];
  "update:rightKey": [key: string];
  /** 交换左右：由父组件同时改两个 key，避免两次事件之间出现「两侧同 key」的中间态。 */
  swap: [];
}>();

const left = computed(() => props.options.find((option) => option.key === props.leftKey) ?? props.options[0] ?? null);
const right = computed(() => props.options.find((option) => option.key === props.rightKey) ?? props.options[1] ?? null);
const bothSame = computed(() => Boolean(left.value && right.value && left.value.key === right.value.key));

const report = computed(() => {
  if (!left.value || !right.value) return null;
  return compareTexts(left.value.text, right.value.text);
});

// ---------- AI 差异分析 ----------
/** 判读结果按「两侧 key」记忆：切回来看过的组合不用重跑（服务端还有一层内容指纹缓存）。 */
interface AnalysisEntry {
  analysis: CompareAnalysis;
  meta: { model: string; createdAt: number; truncated: { left: boolean; right: boolean; maxChars: number } };
  cached: boolean;
}
const analyses = ref(new Map<string, AnalysisEntry>());
const analyzing = ref(false);
const analysisError = ref("");
const pairKey = computed(() => `${props.leftKey}\u0000${props.rightKey}`);
const analysis = computed(() => analyses.value.get(pairKey.value) ?? null);
/** 两侧任一变化就清掉错误提示：上一次的错误不该跟着新组合走。 */
watch(pairKey, () => {
  analysisError.value = "";
});

async function requestAnalysis(refresh: boolean) {
  if (!left.value || !right.value || analyzing.value) return;
  analyzing.value = true;
  analysisError.value = "";
  try {
    const result = await api.post<{ analysis: CompareAnalysis; meta: AnalysisEntry["meta"]; cached: boolean }>("/api/compare", {
      left: { label: left.value.label, text: left.value.text },
      right: { label: right.value.label, text: right.value.text },
      refresh,
    });
    const next = new Map(analyses.value);
    next.set(pairKey.value, { analysis: result.analysis, meta: result.meta, cached: result.cached });
    analyses.value = next;
  } catch (err) {
    analysisError.value = err instanceof Error ? err.message : "差异分析失败";
  } finally {
    analyzing.value = false;
  }
}

const analysisTruncated = computed(() => {
  const meta = analysis.value?.meta;
  if (!meta) return "";
  const sides = [meta.truncated.left ? left.value?.label : "", meta.truncated.right ? right.value?.label : ""].filter(Boolean);
  if (sides.length === 0) return "";
  return `${sides.join("、")}超过 ${meta.truncated.maxChars.toLocaleString("zh-CN")} 字，只送了头尾部分参与判读。`;
});

async function copyAnalysis() {
  const current = analysis.value;
  if (!current || !left.value || !right.value) return;
  const markdown = compareAnalysisToMarkdown(current.analysis, { left: left.value.label, right: right.value.label });
  try {
    await navigator.clipboard.writeText(markdown);
    toast.success("对照分析已复制为 Markdown");
  } catch {
    toast.error("复制失败，可手动选中文本");
  }
}

// ---------- 机械统计（指标 + 逐行差异）----------
interface MetricRow {
  key: string;
  label: string;
  left: number;
  right: number;
  delta: number;
}

/** 指标顺序按「先看体量、再看结构」排：字数/行数/段落 → 标题/列表/表格/引用/代码。 */
const METRIC_LABELS: { key: keyof TextMetrics; label: string }[] = [
  { key: "chars", label: "字数" },
  { key: "lines", label: "行数" },
  { key: "paragraphs", label: "段落" },
  { key: "headings", label: "标题" },
  { key: "listItems", label: "列表项" },
  { key: "tableRows", label: "表格行" },
  { key: "quotes", label: "引用" },
  { key: "codeBlocks", label: "代码块" },
];

const metricRows = computed<MetricRow[]>(() => {
  const current = report.value;
  if (!current) return [];
  return METRIC_LABELS.map(({ key, label }) => ({
    key,
    label,
    left: current.left[key],
    right: current.right[key],
    delta: current.right[key] - current.left[key],
  }));
});

/** 只在有意义时显示差值：两边一样就留空，避免一列 0 刷屏。 */
function fmtDelta(delta: number): string {
  if (delta === 0) return "";
  return delta > 0 ? `+${delta.toLocaleString("zh-CN")}` : delta.toLocaleString("zh-CN");
}

function deltaClass(delta: number): string {
  if (delta === 0) return "";
  return delta > 0 ? "is-more" : "is-less";
}

const tooLong = computed(() => Boolean(left.value && right.value && !report.value?.stats));
/** 折叠起来的逐行差异：标题栏上给删/增/重合率，展开才看红绿。 */
const diffSummary = computed(() => {
  const stats = report.value?.stats;
  if (!stats) return "";
  return `删 ${stats.removed} 行 · 增 ${stats.added} 行 · 重合率 ${Math.round(stats.similarity * 100)}%`;
});
</script>

<template>
  <div class="cmp">
    <div class="cmp-picks">
      <label class="cmp-pick">
        <span class="cmp-pick-label">左侧</span>
        <el-select :model-value="leftKey" size="small" class="cmp-select" @update:model-value="emit('update:leftKey', $event)">
          <el-option v-for="option in options" :key="option.key" :label="option.label" :value="option.key" />
        </el-select>
      </label>

      <button type="button" class="cmp-swap" title="交换左右" @click="emit('swap')">
        <ArrowLeftRight :size="14" />
        <span>交换</span>
      </button>

      <label class="cmp-pick">
        <span class="cmp-pick-label">右侧</span>
        <el-select :model-value="rightKey" size="small" class="cmp-select" @update:model-value="emit('update:rightKey', $event)">
          <el-option v-for="option in options" :key="option.key" :label="option.label" :value="option.key" />
        </el-select>
      </label>
    </div>

    <p v-if="bothSame" class="cmp-warn">
      <TriangleAlert :size="13" />两侧选的是同一份产物，换个右侧才能看出差异。
    </p>

    <!-- AI 差异判读：主角。行级 diff 在两套措辞不同的产物上几乎全是噪声，结论得由它来给。 -->
    <section class="cmp-panel cmp-ai">
      <div class="cmp-panel-head">
        <span class="cmp-panel-title"><Bot :size="13" />AI 差异分析</span>
        <span v-if="analysis" class="cmp-panel-hint tnum">
          {{ analysis.meta.model }} · {{ analysis.cached ? "读取缓存" : "本次生成" }}
        </span>
      </div>

      <template v-if="analysis">
        <p class="cmp-ai-summary">{{ analysis.analysis.summary }}</p>

        <div v-if="analysis.analysis.onlyLeft.length > 0 || analysis.analysis.onlyRight.length > 0" class="cmp-ai-sides">
          <div class="cmp-ai-side">
            <div class="cmp-ai-side-head">只在「{{ left?.label }}」里讲到（{{ analysis.analysis.onlyLeft.length }}）</div>
            <ul class="cmp-ai-list">
              <li v-for="(item, index) in analysis.analysis.onlyLeft" :key="index">
                {{ item.point }}
                <span v-if="item.detail" class="cmp-ai-detail">{{ item.detail }}</span>
              </li>
            </ul>
          </div>
          <div class="cmp-ai-side">
            <div class="cmp-ai-side-head">只在「{{ right?.label }}」里讲到（{{ analysis.analysis.onlyRight.length }}）</div>
            <ul class="cmp-ai-list">
              <li v-for="(item, index) in analysis.analysis.onlyRight" :key="index">
                {{ item.point }}
                <span v-if="item.detail" class="cmp-ai-detail">{{ item.detail }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="analysis.analysis.conflicts.length > 0" class="cmp-ai-block">
          <div class="cmp-ai-side-head">两边说得不一样（{{ analysis.analysis.conflicts.length }}）</div>
          <ul class="cmp-ai-list">
            <li v-for="(item, index) in analysis.analysis.conflicts" :key="index">
              <strong>{{ item.topic }}</strong>：{{ left?.label }} 说「{{ item.left }}」；{{ right?.label }} 说「{{ item.right }}」
            </li>
          </ul>
        </div>

        <div v-if="analysis.analysis.shared.length > 0" class="cmp-ai-block">
          <div class="cmp-ai-side-head">两边都讲到（{{ analysis.analysis.shared.length }}）</div>
          <ul class="cmp-ai-list cmp-ai-list--inline">
            <li v-for="(item, index) in analysis.analysis.shared" :key="index">{{ item }}</li>
          </ul>
        </div>

        <div v-if="analysis.analysis.fit.left.length > 0 || analysis.analysis.fit.right.length > 0" class="cmp-ai-sides">
          <div class="cmp-ai-side">
            <div class="cmp-ai-side-head">更适合「{{ left?.label }}」</div>
            <ul class="cmp-ai-list">
              <li v-for="(item, index) in analysis.analysis.fit.left" :key="index">{{ item }}</li>
            </ul>
          </div>
          <div class="cmp-ai-side">
            <div class="cmp-ai-side-head">更适合「{{ right?.label }}」</div>
            <ul class="cmp-ai-list">
              <li v-for="(item, index) in analysis.analysis.fit.right" :key="index">{{ item }}</li>
            </ul>
          </div>
        </div>

        <p v-if="analysis.analysis.sameNote" class="cmp-ai-note">{{ analysis.analysis.sameNote }}</p>
        <p v-if="analysisTruncated" class="cmp-ai-note">{{ analysisTruncated }}</p>

        <div class="cmp-ai-foot">
          <span class="cmp-panel-hint">AI 判读，可能不准；下面的指标与逐行差异是机械统计，可作对照。</span>
          <div class="cmp-ai-actions">
            <el-button size="small" plain :disabled="analyzing" @click="copyAnalysis">
              <Copy :size="13" /><span>复制分析</span>
            </el-button>
            <el-button size="small" plain :loading="analyzing" :disabled="!aiReady" @click="requestAnalysis(true)">
              <RefreshCw :size="13" /><span>重新分析</span>
            </el-button>
          </div>
        </div>
      </template>

      <template v-else>
        <p class="cmp-ai-empty">
          让 AI 读一遍两份内容，给出「哪边多了什么、哪边少了什么、哪里说法不一致、各自适合什么场景」——
          行级对比在两套措辞不同的产物上几乎全是噪声，结论看这一层更省事。
        </p>
        <div class="cmp-ai-foot">
          <span class="cmp-panel-hint">
            <template v-if="aiReady">会消耗一次模型调用；同一对内容重复打开直接读缓存。</template>
            <template v-else>未配置 AI 模型密钥，先到设置页填写才能分析。</template>
          </span>
          <el-button size="small" type="primary" :loading="analyzing" :disabled="!aiReady || bothSame" @click="requestAnalysis(false)">
            <Bot :size="13" /><span>{{ analyzing ? "正在分析…" : "分析差异" }}</span>
          </el-button>
        </div>
      </template>

      <p v-if="analysisError" class="cmp-warn"><TriangleAlert :size="13" />{{ analysisError }}</p>
    </section>

    <div class="cmp-panel">
      <div class="cmp-panel-head">
        <span class="cmp-panel-title">指标对比</span>
        <span class="cmp-panel-hint">机械统计（字数不含空白），不是语义相似度</span>
      </div>
      <el-table :data="metricRows" size="small" class="cmp-table" :show-header="true">
        <el-table-column prop="label" label="指标" width="80" />
        <el-table-column label="左侧" width="100">
          <template #default="{ row }"><span class="tnum">{{ row.left.toLocaleString("zh-CN") }}</span></template>
        </el-table-column>
        <el-table-column label="右侧" width="100">
          <template #default="{ row }"><span class="tnum">{{ row.right.toLocaleString("zh-CN") }}</span></template>
        </el-table-column>
        <el-table-column label="差值（右 − 左）">
          <template #default="{ row }"><span class="tnum cmp-delta" :class="deltaClass(row.delta)">{{ fmtDelta(row.delta) }}</span></template>
        </el-table-column>
      </el-table>
    </div>

    <el-collapse class="cmp-collapse">
      <el-collapse-item name="diff">
        <template #title>
          <span class="cmp-panel-title">逐行差异</span>
          <span class="cmp-panel-hint tnum">{{ diffSummary }}</span>
        </template>
        <p v-if="tooLong" class="cmp-warn">
          <TriangleAlert :size="13" />内容超过 {{ DIFF_MAX_LINES }} 行，不做逐行对比；上面的指标对比仍然有效。
        </p>
        <DiffViewer
          v-else-if="left && right"
          :before="left.text"
          :after="right.text"
          :before-label="left.label"
          :after-label="right.label"
          same-message="两侧内容逐行一致，没有差异"
        />
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.cmp {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.cmp-picks {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.cmp-pick {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 240px;
}

.cmp-pick-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.cmp-select {
  width: 100%;
}

.cmp-swap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.cmp-swap:hover {
  border-color: var(--color-text);
  color: var(--color-text);
}

.cmp-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 8px 10px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-warning);
  font-size: 12px;
}

.cmp-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.cmp-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.cmp-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.cmp-panel-hint {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

/* ---------- AI 差异分析 ---------- */
.cmp-ai {
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.cmp-ai-summary {
  margin: 0;
  padding: 9px 11px;
  border-left: 2px solid var(--color-text);
  background: var(--color-surface);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text);
}

.cmp-ai-sides {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}

.cmp-ai-side,
.cmp-ai-block {
  min-width: 0;
}

.cmp-ai-side-head {
  margin-bottom: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.cmp-ai-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.75;
  color: var(--color-text);
}

.cmp-ai-list--inline {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding-left: 18px;
}

.cmp-ai-detail {
  color: var(--color-text-tertiary);
}

.cmp-ai-note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-text-tertiary);
}

.cmp-ai-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.cmp-ai-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 2px;
}

.cmp-ai-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cmp-table {
  width: 100%;
  /* 指标表只有四列窄数据：限宽避免「差值」一列吃掉半屏空白 */
  max-width: 640px;
}

.cmp-delta.is-more {
  color: var(--color-success);
}

.cmp-delta.is-less {
  color: var(--color-error);
}

/* 折叠起来的逐行差异：标题即结论，展开才是红绿 */
.cmp-collapse {
  border-top: 1px solid var(--color-border);
  --el-collapse-header-bg-color: transparent;
  --el-collapse-header-text-color: var(--color-text);
  --el-collapse-border-color: var(--color-border);
}

.cmp-collapse :deep(.el-collapse-item__header) {
  gap: 10px;
  height: 38px;
  background: transparent;
}
</style>
