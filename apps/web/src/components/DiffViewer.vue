<script setup lang="ts">
import { computed } from "vue";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff as diffMatch } from "diff-match-patch-es";

const props = defineProps<{ before: string; after: string }>();

interface DiffRow {
  type: "add" | "del";
  text: string;
}

interface HighlightSegment {
  text: string;
  changed: boolean;
}

interface VisualRow {
  kind: "add" | "del" | "replace";
  text?: string;
  oldSegments?: HighlightSegment[];
  newSegments?: HighlightSegment[];
}

const MAX_LINES = 800;
const MAX_ROWS = 400;

function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function lineDiff(before: string, after: string): DiffRow[] | null {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;

  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS 长度（从后往前计算）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      rows.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j] });
    j += 1;
  }
  return rows;
}

/** 对一对“替换行”使用 diff-match-patch 做精确字符级高亮。 */
function splitCommonEdits(oldText: string, newText: string): { oldSegments: HighlightSegment[]; newSegments: HighlightSegment[] } {
  const operations = diffMatch(oldText, newText, { diffTimeout: 1 });
  const oldSegments: HighlightSegment[] = [];
  const newSegments: HighlightSegment[] = [];
  for (const [operation, text] of operations) {
    if (!text) continue;
    if (operation === DIFF_EQUAL) {
      oldSegments.push({ text, changed: false });
      newSegments.push({ text, changed: false });
    } else if (operation === DIFF_DELETE) {
      oldSegments.push({ text, changed: true });
    } else if (operation === DIFF_INSERT) {
      newSegments.push({ text, changed: true });
    }
  }
  return { oldSegments, newSegments };
}

/** 把“删/增”行配对成可做字符级高亮的 replace 行；无法配对的保留整行增删。 */
function buildVisualRows(rows: DiffRow[]): VisualRow[] {
  const visual: VisualRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const current = rows[i];
    const next = rows[i + 1];
    if (current.type === "del" && next?.type === "add") {
      const segments = splitCommonEdits(current.text, next.text);
      visual.push({ kind: "replace", oldSegments: segments.oldSegments, newSegments: segments.newSegments });
      i += 1;
    } else if (current.type === "add" && next?.type === "del") {
      const segments = splitCommonEdits(next.text, current.text);
      visual.push({ kind: "replace", oldSegments: segments.oldSegments, newSegments: segments.newSegments });
      i += 1;
    } else {
      visual.push({ kind: current.type, text: current.text });
    }
  }
  return visual;
}

const diff = computed(() => lineDiff(props.before, props.after));
const visualRows = computed(() => buildVisualRows(diff.value ?? []).slice(0, MAX_ROWS));
const truncated = computed(() => (diff.value?.length ?? 0) > MAX_ROWS);
const addedCount = computed(() => (diff.value ?? []).filter((row) => row.type === "add").length);
const removedCount = computed(() => (diff.value ?? []).filter((row) => row.type === "del").length);
const beforeChars = computed(() => countChars(props.before));
const afterChars = computed(() => countChars(props.after));
const same = computed(() => (diff.value?.length ?? 0) === 0);
</script>

<template>
  <div class="sf-diff">
    <div class="sf-diff-stats tnum">
      <span>上游 {{ beforeChars }} 字</span>
      <span>→</span>
      <span>当前 {{ afterChars }} 字</span>
      <span v-if="diff && !same" class="sf-diff-stat-change">删 {{ removedCount }} 行 · 增 {{ addedCount }} 行</span>
    </div>

    <div v-if="!diff" class="sf-diff-empty">内容过长，暂不逐行对比；可分别查看“处理结果”和“原始输入”。</div>
    <div v-else-if="same" class="sf-diff-same">与上游一致，没有内容变化</div>
    <div v-else class="sf-diff-list">
      <template v-for="(row, index) in visualRows" :key="index">
        <template v-if="row.kind === 'replace'">
          <div class="sf-diff-line is-del">
            <span class="sf-diff-mark">-</span>
            <span class="sf-diff-text">
              <template v-for="(segment, segIndex) in row.oldSegments" :key="segIndex">
                <span v-if="segment.changed" class="sf-diff-hl sf-diff-hl--del">{{ segment.text }}</span>
                <template v-else>{{ segment.text }}</template>
              </template>
            </span>
          </div>
          <div class="sf-diff-line is-add">
            <span class="sf-diff-mark">+</span>
            <span class="sf-diff-text">
              <template v-for="(segment, segIndex) in row.newSegments" :key="segIndex">
                <span v-if="segment.changed" class="sf-diff-hl sf-diff-hl--add">{{ segment.text }}</span>
                <template v-else>{{ segment.text }}</template>
              </template>
            </span>
          </div>
        </template>
        <div v-else class="sf-diff-line" :class="`is-${row.kind}`">
          <span class="sf-diff-mark">{{ row.kind === "add" ? "+" : "-" }}</span>
          <span class="sf-diff-text">{{ row.text }}</span>
        </div>
      </template>
      <div v-if="truncated" class="sf-diff-more">仅显示前 {{ visualRows.length }} 组变更，完整对比请查看完整输出。</div>
    </div>
  </div>
</template>

<style scoped>
.sf-diff {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.sf-diff-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-diff-stat-change {
  color: var(--color-text-secondary);
}

.sf-diff-same,
.sf-diff-empty {
  padding: 14px 12px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  font-size: 12px;
  text-align: center;
}

.sf-diff-list {
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

.sf-diff-line {
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.sf-diff-line.is-add {
  background: var(--color-success-soft);
}

.sf-diff-line.is-del {
  background: var(--color-error-soft);
}

.sf-diff-mark {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  user-select: none;
}

.sf-diff-line.is-add .sf-diff-mark {
  color: var(--color-success);
}

.sf-diff-line.is-del .sf-diff-mark {
  color: var(--color-error);
}

.sf-diff-text {
  min-width: 0;
  flex: 1;
  color: var(--color-text-secondary);
}

.sf-diff-line.is-add .sf-diff-text {
  color: var(--color-text);
}

.sf-diff-hl {
  border-radius: 2px;
  padding: 0 1px;
}

.sf-diff-hl--del {
  background: var(--color-error);
  color: var(--color-surface);
}

.sf-diff-hl--add {
  background: var(--color-success);
  color: var(--color-surface);
}

.sf-diff-more {
  padding: 6px 8px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  text-align: center;
}
</style>
