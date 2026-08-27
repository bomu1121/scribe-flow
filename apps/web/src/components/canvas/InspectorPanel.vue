<script setup lang="ts">
import { computed } from "vue";
import { NODE_TYPE_LABELS, type GraphNode } from "@scribe-flow/shared";
import Badge from "@/components/ui/Badge.vue";
import Input from "@/components/ui/Input.vue";
import Select, { type SelectOption } from "@/components/ui/Select.vue";
import { usePromptsStore } from "@/stores/prompts";

const props = defineProps<{ node: GraphNode | null }>();
const emit = defineEmits<{ update: [id: string, patch: Record<string, unknown>]; commit: [] }>();

const promptsStore = usePromptsStore();

const node = computed(() => props.node);
const nodeType = computed(() => node.value?.type ?? "source.bili");
// 节点数据是判别联合，模板里按节点类型访问专属字段时用宽松类型，避免到处收窄。
// eslint 风格说明：这里的 any 仅限检查器内部读取，写入仍走 patch()。
const data = computed<any>(() => (props.node?.data ?? {}) as any);

const promptOptions = computed<SelectOption[]>(() =>
  promptsStore.allBlocks.map((block) => ({ label: `${block.name}${block.builtin ? "（内置）" : ""}`, value: block.id })),
);

const asrOptions: SelectOption[] = [
  { label: "MiMo-V2.5（云端）", value: "mimo" },
  { label: "OpenAI 兼容端点", value: "openai-compatible" },
];

function patch(p: Record<string, unknown>) {
  if (node.value) emit("update", node.value.id, p);
}

const statusLabel: Record<string, string> = {
  idle: "未运行",
  queued: "等待中",
  running: "运行中",
  done: "已完成",
  error: "失败",
  cancelled: "已取消",
};

const statusTone = computed(() => {
  switch (node.value?.data.status) {
    case "done":
      return "success";
    case "error":
      return "error";
    case "running":
    case "queued":
      return "brand";
    default:
      return "neutral";
  }
});
</script>

<template>
  <aside class="sf-inspector">
    <div v-if="!node" class="sf-inspector-empty">
      <h3 class="sf-inspector-title">工程属性</h3>
      <p class="sf-inspector-desc">未选中节点。选中画布上的节点后，在这里编辑它的参数。</p>
      <p class="sf-inspector-desc tnum">运行配置默认值将在 M3 接入。</p>
    </div>

    <template v-else>
      <div class="sf-inspector-head">
        <h3 class="sf-inspector-title">{{ NODE_TYPE_LABELS[nodeType] }}</h3>
        <Badge :tone="statusTone">{{ statusLabel[String(data.status ?? "idle")] }}</Badge>
      </div>
      <p v-if="data.summary" class="sf-inspector-summary">{{ data.summary }}</p>

      <div class="sf-field">
        <span class="sf-field-label">节点名称</span>
        <Input
          :model-value="data.label ?? ''"
          placeholder="节点名称"
          @update:model-value="(v: string) => patch({ label: v })"
          @blur="emit('commit')"
        />
      </div>

      <template v-if="nodeType === 'source.bili'">
        <div class="sf-field">
          <span class="sf-field-label">视频链接</span>
          <Input
            :model-value="data.url ?? ''"
            placeholder="https://www.bilibili.com/video/BV…"
            @update:model-value="(v: string) => patch({ url: v })"
            @blur="emit('commit')"
          />
        </div>
        <div class="sf-field" v-if="data.pageInfo">
          <span class="sf-field-label">已选分 P</span>
          <span class="sf-field-value tnum">P{{ data.pageInfo.page }} · {{ data.pageInfo.part }}</span>
        </div>
        <p class="sf-inspector-hint">M2 接入：解析预览、分 P 勾选、从收藏夹快捷选择。</p>
      </template>

      <template v-else-if="nodeType === 'source.file'">
        <div class="sf-field">
          <span class="sf-field-label">文件</span>
          <span class="sf-field-value">{{ data.fileName ?? "尚未选择文件" }}</span>
        </div>
        <p class="sf-inspector-hint">M2 接入：上传与拖拽选择本地音视频。</p>
      </template>

      <template v-else-if="nodeType === 'source.text'">
        <div class="sf-field">
          <span class="sf-field-label">文稿内容</span>
          <textarea
            class="sf-textarea"
            :value="data.text ?? ''"
            rows="8"
            placeholder="粘贴已有文稿…"
            @input="patch({ text: ($event.target as HTMLTextAreaElement).value })"
            @blur="emit('commit')"
          />
        </div>
      </template>

      <template v-else-if="nodeType === 'process.transcribe'">
        <div class="sf-field">
          <span class="sf-field-label">ASR 引擎</span>
          <Select :model-value="data.asrEngine ?? null" :options="asrOptions" placeholder="跟随默认设置" @update:model-value="(v) => { patch({ asrEngine: v }); emit('commit'); }" />
        </div>
      </template>

      <template v-else-if="nodeType === 'process.refine'">
        <div class="sf-field">
          <span class="sf-field-label">输出名称</span>
          <Input :model-value="data.outputName ?? ''" placeholder="如：校对稿" @update:model-value="(v: string) => patch({ outputName: v })" @blur="emit('commit')" />
        </div>
      </template>

      <template v-else-if="nodeType === 'process.prompt'">
        <div class="sf-field">
          <span class="sf-field-label">提示词块</span>
          <Select
            :model-value="data.promptBlockId ?? null"
            :options="promptOptions"
            placeholder="选择提示词块"
            @update:model-value="(v) => { patch({ promptBlockId: v }); emit('commit'); }"
          />
        </div>
        <div class="sf-field">
          <span class="sf-field-label">输出名称</span>
          <Input :model-value="data.outputName ?? ''" placeholder="如：观点笔记" @update:model-value="(v: string) => patch({ outputName: v })" @blur="emit('commit')" />
        </div>
        <div class="sf-field">
          <span class="sf-field-label">模型覆盖（可选）</span>
          <Input :model-value="data.model ?? ''" placeholder="不填则跟随默认模型" @update:model-value="(v: string) => patch({ model: v })" @blur="emit('commit')" />
        </div>
      </template>

      <template v-else-if="nodeType === 'process.merge'">
        <div class="sf-field">
          <span class="sf-field-label">合并标题</span>
          <Input :model-value="data.title ?? ''" placeholder="合并文档标题" @update:model-value="(v: string) => patch({ title: v })" @blur="emit('commit')" />
        </div>
      </template>

      <template v-else-if="nodeType === 'process.output'">
        <div class="sf-field">
          <span class="sf-field-label">输出文件名</span>
          <Input :model-value="data.fileName ?? ''" placeholder="笔记.md" @update:model-value="(v: string) => patch({ fileName: v })" @blur="emit('commit')" />
        </div>
      </template>
    </template>
  </aside>
</template>

<style scoped>
.sf-inspector {
  width: 280px;
  flex-shrink: 0;
  padding: 14px;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-y: auto;
}

.sf-inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.sf-inspector-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-inspector-desc {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-inspector-summary {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.sf-field-label {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-field-value {
  font-size: 12.5px;
  color: var(--color-text);
  word-break: break-all;
}

.sf-inspector-hint {
  margin: 0 0 12px;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}

.sf-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
}

.sf-textarea::placeholder {
  color: var(--color-text-tertiary);
}

.sf-textarea:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}
</style>
