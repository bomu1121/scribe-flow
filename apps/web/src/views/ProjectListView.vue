<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElButton, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage, ElMessageBox, ElTag } from "element-plus";
import { FileUp, FolderOpen, MoreHorizontal, Plus } from "lucide-vue-next";
import { WORKFLOW_TEMPLATES, type ProjectListItem, type RunMeta, type RunStatus } from "@scribe-flow/shared";
import { useProjectsStore } from "@/stores/projects";
import { useRunsStore } from "@/stores/runs";

const router = useRouter();
const store = useProjectsStore();
const runsStore = useRunsStore();

const showCreate = ref(false);
const creating = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function isProjectRunning(projectId: string): boolean {
  return runsStore.runs.some((r) => r.projectId === projectId && r.status === "running");
}

function latestRun(projectId: string): RunMeta | undefined {
  // runsStore.runs 按 createdAt 倒序，取第一条即最近一次运行。
  return runsStore.runs.find((r) => r.projectId === projectId);
}

function runStatusLabel(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    running: "运行中",
    success: "成功",
    error: "失败",
    cancelled: "已取消",
  };
  return labels[status] ?? status;
}

function runStatusType(status: RunStatus): "primary" | "success" | "danger" | "info" {
  const types: Record<RunStatus, "primary" | "success" | "danger" | "info"> = {
    running: "primary",
    success: "success",
    error: "danger",
    cancelled: "info",
  };
  return types[status] ?? "info";
}

function openLatestRun(project: ProjectListItem) {
  const run = latestRun(project.id);
  if (run) void router.push(`/project/${project.id}/run/${run.id}`);
}

onMounted(() => {
  void store.loadList();
  void runsStore.load();
});

async function createFromTemplate(templateId?: string) {
  creating.value = true;
  try {
    const project = await store.createProject(templateId ? { templateId } : { name: "未命名工程" });
    showCreate.value = false;
    await router.push(`/project/${project.id}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "创建工程失败");
  } finally {
    creating.value = false;
  }
}

async function duplicate(project: ProjectListItem) {
  try {
    const created = await store.duplicateProject(project.id);
    ElMessage.success(`已创建副本「${created.name}」`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "复制工程失败");
  }
}

async function exportProject(project: ProjectListItem) {
  try {
    await store.exportProject(project.id, project.name);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "导出工程失败");
  }
}

async function removeProject(project: ProjectListItem) {
  try {
    await ElMessageBox.confirm("工程内的运行记录会一并删除，此操作无法恢复。", `删除工程「${project.name}」`, {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }

  try {
    await store.removeProject(project.id);
    ElMessage.success(`已删除工程「${project.name}」`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "删除工程失败");
  }
}

function onProjectCommand(project: ProjectListItem, command: string) {
  switch (command) {
    case "open":
      void router.push(`/project/${project.id}`);
      break;
    case "duplicate":
      void duplicate(project);
      break;
    case "export":
      void exportProject(project);
      break;
    case "delete":
      void removeProject(project);
      break;
  }
}

function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void (async () => {
    try {
      const project = await store.importProject(file);
      ElMessage.success(`已导入工程「${project.name}」`);
      await router.push(`/project/${project.id}`);
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : "导入工程失败");
    }
  })();
}
</script>

<template>
  <div class="page-scroll sf-page">
    <div class="sf-page-head">
      <div>
        <h2 class="sf-page-title">工程</h2>
        <p class="sf-page-sub">工作流以工程形式保存：画布编排、运行记录随工程归档。</p>
      </div>
      <div class="sf-head-actions">
        <el-button class="sf-btn" plain @click="fileInput?.click()">
          <FileUp :size="15" />
          <span>导入工程</span>
        </el-button>
        <el-button class="sf-btn" type="primary" @click="showCreate = true">
          <Plus :size="15" />
          <span>新建工程</span>
        </el-button>
      </div>
      <input ref="fileInput" type="file" accept=".json,application/json" class="sf-hidden-input" @change="onImportFile" />
    </div>

    <div v-if="store.loading" class="sf-empty">
      <div class="sf-empty-title">加载中…</div>
    </div>

    <div v-else-if="store.list.length > 0" class="sf-project-grid">
      <article v-for="project in store.list" :key="project.id" class="sf-project-card" @click="router.push(`/project/${project.id}`)">
        <header class="sf-project-card-head">
          <span class="sf-project-icon"><FolderOpen :size="15" /></span>
          <el-dropdown trigger="click" @command="(cmd) => onProjectCommand(project, String(cmd))">
            <button type="button" class="sf-more" title="更多操作" @click.stop>
              <MoreHorizontal :size="15" />
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="open">打开</el-dropdown-item>
                <el-dropdown-item command="duplicate">复制</el-dropdown-item>
                <el-dropdown-item command="export">导出</el-dropdown-item>
                <el-dropdown-item command="delete" divided class="sf-dropdown-danger">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </header>
        <h3 class="sf-project-name">{{ project.name }}</h3>
        <p class="sf-project-desc">{{ project.description || "无说明" }}</p>
        <footer class="sf-project-meta tnum">
          <div class="sf-project-meta-left">
            <el-tag v-if="isProjectRunning(project.id)" type="primary" size="small" effect="light">运行中</el-tag>
            <span>{{ project.nodeCount }} 个节点</span>
          </div>
          <button v-if="latestRun(project.id)" type="button" class="sf-last-run" title="查看最近一次运行结果" @click.stop="openLatestRun(project)">
            <el-tag :type="runStatusType(latestRun(project.id)!.status)" size="small" effect="light">{{ runStatusLabel(latestRun(project.id)!.status) }}</el-tag>
            <span>上次 #{{ latestRun(project.id)!.id.slice(-6) }}</span>
          </button>
          <span v-else>更新于 {{ new Date(project.updatedAt).toLocaleString("zh-CN") }}</span>
        </footer>
      </article>
    </div>

    <div v-else class="sf-empty">
      <div class="sf-empty-icon"><FolderOpen :size="22" /></div>
      <div class="sf-empty-title">还没有工程</div>
      <div class="sf-empty-desc">创建一个空白工程，或从「文稿转思维导图」模板开始。</div>
    </div>

    <el-dialog v-model="showCreate" title="新建工程" width="560px">
      <p class="sf-dialog-desc">工作流模板只决定加工路径。提示词块在「AI 加工」节点中选择，思维导图在「思维导图」节点中配置。</p>
      <div class="sf-tpl-grid">
        <button type="button" class="sf-tpl-card" :disabled="creating" @click="createFromTemplate()">
          <span class="sf-tpl-name">空白工程</span>
          <span class="sf-tpl-desc">从空画布开始搭建加工流</span>
        </button>
        <button v-for="tpl in WORKFLOW_TEMPLATES" :key="tpl.id" type="button" class="sf-tpl-card" :disabled="creating" @click="createFromTemplate(tpl.id)">
          <span class="sf-tpl-name">{{ tpl.name }}</span>
          <span class="sf-tpl-desc">{{ tpl.description }}</span>
        </button>
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

.sf-page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 20px;
}

.sf-head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.sf-btn {
  gap: 6px;
}

.sf-hidden-input {
  display: none;
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

.sf-project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.sf-project-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

.sf-project-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-card);
}

.sf-project-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sf-project-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.sf-more {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
}

.sf-more:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-project-name {
  margin: 6px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-project-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.sf-project-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-project-meta-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.sf-last-run {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-last-run:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
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
  margin-bottom: 4px;
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

.sf-dialog-desc {
  margin: 0 0 14px;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-tpl-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.sf-tpl-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-tpl-card:hover:not(:disabled) {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
}

.sf-tpl-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sf-tpl-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-tpl-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
</style>

<style>
/* 下拉菜单 Teleport 到 body，样式必须全局 */
.sf-dropdown-danger {
  color: var(--color-error);
}
</style>
