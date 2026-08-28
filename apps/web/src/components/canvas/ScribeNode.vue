<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { FileOutput, FileText, FileUp, GitMerge, Link2, Mic, Sparkles, WandSparkles } from "lucide-vue-next";
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger } from "reka-ui";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodeType, type VideoPreview } from "@scribe-flow/shared";
import Select, { type SelectOption } from "@/components/ui/Select.vue";
import { Input } from "@/components/ui/input";
import { usePromptsStore } from "@/stores/prompts";
import { api } from "@/lib/api";
import type { ScribeNodeData } from "@/utils/flow";

const props = defineProps<NodeProps<ScribeNodeData>>();

const promptsStore = usePromptsStore();
const data = computed(() => props.data);

// 链接即时解析（检查点）：输入后防抖查询封面/标题/分 P
const preview = ref<VideoPreview | null>(null);
const previewLoading = ref(false);
const previewError = ref("");
let previewTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePreview(url: string) {
  if (previewTimer) clearTimeout(previewTimer);
  preview.value = null;
  previewError.value = "";

  const value = url.trim();
  if (!value) return;
  if (!/bilibili\.com|b23\.tv|\bBV[0-9A-Za-z]+|\bav\d+/i.test(value)) {
    previewError.value = "需要 B 站视频链接（支持 BV 号或 av 号）";
    return;
  }

  previewLoading.value = true;
  previewTimer = setTimeout(async () => {
    try {
      const result = await api.post<VideoPreview>("/api/videos/preview", { url: value });
      preview.value = result;
      if (result.pages.length > 0) {
        const first = result.pages[0];
        patch({ pageInfo: { cid: first.cid, page: first.page, part: first.part, duration: first.duration } });
      }
    } catch (err) {
      previewError.value = err instanceof Error ? err.message : "解析失败，请检查链接";
    } finally {
      previewLoading.value = false;
    }
  }, 500);
}

onMounted(() => {
  if (props.data.url) schedulePreview(props.data.url);
});

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
});

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
            <Input
              class="h-8 text-xs"
              :model-value="data.url"
              placeholder="粘贴 B 站视频链接（支持分 P）"
              @update:model-value="(v: string | number) => { const value = String(v); patch({ url: value }); schedulePreview(value); }"
              @blur="commit"
            />
            <div v-if="previewLoading" class="sf-node-preview sf-node-preview--loading tnum">正在解析视频信息…</div>
            <div v-else-if="preview" class="sf-node-preview">
              <img :src="preview.cover" class="sf-node-cover" alt="视频封面" referrerpolicy="no-referrer" loading="lazy" />
              <div class="sf-node-preview-info">
                <span class="sf-node-preview-title">{{ preview.title }}</span>
                <span class="sf-node-preview-meta tnum">
                  {{ preview.uploader }} · {{ fmtDuration(preview.duration) }} · {{ preview.pages.length }}P
                </span>
                <span v-if="data.pageInfo" class="sf-node-preview-page tnum">
                  已选 P{{ data.pageInfo.page }} · {{ data.pageInfo.part }}
                </span>
              </div>
            </div>
            <div v-else-if="previewError" class="sf-node-preview sf-node-preview--error">{{ previewError }}</div>
            <div v-else class="sf-node-hint tnum">输入链接后自动解析封面、UP 主与分 P 信息</div>
            <button type="button" class="sf-node-batch" disabled title="M2 接入">
              从收藏夹 / 稍后再看批量选择视频（M2 接入）
            </button>
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
              <Input
                class="h-8 text-xs"
                :model-value="data.outputName ?? ''"
                placeholder="如：校对稿"
                @update:model-value="(v: string | number) => patch({ outputName: String(v) })"
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
              <Input
                class="h-8 text-xs"
                :model-value="data.outputName ?? ''"
                placeholder="如：观点笔记"
                @update:model-value="(v: string | number) => patch({ outputName: String(v) })"
                @blur="commit"
              />
            </label>
            <label class="sf-node-field">
              <span class="sf-node-field-label">模型覆盖（可选）</span>
              <Input
                class="h-8 text-xs"
                :model-value="data.model ?? ''"
                placeholder="不填则跟随默认模型"
                @update:model-value="(v: string | number) => patch({ model: String(v) })"
                @blur="commit"
              />
            </label>
          </template>

          <template v-else-if="nodeType === 'process.merge'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">合并标题</span>
              <Input
                class="h-8 text-xs"
                :model-value="data.title ?? ''"
                placeholder="合并文档标题"
                @update:model-value="(v: string | number) => patch({ title: String(v) })"
                @blur="commit"
              />
            </label>
          </template>

          <template v-else-if="nodeType === 'process.output'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">输出文件名</span>
              <Input
                class="h-8 text-xs"
                :model-value="data.fileName ?? ''"
                placeholder="笔记.md"
                @update:model-value="(v: string | number) => patch({ fileName: String(v) })"
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
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out),
    background-color var(--dur-2) var(--ease-out);
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
  background: color-mix(in srgb, var(--color-brand) 3%, var(--color-surface));
  box-shadow: var(--shadow-card);
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
  height: 24px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}

.sf-node-title-input:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-border);
}

.sf-node-title-input:focus {
  outline: none;
  background: var(--color-surface);
  border-color: var(--color-brand);
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

.sf-node-preview {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.sf-node-preview--loading {
  justify-content: center;
  color: var(--color-text-tertiary);
  font-size: 11.5px;
}

.sf-node-preview--error {
  color: var(--color-error);
  font-size: 11.5px;
}

.sf-node-cover {
  width: 96px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  background: var(--color-ink-soft);
}

.sf-node-preview-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sf-node-preview-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.sf-node-preview-meta {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.sf-node-preview-page {
  font-size: 10.5px;
  color: var(--color-brand);
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

@keyframes sf-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}
</style>

<style>
/* 右键菜单经 Teleport 挂到 body：必须用全局样式，不能 scoped */
.sf-node-menu {
  z-index: var(--z-context);
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
</style>
