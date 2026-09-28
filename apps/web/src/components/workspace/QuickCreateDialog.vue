<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElButton, ElDialog, ElInput, ElOption, ElSelect } from "element-plus";
import { Link2 } from "lucide-vue-next";
import {
  WORKFLOW_TEMPLATES,
  availablePromptBlocks,
  bindablePromptBlocks,
  extractBiliUrl,
  extractShareTitle,
  instantiateTemplate,
  isBiliTemplate,
  pageFromUrl,
  type BiliLinkSource,
  type VideoPreview,
  type WorkflowTemplate,
} from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useProjectsStore } from "@/stores/projects";
import { usePromptsStore } from "@/stores/prompts";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  open: boolean;
  /** 创建位置：null/缺省为根层级。 */
  defaultFolderId?: string | null;
  /** 创建位置展示文案。 */
  folderLabel?: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
}>();

const router = useRouter();
const store = useProjectsStore();
const promptsStore = usePromptsStore();
const settingsStore = useSettingsStore();
const inputRef = ref<InstanceType<typeof ElInput> | null>(null);

/** 默认「视频转笔记（单线）」+ 推荐的观点提炼：最常用的那条链路，回车即可。 */
const DEFAULT_TEMPLATE_ID = "template.video-basic";
const DEFAULT_PROMPT_BLOCK_ID = "builtin.insight.v4";
const PREFS_KEY = "scribe-flow.quickCreate";
/** 留空表示不预选，进画布后在节点检查器里再选。 */
const NO_PROMPT = "";

interface QuickCreatePrefs {
  templateId: string;
  promptBlockId: string;
}

function readPrefs(): QuickCreatePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<QuickCreatePrefs>;
      return {
        templateId: typeof parsed.templateId === "string" ? parsed.templateId : DEFAULT_TEMPLATE_ID,
        promptBlockId: typeof parsed.promptBlockId === "string" ? parsed.promptBlockId : DEFAULT_PROMPT_BLOCK_ID,
      };
    }
  } catch {
    // 隐私模式/损坏状态：回到默认值
  }
  return { templateId: DEFAULT_TEMPLATE_ID, promptBlockId: DEFAULT_PROMPT_BLOCK_ID };
}

function writePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ templateId: templateId.value, promptBlockId: promptBlockId.value }));
  } catch {
    // 隐私模式等场景静默降级
  }
}

const videoTemplates = computed<WorkflowTemplate[]>(() => WORKFLOW_TEMPLATES.filter(isBiliTemplate));
/** 检索密钥没配时，需要联网核查的模版不出现在可选列表里（跑出来只有一份没核查的清单）。 */
const searchReady = computed(() => Boolean(settingsStore.settings?.search.hasKey));
const promptOptions = computed(() => availablePromptBlocks(bindablePromptBlocks(promptsStore.customBlocks), searchReady.value));

const link = ref("");
const preview = ref<VideoPreview | null>(null);
const previewError = ref("");
const previewLoading = ref(false);
const creating = ref(false);
const templateId = ref(readPrefs().templateId);
const promptBlockId = ref(readPrefs().promptBlockId);

const dialogVisible = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const selectedTemplate = computed(() => videoTemplates.value.find((tpl) => tpl.id === templateId.value));
/** 模版里没有 AI 加工节点时（如思维导图、攻略加工自带提示词），提示词选择不生效。 */
const hasPromptNode = computed(() => selectedTemplate.value?.graph.nodes.some((node) => node.type === "process.prompt") ?? false);
const selectedBlock = computed(() => promptOptions.value.find((block) => block.id === promptBlockId.value));
/** 工程名将使用的标题：解析结果优先，其次分享文案里的【标题】。 */
const resolvedTitle = computed(() => normalizeTitle(preview.value?.title) || extractShareTitle(link.value));
const canSubmit = computed(() => link.value.trim().length > 0 && !creating.value);

let resolveTimer: ReturnType<typeof setTimeout> | null = null;
let resolveSeq = 0;

function normalizeTitle(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function durationText(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 解析链接：拿标题/封面/UP主/分 P。失败不阻断创建，只是工程名与来源元信息退化为链接本身。 */
async function resolveLink(url: string): Promise<VideoPreview | null> {
  const seq = (resolveSeq += 1);
  previewLoading.value = true;
  previewError.value = "";
  try {
    const result = await api.post<VideoPreview>("/api/videos/preview", { url });
    if (seq !== resolveSeq) return null;
    preview.value = result;
    return result;
  } catch (err) {
    if (seq !== resolveSeq) return null;
    preview.value = null;
    previewError.value = err instanceof Error ? err.message : "解析失败";
    return null;
  } finally {
    if (seq === resolveSeq) previewLoading.value = false;
  }
}

/** 输入防抖解析：粘贴整段分享文案也只需要一秒内出结果。 */
function scheduleResolve() {
  if (resolveTimer) clearTimeout(resolveTimer);
  resolveSeq += 1;
  preview.value = null;
  previewError.value = "";
  previewLoading.value = false;
  const url = extractBiliUrl(link.value);
  if (!url) return;
  resolveTimer = setTimeout(() => {
    resolveTimer = null;
    void resolveLink(url);
  }, 450);
}

/** 打开时尝试读剪贴板里的 B 站链接。权限被拒（非安全上下文/未授权）就静默降级为手动粘贴。 */
async function readClipboardLink(): Promise<string> {
  try {
    if (!navigator.clipboard?.readText) return "";
    const text = await navigator.clipboard.readText();
    const trimmed = text.trim();
    if (!trimmed || !extractBiliUrl(trimmed)) return "";
    return trimmed.slice(0, 2000);
  } catch {
    return "";
  }
}

function reset() {
  if (resolveTimer) {
    clearTimeout(resolveTimer);
    resolveTimer = null;
  }
  resolveSeq += 1;
  link.value = "";
  preview.value = null;
  previewError.value = "";
  previewLoading.value = false;
  creating.value = false;
  const prefs = readPrefs();
  templateId.value = videoTemplates.value.some((tpl) => tpl.id === prefs.templateId) ? prefs.templateId : DEFAULT_TEMPLATE_ID;
  promptBlockId.value = promptOptions.value.some((block) => block.id === prefs.promptBlockId) ? prefs.promptBlockId : DEFAULT_PROMPT_BLOCK_ID;
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    // 先拿到设置：可选提示词块要看「有没有配检索密钥」，否则 reset 会挑出一个之后被过滤掉的块。
    await settingsStore.ensureLoaded();
    reset();
    void promptsStore.load();
    const pasted = await readClipboardLink();
    if (pasted) {
      link.value = pasted;
      scheduleResolve();
    }
    await nextTick();
    inputRef.value?.focus();
  },
);

/** 组装来源节点数据；解析失败时只写链接。 */
function buildBiliSource(url: string, info: VideoPreview | null): BiliLinkSource {
  const page = pageFromUrl(url);
  if (!info) return { url, page };
  const part = info.pages.find((item) => item.page === page) ?? info.pages[0];
  return {
    url: `https://www.bilibili.com/video/${info.bvid}`,
    page: part?.page ?? page,
    pageInfo: part ? { cid: part.cid, page: part.page, part: part.part, duration: part.duration } : undefined,
    bvid: info.bvid,
    title: info.title,
    cover: info.cover,
    uploader: info.uploader,
    duration: part?.duration ?? info.duration,
  };
}

function close() {
  if (creating.value) return;
  emit("update:open", false);
}

async function submit() {
  if (!canSubmit.value) return;
  const raw = link.value.trim();
  const url = extractBiliUrl(raw);
  if (!url) {
    toast.error("没识别到 B 站链接，需要 BV 号或视频链接");
    return;
  }

  creating.value = true;
  try {
    // 手快在防抖解析出结果前就回车：这里补一次同步解析，保证工程名拿到视频标题。
    let info = preview.value;
    if (!info && !previewError.value) {
      if (resolveTimer) {
        clearTimeout(resolveTimer);
        resolveTimer = null;
      }
      info = await resolveLink(url);
    }

    const title = normalizeTitle(info?.title) || extractShareTitle(raw);
    const name = (title || url).slice(0, 80);
    const graph = instantiateTemplate(templateId.value, {
      bili: buildBiliSource(url, info),
      promptBlockId: promptBlockId.value || undefined,
    });

    const project = graph
      ? await store.createProjectFromGraph({
          name,
          description: (info?.uploader ? `${info.uploader} · ` : "") + url,
          folderId: props.defaultFolderId ?? undefined,
          graph,
        })
      : await store.createProject({ name, templateId: templateId.value, folderId: props.defaultFolderId ?? undefined });

    writePrefs();
    emit("update:open", false);
    toast.success(`已按模版建好工程「${project.name}」`);
    await router.push(`/project/${project.id}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "创建工程失败");
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <ElDialog v-model="dialogVisible" title="粘贴链接建工程" width="560px" :close-on-click-modal="false" align-center append-to-body @closed="reset">
    <p v-if="folderLabel" class="np-location">创建位置：{{ folderLabel }}</p>
    <el-input
      ref="inputRef"
      v-model="link"
      class="qc-link"
      type="textarea"
      :rows="2"
      :maxlength="2000"
      placeholder="粘贴 B 站视频链接或 App 分享文案（【标题】+ 链接）"
      @input="scheduleResolve"
      @keydown.enter.prevent="submit"
    />

    <div v-if="previewLoading" class="qc-state">正在解析视频…</div>
    <div v-else-if="preview" class="qc-preview">
      <img v-if="preview.cover" class="qc-cover" :src="preview.cover" alt="" referrerpolicy="no-referrer" />
      <div class="qc-meta">
        <span class="qc-title">{{ preview.title }}</span>
        <span class="qc-sub">
          {{ preview.uploader }}
          <template v-if="preview.duration"> · {{ durationText(preview.duration) }}</template>
          <template v-if="preview.pages.length > 1"> · {{ preview.pages.length }} 个分 P</template>
        </span>
      </div>
    </div>
    <div v-else-if="previewError" class="qc-state qc-state--error">
      没解析出视频信息（{{ previewError }}）。仍可先建工程，链接会写进来源节点。
    </div>

    <p v-if="resolvedTitle" class="qc-name">
      <Link2 :size="12" />工程名将使用视频标题「{{ resolvedTitle }}」
    </p>

    <div class="qc-fields">
      <label class="qc-field">
        <span class="qc-field-label">加工模版</span>
        <el-select v-model="templateId" size="default" class="qc-select">
          <el-option v-for="tpl in videoTemplates" :key="tpl.id" :label="tpl.name" :value="tpl.id" />
        </el-select>
        <span class="qc-field-hint">{{ selectedTemplate?.description }}</span>
      </label>

      <label class="qc-field">
        <span class="qc-field-label">AI 加工提示词</span>
        <el-select v-model="promptBlockId" size="default" class="qc-select" :disabled="!hasPromptNode">
          <el-option label="不预选（进画布再选）" :value="NO_PROMPT" />
          <el-option v-for="block in promptOptions" :key="block.id" :label="block.name" :value="block.id" />
        </el-select>
        <span class="qc-field-hint">
          {{ hasPromptNode ? selectedBlock?.description || "该块没有说明文案，可在设置页查看正文。" : "该模版没有 AI 加工节点，加工节点自带提示词。" }}
        </span>
      </label>
    </div>

    <div class="np-foot">
      <span class="np-hint">模版与提示词会记住上次的选择：下次复制链接后打开这里，直接回车即可。</span>
      <div class="qc-actions">
        <el-button plain :disabled="creating" @click="close">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!canSubmit" @click="submit">创建并打开</el-button>
      </div>
    </div>
  </ElDialog>
</template>
