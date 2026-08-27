<script setup lang="ts">
import { GitBranchPlus } from "lucide-vue-next";
</script>

<template>
  <div class="sf-editor-placeholder">
    <div class="sf-editor-icon"><GitBranchPlus :size="22" /></div>
    <h2 class="sf-editor-title">画布编辑器</h2>
    <p class="sf-editor-desc">M1 接入 Vue Flow：左节点库 / 中画布 / 右检查器 / 底运行控制台。</p>
    <p class="sf-editor-note tnum">画布交互不自研，按 n8n 行为照搬清单逐项验收。</p>
  </div>
</template>

<style scoped>
.sf-editor-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  background: var(--color-canvas);
}

.sf-editor-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-brand);
}

.sf-editor-title {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-editor-desc {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.sf-editor-note {
  font-size: 12px;
  color: var(--color-text-tertiary);
}
</style>
