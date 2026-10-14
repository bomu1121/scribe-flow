<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElCheckbox } from "element-plus/es/components/checkbox/index.mjs";
import { ElDialog } from "element-plus/es/components/dialog/index.mjs";
import { ElInput } from "element-plus/es/components/input/index.mjs";
import { ElOption, ElOptionGroup, ElSelect } from "element-plus/es/components/select/index.mjs";
import { Link2 } from "lucide-vue-next";
import {
  aiPromptBlocks,
  buildTemplateGraph,
  extractBiliUrl,
  extractShareTitle,
  groupPromptBlocks,
  pageFromUrl,
  supportsSource,
  visibleTemplates,
  type BiliLinkSource,
  type PromptBlock,
  type RunMeta,
  type VideoPreview,
  type WorkflowTemplate,
} from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { fmtDuration } from "@/utils/run-segments";
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

/** 默认「单线笔记」+ 推荐的观点笔记：最常用的那条链路，回车即可。 */
const DEFAULT_TEMPLATE_ID = "template.single-note";
const DEFAULT_PROMPT_BLOCK_ID = "builtin.insight.v4";
const PREFS_KEY = "scribe-flow.quickCreate";
/** 留空表示不预选，进画布后在节点检查器里再选。 */
const NO_PROMPT = "";

interface QuickCreatePrefs {
  templateId: string;
  promptBlockId: string;
  /** 建好就立刻跑一遍。默认不勾——它会真的花掉模型调用，第一次不该替用户决定。 */
  runAfterCreate: boolean;
}

function readPrefs(): QuickCreatePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<QuickCreatePrefs>;
      return {
        templateId: typeof parsed.templateId === "string" ? parsed.templateId : DEFAULT_TEMPLATE_ID,
        promptBlockId: typeof parsed.promptBlockId === "string" ? parsed.promptBlockId : DEFAULT_PROMPT_BLOCK_ID,
        runAfterCreate: parsed.runAfterCreate === true,
      };
    }
  } catch {
    // 隐私模式/损坏状态：回到默认值
  }
  return { templateId: DEFAULT_TEMPLATE_ID, promptBlockId: DEFAULT_PROMPT_BLOCK_ID, runAfterCreate: false };
}

function writePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ templateId: templateId.value, promptBlockId: promptBlockId.value, runAfterCreate: runAfterCreate.value }),
    );
  } catch {
    // 隐私模式等场景静默降级
  }
}

/** 这里粘的是 B 站链接，所以只列支持 B 站来源的链路；展示范围里收起的节点整条链路都不出现。 */
const videoTemplates = computed<WorkflowTemplate[]>(() =>
  visibleTemplates(settingsStore.settings?.visibility?.hiddenNodes).filter((tpl) => supportsSource(tpl, "bili")),
);
/** 检索密钥没配时，需要联网核查的提示词不出现在可选列表里（跑出来只有一份没核查的清单）。 */
const searchReady = computed(() => Boolean(settingsStore.settings?.search.hasKey));
/** 与画布节点上的提示词下拉共用一份列表（`aiPromptBlocks`），两处能选到的提示词必须一致。 */
const promptOptions = computed(() => aiPromptBlocks(promptsStore.customBlocks, searchReady.value));
/**
 * 下拉里按系列分组。与画布卡片、设置页共用同一个分组口径（`groupPromptBlocks`）：
 * 单成员系列不挂分组标题——标题会和选项一模一样，等于同一行写两遍。
 */
const promptGroups = computed(() => groupPromptBlocks(promptOptions.value));

/** 选项文案：内置只写成员名（系列由分组标题承担），自己写的标一个「我的」。 */
function promptOptionLabel(block: PromptBlock): string {
  return block.builtin ? block.name : `${block.name} · 我的`;
}

const link = ref("");
const preview = ref<VideoPreview | null>(null);
const previewError = ref("");
const previewLoading = ref(false);
const creating = ref(false);
const templateId = ref(readPrefs().templateId);
const promptBlockId = ref(readPrefs().promptBlockId);
const runAfterCreate = ref(readPrefs().runAfterCreate);

const dialogVisible = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const selectedTemplate = computed(() => videoTemplates.value.find((tpl) => tpl.id === templateId.value));
/** 该链路落到 B 站来源时有没有「AI 加工」节点：没有的话提示词选择不生效（如思维导图、攻略加工自带提示词）。 */
const hasPromptNode = computed(
  () => buildTemplateGraph(templateId.value, { source: "bili" })?.nodes.some((node) => node.type === "process.prompt") ?? false,
);
/**
 * 这里选提示词有没有意义：要有「AI 加工」节点，且**节点自己没带提示词**。
 *
 * 有节点但块已经绑好的是「全提示词对照」——每条分支各绑一个（`buildTemplateGraph` 里模板写死的提示词优先），
 * 在这里选一个会以为生效了，其实一个都不会被覆盖。
 */
const promptSelectable = computed(() => {
  const nodes = buildTemplateGraph(templateId.value, { source: "bili" })?.nodes ?? [];
  return nodes.some((node) => node.type === "process.prompt" && !(node.data as { promptBlockId?: string }).promptBlockId);
});
/** 选择框下面那行小字：说明这里选的提示词会不会生效，以及为什么。 */
const promptHint = computed(() => {
  if (promptSelectable.value) return selectedBlock.value?.description || "该提示词没有说明文案，可在设置页查看正文。";
  return hasPromptNode.value
    ? "该链路的每条 AI 加工分支都已各自绑好提示词，这里选了不会覆盖（进画布可逐个改）。"
    : "该链路没有 AI 加工节点，加工节点自带提示词。";
});
const selectedBlock = computed(() => promptOptions.value.find((block) => block.id === promptBlockId.value));
/** 工程名将使用的标题：解析结果优先，其次分享文案里的【标题】。 */
const resolvedTitle = computed(() => normalizeTitle(preview.value?.title) || extractShareTitle(link.value));
const canSubmit = computed(() => link.value.trim().length > 0 && !creating.value);

let resolveTimer: ReturnType<typeof setTimeout> | null = null;
let resolveSeq = 0;

function normalizeTitle(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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
  runAfterCreate.value = prefs.runAfterCreate;
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    // 先拿到设置：可选提示词要看「有没有配检索密钥」，否则 reset 会挑出一个之后被过滤掉的提示词。
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
    const graph = buildTemplateGraph(templateId.value, {
      source: "bili",
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
    if (runAfterCreate.value) await startRun(project.id, project.name);
    else toast.success(`已按链路建好工程「${project.name}」`);
    await router.push(`/project/${project.id}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "创建工程失败");
  } finally {
    creating.value = false;
  }
}

/**
 * 建完直接起运行（scope 是整图，跟画布上那个「运行」按钮同一条路）。
 *
 * 密钥、来源节点空没空这些预检由服务端做（`apps/server/src/routes/runs.ts` 的 createRun），
 * 不在这儿重写一遍——两份判断迟早会漂。它拒了也不影响工程：照常跳进画布，
 * 补好设置再点一次运行即可。
 */
async function startRun(projectId: string, projectName: string) {
  try {
    await api.post<RunMeta>(`/api/projects/${projectId}/runs`, { scope: "all" });
    toast.success(`已建好工程「${projectName}」，正在运行`);
  } catch (err) {
    toast.error(`工程已建好，但没能开始运行：${err instanceof Error ? err.message : "启动运行失败"}`);
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
      :autosize="{ minRows: 2, maxRows: 6 }"
      resize="none"
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
          <template v-if="preview.duration"> · {{ fmtDuration(preview.duration) }}</template>
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
        <span class="qc-field-label">加工链路</span>
        <el-select v-model="templateId" size="default" class="qc-select">
          <el-option v-for="tpl in videoTemplates" :key="tpl.id" :label="tpl.name" :value="tpl.id" />
        </el-select>
        <span class="qc-field-hint">{{ selectedTemplate?.description }}</span>
      </label>

      <label class="qc-field">
        <span class="qc-field-label">AI 加工提示词</span>
        <el-select v-model="promptBlockId" size="default" class="qc-select" :disabled="!promptSelectable">
          <el-option label="不预选（进画布再选）" :value="NO_PROMPT" />
          <template v-for="group in promptGroups" :key="group.series">
            <el-option-group v-if="group.members.length > 1" :label="group.series">
              <el-option v-for="block in group.members" :key="block.id" :label="promptOptionLabel(block)" :value="block.id" />
            </el-option-group>
            <template v-else>
              <el-option v-for="block in group.members" :key="block.id" :label="promptOptionLabel(block)" :value="block.id" />
            </template>
          </template>
        </el-select>
        <span class="qc-field-hint">{{ promptHint }}</span>
      </label>
    </div>

    <div class="qc-run">
      <el-checkbox v-model="runAfterCreate">创建后立刻运行</el-checkbox>
      <span class="qc-field-hint">建好就按这条链路从来源节点跑到底（会消耗模型调用），进画布即可看进度</span>
    </div>

    <div class="np-foot">
      <span class="np-hint">链路、提示词与运行勾选都会记住：下次复制链接后打开这里，直接回车即可。</span>
      <div class="qc-actions">
        <el-button plain :disabled="creating" @click="close">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!canSubmit" @click="submit">创建并打开</el-button>
      </div>
    </div>
  </ElDialog>
</template>
