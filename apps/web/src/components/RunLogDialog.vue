<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElInput, ElOption, ElSelect } from "element-plus";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ListCollapse,
  ListTree,
  ScrollText,
  Search,
  WrapText,
  X,
} from "lucide-vue-next";
import { toast } from "@/lib/toast";
import { api } from "@/lib/api";
import type { RunNodeLog, RunNodeLogKind, RunNodeResult } from "@scribe-flow/shared";

const props = defineProps<{
  open: boolean;
  runId: string;
  nodes?: RunNodeResult[];
  initialNodeId?: string;
}>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const logs = ref<RunNodeLog[]>([]);
const loading = ref(false);
const loadError = ref("");
const nodeId = ref("");
const step = ref("");
const kind = ref<RunNodeLogKind | "all">("all");
const keyword = ref("");
const expandedIds = ref<Set<string>>(new Set());
const collapsedIds = ref<Set<string>>(new Set());
const wrap = ref(true);

const kindLabels: Record<RunNodeLogKind, string> = {
  input: "输入文稿",
  "ai-request": "AI 请求",
  "ai-response": "AI 响应",
  info: "信息",
  error: "错误",
};

const kindOptions: Array<{ value: RunNodeLogKind | "all"; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "error", label: "错误" },
  { value: "info", label: "信息" },
  { value: "input", label: "输入文稿" },
  { value: "ai-request", label: "AI 请求" },
  { value: "ai-response", label: "AI 响应" },
];

const stepDisplayMap = computed(() => {
  const map = new Map<string, string>();
  for (const log of logs.value) {
    if (!log.step) continue;
    const line = log.content.split("\n", 1)[0] ?? "";
    const match = /^\[([A-Za-z0-9_]+)\]\s*([^\n]{1,28})/.exec(line);
    if (match && match[1] === log.step) {
      const key = `${log.nodeId}\u0000${log.step}`;
      if (!map.has(key)) map.set(key, `${match[1]} · ${match[2]}`);
    }
  }
  return map;
});

function stepLabel(log: RunNodeLog): string {
  return stepDisplayMap.value.get(`${log.nodeId}\u0000${log.step ?? ""}`) || log.step || "";
}

function isLongContent(content: string): boolean {
  return content.length > 600 || content.split("\n").length > 14;
}

const longLogIds = computed(() => new Set(logs.value.filter((log) => isLongContent(log.content)).map((log) => log.id)));

const nodeOptions = computed(() => {
  const map = new Map<string, string>();
  for (const node of props.nodes ?? []) {
    if (!map.has(node.nodeId)) map.set(node.nodeId, node.nodeLabel || node.nodeType || node.nodeId);
  }
  for (const log of logs.value) {
    if (!map.has(log.nodeId)) map.set(log.nodeId, log.nodeLabel || log.nodeId);
  }
  return Array.from(map, ([value, label]) => ({ value, label }));
});

const stepOptions = computed(() => {
  const scoped = nodeId.value ? logs.value.filter((log) => log.nodeId === nodeId.value) : logs.value;
  const map = new Map<string, string>();
  for (const log of scoped) {
    if (!log.step || map.has(log.step)) continue;
    const label = stepLabel(log);
    if (label) map.set(log.step, label);
  }
  return Array.from(map, ([value, label]) => ({ value, label }));
});

const filteredLogs = computed(() => {
  let list = logs.value;
  if (nodeId.value) list = list.filter((log) => log.nodeId === nodeId.value);
  if (step.value) list = list.filter((log) => log.step === step.value);
  if (kind.value !== "all") list = list.filter((log) => log.kind === kind.value);
  const q = keyword.value.trim().toLowerCase();
  if (q) {
    list = list.filter((log) =>
      `${log.nodeLabel ?? ""} ${log.nodeId} ${log.step ?? ""} ${log.content}`.toLowerCase().includes(q),
    );
  }
  return list;
});

const summary = computed(() => ({
  total: logs.value.length,
  filtered: filteredLogs.value.length,
  errors: logs.value.filter((log) => log.kind === "error").length,
}));

function isCollapsed(log: RunNodeLog): boolean {
  if (expandedIds.value.has(log.id)) return false;
  if (collapsedIds.value.has(log.id)) return true;
  return isLongContent(log.content);
}

function toggleLog(log: RunNodeLog) {
  if (isCollapsed(log)) {
    collapsedIds.value.delete(log.id);
    expandedIds.value.add(log.id);
  } else {
    expandedIds.value.delete(log.id);
    collapsedIds.value.add(log.id);
  }
}

function expandAll() {
  collapsedIds.value.clear();
  for (const id of longLogIds.value) expandedIds.value.add(id);
}

function collapseAll() {
  expandedIds.value.clear();
  for (const id of longLogIds.value) collapsedIds.value.add(id);
}

function logTitle(log: RunNodeLog): string {
  const parts = [log.nodeLabel || log.nodeId];
  if (log.step) {
    const label = stepLabel(log);
    parts.push(label || log.step);
  }
  return parts.filter(Boolean).join(" · ");
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatLog(log: RunNodeLog): string {
  return `[${formatTime(log.createdAt)}] [${kindLabels[log.kind]}] ${logTitle(log)}\n${log.content}`;
}

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}

function copyLog(log: RunNodeLog) {
  void copyText(log.content, "已复制该条日志");
}

function copyFiltered() {
  const text = filteredLogs.value.map(formatLog).join("\n\n");
  if (!text) return;
  void copyText(text, `已复制 ${filteredLogs.value.length} 条日志`);
}

function downloadLogs() {
  const text = filteredLogs.value.map(formatLog).join("\n\n");
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `run-${props.runId.slice(-6)}-logs.log`;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchLogs() {
  if (!props.runId) return;
  loading.value = true;
  loadError.value = "";
  try {
    const data = await api.get<{ items: RunNodeLog[] }>(`/api/runs/${props.runId}/logs`);
    logs.value = data.items ?? [];
    expandedIds.value = new Set();
    collapsedIds.value = new Set();
  } catch (err) {
    logs.value = [];
    loadError.value = err instanceof Error ? err.message : "日志加载失败";
  } finally {
    loading.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.open) emit("update:open", false);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      nodeId.value = props.initialNodeId ?? "";
      step.value = "";
      kind.value = "all";
      keyword.value = "";
      void fetchLogs();
    }
    if (open) {
      document.body.classList.add("rl-lock");
      window.addEventListener("keydown", onKeydown);
    } else {
      document.body.classList.remove("rl-lock");
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

watch(
  () => props.initialNodeId,
  (value) => {
    if (props.open) {
      nodeId.value = value ?? "";
      step.value = "";
    }
  },
);

watch(nodeId, () => {
  step.value = "";
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  document.body.classList.remove("rl-lock");
});
</script>

<template>
  <Teleport to="body">
    <Transition name="rl-fade">
      <div v-if="open" class="rl-overlay" @click.self="emit('update:open', false)">
        <section class="rl-panel" role="dialog" aria-modal="true" aria-label="运行日志">
          <header class="rl-header">
            <div class="rl-heading">
              <span class="rl-heading-icon"><ScrollText :size="16" /></span>
              <div class="rl-heading-text">
                <h2 class="rl-title">
                  运行日志 <span class="tnum">#{{ runId.slice(-6) }}</span>
                </h2>
                <p class="rl-sub">
                  {{ summary.total }} 条记录<template v-if="summary.filtered !== summary.total">
                    · 筛选后 {{ summary.filtered }} 条
                  </template>
                  <template v-if="summary.errors > 0"> · <span class="rl-error-text">{{ summary.errors }} 条错误</span></template>
                </p>
              </div>
            </div>
            <button type="button" class="rl-close" aria-label="关闭日志" @click="emit('update:open', false)">
              <X :size="16" />
            </button>
          </header>

          <div class="rl-toolbar">
            <div class="rl-toolbar-filters">
              <el-input v-model="keyword" class="rl-search" size="small" placeholder="搜索日志内容…" clearable>
                <template #prefix><Search :size="14" /></template>
              </el-input>
              <el-select v-model="nodeId" class="rl-select" size="small" placeholder="全部节点" clearable>
                <el-option v-for="opt in nodeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <el-select v-model="step" class="rl-select rl-select--step" size="small" placeholder="全部步骤" clearable :disabled="stepOptions.length === 0">
                <el-option v-for="opt in stepOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <el-select v-model="kind" class="rl-select rl-select--kind" size="small">
                <el-option v-for="opt in kindOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </div>
            <div class="rl-toolbar-actions">
              <button type="button" class="rl-action" :class="{ active: !wrap }" :title="wrap ? '关闭自动换行' : '开启自动换行'" @click="wrap = !wrap">
                <WrapText :size="14" /><span>换行</span>
              </button>
              <button type="button" class="rl-action" title="展开全部长日志" @click="expandAll">
                <ListTree :size="14" /><span>展开全部</span>
              </button>
              <button type="button" class="rl-action" title="收起全部长日志" @click="collapseAll">
                <ListCollapse :size="14" /><span>收起全部</span>
              </button>
              <span class="rl-toolbar-divider" />
              <button type="button" class="rl-action" :disabled="filteredLogs.length === 0" @click="copyFiltered">
                <Copy :size="14" /><span>复制日志</span>
              </button>
              <button type="button" class="rl-action" :disabled="filteredLogs.length === 0" @click="downloadLogs">
                <Download :size="14" /><span>下载</span>
              </button>
            </div>
          </div>

          <div class="rl-body">
            <div v-if="loading" class="rl-state">日志加载中…</div>
            <div v-else-if="loadError" class="rl-state rl-state--error">{{ loadError }}</div>
            <div v-else-if="filteredLogs.length === 0" class="rl-state">没有匹配的日志</div>
            <div v-else class="rl-console" :class="{ 'is-wrap': wrap }">
              <article
                v-for="(log, index) in filteredLogs"
                :key="log.id"
                class="rl-log-item"
                :class="[`is-${log.kind}`, { 'is-collapsed': isCollapsed(log) }]"
              >
                <div class="rl-log-gutter tnum">{{ index + 1 }}</div>
                <div class="rl-log-main">
                  <header class="rl-log-head">
                    <span class="rl-kind" :class="`is-${log.kind}`">{{ kindLabels[log.kind] }}</span>
                    <span class="rl-log-title" :title="logTitle(log)">{{ logTitle(log) }}</span>
                    <span class="rl-log-time tnum">{{ formatTime(log.createdAt) }}</span>
                    <button
                      v-if="isLongContent(log.content)"
                      type="button"
                      class="rl-log-action"
                      :title="isCollapsed(log) ? '展开该条日志' : '收起该条日志'"
                      @click="toggleLog(log)"
                    >
                      <ChevronRight v-if="isCollapsed(log)" :size="13" />
                      <ChevronDown v-else :size="13" />
                    </button>
                    <button type="button" class="rl-log-action" title="复制该条日志" @click="copyLog(log)">
                      <Copy :size="13" />
                    </button>
                  </header>
                  <pre v-if="!isCollapsed(log)" class="rl-log-content">{{ log.content }}</pre>
                  <button v-else-if="isLongContent(log.content)" type="button" class="rl-log-expand" @click="toggleLog(log)">
                    展开全文（{{ log.content.length }} 字）
                  </button>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* 运行日志查看器：独立 Teleport 浮层，样式跟随平台纸面工作台而非 EP Dialog 默认骨架。 */
.rl-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--el-overlay-color-lighter);
}

.rl-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1120px, calc(100vw - 48px));
  height: min(760px, calc(100vh - 64px));
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.rl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.rl-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.rl-heading-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-ink-soft);
  color: var(--color-text);
  flex-shrink: 0;
}

.rl-heading-text {
  min-width: 0;
}

.rl-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-text);
}

.rl-sub {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rl-error-text {
  color: var(--color-error);
  font-weight: 500;
}

.rl-close {
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

.rl-close:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.rl-toolbar-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.rl-search {
  width: 200px;
}

.rl-select {
  width: 140px;
}

.rl-select--step {
  width: 180px;
}

.rl-select--kind {
  width: 110px;
}

.rl-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-wrap: wrap;
}

.rl-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.rl-action:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rl-action.active {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rl-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rl-toolbar-divider {
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--color-border);
}

.rl-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--color-canvas);
}

.rl-console {
  height: 100%;
  padding: 14px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rl-state {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.rl-state--error {
  color: var(--color-error);
}

.rl-log-item {
  display: flex;
  flex-shrink: 0;
  border: 1px solid var(--color-border-strong);
  border-left: 3px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

.rl-log-item:hover {
  border-color: var(--color-text-tertiary);
}

.rl-log-item.is-error {
  border-color: var(--color-error-border);
  border-left-color: var(--color-error);
}

.rl-log-item.is-ai-request {
  border-color: var(--color-info-border);
  border-left-color: var(--color-info);
}

.rl-log-item.is-ai-response {
  border-color: var(--color-success-border);
  border-left-color: var(--color-success);
}

.rl-log-item.is-input {
  border-left-color: var(--color-accent-indigo);
}

.rl-log-gutter {
  flex-shrink: 0;
  width: 44px;
  padding: 10px 12px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  color: var(--color-text-tertiary);
  font-size: 11px;
  text-align: right;
  user-select: none;
}

.rl-log-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.rl-log-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}

.rl-kind {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
}

.rl-kind.is-error {
  background: var(--color-error-soft);
  color: var(--color-error);
}

.rl-kind.is-info {
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
}

.rl-kind.is-input {
  background: var(--color-accent-indigo-soft);
  color: var(--color-accent-indigo);
}

.rl-kind.is-ai-request {
  background: var(--color-info-soft);
  color: var(--color-info);
}

.rl-kind.is-ai-response {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.rl-log-title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
}

.rl-log-time {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.rl-log-action {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.rl-log-action:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.rl-log-content {
  margin: 0;
  padding: 12px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-surface);
  white-space: pre;
  overflow-x: auto;
}

.rl-console.is-wrap .rl-log-content {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: hidden;
}

.rl-log-expand {
  display: block;
  width: 100%;
  padding: 8px 14px;
  border: none;
  border-top: 1px dashed var(--color-border);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.rl-log-expand:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

body.rl-lock {
  overflow: hidden;
}

.rl-fade-enter-active,
.rl-fade-leave-active {
  transition: opacity var(--dur-2) var(--ease-out);
}

.rl-fade-enter-from,
.rl-fade-leave-to {
  opacity: 0;
}

@media (max-width: 960px) {
  .rl-overlay {
    padding: 12px;
  }

  .rl-panel {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .rl-toolbar {
    align-items: stretch;
  }

  .rl-toolbar-filters {
    width: 100%;
  }

  .rl-search {
    flex: 1;
    min-width: 180px;
  }

  .rl-toolbar-actions {
    margin-left: 0;
  }
}
</style>
