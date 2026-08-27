<script setup lang="ts">
import { ref } from "vue";

const groups = [
  { key: "general", label: "常规", desc: "默认并发数、输出文件命名等基础选项。" },
  { key: "ai", label: "AI 模型", desc: "提供商、地址、密钥、模型与测试连接。" },
  { key: "asr", label: "语音识别", desc: "云 ASR 引擎（MiMo-V2.5 默认）配置。" },
  { key: "prompts", label: "提示词块库", desc: "内置与自定义提示词块，节点只引用块。" },
  { key: "bili", label: "B 站账号", desc: "扫码登录，仅服务来源节点的快捷选视频。" },
  { key: "data", label: "数据与工程", desc: "工程导入导出与运行记录清理。" },
] as const;

type GroupKey = (typeof groups)[number]["key"];

const active = ref<GroupKey>("general");
</script>

<template>
  <div class="sf-settings">
    <aside class="sf-settings-nav">
      <button
        v-for="group in groups"
        :key="group.key"
        type="button"
        class="sf-settings-nav-item"
        :class="{ active: active === group.key }"
        @click="active = group.key"
      >
        {{ group.label }}
      </button>
    </aside>

    <section class="sf-settings-body">
      <h2 class="sf-settings-title">{{ groups.find((g) => g.key === active)?.label }}</h2>
      <p class="sf-settings-desc">{{ groups.find((g) => g.key === active)?.desc }}</p>
      <div class="sf-settings-placeholder">该分组的表单将在 M0 完成后按里程碑接入。</div>
    </section>
  </div>
</template>

<style scoped>
.sf-settings {
  height: 100%;
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  background: var(--color-bg);
}

.sf-settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 10px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-y: auto;
}

.sf-settings-nav-item {
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-settings-nav-item:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-settings-nav-item.active {
  background: var(--color-ink);
  color: var(--color-surface);
}

.sf-settings-body {
  padding: 24px 28px 40px;
  max-width: 720px;
  overflow-y: auto;
}

.sf-settings-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-settings-desc {
  margin: 4px 0 18px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.sf-settings-placeholder {
  padding: 32px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-tertiary);
  font-size: 13px;
  text-align: center;
}
</style>
