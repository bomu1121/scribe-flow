<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElButton, ElInput } from "element-plus";
import { Check, ChevronDown, Download, RotateCcw } from "lucide-vue-next";
import {
  DRILL_KIND_LABELS,
  drillSetToMarkdown,
  gradeObjective,
  type DrillItem,
  type DrillPoint,
  type DrillSet,
} from "@scribe-flow/shared";
import { parseDrillSets } from "@/utils/drill";
import { toast } from "@/lib/toast";

/**
 * 知识巩固结果视图：把 process.drill 产物的 JSON 变成一题一屏的答题界面。
 *
 * 关键取舍：
 * - 判分全部本地做（单选/多选/判断/填空），零网络请求、零延迟、可离线重做；
 * - 开放题不做 AI 判分，避免「判得松/判得严」的不适感；
 * - 原文依据默认折叠：先自己回想，点开才看依据（合意难度）；
 * - 只用「已经能自己答出来 / 建议回看」两组表达结果，不给百分比、不做排行。
 */
const props = defineProps<{
  /** 节点产物原始文本；多输入时引擎用 "\n\n---\n\n" 连接多份产物。 */
  text: string;
  /** 节点展示名，用于导出文件名。 */
  nodeLabel?: string;
}>();

/** 解析产物：生成期已完成引文校验与逐条丢弃，这里只做结构解析（详见 utils/drill.ts）。 */
const sets = computed<DrillSet[]>(() => parseDrillSets(props.text));

const activeSetIndex = ref(0);
const activeSet = computed<DrillSet | null>(() => sets.value[activeSetIndex.value] ?? null);

const queue = ref<string[]>([]);
const cursor = ref(0);
const answers = ref<Record<string, string[]>>({});
const grades = ref<Record<string, { correct: boolean; note?: string }>>({});
const draft = ref<string[]>([]);
const clozeDraft = ref("");
const sourceOpen = ref<Record<string, boolean>>({});
const editingWrong = ref(false);

/** 当前题。 */
const currentItem = computed<DrillItem | null>(() => {
  const set = activeSet.value;
  if (!set) return null;
  const id = queue.value[cursor.value];
  return set.items.find((item) => item.id === id) ?? null;
});

const currentPoint = computed<DrillPoint | null>(() => {
  const set = activeSet.value;
  const item = currentItem.value;
  if (!set || !item) return null;
  return set.points.find((point) => point.id === item.pointId) ?? null;
});

const currentGrade = computed(() => (currentItem.value ? grades.value[currentItem.value.id] : undefined));
const isGraded = computed(() => Boolean(currentGrade.value));

const total = computed(() => queue.value.length);
const position = computed(() => Math.min(cursor.value + 1, Math.max(total.value, 1)));
const finished = computed(() => total.value > 0 && cursor.value >= total.value);

const optionLetters = "ABCDEFGH";
const isMultiple = computed(() => currentItem.value?.kind === "multi");
const isCloze = computed(() => currentItem.value?.kind === "cloze");

const allItems = computed(() => activeSet.value?.items ?? []);
const answeredCount = computed(() => allItems.value.filter((item) => grades.value[item.id]).length);

interface PointStatus {
  point: DrillPoint;
  items: DrillItem[];
  ok: boolean;
  answered: number;
}

const pointStatus = computed<PointStatus[]>(() => {
  const set = activeSet.value;
  if (!set) return [];
  return set.points
    .map((point) => {
      const items = set.items.filter((item) => item.pointId === point.id);
      const answered = items.filter((item) => grades.value[item.id]).length;
      const ok = items.length > 0 && answered === items.length && items.every((item) => grades.value[item.id]?.correct);
      return { point, items, ok, answered };
    })
    .filter((entry) => entry.items.length > 0);
});

const masteredPoints = computed(() => pointStatus.value.filter((entry) => entry.ok));
const reviewPoints = computed(() => pointStatus.value.filter((entry) => !entry.ok));
const wrongItems = computed(() => allItems.value.filter((item) => grades.value[item.id] && !grades.value[item.id].correct));

function resetRun(ids: string[]) {
  queue.value = [...ids];
  cursor.value = 0;
  draft.value = [];
  clozeDraft.value = "";
  editingWrong.value = false;
  syncDraftFromAnswer();
}

function syncDraftFromAnswer() {
  const item = currentItem.value;
  if (!item) {
    draft.value = [];
    clozeDraft.value = "";
    return;
  }
  const submitted = answers.value[item.id] ?? [];
  draft.value = [...submitted];
  clozeDraft.value = submitted[0] ?? "";
}

watch(
  () => [activeSetIndex.value, cursor.value],
  () => {
    syncDraftFromAnswer();
  },
);

watch(
  () => props.text,
  () => {
    activeSetIndex.value = 0;
    restartAll();
  },
);

/** 首次挂载与产物变化时重置队列。 */
function restartAll() {
  const set = activeSet.value;
  resetRun(set ? set.items.map((item) => item.id) : []);
}

restartAll();

function selectSet(index: number) {
  activeSetIndex.value = index;
  restartAll();
}

function pickOption(option: string) {
  const item = currentItem.value;
  if (!item || (isGraded.value && !editingWrong.value)) return;
  if (item.kind === "multi" || item.kind === "judge") {
    const exists = draft.value.includes(option);
    draft.value = exists ? draft.value.filter((value) => value !== option) : [...draft.value, option];
    return;
  }
  if (item.kind === "single") {
    draft.value = [option];
    void submitAnswer();
  }
}

function submitAnswer() {
  const item = currentItem.value;
  if (!item || isGraded.value) return;
  const picked = item.kind === "cloze" ? (clozeDraft.value.trim() ? [clozeDraft.value.trim()] : []) : draft.value;
  if (picked.length === 0) {
    toast.info(isCloze.value ? "先写下你的答案" : "先选一个答案");
    return;
  }
  const result = gradeObjective(item, picked);
  answers.value = { ...answers.value, [item.id]: picked };
  grades.value = { ...grades.value, [item.id]: result };
}

function goNext() {
  if (cursor.value < total.value) cursor.value += 1;
}

function goPrev() {
  if (cursor.value > 0) cursor.value -= 1;
}

function toggleSource(itemId: string) {
  sourceOpen.value = { ...sourceOpen.value, [itemId]: !sourceOpen.value[itemId] };
}

function restartWrong() {
  const ids = wrongItems.value.map((item) => item.id);
  if (ids.length === 0) {
    toast.info("没有答错的题目");
    return;
  }
  const nextGrades = { ...grades.value };
  const nextAnswers = { ...answers.value };
  for (const id of ids) {
    delete nextGrades[id];
    delete nextAnswers[id];
  }
  grades.value = nextGrades;
  answers.value = nextAnswers;
  resetRun(ids);
}

function restartFromScratch() {
  answers.value = {};
  grades.value = {};
  sourceOpen.value = {};
  restartAll();
}

function markEditing() {
  // 答错后允许改一次答案（右侧「改答案」入口），改完重新判分。
  editingWrong.value = true;
  const item = currentItem.value;
  if (item) {
    const nextGrades = { ...grades.value };
    delete nextGrades[item.id];
    grades.value = nextGrades;
  }
}

function jumpToItem(id: string) {
  const index = queue.value.indexOf(id);
  if (index >= 0) cursor.value = index;
}

function exportMarkdown() {
  const set = activeSet.value;
  if (!set) return;
  const markdown = drillSetToMarkdown(set);
  const blob = new Blob([markdown], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.nodeLabel?.trim() || "知识巩固"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- 键盘操作：数字选选项、回车提交/下一题 ----------
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName) && !isCloze.value) return;
  if (finished.value) return;
  const item = currentItem.value;
  if (!item) return;
  if (event.key === "Enter") {
    event.preventDefault();
    if (isGraded.value) goNext();
    else submitAnswer();
    return;
  }
  if (item.kind === "cloze") return;
  const index = Number(event.key) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= item.options.length) return;
  event.preventDefault();
  pickOption(item.options[index]);
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const hasProduct = computed(() => sets.value.length > 0);
</script>

<template>
  <div class="rv-drill">
    <div v-if="!hasProduct" class="rv-empty">
      <div class="rv-empty-title">没有可作答的练习</div>
      <div class="rv-empty-sub">运行「知识巩固」节点后，题目会显示在这里。</div>
    </div>

    <template v-else>
      <div v-if="sets.length > 1" class="rv-drill-tabs">
        <button
          v-for="(item, index) in sets"
          :key="index"
          type="button"
          :class="{ active: index === activeSetIndex }"
          @click="selectSet(index)"
        >
          {{ item.title?.trim() || `练习 ${index + 1}` }}
        </button>
      </div>

      <div class="rv-drill-head">
        <div class="rv-drill-title">
          <h3>{{ activeSet?.title?.trim() || "知识巩固" }}</h3>
          <p class="rv-drill-meta">
            {{ (activeSet?.points.length ?? 0) }} 个考察点 · {{ allItems.length }} 题 · 已答 {{ answeredCount }} 题 ·
            {{ (activeSet?.extensions.length ?? 0) }} 条延伸
          </p>
        </div>
        <div class="rv-drill-actions">
          <el-button size="small" :icon="Download" @click="exportMarkdown">导出 Markdown</el-button>
          <el-button size="small" :icon="RotateCcw" @click="restartFromScratch">重新开始</el-button>
        </div>
      </div>

      <!-- 答题区 -->
      <div v-if="!finished && currentItem" class="rv-drill-card">
        <div class="rv-drill-card-head">
          <span class="rv-drill-step">第 {{ position }} / {{ total }} 题</span>
          <span class="rv-drill-kind">{{ DRILL_KIND_LABELS[currentItem.kind] }}{{ currentItem.kind === "multi" ? "（可多选）" : "" }}</span>
          <span v-if="currentPoint" class="rv-drill-point">考察点：{{ currentPoint.name }}</span>
        </div>

        <p class="rv-drill-stem">{{ currentItem.stem }}</p>

        <div v-if="isCloze" class="rv-drill-cloze" role="group" aria-label="填空题作答">
          <el-input
            v-model="clozeDraft"
            :disabled="isGraded"
            placeholder="填写答案后回车提交"
            size="default"
            @keyup.enter="submitAnswer"
          />
        </div>
        <div
          v-else
          class="rv-drill-options"
          :role="isMultiple ? 'group' : 'radiogroup'"
          :aria-label="isMultiple ? '多选题选项' : '单选题选项'"
        >
          <button
            v-for="(option, index) in currentItem.options"
            :key="option"
            type="button"
            class="rv-drill-option"
            :class="{
              picked: draft.includes(option),
              locked: isGraded,
              correct: isGraded && currentItem.answer.includes(option),
              wrong: isGraded && draft.includes(option) && !currentItem.answer.includes(option),
            }"
            :aria-checked="draft.includes(option)"
            :role="isMultiple ? 'checkbox' : 'radio'"
            :disabled="isGraded"
            @click="pickOption(option)"
          >
            <span class="rv-drill-letter">{{ optionLetters[index] }}</span>
            <span class="rv-drill-option-text">{{ option }}</span>
          </button>
        </div>

        <div class="rv-drill-buttons">
          <el-button size="small" :disabled="cursor === 0" @click="goPrev">上一题</el-button>
          <el-button v-if="!isGraded" type="primary" size="small" @click="submitAnswer">提交答案</el-button>
          <el-button v-else size="small" @click="goNext">下一题</el-button>
        </div>

        <!-- 反馈区：对错 → 解析 → 原文依据（默认折叠） -->
        <div v-if="isGraded" class="rv-drill-feedback" aria-live="polite">
          <div class="rv-drill-verdict" :class="currentGrade?.correct ? 'ok' : 'no'">
            {{ currentGrade?.correct ? "回答正确" : "这个点还没答上来" }}
          </div>
          <p v-if="currentGrade?.note" class="rv-drill-note">{{ currentGrade.note }}</p>
          <p v-if="currentItem.explanation" class="rv-drill-explain">{{ currentItem.explanation }}</p>
          <div v-if="currentItem.sourceQuote" class="rv-drill-source">
            <button type="button" class="rv-drill-source-toggle" @click="toggleSource(currentItem.id)">
              <ChevronDown :size="14" :class="{ open: sourceOpen[currentItem.id] }" />
              <span>原文依据</span>
            </button>
            <blockquote v-if="sourceOpen[currentItem.id]">{{ currentItem.sourceQuote }}</blockquote>
          </div>
          <div class="rv-drill-feedback-actions">
            <button v-if="!currentGrade?.correct" type="button" class="rv-drill-link" @click="markEditing">改答案</button>
            <button type="button" class="rv-drill-link" @click="goNext">下一题</button>
          </div>
        </div>
      </div>

      <!-- 结果区 -->
      <div v-else class="rv-drill-result">
        <div class="rv-drill-summary">
          <div class="rv-drill-summary-col">
            <h4><Check :size="14" /> 已经能自己答出来的点（{{ masteredPoints.length }}）</h4>
            <ul v-if="masteredPoints.length > 0">
              <li v-for="entry in masteredPoints" :key="entry.point.id">
                <span>{{ entry.point.name }}</span>
                <button type="button" class="rv-drill-link" @click="jumpToItem(entry.items[0].id)">回看题目</button>
              </li>
            </ul>
            <p v-else class="rv-drill-empty-line">还没有全部答对的考察点。</p>
          </div>
          <div class="rv-drill-summary-col">
            <h4>建议回看的点（{{ reviewPoints.length }}）</h4>
            <ul v-if="reviewPoints.length > 0">
              <li v-for="entry in reviewPoints" :key="entry.point.id">
                <span>{{ entry.point.name }}</span>
                <span class="rv-drill-hint">{{ entry.point.gist }}</span>
                <button type="button" class="rv-drill-link" @click="jumpToItem(entry.items[0].id)">回到题目</button>
              </li>
            </ul>
            <p v-else class="rv-drill-empty-line">所有考察点都能自己答出来了。</p>
          </div>
        </div>

        <div class="rv-drill-result-actions">
          <el-button size="small" :disabled="wrongItems.length === 0" @click="restartWrong">
            只重做错题（{{ wrongItems.length }}）
          </el-button>
          <el-button size="small" @click="restartFromScratch">全部重来</el-button>
          <el-button size="small" :icon="Download" @click="exportMarkdown">导出 Markdown</el-button>
        </div>

        <div v-if="activeSet && activeSet.extensions.length > 0" class="rv-drill-extensions">
          <h4>再想一步</h4>
          <p class="rv-drill-extensions-note">这些问题没有标准答案，留给下次接着想。</p>
          <ol>
            <li v-for="(extension, index) in activeSet.extensions" :key="index">
              <p class="rv-drill-extension-question">{{ extension.question }}</p>
              <p v-if="extension.hint" class="rv-drill-extension-meta">提示：{{ extension.hint }}</p>
              <p v-if="extension.angle" class="rv-drill-extension-meta">方向：{{ extension.angle }}</p>
            </li>
          </ol>
        </div>
      </div>

      <!-- 进度点阵 -->
      <div v-if="allItems.length > 0" class="rv-drill-dots" aria-hidden="true">
        <button
          v-for="(item, index) in allItems"
          :key="item.id"
          type="button"
          class="rv-drill-dot"
          :class="{
            done: Boolean(grades[item.id]),
            ok: grades[item.id]?.correct === true,
            no: grades[item.id]?.correct === false,
            current: !finished && item.id === currentItem?.id,
          }"
          :title="`第 ${index + 1} 题`"
          @click="jumpToItem(item.id)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.rv-drill {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 16px 20px 20px;
  overflow: auto;
}

.rv-drill-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rv-drill-tabs button {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border-radius: var(--control-radius-sm);
  padding: 4px 10px;
  font-size: var(--control-font-size-sm);
  cursor: pointer;
}

.rv-drill-tabs button.active {
  border-color: var(--color-brand-border);
  background: var(--color-brand-soft);
  color: var(--color-brand-pressed);
}

.rv-drill-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.rv-drill-title h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-drill-meta {
  margin: 4px 0 0;
  font-size: var(--control-font-size-sm);
  color: var(--color-text-tertiary);
}

.rv-drill-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.rv-drill-card {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rv-drill-card-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: var(--control-font-size-sm);
  color: var(--color-text-tertiary);
}

.rv-drill-step {
  font-weight: 600;
  color: var(--color-text-secondary);
}

.rv-drill-kind {
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0 6px;
}

.rv-drill-stem {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text);
}

.rv-drill-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rv-drill-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--color-border);
  border-radius: var(--control-radius);
  background: var(--color-surface);
  padding: 9px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}

.rv-drill-option:hover:not(:disabled) {
  border-color: var(--control-border-hover);
}

.rv-drill-option.picked {
  border-color: var(--color-brand-border);
  background: var(--color-brand-soft);
}

.rv-drill-option.correct {
  border-color: var(--color-success-border);
  background: var(--color-success-soft);
}

.rv-drill-option.wrong {
  border-color: var(--color-error-border);
  background: var(--color-error-soft);
}

.rv-drill-option.locked {
  cursor: default;
}

.rv-drill-letter {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.rv-drill-option-text {
  line-height: 1.6;
}

.rv-drill-buttons {
  display: flex;
  gap: 8px;
}

.rv-drill-feedback {
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rv-drill-verdict {
  font-size: 13px;
  font-weight: 600;
}

.rv-drill-verdict.ok {
  color: var(--color-success);
}

.rv-drill-verdict.no {
  color: var(--color-error);
}

.rv-drill-note,
.rv-drill-explain {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.rv-drill-source-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  padding: 0;
  font-size: var(--control-font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.rv-drill-source-toggle svg {
  transition: transform 0.15s ease;
}

.rv-drill-source-toggle svg.open {
  transform: rotate(180deg);
}

.rv-drill-source blockquote {
  margin: 8px 0 0;
  padding: 8px 12px;
  border-left: 2px solid var(--color-brand-border);
  background: var(--color-surface-muted);
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.rv-drill-feedback-actions {
  display: flex;
  gap: 14px;
}

.rv-drill-link {
  border: none;
  background: none;
  padding: 0;
  font-size: var(--control-font-size-sm);
  color: var(--color-brand-pressed);
  cursor: pointer;
}

.rv-drill-result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rv-drill-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.rv-drill-summary-col {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  padding: 14px 16px;
}

.rv-drill-summary-col h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-drill-summary-col ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rv-drill-summary-col li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--color-text);
}

.rv-drill-hint {
  font-size: var(--control-font-size-sm);
  color: var(--color-text-tertiary);
}

.rv-drill-empty-line {
  margin: 0;
  font-size: var(--control-font-size-sm);
  color: var(--color-text-tertiary);
}

.rv-drill-result-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.rv-drill-extensions {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  padding: 14px 16px;
}

.rv-drill-extensions h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.rv-drill-extensions-note {
  margin: 4px 0 10px;
  font-size: var(--control-font-size-sm);
  color: var(--color-text-tertiary);
}

.rv-drill-extensions ol {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rv-drill-extension-question {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text);
}

.rv-drill-extension-meta {
  margin: 2px 0 0;
  font-size: var(--control-font-size-sm);
  color: var(--color-text-tertiary);
}

.rv-drill-dots {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-top: 4px;
}

.rv-drill-dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  cursor: pointer;
}

.rv-drill-dot.ok {
  border-color: var(--color-success);
  background: var(--color-success);
}

.rv-drill-dot.no {
  border-color: var(--color-error);
  background: var(--color-error);
}

.rv-drill-dot.current {
  outline: 2px solid var(--color-brand-border);
  outline-offset: 1px;
}
</style>
