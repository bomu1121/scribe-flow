<script setup lang="ts">
import { computed } from "vue";
import { FileOutput, FileText, FileUp, GitMerge, Link2, Mic, Sparkles, WandSparkles } from "lucide-vue-next";
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger } from "reka-ui";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodeType } from "@scribe-flow/shared";
import Select, { type SelectOption } from "@/components/ui/Select.vue";
import { usePromptsStore } from "@/stores/prompts";
import type { ScribeNodeData } from "@/utils/flow";

const props = defineProps<NodeProps<ScribeNodeData>>();

const promptsStore = usePromptsStore();
const data = computed(() => props.data);

const nodeType = computed<NodeType>(() => props.data.nodeType);
const ports = computed(() => NODE_PORTS[nodeType.value]);
const defaultLabel = computed(() => NODE_TYPE_LABELS[nodeType.value]);
const label = computed(() => props.data.label || defaultLabel.value);

const typeIcon = computed(() => {
  switch (nodeType.value) {
    case "source.bili":
      return Link2;
    case "source.file":
      return FileUp;
    case "source.text":
      return FileText;
    case "process.transcribe":
      return Mic;
    case "process.refine":
      return WandSparkles;
    case "process.prompt":
      return Sparkles;
    case "process.merge":
      return GitMerge;
    case "process.output":
      return FileOutput;
  }
});

const statusClass = computed(() => (props.data.status ? `is-${props.data.status}` : "is-idle"));
const sizeClass = computed(() => `sf-node--${nodeType.value.replaceAll(".", "-")}`);

const promptOptions = computed<SelectOption[]>(() =>
  promptsStore.allBlocks.map((block) => ({ label: `${block.name}${block.builtin ? "（内置）" : ""}`, value: block.id })),
);

const asrOptions: SelectOption[] = [
  { label: "跟随默认设置", value: "default" },
  { label: "MiMo-V2.5（云端）", value: "mimo" },
  { label: "OpenAI 兼容端点", value: "openai-compatible" },
];

function patch(p: Record<string, unknown>) {
  props.data.ctx?.updateData(p);
}

function commit() {
  props.data.ctx?.commit();
}
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div class="sf-node" :class="[statusClass, sizeClass, { 'is-selected': props.selected }]">
        <Handle
          v-for="port in ports.inputs"
          :key="port.id"
          :id="port.id"
          type="target"
          :position="Position.Left"
          class="sf-handle sf-handle--target"
        />

        <div class="sf-node-head">
          <span class="sf-node-icon">
            <component :is="typeIcon" :size="13" />
          </span>
          <input
            class="sf-node-title-input"
            :value="label"
            :aria-label="`节点名称：${label}`"
            @input="patch({ label: ($event.target as HTMLInputElement).value })"
            @blur="commit"
          />
          <span class="sf-node-status" />
        </div>

        <div class="sf-node-body">
          <!-- 来源：B 站链接。卡片做大，容纳批量选视频入口 -->
          <template v-if="nodeType === 'source.bili'">
            <input
              class="sf-node-input"
              :value="data.url"
              placeholder="粘贴 B 站视频链接（支持分 P）"
              @input="patch({ url: ($event.target as HTMLInputElement).value })"
              @blur="commit"
            />
            <button type="button" class="sf-node-batch" disabled title="M2 接入">
              从收藏夹 / 稍后再看批量选择视频（M2 接入）
            </button>
            <div class="sf-node-hint tnum">
              {{ data.pageInfo ? `已选 P${data.pageInfo.page} · ${data.pageInfo.part}` : "解析与分 P 勾选将在 M2 接入" }}
            </div>
          </template>

          <template v-else-if="nodeType === 'source.file'">
            <button type="button" class="sf-node-drop" disabled title="M2 接入">
              <FileUp :size="18" />
              <span>{{ data.fileName ?? "选择或拖入本地音视频（M2 接入）" }}</span>
            </button>
          </template>

          <template v-else-if="nodeType === 'source.text'">
            <textarea
              class="sf-node-textarea"
              :value="data.text"
              rows="6"
              placeholder="粘贴已有文稿…"
              @input="patch({ text: ($event.target as HTMLTextAreaElement).value })"
              @blur="commit"
            />
          </template>

          <template v-else-if="nodeType === 'process.transcribe'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">ASR 引擎</span>
              <div class="sf-node-select">
                <Select
                  :model-value="data.asrEngine ?? null"
                  :options="asrOptions"
                  placeholder="跟随默认设置"
                  size="sm"
                  @update:model-value="(v) => { patch({ asrEngine: v === 'default' ? undefined : v }); commit(); }"
                />
              </div>
            </label>
          </template>

          <template v-else-if="nodeType === 'process.refine'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">输出名称</span>
              <input
                class="sf-node-input"
                :value="data.outputName ?? ''"
                placeholder="如：校对稿"
                @input="patch({ outputName: ($event.target as HTMLInputElement).value })"
                @blur="commit"
              />
            </label>
          </template>

          <template v-else-if="nodeType === 'process.prompt'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">提示词块</span>
              <div class="sf-node-select">
                <Select
                  :model-value="data.promptBlockId ?? null"
                  :options="promptOptions"
                  placeholder="选择提示词块"
                  size="sm"
                  @update:model-value="(v) => { patch({ promptBlockId: v ?? undefined }); commit(); }"
                />
              </div>
            </label>
            <label class="sf-node-field">
              <span class="sf-node-field-label">输出名称</span>
              <input
                class="sf-node-input"
                :value="data.outputName ?? ''"
                placeholder="如：观点笔记"
                @input="patch({ outputName: ($event.target as HTMLInputElement).value })"
                @blur="commit"
              />
            </label>
            <label class="sf-node-field">
              <span class="sf-node-field-label">模型覆盖（可选）</span>
              <input
                class="sf-node-input"
                :value="data.model ?? ''"
                placeholder="不填则跟随默认模型"
                @input="patch({ model: ($event.target as HTMLInputElement).value })"
                @blur="commit"
              />
            </label>
          </template>

          <template v-else-if="nodeType === 'process.merge'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">合并标题</span>
              <input
                class="sf-node-input"
                :value="data.title ?? ''"
                placeholder="合并文档标题"
                @input="patch({ title: ($event.target as HTMLInputElement).value })"
                @blur="commit"
              />
            </label>
          </template>

          <template v-else-if="nodeType === 'process.output'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">输出文件名</span>
              <input
                class="sf-node-input"
                :value="data.fileName ?? ''"
                placeholder="笔记.md"
                @input="patch({ fileName: ($event.target as HTMLInputElement).value })"
                @blur="commit"
              />
            </label>
            <div class="sf-node-output-preview">输出预览（M3 运行后显示）</div>
          </template>
        </div>

        <Handle
          v-for="port in ports.outputs"
          :key="port.id"
          :id="port.id"
          type="source"
          :position="Position.Right"
          class="sf-handle sf-handle--source"
        />
      </div>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="sf-node-menu" align="start">
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M3 接入">运行此节点</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M3 接入">从此节点运行</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item" @select="props.data.ctx?.duplicate()">复制</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M3 接入">复制输出</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item sf-node-menu-item--danger" @select="props.data.ctx?.remove()">删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>

<style scoped>
.sf-node {
  position: relative;
  width: 224px;
  padding: 10px 12px 12px;
  border: 1px solid var(--node-border);
  border-radius: var(--node-radius);
  background: var(--color-surface);
  box-shadow: var(--shadow-xs);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

/* 卡片按内容自适应：入口要大，方便批量选视频 */
.sf-node--source-bili {
  width: 380px;
}
.sf-node--source-file {
  width: 320px;
}
.sf-node--source-text {
  width: 340px;
}
.sf-node--process-prompt {
  width: 320px;
}
.sf-node--process-output {
  width: 320px;
}

.sf-node.is-selected {
  border-color: var(--node-selected-border);
  box-shadow: 0 0 0 1px var(--node-selected-border);
}

.sf-node.is-running {
  border-color: var(--node-running-border);
}

.sf-node.is-running .sf-node-status {
  background: var(--color-brand);
  animation: sf-pulse var(--dur-3) var(--ease-out) infinite alternate;
}

.sf-node.is-done .sf-node-status {
  background: var(--color-success);
}

.sf-node.is-error {
  border-color: var(--color-error);
}

.sf-node.is-error .sf-node-status {
  background: var(--color-error);
}

.sf-node-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
}

.sf-node-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.sf-node-title-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
}

.sf-node-title-input:hover {
  border-color: var(--color-border);
}

.sf-node-title-input:focus {
  outline: none;
  border-color: var(--color-brand);
  background: var(--color-surface);
}

.sf-node-status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-border-strong);
  flex-shrink: 0;
}

.sf-node-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sf-node-input {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 12.5px;
}

.sf-node-input::placeholder {
  color: var(--color-text-tertiary);
}

.sf-node-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}

.sf-node-batch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 56px;
  padding: 8px 10px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  text-align: center;
}

.sf-node-batch:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.sf-node-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 72px;
  padding: 10px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
}

.sf-node-drop:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.sf-node-textarea {
  width: 100%;
  min-height: 120px;
  padding: 8px 9px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
}

.sf-node-textarea::placeholder {
  color: var(--color-text-tertiary);
}

.sf-node-textarea:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}

.sf-node-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.sf-node-field-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-node-select {
  width: 100%;
}

.sf-node-select :deep(.sf-select-trigger) {
  width: 100%;
  justify-content: space-between;
}

.sf-node-hint {
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

.sf-node-output-preview {
  display: grid;
  place-items: center;
  min-height: 88px;
  padding: 10px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  text-align: center;
}

.sf-handle {
  width: 9px;
  height: 9px;
  border: 2px solid var(--color-surface);
  background: var(--handle-color);
}

.sf-handle:hover {
  background: var(--handle-hover-color);
}

.sf-node-menu {
  z-index: 1300;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}

.sf-node-menu-item {
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--color-text);
  cursor: pointer;
}

.sf-node-menu-item[data-highlighted] {
  outline: none;
  background: var(--color-ink-soft);
}

.sf-node-menu-item[data-disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.sf-node-menu-item--danger {
  color: var(--color-error);
}

.sf-node-menu-item--danger[data-highlighted] {
  background: var(--color-error-soft);
}

.sf-node-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border);
}

@keyframes sf-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}
</style>
