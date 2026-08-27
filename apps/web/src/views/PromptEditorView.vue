<script setup lang="ts">
import { ArrowLeft } from "lucide-vue-next";
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <div class="page-scroll sf-page">
    <button type="button" class="sf-back" @click="router.push('/settings')">
      <ArrowLeft :size="14" />
      返回设置
    </button>
    <div class="sf-empty">
      <h2 class="sf-empty-title">提示词块编辑器</h2>
      <p class="sf-empty-desc">内置提示词块只读，自定义块可编辑名称与提示词。表单将在 M4 接入。</p>
    </div>
  </div>
</template>

<style scoped>
.sf-page {
  padding: 20px 28px 40px;
  max-width: var(--content-max);
  margin: 0 auto;
  width: 100%;
}

.sf-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 14px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.sf-back:hover {
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

.sf-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-empty-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
}
</style>
