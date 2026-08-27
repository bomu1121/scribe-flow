<script setup lang="ts">
import { FileText } from "lucide-vue-next";
</script>

<template>
  <div class="page-scroll sf-page">
    <div class="sf-empty">
      <div class="sf-empty-icon"><FileText :size="22" /></div>
      <div class="sf-empty-title">运行详情</div>
      <div class="sf-empty-desc">M3 后显示节点结果清单与输出文档阅读视图。</div>
    </div>
  </div>
</template>

<style scoped>
.sf-page {
  padding: 24px 28px 40px;
  max-width: var(--content-max);
  margin: 0 auto;
  width: 100%;
}

.sf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 96px 16px;
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
</style>
