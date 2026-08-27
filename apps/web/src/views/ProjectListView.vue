<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { FileUp, FolderOpen, MoreHorizontal, Plus } from "lucide-vue-next";
import { WORKFLOW_TEMPLATES, type ProjectListItem } from "@scribe-flow/shared";
import AlertDialog from "@/components/ui/AlertDialog.vue";
import Button from "@/components/ui/Button.vue";
import Dialog from "@/components/ui/Dialog.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import DropdownMenuItem from "@/components/ui/DropdownMenuItem.vue";
import { useProjectsStore } from "@/stores/projects";

const router = useRouter();
const store = useProjectsStore();

const showCreate = ref(false);
const creating = ref(false);
const notice = ref("");
const errorNotice = ref("");
const deleteTarget = ref<ProjectListItem | null>(null);
const deleting = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
  void store.loadList();
});

async function createFromTemplate(templateId?: string) {
  creating.value = true;
  errorNotice.value = "";
  try {
    const project = await store.createProject(templateId ? { templateId } : { name: "未命名工程" });
    showCreate.value = false;
    await router.push(`/project/${project.id}`);
  } catch (err) {
    errorNotice.value = err instanceof Error ? err.message : "创建工程失败";
  } finally {
    creating.value = false;
  }
}

async function duplicate(project: ProjectListItem) {
  try {
    const created = await store.duplicateProject(project.id);
    notice.value = `已创建副本「${created.name}」`;
  } catch (err) {
    errorNotice.value = err instanceof Error ? err.message : "复制工程失败";
  }
}

async function exportProject(project: ProjectListItem) {
  try {
    await store.exportProject(project.id, project.name);
  } catch (err) {
    errorNotice.value = err instanceof Error ? err.message : "导出工程失败";
  }
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await store.removeProject(deleteTarget.value.id);
    notice.value = `已删除工程「${deleteTarget.value.name}」`;
    deleteTarget.value = null;
  } catch (err) {
    errorNotice.value = err instanceof Error ? err.message : "删除工程失败";
  } finally {
    deleting.value = false;
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
      notice.value = `已导入工程「${project.name}」`;
      await router.push(`/project/${project.id}`);
    } catch (err) {
      errorNotice.value = err instanceof Error ? err.message : "导入工程失败";
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
        <Button @click="fileInput?.click()">
          <FileUp :size="15" />
          导入工程
        </Button>
        <Button variant="primary" @click="showCreate = true">
          <Plus :size="15" />
          新建工程
        </Button>
      </div>
      <input ref="fileInput" type="file" accept=".json,application/json" class="sf-hidden-input" @change="onImportFile" />
    </div>

    <p v-if="notice" class="sf-notice">{{ notice }}</p>
    <p v-if="errorNotice" class="sf-notice sf-notice--error">{{ errorNotice }}</p>

    <div v-if="store.loading" class="sf-empty">
      <div class="sf-empty-title">加载中…</div>
    </div>

    <div v-else-if="store.list.length > 0" class="sf-project-grid">
      <article v-for="project in store.list" :key="project.id" class="sf-project-card" @click="router.push(`/project/${project.id}`)">
        <header class="sf-project-card-head">
          <span class="sf-project-icon"><FolderOpen :size="15" /></span>
          <DropdownMenu>
            <template #trigger>
              <button type="button" class="sf-more" title="更多操作" @click.stop>
                <MoreHorizontal :size="15" />
              </button>
            </template>
            <DropdownMenuItem @select="router.push(`/project/${project.id}`)">打开</DropdownMenuItem>
            <DropdownMenuItem @select="duplicate(project)">复制</DropdownMenuItem>
            <DropdownMenuItem @select="exportProject(project)">导出</DropdownMenuItem>
            <DropdownMenuItem danger @select="deleteTarget = project">删除</DropdownMenuItem>
          </DropdownMenu>
        </header>
        <h3 class="sf-project-name">{{ project.name }}</h3>
        <p class="sf-project-desc">{{ project.description || "无说明" }}</p>
        <footer class="sf-project-meta tnum">
          <span>{{ project.nodeCount }} 个节点</span>
          <span>更新于 {{ new Date(project.updatedAt).toLocaleString("zh-CN") }}</span>
        </footer>
      </article>
    </div>

    <div v-else class="sf-empty">
      <div class="sf-empty-icon"><FolderOpen :size="22" /></div>
      <div class="sf-empty-title">还没有工程</div>
      <div class="sf-empty-desc">创建一个空白工程，或从「视频转笔记（单线）」模板开始。</div>
    </div>

    <Dialog v-model:open="showCreate" title="新建工程" description="工作流模板只决定加工路径。观点提炼、技术文案提炼、信息溯源等提示词块，在画布的「AI 加工」节点中选择。" width="560px">
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
    </Dialog>

    <AlertDialog
      :open="deleteTarget !== null"
      @update:open="(v: boolean) => { if (!v) deleteTarget = null; }"
      :title="`删除工程「${deleteTarget?.name ?? ''}」`"
      description="工程内的运行记录会一并删除，此操作无法恢复。"
      confirm-text="删除"
      cancel-text="取消"
      danger
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
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

.sf-notice {
  margin: 0 0 14px;
  padding: 10px 14px;
  border: 1px solid var(--color-info-border);
  border-radius: var(--radius-md);
  background: var(--color-info-soft);
  color: var(--color-info);
  font-size: 12px;
}

.sf-notice--error {
  border-color: var(--color-error-border);
  background: var(--color-error-soft);
  color: var(--color-error);
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
