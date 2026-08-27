<script setup lang="ts">
import { ref } from "vue";
import { Plus, FileUp } from "lucide-vue-next";
import { WORKFLOW_TEMPLATES } from "@scribe-flow/shared";
import Button from "@/components/ui/Button.vue";
import Dialog from "@/components/ui/Dialog.vue";

const showCreate = ref(false);
const notice = ref("");

function pickTemplate(name: string) {
  notice.value = `「${name}」模板创建将在 M1 接入后端接口后可用`;
  showCreate.value = false;
}
</script>

<template>
  <div class="page-scroll sf-page">
    <div class="sf-page-head">
      <div>
        <h2 class="sf-page-title">工程</h2>
        <p class="sf-page-sub">工作流以工程形式保存：画布编排、运行记录随工程归档。</p>
      </div>
      <Button variant="primary" @click="showCreate = true">
        <Plus :size="15" />
        新建工程
      </Button>
    </div>

    <div class="sf-empty">
      <div class="sf-empty-icon"><FileUp :size="22" /></div>
      <div class="sf-empty-title">还没有工程</div>
      <div class="sf-empty-desc">创建一个空白工程，或从「视频观点笔记」模板开始。</div>
    </div>

    <p v-if="notice" class="sf-notice tnum">{{ notice }}</p>

    <Dialog v-model:open="showCreate" title="新建工程" description="选择起始方式。工程创建与画布编辑器将在 M1 里程碑接入。" width="560px">
      <div class="sf-tpl-grid">
        <button type="button" class="sf-tpl-card" @click="pickTemplate('空白工程')">
          <span class="sf-tpl-name">空白工程</span>
          <span class="sf-tpl-desc">从空画布开始搭建加工流</span>
        </button>
        <button v-for="tpl in WORKFLOW_TEMPLATES" :key="tpl.id" type="button" class="sf-tpl-card" @click="pickTemplate(tpl.name)">
          <span class="sf-tpl-name">{{ tpl.name }}</span>
          <span class="sf-tpl-desc">{{ tpl.description }}</span>
        </button>
      </div>
    </Dialog>
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

.sf-notice {
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid var(--color-info-border);
  border-radius: var(--radius-md);
  background: var(--color-info-soft);
  color: var(--color-info);
  font-size: 12px;
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

.sf-tpl-card:hover {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
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
