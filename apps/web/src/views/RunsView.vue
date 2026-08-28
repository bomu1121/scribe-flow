<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElButton, ElMessage, ElMessageBox, ElOption, ElSelect, ElTable, ElTag } from "element-plus";
import { Activity, Eye, Trash2 } from "lucide-vue-next";
import type { RunMeta, RunStatus } from "@scribe-flow/shared";
import { useRunsStore } from "@/stores/runs";

const router = useRouter();
const store = useRunsStore();

const statusFilter = ref<"" | RunStatus>("");
const projectFilter = ref("");
const statusOptions = [
  { label: "全部", value: "" },
  { label: "运行中", value: "running" },
  { label: "成功", value: "success" },
  { label: "失败", value: "error" },
  { label: "已取消", value: "cancelled" },
];

const projectOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const run of store.runs) seen.set(run.projectId, run.projectName || run.projectId);
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
});

const filtered = computed(() =>
  store.runs.filter((r) => (statusFilter.value ? r.status === statusFilter.value : true) && (projectFilter.value ? r.projectId === projectFilter.value : true)),
);

const statusMeta: Record<RunStatus, { label: string; type: "primary" | "success" | "danger" | "info" }> = {
  running: { label: "运行中", type: "primary" },
  success: { label: "成功", type: "success" },
  error: { label: "失败", type: "danger" },
  cancelled: { label: "已取消", type: "info" },
};

const scopeLabels: Record<RunMeta["scope"], string> = {
  all: "全部",
  fromNode: "从节点",
  node: "单节点",
};

onMounted(() => void store.load());

function fmtTime(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function removeRun(run: RunMeta) {
  try {
    await ElMessageBox.confirm(`删除运行 ${run.id.slice(-6)}？相关节点结果与产物文件会一并删除。`, "删除运行", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    await store.remove(run.id);
    ElMessage.success("已删除运行");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "删除失败");
  }
}
</script>

<template>
  <div class="page-scroll sf-page">
    <div class="sf-page-head">
      <div>
        <h2 class="sf-page-title">运行记录</h2>
        <p class="sf-page-sub">运行即归档，归档属于工程。没有收藏、星标或置顶。</p>
      </div>
      <div class="sf-head-filters">
        <el-select v-model="projectFilter" class="sf-project-filter" size="small" clearable placeholder="全部工程">
          <el-option v-for="opt in projectOptions" :key="opt.id" :label="opt.name" :value="opt.id" />
        </el-select>
        <el-select v-model="statusFilter" class="sf-status-filter" size="small">
          <el-option v-for="opt in statusOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </div>
    </div>

    <div v-if="store.loading" class="sf-empty">
      <div class="sf-empty-title">加载中…</div>
    </div>

    <div v-else-if="filtered.length === 0" class="sf-empty">
      <div class="sf-empty-icon"><Activity :size="22" /></div>
      <div class="sf-empty-title">暂无运行记录</div>
      <div class="sf-empty-desc">在画布中点击「运行全部」后，运行结果会出现在这里。</div>
    </div>

    <el-table v-else :data="filtered" row-key="id" size="small" class="sf-runs-table">
      <el-table-column label="运行" min-width="140">
        <template #default="{ row }: { row: RunMeta }">
          <span class="sf-run-id tnum">#{{ row.id.slice(-6) }}</span>
          <span class="sf-run-summary">{{ row.summary || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="工程" min-width="160">
        <template #default="{ row }: { row: RunMeta }">{{ row.projectName || row.projectId }}</template>
      </el-table-column>
      <el-table-column label="范围" width="90">
        <template #default="{ row }: { row: RunMeta }">{{ scopeLabels[row.scope] }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }: { row: RunMeta }">
          <el-tag :type="statusMeta[row.status].type" size="small">{{ statusMeta[row.status].label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="90">
        <template #default="{ row }: { row: RunMeta }"><span class="tnum">{{ fmtTime(row.elapsedMs) }}</span></template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }: { row: RunMeta }"><span class="tnum">{{ new Date(row.createdAt).toLocaleString("zh-CN") }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="130" align="right">
        <template #default="{ row }: { row: RunMeta }">
          <el-button size="small" text @click="router.push(`/project/${row.projectId}/run/${row.id}`)"><Eye :size="14" /><span>详情</span></el-button>
          <el-button size="small" text class="sf-danger-text" @click="removeRun(row)"><Trash2 :size="14" /><span>删除</span></el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.sf-page {
  padding: 24px 28px 40px;
  max-width: var(--content-max);
  margin: 0 auto;
  width: 100%;
}

.sf-page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 20px;
}

.sf-head-filters {
  display: flex;
  gap: 8px;
}

.sf-project-filter {
  width: 200px;
}

.sf-status-filter {
  width: 140px;
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

.sf-empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: var(--color-ink-soft);
  color: var(--color-text-tertiary);
}

.sf-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-empty-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.sf-run-id {
  font-size: 12px;
  color: var(--color-brand);
  margin-right: 8px;
}

.sf-run-summary {
  font-size: 12.5px;
  color: var(--color-text);
}

.sf-danger-text {
  color: var(--color-error);
}
</style>
