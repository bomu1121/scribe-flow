<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElButton, ElDialog, ElMessage, ElOption, ElSelect, ElTable, ElTag } from "element-plus";
import { ArrowLeft, Copy, FileText, RefreshCw, ScrollText } from "lucide-vue-next";
import type { RunDetail, RunNodeLog, RunNodeResult } from "@scribe-flow/shared";
import { api } from "@/lib/api";

const route = useRoute();
const router = useRouter();
const run = ref<RunDetail | null>(null);
const markdown = ref("");
const loading = ref(false);
const logs = ref<RunNodeLog[]>([]);
const logsVisible = ref(false);
const logsNodeId = ref("");

const runId = String(route.params.runId);
const projectId = String(route.params.id);

const outputNode = computed(() => run.value?.nodeResults.find((n) => n.output?.kind === "noteDoc"));

onMounted(async () => {
  loading.value = true;
  try {
    run.value = await api.get<RunDetail>(`/api/runs/${runId}`);
    const node = run.value.nodeResults.find((n) => n.output?.kind === "noteDoc" && n.output.path);
    if (node) {
      const result = await api.get<{ output?: { text?: string } }>(`/api/runs/${runId}/outputs/${node.nodeId}`);
      markdown.value = result.output?.text ?? "";
    } else {
      const firstText = run.value.nodeResults.find((n) => n.output?.text);
      markdown.value = firstText?.output?.text ?? "";
    }
  } finally {
    loading.value = false;
  }
});

const statusMeta: Record<string, { label: string; type: "primary" | "success" | "danger" | "info" }> = {
  running: { label: "运行中", type: "primary" },
  done: { label: "完成", type: "success" },
  error: { label: "失败", type: "danger" },
  cancelled: { label: "已取消", type: "info" },
  skipped: { label: "跳过", type: "info" },
};

const logKindLabels: Record<RunNodeLog["kind"], string> = {
  input: "输入文稿",
  "ai-request": "AI 请求",
  "ai-response": "AI 响应",
  info: "信息",
  error: "错误",
};

function fmt(ms?: number): string {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function downloadMarkdown() {
  if (!markdown.value) return;
  const blob = new Blob([markdown.value], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `run-${runId.slice(-6)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(markdown.value);
    ElMessage.success("已复制到剪贴板");
  } catch {
    ElMessage.error("复制失败，请手动选择文本");
  }
}

async function openLogs(nodeId = "") {
  logsVisible.value = true;
  logsNodeId.value = nodeId;
  try {
    const data = await api.get<{ items: RunNodeLog[] }>(`/api/runs/${runId}/logs${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ""}`);
    logs.value = data.items ?? [];
  } catch (err) {
    logs.value = [];
    ElMessage.error(err instanceof Error ? err.message : "日志加载失败");
  }
}

async function retryNode(node: RunNodeResult) {
  try {
    const created = await api.post<{ id: string }>(`/api/runs/${runId}/nodes/${node.nodeId}/retry`);
    ElMessage.success(`已启动重跑：#${created.id.slice(-6)}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "重跑失败");
  }
}
</script>

<template>
  <div class="page-scroll sf-page">
    <div class="sf-run-head">
      <div>
        <div class="sf-run-title-row">
          <el-button size="small" text @click="router.push(`/project/${projectId}`)"><ArrowLeft :size="14" /><span>返回工程</span></el-button>
          <h2 class="sf-page-title">运行详情 <span class="tnum">#{{ runId.slice(-6) }}</span></h2>
          <el-tag v-if="run" :type="statusMeta[run.status]?.type" size="small">{{ statusMeta[run.status]?.label }}</el-tag>
        </div>
        <p class="sf-page-sub">
          {{ run ? `${run.projectName ?? ""} · 耗时 ${fmt(run.elapsedMs)} · ${new Date(run.createdAt).toLocaleString("zh-CN")}` : "加载中…" }}
        </p>
      </div>
      <div class="sf-run-actions">
        <el-button size="small" plain @click="openLogs('')"><ScrollText :size="14" /><span>查看日志</span></el-button>
        <el-button size="small" plain :disabled="!markdown" @click="copyMarkdown"><Copy :size="14" /><span>复制</span></el-button>
        <el-button v-if="outputNode || markdown" size="small" type="primary" :disabled="!markdown" @click="downloadMarkdown"><FileText :size="14" /><span>下载 Markdown</span></el-button>
      </div>
    </div>

    <div v-if="loading" class="sf-empty"><div class="sf-empty-title">加载中…</div></div>

    <template v-else-if="run">
      <el-table :data="run.nodeResults" row-key="nodeId" size="small" class="sf-nodes-table">
        <el-table-column label="节点" min-width="160">
          <template #default="{ row }: { row: RunNodeResult }">{{ row.nodeLabel || row.nodeType }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }: { row: RunNodeResult }">
            <el-tag :type="statusMeta[row.status]?.type ?? 'info'" size="small">{{ statusMeta[row.status]?.label ?? row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }: { row: RunNodeResult }"><span class="tnum">{{ fmt(row.elapsedMs) }}</span></template>
        </el-table-column>
        <el-table-column label="产物 / 错误" min-width="220">
          <template #default="{ row }: { row: RunNodeResult }">
            <span v-if="row.error" class="sf-node-error">{{ row.error }}</span>
            <span v-else>{{ row.summary || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="right">
          <template #default="{ row }: { row: RunNodeResult }">
            <el-button size="small" text @click="openLogs(row.nodeId)">日志</el-button>
            <el-button v-if="row.status === 'error'" size="small" text type="primary" @click="retryNode(row)"><RefreshCw :size="13" /><span>重跑</span></el-button>
          </template>
        </el-table-column>
      </el-table>

      <section class="sf-markdown">
        <h3 class="sf-markdown-title">输出文档</h3>
        <pre v-if="markdown" class="sf-markdown-text">{{ markdown }}</pre>
        <div v-else class="sf-markdown-empty">本次运行没有文本产物。</div>
      </section>
    </template>

    <el-dialog v-model="logsVisible" title="运行日志" width="640px" align-center>
      <el-select v-model="logsNodeId" class="sf-log-filter" size="small" placeholder="全部节点" clearable @change="(v) => openLogs(String(v ?? ''))">
        <el-option v-for="node in run?.nodeResults ?? []" :key="node.nodeId" :label="node.nodeLabel || node.nodeType" :value="node.nodeId" />
      </el-select>
      <div class="sf-log-list">
        <article v-for="log in logs" :key="log.id" class="sf-log-item">
          <header class="sf-log-head">
            <span class="sf-log-node">{{ log.nodeLabel || log.nodeId }}</span>
            <span class="sf-log-kind">{{ logKindLabels[log.kind] }}</span>
            <span class="sf-log-time tnum">{{ new Date(log.createdAt).toLocaleTimeString("zh-CN") }}</span>
          </header>
          <pre class="sf-log-content">{{ log.content }}</pre>
        </article>
        <div v-if="logs.length === 0" class="sf-log-empty">暂无日志</div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.sf-page {
  padding: 24px 28px 40px;
  max-width: var(--content-max);
  margin: 0 auto;
  width: 100%;
}

.sf-run-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 20px;
}

.sf-run-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-run-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.sf-page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.sf-page-sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.sf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 72px 16px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  text-align: center;
}

.sf-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-node-error {
  color: var(--color-error);
}

.sf-markdown {
  margin-top: 20px;
}

.sf-markdown-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-markdown-text {
  margin: 0;
  padding: 24px 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  color: var(--color-text);
}

.sf-markdown-empty {
  padding: 32px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-tertiary);
  font-size: 13px;
  text-align: center;
}

.sf-log-filter {
  width: 220px;
  margin-bottom: 10px;
}

.sf-log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 420px;
  overflow-y: auto;
}

.sf-log-item {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.sf-log-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.sf-log-node {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-log-kind {
  font-size: 11px;
  color: var(--color-brand);
}

.sf-log-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-log-content {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.sf-log-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}
</style>
