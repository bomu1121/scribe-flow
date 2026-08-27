<script setup lang="ts">
import { Activity } from "lucide-vue-next";
</script>

<template>
  <div class="page-scroll sf-page">
    <div class="sf-page-head">
      <div>
        <h2 class="sf-page-title">运行记录</h2>
        <p class="sf-page-sub">运行即归档，归档属于工程。没有收藏、星标或置顶。</p>
      </div>
    </div>

    <div class="sf-empty">
      <div class="sf-empty-icon"><Activity :size="22" /></div>
      <div class="sf-empty-title">暂无运行记录</div>
      <div class="sf-empty-desc">M3 运行引擎接入后，这里显示跨工程的运行状态与结果。</div>
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

.sf-page-head {
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
