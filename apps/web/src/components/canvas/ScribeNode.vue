<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { ElInput, ElMessage, ElMessageBox, ElUpload, type UploadRequestOptions } from "element-plus";
import { PhBookOpenText, PhCloud, PhDotsThreeVertical, PhFileArrowDown, PhFileText, PhGitBranch, PhGitMerge, PhMagicWand, PhMicrophone, PhPlay, PhShareNetwork, PhSlidersHorizontal, PhSparkle, PhSwap, PhTreeStructure, PhUploadSimple, PhVideo } from "@phosphor-icons/vue";
import { Handle, Position, useVueFlow, type NodeProps } from "@vue-flow/core";
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from "reka-ui";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodeType, type UploadedFile, type VideoPreview } from "@scribe-flow/shared";
import ModelSelect from "../ModelSelect.vue";
import NodeFieldLabel from "./NodeFieldLabel.vue";
import IfCard from "./node-cards/IfCard.vue";
import TextToolCard from "./node-cards/TextToolCard.vue";
import ChapterCard from "./node-cards/ChapterCard.vue";
import RetryFields from "./node-cards/RetryFields.vue";
import ObsidianCard from "./node-cards/ObsidianCard.vue";
import { renderMarkdown } from "@/lib/markdown";
import { usePromptsStore } from "@/stores/prompts";
import { api } from "@/lib/api";
import type { ScribeNodeData } from "@/utils/flow";

const props = defineProps<NodeProps<ScribeNodeData>>();

const { viewport } = useVueFlow();
const flowZoom = computed(() => viewport.value.zoom);
const flowMenuStyle = computed(() => ({ zoom: String(flowZoom.value) }));
provide("sf-flow-zoom", flowZoom);

const promptsStore = usePromptsStore();
const data = computed(() => props.data);

const selectedPages = ref<number[]>([]);

const biliItems = computed(() => (Array.isArray(data.value.items) ? data.value.items : []));
const distinctBvids = computed(() => new Set(biliItems.value.map((item) => item.bvid)).size);
const isCollection = computed(() => biliItems.value.length > 1);

// 文本节点校验
const textError = computed(() => {
  const text = String(data.value.text ?? "");
  if (text.trim().length === 0) return "文稿不能为空";
  if (text.length > 50000) return "文稿过长（最多 50000 字）";
  return "";
});

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
        const savedPages = (data.value.items ?? []).map((item) => item.page).filter(Boolean);
        const savedPage = Number(data.value.pageInfo?.page ?? 0);
        const initial = result.pages.find((p) => p.page === savedPage) ?? result.pages[0];
        const restored = result.pages.filter((p) => savedPages.includes(p.page)).map((p) => p.page);
        selectedPages.value = restored.length > 0 ? restored : [initial.page];
        patch({ pageInfo: { cid: initial.cid, page: initial.page, part: initial.part, duration: initial.duration } });
      } else {
        selectedPages.value = [];
      }
    } catch (err) {
      previewError.value = err instanceof Error ? err.message : "解析失败，请检查链接";
    } finally {
      previewLoading.value = false;
    }
  }, 500);
}

function togglePage(page: number) {
  selectedPages.value = selectedPages.value.includes(page)
    ? selectedPages.value.filter((p) => p !== page)
    : [...selectedPages.value, page];
}

function confirmPageSelection() {
  const current = preview.value;
  if (!current || selectedPages.value.length === 0) return;
  const pages = current.pages.filter((p) => selectedPages.value.includes(p.page));
  if (pages.length === 0) return;
  const items = pages.map((page) => ({
    bvid: current.bvid,
    cid: page.cid,
    page: page.page,
    part: page.part,
    title: current.title,
    cover: current.cover,
    uploader: current.uploader,
    duration: page.duration,
  }));
  const first = items[0];
  patch({
    items,
    url: `https://www.bilibili.com/video/${current.bvid}`,
    bvid: current.bvid,
    title: current.title,
    cover: current.cover,
    uploader: current.uploader,
    duration: first.duration,
    pageInfo: { cid: first.cid, page: first.page, part: first.part, duration: first.duration },
  });
  props.data.ctx?.commit();
  ElMessage.success(items.length > 1 ? `已选择 ${items.length} 个分P，合并为一张卡片` : `已选择 P${first.page}`);
}

onMounted(() => {
  // 多选收藏卡片不需要解析“第一个视频”的预览，所有项平等展示。
  if (props.data.url && !isCollection.value) schedulePreview(props.data.url);
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

const nodeDescriptions: Record<NodeType, string> = {
  "source.bili": "粘贴 B 站视频或合集链接",
  "source.file": "上传或拖入本地音视频文件",
  "source.text": "粘贴已有文稿作为处理起点",
  "process.transcribe": "将音频/视频转写为文稿",
  "process.refine": "对文稿进行 AI 校对与修正",
  "process.prompt": "使用提示词块对文稿做 AI 加工",
  "process.merge": "将多个笔记块合并为一份文档",
  "process.output": "将结果保存为 Markdown 文件",
  "flow.if": "根据条件决定下游执行分支",
  "process.text": "查找替换、正则或模板等文本处理",
  "process.chapter": "将长文稿切分为章节笔记",
  "process.mindmap": "将文稿整理为思维导图 Markdown",
  "process.obsidian": "将结果写入 Obsidian 笔记库",
};

const nodeDescription = computed(() => nodeDescriptions[nodeType.value] ?? "");

const hasAdvanced = computed(() => ["process.transcribe", "process.refine", "process.prompt", "process.chapter", "process.mindmap"].includes(nodeType.value));
const advancedOpen = ref(false);

watch(
  () => props.selected,
  (selected) => {
    if (!selected) advancedOpen.value = false;
  },
);

function toggleAdvanced() {
  if (!hasAdvanced.value) return;
  advancedOpen.value = !advancedOpen.value;
}

const typeIcon = computed(() => {
  switch (nodeType.value) {
    case "source.bili":
      return PhVideo;
    case "source.file":
      return PhUploadSimple;
    case "source.text":
      return PhFileText;
    case "process.transcribe":
      return PhMicrophone;
    case "process.refine":
      return PhMagicWand;
    case "process.prompt":
      return PhSparkle;
    case "process.merge":
      return PhGitMerge;
    case "process.output":
      return PhFileArrowDown;
    case "flow.if":
      return PhGitBranch;
    case "process.text":
      return PhSwap;
    case "process.chapter":
      return PhTreeStructure;
    case "process.mindmap":
      return PhShareNetwork;
    case "process.obsidian":
      return PhBookOpenText;
  }
});

const statusClass = computed(() => (props.data.status ? `is-${props.data.status}` : "is-idle"));
const sizeClass = computed(() => `sf-node--${nodeType.value.replaceAll(".", "-")}`);

const canViewOutput = computed(() =>
  ["source.text", "process.transcribe", "process.refine", "process.prompt", "process.merge", "process.output", "flow.if", "process.text", "process.chapter", "process.mindmap", "process.obsidian"].includes(
    nodeType.value,
  ),
);

const hasResult = computed(() => Boolean(data.value.summary));
/** 方案 A+B：画布常态不展示正文；只有选中且已完成的节点才展开结构化摘要，完整内容仍走抽屉。 */
const canShowResultDetail = computed(() => props.selected && data.value.status === "done" && Boolean(data.value.preview) && canViewOutput.value);
const renderedResultDetail = computed(() => (data.value.preview ? renderMarkdown(data.value.preview) : ""));

function onNodeDoubleClick(event: MouseEvent) {
  if (!canViewOutput.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, button, select, [contenteditable], .el-upload, .el-select, .sf-model-select, .sf-node-run-btn")) return;
  props.data.ctx?.viewOutput();
}

const asrOptions = [
  { label: "MiMo-V2.5", value: "mimo", icon: PhMicrophone },
  { label: "OpenAI 兼容", value: "openai-compatible", icon: PhCloud },
];

const promptOptions = computed(() =>
  promptsStore.allBlocks.map((block) => {
    const parts = [block.name];
    if (block.version) parts.push(block.version);
    if (block.builtin) parts.push("内置");
    return { label: parts.join(" · "), value: block.id };
  }),
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

async function renameNode() {
  try {
    const { value } = await ElMessageBox.prompt("输入新的模块名称", "重命名模块", {
      inputValue: label.value,
      inputPattern: /\S+/,
      inputErrorMessage: "模块名称不能为空",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    const next = value.trim();
    if (!next || next === label.value) return;
    patch({ label: next });
    commit();
  } catch {
    // 用户取消时不处理
  }
}

function patchIf(value: ScribeNodeData["condition"]) {
  patch({ condition: value });
  commit();
}

function patchTextTool(value: Record<string, unknown>) {
  patch(value);
  commit();
}

function patchChapter(value: { granularity: ScribeNodeData["granularity"]; maxChapters: number }) {
  patch(value);
  commit();
}

function patchRetry(value: { maxRetries?: number; backoffMs?: number }) {
  patch({ retry: value });
  commit();
}

function patchMindMap(value: Record<string, unknown>) {
  patch(value);
  commit();
}

function patchObsidian(value: Record<string, unknown>) {
  patch(value);
  commit();
}

const branchSizeOptions = [
  { label: "自动（4-7 个）", value: "auto" },
  { label: "精简（3-5 个）", value: "few" },
  { label: "详细（6-9 个）", value: "many" },
];

const depthOptions = [
  { label: "3 层", value: "3" },
  { label: "4 层（推荐）", value: "4" },
  { label: "5 层", value: "5" },
];

const themeOptions = [
  { label: "纸面", value: "paper" },
  { label: "演示", value: "presentation" },
  { label: "学术", value: "academic" },
];
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div class="sf-node" :class="[statusClass, sizeClass, { 'is-selected': props.selected }]" @dblclick="onNodeDoubleClick">
        <Handle
          v-for="port in ports.inputs"
          :key="port.id"
          :id="port.id"
          type="target"
          :position="Position.Left"
          class="sf-handle sf-handle--target"
        />

        <div v-if="props.selected" class="sf-node-selection-bar">
          <div class="sf-node-selection-bar-left">
            <button
              type="button"
              class="sf-node-bar-btn"
              :class="{ active: advancedOpen }"
              :disabled="!hasAdvanced"
              :title="hasAdvanced ? (advancedOpen ? '收起高级设置' : '展开高级设置') : '该节点暂无高级设置'"
              @click.stop="toggleAdvanced"
              @dblclick.stop
            >
              <PhSlidersHorizontal :size="13" />
              <span>高级设置</span>
            </button>
          </div>
          <DropdownMenuRoot>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="sf-node-bar-more"
                title="更多操作"
                aria-label="更多操作"
                @click.stop
                @dblclick.stop
              >
                <PhDotsThreeVertical :size="15" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="sf-node-menu" side="bottom" align="start" :side-offset="6" :collision-padding="8" :style="flowMenuStyle">
                <DropdownMenuItem class="sf-node-menu-item" :disabled="props.data.ctx?.running" title="运行中不可启动新运行" @select="props.data.ctx?.runNode()">运行此节点</DropdownMenuItem>
                <DropdownMenuItem class="sf-node-menu-item" :disabled="props.data.ctx?.running" title="运行中不可启动新运行" @select="props.data.ctx?.runFromNode()">从此节点运行</DropdownMenuItem>
                <DropdownMenuSeparator class="sf-node-menu-sep" />
                <DropdownMenuItem class="sf-node-menu-item" @select="renameNode">重命名</DropdownMenuItem>
                <DropdownMenuItem class="sf-node-menu-item" @select="props.data.ctx?.duplicate()">复制</DropdownMenuItem>
                <DropdownMenuItem class="sf-node-menu-item" :disabled="true" title="M4 接入">复制输出</DropdownMenuItem>
                <DropdownMenuSeparator class="sf-node-menu-sep" />
                <DropdownMenuItem class="sf-node-menu-item sf-node-menu-item--danger" @select="props.data.ctx?.remove()">删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>

        <div class="sf-node-head">
          <div class="sf-node-head-top">
            <span class="sf-node-icon">
              <component :is="typeIcon" :size="17" />
            </span>
            <span class="sf-node-title" :title="label" :aria-label="`节点名称：${label}`">{{ label }}</span>
            <span class="sf-node-status" />
            <button
              type="button"
              class="sf-node-run-btn"
              :disabled="props.data.ctx?.running"
              :title="props.data.ctx?.running ? '运行中不可启动新运行' : '从此节点运行'"
              :aria-label="`从此节点运行 ${label}`"
              @click.stop="props.data.ctx?.runFromNode()"
              @dblclick.stop
            >
              <PhPlay :size="13" />
            </button>
          </div>
          <p class="sf-node-desc">{{ nodeDescription }}</p>
        </div>

        <div class="sf-node-body">
          <!-- 来源：B 站链接 / B 站多选收藏。多选时使用“平等列表”卡片，不再强调第一个视频。 -->
          <template v-if="nodeType === 'source.bili'">
            <template v-if="isCollection">
              <div class="sf-node-collection">
                <div class="sf-node-collection-head">
                  <span class="sf-node-collection-count tnum">{{ biliItems.length }} 项</span>
                  <span class="sf-node-collection-tag">{{ distinctBvids > 1 ? "多视频" : "多P" }}</span>
                </div>
                <div class="sf-node-selected-list">
                  <div v-for="item in biliItems" :key="`${item.bvid}-${item.cid}`" class="sf-node-selected-row">
                    <img v-if="item.cover" :src="item.cover" class="sf-node-selected-cover" alt="" referrerpolicy="no-referrer" loading="lazy" />
                    <div v-else class="sf-node-selected-cover sf-node-selected-cover--placeholder" />
                    <div class="sf-node-selected-info">
                      <span class="sf-node-selected-title">{{ item.title || item.part || `P${item.page}` }}</span>
                      <span class="sf-node-selected-meta tnum">
                        <template v-if="item.uploader">{{ item.uploader }} · </template>{{ fmtDuration(item.duration ?? 0) }}
                      </span>
                      <span v-if="item.part" class="sf-node-selected-part tnum">P{{ item.page }} · {{ item.part }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="sf-node-field">
                <NodeFieldLabel label="链接" hint="粘贴 B 站视频链接（支持分 P）；输入后自动解析封面、UP 主与分 P 信息" />
                <el-input
                  class="sf-node-control"
                  size="small"
                  :model-value="data.url"
                  placeholder="输入内容…"
                  @update:model-value="(v: string | number) => { const value = String(v); patch({ url: value }); schedulePreview(value); }"
                  @blur="commit"
                />
              </div>
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
              <div v-if="preview && preview.pages.length > 1" class="sf-node-pages">
                <div class="sf-node-pages-head">
                  <span class="sf-node-pages-title">选择分P（可多选）</span>
                  <button type="button" class="sf-node-pages-confirm" :disabled="selectedPages.length === 0" @click="confirmPageSelection">
                    生成所选分P
                  </button>
                </div>
                <label v-for="page in preview.pages" :key="page.page" class="sf-node-page">
                  <input type="checkbox" :checked="selectedPages.includes(page.page)" @change="togglePage(page.page)" />
                  <span class="sf-node-page-name">P{{ page.page }} · {{ page.part || `第 ${page.page} 集` }}</span>
                  <span class="sf-node-page-duration tnum">{{ fmtDuration(page.duration) }}</span>
                </label>
              </div>
            </template>
          </template>

          <template v-else-if="nodeType === 'source.file'">
            <div class="sf-node-field">
              <span class="sf-node-field-label">本地音视频</span>
              <el-upload
                class="sf-node-upload"
                drag
                :show-file-list="false"
                :http-request="uploadFile"
                accept=".mp4,.m4a,.mkv,.flv,.mov,.wav,.mp3,.aac,.webm,.m4v,audio/*,video/*"
              >
                <div class="sf-node-drop" :class="{ 'has-file': Boolean(data.fileName) }">
                  <PhUploadSimple :size="18" />
                  <span v-if="data.fileName" class="sf-node-file-name">{{ data.fileName }}</span>
                  <span v-else>点击或拖入本地音视频</span>
                </div>
              </el-upload>
            </div>
          </template>

          <template v-else-if="nodeType === 'source.text'">
            <div class="sf-node-field">
              <NodeFieldLabel label="已有文稿" hint="粘贴已有文稿，作为工作流的处理起点" />
              <el-input
                class="sf-node-textarea"
                type="textarea"
                :rows="6"
                :model-value="data.text"
                placeholder="输入内容…"
                @update:model-value="(v: string | number) => patch({ text: String(v) })"
                @blur="commit"
              />
            </div>
            <span v-if="textError" class="sf-node-text-error">{{ textError }}</span>
            <span v-else class="sf-node-text-count tnum">{{ String(data.text ?? '').length }} / 50000</span>
          </template>

          <template v-else-if="nodeType === 'process.transcribe'">
            <div class="sf-node-field">
              <span class="sf-node-field-label">ASR 引擎</span>
              <ModelSelect v-model="asrEngine" :options="asrOptions" size="small" placeholder="选择 ASR 引擎" :prefix-icon="PhMicrophone" />
            </div>
          </template>

          <template v-else-if="nodeType === 'process.refine'">
            <!-- AI 校对使用默认模型与默认校对提示词，节点内无需额外表单。 -->
          </template>

          <template v-else-if="nodeType === 'process.prompt'">
            <div class="sf-node-field">
              <span class="sf-node-field-label">提示词块</span>
              <ModelSelect
                v-model="promptBlockId"
                :options="promptOptions"
                size="small"
                clearable
                filterable
                placeholder="选择提示词块"
                :prefix-icon="PhSparkle"
              />
            </div>
          </template>

          <template v-else-if="nodeType === 'flow.if'">
            <IfCard :condition="data.condition" @update="patchIf" />
          </template>

          <template v-else-if="nodeType === 'process.text'">
            <TextToolCard
              :operation="data.operation"
              :find="data.find"
              :replace="data.replace"
              :pattern="data.pattern"
              :flags="data.flags"
              :template="data.template"
              @update="patchTextTool"
            />
          </template>

          <template v-else-if="nodeType === 'process.chapter'">
            <ChapterCard :granularity="data.granularity" :max-chapters="data.maxChapters" @update="patchChapter" />
          </template>

          <template v-else-if="nodeType === 'process.mindmap'">
            <label class="sf-node-field">
              <NodeFieldLabel label="导图标题（可选）" hint="留空时由 AI 自动提炼标题" />
              <el-input
                class="sf-node-control"
                size="small"
                :model-value="data.title ?? ''"
                placeholder="输入内容…"
                @update:model-value="(v: string | number) => patch({ title: String(v) })"
                @blur="commit"
              />
            </label>
            <div class="sf-node-field">
              <span class="sf-node-field-label">分支数量</span>
              <ModelSelect
                :model-value="data.branchSize ?? 'auto'"
                :options="branchSizeOptions"
                size="small"
                @update:model-value="(v: string) => patchMindMap({ branchSize: v as 'auto' | 'few' | 'many' })"
              />
            </div>
            <div class="sf-node-field">
              <span class="sf-node-field-label">层级上限</span>
              <ModelSelect
                :model-value="String(data.maxDepth ?? 4)"
                :options="depthOptions"
                size="small"
                @update:model-value="(v: string) => patchMindMap({ maxDepth: Number(v) })"
              />
            </div>
            <div class="sf-node-field">
              <span class="sf-node-field-label">主题</span>
              <ModelSelect
                :model-value="data.theme ?? 'paper'"
                :options="themeOptions"
                size="small"
                @update:model-value="(v: string) => patchMindMap({ theme: v as 'paper' | 'presentation' | 'academic' })"
              />
            </div>
          </template>

          <template v-else-if="nodeType === 'process.obsidian'">
            <ObsidianCard :folder="data.folder" @update="patchObsidian" />
          </template>

          <template v-else-if="nodeType === 'process.merge'">
            <label class="sf-node-field">
              <NodeFieldLabel label="合并标题" hint="合并后文档的标题" />
              <el-input
                class="sf-node-control"
                size="small"
                :model-value="data.title ?? ''"
                placeholder="输入内容…"
                @update:model-value="(v: string | number) => patch({ title: String(v) })"
                @blur="commit"
              />
            </label>
          </template>

          <template v-else-if="nodeType === 'process.output'">
            <label class="sf-node-field">
              <NodeFieldLabel label="输出文件名" hint="例如：笔记.md" />
              <el-input
                class="sf-node-control"
                size="small"
                :model-value="data.fileName ?? ''"
                placeholder="输入内容…"
                @update:model-value="(v: string | number) => patch({ fileName: String(v) })"
                @blur="commit"
              />
            </label>
          </template>

          <div v-if="hasAdvanced && advancedOpen" class="sf-node-advanced">
            <div class="sf-node-advanced-title">高级（失败重试）</div>
            <RetryFields :retry="data.retry" @update="patchRetry" />
          </div>
        </div>

        <div v-if="canShowResultDetail" class="sf-node-result-detail">
          <div class="sf-node-result-detail-text markdown-body" v-html="renderedResultDetail" />
          <button type="button" class="sf-node-result-detail-open" @click.stop="props.data.ctx?.viewOutput()">查看完整输出</button>
        </div>
        <div v-if="hasResult" class="sf-node-result" :class="data.status ? `is-${data.status}` : ''">
          <span v-if="data.status" class="sf-node-result-status" />
          <span class="sf-node-result-meta tnum">{{ data.summary }}</span>
          <span v-if="data.delta" class="sf-node-result-delta tnum" :class="`is-${data.delta.tone}`">{{ data.delta.label }}</span>
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
      <ContextMenuContent class="sf-node-menu" align="start" :side-offset="4" :collision-padding="8" :style="flowMenuStyle">
        <ContextMenuItem class="sf-node-menu-item" :disabled="props.data.ctx?.running" title="运行中不可启动新运行" @select="props.data.ctx?.runNode()">运行此节点</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="props.data.ctx?.running" title="运行中不可启动新运行" @select="props.data.ctx?.runFromNode()">从此节点运行</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item" @select="renameNode">重命名</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" @select="props.data.ctx?.duplicate()">复制</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M4 接入">复制输出</ContextMenuItem>
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
  border: 1.5px solid var(--node-border);
  border-radius: var(--node-radius);
  background: var(--color-surface);
  box-shadow: none;
  transition:
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out),
    background-color var(--dur-2) var(--ease-out);
}

.sf-node:hover {
  box-shadow: var(--shadow-card);
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
.sf-node--flow-if {
  width: 300px;
}
.sf-node--process-text {
  width: 260px;
}
.sf-node--process-chapter {
  width: 240px;
}
.sf-node--process-mindmap {
  width: 300px;
}
.sf-node--process-obsidian {
  width: 300px;
}

.sf-node.is-selected {
  border-color: var(--control-border-focus);
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

.sf-node.is-skipped {
  border-color: var(--color-border);
  opacity: 0.72;
}

.sf-node.is-skipped .sf-node-status {
  background: var(--color-text-tertiary);
}

.sf-node-selection-bar {
  position: absolute;
  top: -40px;
  left: -1.5px;
  right: -1.5px;
  z-index: var(--z-dropdown);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 32px;
  padding: 0 6px 0 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
}

.sf-node-selection-bar-left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.sf-node-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-node-bar-btn:hover:not(:disabled),
.sf-node-bar-btn.active {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-node-bar-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sf-node-bar-more {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-node-bar-more:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-node-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: -10px -12px 8px;
  padding: 8px 12px 10px;
  border-bottom: 1px solid var(--color-border);
}

.sf-node-head-top {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.sf-node-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
  flex-shrink: 0;
}

.sf-node-title {
  flex: 1;
  min-width: 0;
  height: 22px;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
  cursor: default;
  user-select: none;
}

.sf-node-desc {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.4;
  user-select: none;
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
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px -12px -12px;
  padding: 6px 12px;
  border: 0;
  border-radius: 0 0 calc(var(--node-radius) - 1px) calc(var(--node-radius) - 1px);
  background: var(--color-surface-muted);
}

.sf-node-result-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  flex-shrink: 0;
}

.sf-node-result.is-done .sf-node-result-status {
  background: var(--color-success);
}

.sf-node-result.is-error .sf-node-result-status {
  background: var(--color-error);
}

.sf-node-result.is-running .sf-node-result-status {
  background: var(--color-brand);
}

.sf-node-result.is-skipped .sf-node-result-status {
  background: var(--color-text-tertiary);
}

.sf-node-result-meta {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-node-result-delta {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 9.5px;
  line-height: 1.6;
  white-space: nowrap;
}

.sf-node-result-delta.is-same {
  background: var(--color-ink-soft);
  color: var(--color-text-tertiary);
}

.sf-node-result-delta.is-up {
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.sf-node-result-delta.is-down,
.sf-node-result-delta.is-changed {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.sf-node-result-delta.is-new {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.sf-node-result-detail {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

.sf-node-result-detail-text {
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  max-height: 120px;
  overflow: hidden;
  word-break: break-word;
}

.sf-node-result-detail-text :deep(p) {
  margin: 0 0 6px;
}

.sf-node-result-detail-text :deep(p:last-child) {
  margin-bottom: 0;
}

.sf-node-result-detail-open {
  display: inline-flex;
  align-items: center;
  margin-top: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-brand);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}

.sf-node-result-detail-open:hover {
  text-decoration: underline;
}

.sf-node-run-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-node-run-btn:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-node-run-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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

.sf-node-selected-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
  padding: 2px;
}

.sf-node-selected-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.sf-node-selected-cover {
  width: 96px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  flex-shrink: 0;
}

.sf-node-selected-cover--placeholder {
  background: var(--color-ink-soft);
}

.sf-node-selected-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sf-node-selected-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.sf-node-selected-meta {
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sf-node-selected-part {
  font-size: 10.5px;
  color: var(--color-brand);
}

.sf-node-collection {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sf-node-collection-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sf-node-collection-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.sf-node-collection-tag {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-size: 10px;
  line-height: 1.5;
}

.sf-node-pages {
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.sf-node-pages-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.sf-node-pages-title {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-node-pages-confirm {
  padding: 2px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.sf-node-pages-confirm:hover:not(:disabled) {
  border-color: var(--color-brand);
  color: var(--color-brand);
}

.sf-node-pages-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sf-node-page {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 2px;
  font-size: 11.5px;
  color: var(--color-text);
  cursor: pointer;
}

.sf-node-page-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-node-page-duration {
  color: var(--color-text-tertiary);
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

.sf-node-advanced {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.sf-node-advanced-title {
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-node-advanced-summary {
  font-size: 11px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  user-select: none;
}

.sf-node-advanced-summary:hover {
  color: var(--color-text-secondary);
}

.sf-node-select {
  width: 100%;
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
/* 右键/更多菜单经 Teleport 挂到 body：必须用全局样式，不能 scoped */
.sf-node-menu {
  z-index: var(--z-dropdown-modal);
  min-width: 196px;
  max-width: calc(100vw - 16px);
  max-height: min(420px, calc(100vh - 24px));
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
  transform-origin: var(--reka-popper-transform-origin, top center);
  animation: sf-dropdown-in var(--dur-2) var(--ease-out);
}

.sf-node-menu[data-state="closed"] {
  animation: sf-dropdown-out var(--dur-1) var(--ease-out);
}

.sf-node-menu-item {
  min-height: 32px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
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
