<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElInput, ElMessage, ElOption, ElSelect, ElUpload, type UploadRequestOptions } from "element-plus";
import { Cloud, Eye, FileOutput, FileText, FileUp, GitMerge, Link2, Mic, Sparkles, WandSparkles } from "lucide-vue-next";
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger } from "reka-ui";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodeType, type UploadedFile, type VideoPreview } from "@scribe-flow/shared";
import SourcePickerDialog from "./SourcePickerDialog.vue";
import ModelSelect from "../ModelSelect.vue";
import { usePromptsStore } from "@/stores/prompts";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";
import type { ScribeNodeData } from "@/utils/flow";

const props = defineProps<NodeProps<ScribeNodeData>>();

const promptsStore = usePromptsStore();
const authStore = useAuthStore();
const data = computed(() => props.data);

const showPicker = ref(false);

// 文本节点校验
const textError = computed(() => {
  const text = String(data.value.text ?? "");
  if (text.trim().length === 0) return "文稿不能为空";
  if (text.length > 50000) return "文稿过长（最多 50000 字）";
  return "";
});

function openPicker() {
  if (!authStore.loggedIn) {
    ElMessage.info("请先点击左下角「未登录 B 站」扫码登录");
    return;
  }
  showPicker.value = true;
}

function onPickerConfirm(videos: import("@scribe-flow/shared").SourceVideoItem[]) {
  props.data.ctx?.addSourceVideos(videos);
  ElMessage.success(`已添加 ${videos.length} 个视频来源`);
}

async function uploadFile(options: UploadRequestOptions) {
  const form = new FormData();
  form.append("file", options.file);
  try {
    const result = await api.upload<UploadedFile>("/api/files/upload", form);
    patch({ fileId: result.fileId, fileName: result.fileName, filePath: result.storedPath, size: result.size });
    commit();
    ElMessage.success(`已上传「${result.fileName}」`);
    options.onSuccess?.(result);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "上传失败");
    (options.onError as ((error: unknown) => void) | undefined)?.(err);
  }
}

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
      const bvid = result.bvid || value.match(/BV[0-9A-Za-z]+/)?.[0] || "";
      patch({
        bvid,
        title: result.title,
        cover: result.cover,
        uploader: result.uploader,
        duration: result.duration,
      });
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

const canViewOutput = computed(() =>
  ["source.text", "process.transcribe", "process.refine", "process.prompt", "process.merge", "process.output"].includes(nodeType.value),
);

const asrOptions = [
  { label: "MiMo-V2.5", value: "mimo", icon: Mic },
  { label: "OpenAI 兼容", value: "openai-compatible", icon: Cloud },
];

const promptOptions = computed(() =>
  promptsStore.allBlocks.map((block) => ({ label: `${block.name}${block.builtin ? "（内置）" : ""}`, value: block.id })),
);

const asrEngine = computed<string>({
  get: () => (data.value.asrEngine as string | undefined) ?? "mimo",
  set: (value) => {
    patch({ asrEngine: value });
    commit();
  },
});

const promptBlockId = computed<string | undefined>({
  get: () => data.value.promptBlockId,
  set: (value) => {
    patch({ promptBlockId: value || undefined });
    commit();
  },
});

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
          <button
            v-if="canViewOutput"
            type="button"
            class="sf-node-output-btn"
            :title="`查看 ${label} 的输出`"
            :aria-label="`查看 ${label} 的输出`"
            @click.stop="props.data.ctx?.viewOutput()"
          >
            <Eye :size="13" />
          </button>
          <span class="sf-node-status" />
        </div>

        <div class="sf-node-body">
          <!-- 来源：B 站链接。卡片做大，容纳批量选视频入口 -->
          <template v-if="nodeType === 'source.bili'">
            <el-input
              class="sf-node-control"
              size="small"
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
            <button type="button" class="sf-node-batch" @click="openPicker">
              从收藏夹 / 我的合集 / 稍后再看 / 历史批量选择视频
            </button>
          </template>

          <template v-else-if="nodeType === 'source.file'">
            <el-upload
              class="sf-node-upload"
              drag
              :show-file-list="false"
              :http-request="uploadFile"
              accept=".mp4,.m4a,.mkv,.flv,.mov,.wav,.mp3,.aac,.webm,.m4v,audio/*,video/*"
            >
              <div class="sf-node-drop" :class="{ 'has-file': Boolean(data.fileName) }">
                <FileUp :size="18" />
                <span v-if="data.fileName" class="sf-node-file-name">{{ data.fileName }}</span>
                <span v-else>点击或拖入本地音视频</span>
              </div>
            </el-upload>
          </template>

          <template v-else-if="nodeType === 'source.text'">
            <el-input
              class="sf-node-textarea"
              type="textarea"
              :rows="6"
              :model-value="data.text"
              placeholder="粘贴已有文稿…"
              @update:model-value="(v: string | number) => patch({ text: String(v) })"
              @blur="commit"
            />
            <span v-if="textError" class="sf-node-text-error">{{ textError }}</span>
            <span v-else class="sf-node-text-count tnum">{{ String(data.text ?? '').length }} / 50000</span>
          </template>

          <template v-else-if="nodeType === 'process.transcribe'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">ASR 引擎</span>
              <ModelSelect v-model="asrEngine" :options="asrOptions" size="small" placeholder="选择 ASR 引擎" :prefix-icon="Mic" />
            </label>
          </template>

          <template v-else-if="nodeType === 'process.refine'">
            <label class="sf-node-field">
              <span class="sf-node-field-label">输出名称</span>
              <el-input
                class="sf-node-control"
                size="small"
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
              <el-select
                v-model="promptBlockId"
                class="sf-node-select"
                size="small"
                clearable
                filterable
                placeholder="选择提示词块"
              >
                <el-option v-for="option in promptOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </label>
            <label class="sf-node-field">
              <span class="sf-node-field-label">输出名称</span>
              <el-input
                class="sf-node-control"
                size="small"
                :model-value="data.outputName ?? ''"
                placeholder="如：观点笔记"
                @update:model-value="(v: string | number) => patch({ outputName: String(v) })"
                @blur="commit"
              />
            </label>
            <label class="sf-node-field">
              <span class="sf-node-field-label">模型覆盖（可选）</span>
              <el-input
                class="sf-node-control"
                size="small"
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
              <el-input
                class="sf-node-control"
                size="small"
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
              <el-input
                class="sf-node-control"
                size="small"
                :model-value="data.fileName ?? ''"
                placeholder="笔记.md"
                @update:model-value="(v: string | number) => patch({ fileName: String(v) })"
                @blur="commit"
              />
            </label>
            <div class="sf-node-output-preview">{{ data.summary ?? "输出预览（运行后显示）" }}</div>
          </template>
        </div>

        <div v-if="data.summary || data.preview" class="sf-node-result">
          <div v-if="data.preview" class="sf-node-result-preview">{{ data.preview }}</div>
          <div v-if="data.summary" class="sf-node-result-meta tnum">{{ data.summary }}</div>
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
        <ContextMenuItem class="sf-node-menu-item" @select="props.data.ctx?.runNode()">运行此节点</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" @select="props.data.ctx?.runFromNode()">从此节点运行</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item" @select="props.data.ctx?.duplicate()">复制</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M4 接入">复制输出</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item sf-node-menu-item--danger" @select="props.data.ctx?.remove()">删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
    <SourcePickerDialog v-model:open="showPicker" @confirm="onPickerConfirm" />
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
  box-shadow: var(--shadow-card);
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
  box-shadow: var(--shadow-overlay);
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

.sf-node-result {
  margin-top: 8px;
  padding: 7px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

.sf-node-result-preview {
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.sf-node-result-meta {
  margin-top: 4px;
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.sf-node-output-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}

.sf-node-output-btn:hover {
  border-color: var(--color-brand-border);
  background: var(--color-brand-soft);
  color: var(--color-brand);
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
  min-height: 40px;
  padding: 8px 10px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-node-batch:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
  background: var(--color-brand-soft);
}

.sf-node-upload {
  width: 100%;
}

.sf-node-upload :deep(.el-upload) {
  width: 100%;
}

.sf-node-upload :deep(.el-upload-dragger) {
  width: 100%;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
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
  font-size: 12px;
}

.sf-node-drop.has-file {
  border-style: solid;
  border-color: var(--color-brand-border);
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.sf-node-file-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-node-control {
  width: 100%;
}

.sf-node-textarea {
  width: 100%;
}

.sf-node-textarea :deep(.el-textarea__inner) {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.sf-node-text-error {
  font-size: 11px;
  color: var(--color-error);
}

.sf-node-text-count {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  text-align: right;
}

.sf-node-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.sf-node-field-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-node-select {
  width: 100%;
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
