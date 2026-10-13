<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import type { Component } from "vue";
import { useRoute } from "vue-router";
import { ElCollapse, ElCollapseItem } from "element-plus/es/components/collapse/index.mjs";
import { ElInput } from "element-plus/es/components/input/index.mjs";
import { ElInputNumber } from "element-plus/es/components/input-number/index.mjs";
import { ElRadioButton, ElRadioGroup } from "element-plus/es/components/radio/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { ElOption, ElOptionGroup, ElSelect } from "element-plus/es/components/select/index.mjs";
import { ElSwitch } from "element-plus/es/components/switch/index.mjs";
import { Calendar, CircleAlert, CircleCheck, Cloud, Contrast, Copy, Download, ExternalLink, FolderOpen, Link2, List, ListChecks, Loader2, Mic, MoreHorizontal, Palette, PlugZap, Plus, RefreshCw, RotateCcw, Save, Tag, Trash2, Type, Upload, X } from "lucide-vue-next";
import { toast } from "@/lib/toast";
import { ensureNotifyPermission } from "@/utils/run-alert";
import { formatBytes } from "@/lib/bytes";
import ModelSelect from "../components/ModelSelect.vue";
import PromptBlockDiffDialog from "../components/PromptBlockDiffDialog.vue";
import type { AiProvider, AsrEngine, DataOverview, NodeType, TagViewMode, ObsidianVaultCheck, PruneItem, PruneOutcome, PruneTarget, PromptBlock, RelatedJobView, RelatedNoteMode, RelatedPlanView, RetagJobView, RetagPlanView, SearchProvider, TagTaxonomy } from "@scribe-flow/shared";
import { COMMON_EXTRACT_FIELDS, DEFAULT_TAG_VIEW, EXTRACT_FIELD_PRESETS, FILE_NAME_TOKENS, GENERAL_LIMITS, MAX_EXTRACT_FIELDS, NODE_TYPE_LABELS, NODE_TYPE_ORDER, RELATED_SECTION_TITLE, SOURCE_TAXONOMY_GROUP, TAG_VIEW_MODES, TRACE_SOURCE_AUTHORITY_LABELS, UP_TAXONOMY_GROUP, addTagToTaxonomy, backupLocationOf, normalizeTagSegment, renderFileNameTemplate, tagGroupTone, writableTags } from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useDelayedBusy } from "@/utils/busy";
import { useSettingsStore } from "@/stores/settings";
import { usePromptsStore } from "@/stores/prompts";
import { useRunsStore } from "@/stores/runs";

const store = useSettingsStore();
const promptsStore = usePromptsStore();
const runsStore = useRunsStore();
const route = useRoute();

const groups = [
  { key: "ai", label: "AI 模型" },
  { key: "asr", label: "语音识别" },
  { key: "search", label: "联网检索" },
  { key: "general", label: "常规" },
  { key: "visibility", label: "展示范围" },
  { key: "obsidian", label: "Obsidian" },
  { key: "nutstore", label: "坚果云" },
  { key: "prompts", label: "提示词块库" },
  { key: "data", label: "数据与工程" },
] as const;

type GroupKey = (typeof groups)[number]["key"];
const active = ref<GroupKey>("ai");

const form = reactive({
  aiProvider: "deepseek" as AiProvider,
  aiBaseUrl: "",
  aiModel: "",
  aiKey: "",
  asrEngine: "mimo" as AsrEngine,
  asrBaseUrl: "",
  asrModel: "",
  asrKey: "",
  searchProvider: "zhipu" as SearchProvider,
  searchKey: "",
  searchMaxResults: 5,
  concurrency: 2,
  outputDir: "outputs",
  fileNameTemplate: "{project}",
  maxRetries: 2,
  retryBackoffSec: 3,
  runEndNotify: true,
  runEndSound: false,
  hiddenNodes: [] as NodeType[],
  obsidianVaultPath: "",
  obsidianFolder: "00-Inbox",
  /** 词库编辑器的显示样式（纯展示）：三种由用户自己挑，见 TAG_VIEW_MODES。 */
  obsidianTagView: DEFAULT_TAG_VIEW as TagViewMode,
  obsidianAutoTagEnabled: true,
  /** 两个自动标签的开关（来源 / UP 主）：标签由元数据写，用户只决定写不写。 */
  obsidianSourceTagEnabled: true,
  obsidianUpTagEnabled: true,
  obsidianAllowNewTags: false,
  obsidianExtractFields: [] as string[],
  obsidianTagMinCount: 5,
  obsidianTagMaxCount: 10,
  obsidianAutoLinkEnabled: true,
  obsidianAutoLinkMax: 5,
  nutstoreServerUrl: "https://dav.jianguoyun.com/dav/",
  nutstoreAccount: "",
  nutstorePassword: "",
  nutstoreBackupDir: "/我的坚果云/ScribeFlow/backups",
  nutstoreObsidianRemotePath: "/我的坚果云/ScribeFlow/Obsidian",
  nutstoreObsidianMode: false,
});

const DEEPSEEK_DEFAULT_MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;
const aiModelOptions = ref<string[]>([...DEEPSEEK_DEFAULT_MODELS]);
const aiModelLoading = ref(false);
const aiTesting = ref(false);
const asrTesting = ref(false);
const searchTesting = ref(false);
const nutstoreTesting = ref(false);

watch(
  () => form.aiKey,
  (value) => {
    store.aiKeyDraft = value ?? "";
  },
);
watch(
  () => form.asrKey,
  (value) => {
    store.asrKeyDraft = value ?? "";
  },
);

const aiProviderOptions = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "OpenAI", value: "openai" },
  { label: "自定义", value: "custom" },
];

const asrOptions = [
  { label: "MiMo-V2.5（小米）", value: "mimo", icon: Mic },
  { label: "OpenAI 兼容", value: "openai-compatible", icon: Cloud },
];

const searchProviderOptions: { label: string; value: SearchProvider; keyPlaceholder: string }[] = [
  { label: "智谱 BigModel", value: "zhipu", keyPlaceholder: "在 open.bigmodel.cn 的 API Keys 页创建" },
  { label: "Tavily", value: "tavily", keyPlaceholder: "tvly-…" },
];

const searchKeyPlaceholder = computed(
  () => searchProviderOptions.find((opt) => opt.value === form.searchProvider)?.keyPlaceholder ?? "API Key",
);

const blockForm = reactive({ id: "", name: "", prompt: "" });
const expandedBlockId = ref<string | null>(null);
const compareDialogOpen = ref(false);
const compareInitialBlockId = ref("");
const dataInfo = ref<DataOverview | null>(null);
const dataLoading = ref(false);
const dataError = ref("");
const revealTesting = ref(false);
const pruneRunning = ref<PruneTarget | "all" | "">("");
const pruneOutcomes = ref<PruneOutcome[]>([]);
const nutstoreRemoteFolders = ref<string[]>([]);
const nutstoreRemoteFiles = ref<Array<{ path: string; name: string; type: "folder" | "file"; size?: number; lastModified?: number }>>([]);
const nutstoreReading = ref(false);
const nutstoreSyncing = ref(false);
const nutstoreBackingUp = ref(false);
const nutstoreRestoring = ref(false);
const nutstoreBackups = ref<Array<{ path: string; name: string; lastModified?: number }>>([]);
const remotePreview = ref<{ path: string; content: string } | null>(null);
const nutstoreResult = ref<{
  action: string;
  detail?: string;
  transferred?: number;
  skipped?: number;
  skippedItems?: Array<{ path: string; reason: string }>;
  errors?: Array<{ path: string; message: string }>;
  items?: string[];
} | null>(null);

/* ---------------------------------------------------- 标签词库与全库重打标 */

const taxonomy = ref<TagTaxonomy>({});
/** 每个一级下面「新增二级」输入框的草稿，键是一级名。 */
const newChildDraft = reactive<Record<string, string>>({});
const newGroupName = ref("");
const retagDeep = ref(false);
const retagPlanning = ref(false);
const retagRunning = ref(false);
const retagPlan = ref<RetagPlanView | null>(null);
const retagJob = ref<RetagJobView | null>(null);

/* ---------------------------------------- 词库那一块的显示与编辑状态（纯界面，不进设置） */

/**
 * 三种显示样式的图标。图标模式下按钮上只有图标，所以名字走两条路：
 * 鼠标是 `title`（`${label}：${hint}`），读屏是按钮里那段 `.sf-visually-hidden` 文字。
 * 「彩色标记 / 单色」用调色板与黑白圆（lucide 的 Contrast）配成一对，清单用 List。
 */
const TAG_VIEW_ICONS: Record<TagViewMode, Component> = {
  color: Palette,
  plain: Contrast,
  list: List,
};

/** 正在改名的那一个二级：{ 一级, 下标 }。 */
const editingTag = ref<{ group: string; index: number } | null>(null);
/** 正在输入新二级的那个一级（同一时刻只开一个：常驻输入框是这一块原来 880px 的主因）。 */
const addingInGroup = ref("");
/** 组头 ⋯ 菜单展开的是哪一个一级。 */
const groupMenu = ref("");
/** 收起来的一级（默认全展开——词库通常没几组，全展开更好扫）。 */
const collapsedGroups = ref<string[]>([]);
/** 拖拽中的二级与当前悬停的目标，键都是一级名 + 下标。 */
const draggingTag = ref<{ group: string; index: number } | null>(null);
const dragOverTag = ref<{ group: string; index: number } | null>(null);

/** 一个二级标签被多少篇笔记用过（拿不到就是 null，界面就不显示这个数字）。 */
function tagUsage(group: string, child: string): number | null {
  const hit = store.obsidianTagUsage.find((item) => item.tag === `${group}/${child}` || item.tag === child);
  return hit ? hit.count : null;
}

/** 一级的合计用量：判断"这一组整体有没有人用"比单个标签更常用。 */
function groupUsage(group: string): number | null {
  const children = taxonomy.value[group] ?? [];
  if (children.length === 0) return null;
  const counts = children.map((child) => tagUsage(group, child));
  if (counts.every((count) => count === null)) return null;
  return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

function groupToneOf(_group: string, index: number) {
  return tagGroupTone(index);
}

function isCollapsed(group: string): boolean {
  return collapsedGroups.value.includes(group);
}

function toggleGroupCollapsed(group: string): void {
  collapsedGroups.value = isCollapsed(group)
    ? collapsedGroups.value.filter((item) => item !== group)
    : [...collapsedGroups.value, group];
}

function startAddChild(group: string): void {
  addingInGroup.value = group;
  groupMenu.value = "";
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`.sf-tag-add-input[data-group="${CSS.escape(group)}"] input`);
    input?.focus();
  });
}

function startRenameWith(group: string, index: number, current: string): void {
  renameDraft.value = current;
  startRename(group, index);
}

/** 一级改名：改的是键，所以整支内容要搬过去（与节点改名同一套对话框，不用原生 prompt）。 */
async function renameGroup(group: string): Promise<void> {
  groupMenu.value = "";
  try {
    const { value } = await ElMessageBox.prompt("新的一级名", `重命名「${group}」`, {
      inputValue: group,
      inputPattern: /S+/,
      inputErrorMessage: "一级名不能为空",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    const next = normalizeTagSegment(value ?? "");
    if (!next || next === group) return;
    if (Object.prototype.hasOwnProperty.call(taxonomy.value, next)) {
      toast.error(`一级「${next}」已存在`);
      return;
    }
    const moved: TagTaxonomy = {};
    for (const [key, child] of Object.entries(taxonomy.value)) {
      moved[key === group ? next : key] = child;
    }
    taxonomy.value = moved;
  } catch {
    /* 取消：什么都不做 */
  }
}

function startRename(group: string, index: number): void {
  editingTag.value = { group, index };
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`.sf-tag-chip--editing input`);
    input?.focus();
    input?.select();
  });
}

/** 改名提交：留空＝放弃（改名是"改"，不是"删"）。 */
function commitRename(): void {
  const target = editingTag.value;
  editingTag.value = null;
  if (!target) return;
  const draft = (renameDraft.value ?? "").trim();
  const children = taxonomy.value[target.group] ?? [];
  const current = children[target.index];
  if (!draft || current === undefined || draft === current) {
    renameDraft.value = "";
    return;
  }
  const name = normalizeTagSegment(draft);
  if (!name) {
    toast.error("标签名不能为空，也不能是纯数字");
    renameDraft.value = "";
    return;
  }
  if ((taxonomy.value[target.group] ?? []).some((item, index) => index !== target.index && item === name)) {
    toast.error(`「${target.group}/${name}」已存在`);
    renameDraft.value = "";
    return;
  }
  reorderChild(target.group, target.index, target.index, name);
  renameDraft.value = "";
}

/** 改名草稿：开始改名时填上当前值。 */
const renameDraft = ref("");

/** 组内移动（键盘 Alt+↑/↓ 与拖拽共用）：到边界就停，不循环。 */
function moveChild(group: string, index: number, delta: number): void {
  const to = index + delta;
  const children = taxonomy.value[group] ?? [];
  if (to < 0 || to >= children.length) return;
  reorderChild(group, index, to);
}

/**
 * 把某个二级挪到别的位置（`next` 传了就是改名）。
 *
 * 一个函数管改名与移动：两者都是"列表里的一项换了内容/位置"，
 * 分成两条路径会让"改名后再删"那类 bug 复活（上一版原型就是这么坏的）。
 */
function reorderChild(group: string, from: number, to: number, next?: string): void {
  const children = [...(taxonomy.value[group] ?? [])];
  const moved = children[from];
  if (moved === undefined) return;
  children.splice(from, 1);
  children.splice(to, 0, next ?? moved);
  taxonomy.value = { ...taxonomy.value, [group]: children };
}

function onTagDragStart(group: string, index: number, event: DragEvent): void {
  draggingTag.value = { group, index };
  event.dataTransfer?.setData("text/plain", `${group}/${index}`);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onTagDrop(group: string, index: number): void {
  const from = draggingTag.value;
  dragOverTag.value = null;
  draggingTag.value = null;
  if (!from || from.group !== group || from.index === index) return;
  reorderChild(group, from.index, index);
}


/** 词库或库路径有未保存的改动：服务端读的是已保存的设置，没保存就重打标会用错口径。 */
const obsidianDirty = computed(() => {
  const saved = store.settings?.obsidian;
  if (!saved) return false;
  return (
    form.obsidianVaultPath.trim() !== saved.vaultPath.trim() ||
    JSON.stringify(taxonomy.value) !== JSON.stringify(saved.tagTaxonomy ?? {})
  );
});

function addGroup(): void {
  const name = normalizeTagSegment(newGroupName.value);
  if (!name) {
    toast.error("一级名称不能为空，也不能是纯数字（Obsidian 不把纯数字当标签）");
    return;
  }
  if (Object.prototype.hasOwnProperty.call(taxonomy.value, name)) {
    toast.error(`一级「${name}」已存在`);
    return;
  }
  taxonomy.value = { ...taxonomy.value, [name]: [] };
  newGroupName.value = "";
}

function removeGroup(group: string): void {
  const next = { ...taxonomy.value };
  delete next[group];
  taxonomy.value = next;
}

function addChild(group: string): void {
  const name = normalizeTagSegment(newChildDraft[group] ?? "");
  if (!name) {
    toast.error("二级名称不能为空，也不能是纯数字");
    return;
  }
  const next = addTagToTaxonomy(taxonomy.value, group, name);
  if (next === taxonomy.value) {
    toast.error(`「${group}/${name}」已存在`);
    return;
  }
  taxonomy.value = next;
  newChildDraft[group] = "";
}

function removeChild(group: string, child: string): void {
  taxonomy.value = { ...taxonomy.value, [group]: (taxonomy.value[group] ?? []).filter((item) => item !== child) };
}

/**
 * 复制一个标签在 Obsidian 里的搜索串。
 *
 * 「合集」不在这个工具里做：Obsidian 的标签搜索本身就是合集（零配置、不用装插件）。
 * 用户卡在"我该在 Obsidian 里输什么"，所以把这条串直接给到手上。
 */
async function copyTagSearch(group: string, child?: string): Promise<void> {
  const tag = child ? `${group}/${child}` : group;
  await copyText(`tag:#${tag}`, `已复制：tag:#${tag}`);
}

/** 同 `refreshRelatedPlan`：保留旧结果，只压暗，避免点一下抖动一次。 */
async function refreshRetagPlan(): Promise<void> {
  if (retagPlanning.value) return;
  retagPlanning.value = true;
  try {
    retagPlan.value = await api.post<RetagPlanView>("/api/taxonomy/plan", { deep: retagDeep.value });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "预估失败");
  } finally {
    retagPlanning.value = false;
  }
}

async function startRetag(): Promise<void> {
  retagRunning.value = true;
  retagJob.value = null;
  try {
    const created = await api.post<{ jobId: string }>("/api/taxonomy/run", { deep: retagDeep.value });
    await pollRetag(created.jobId);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "重打标启动失败");
    retagRunning.value = false;
  }
}

/**
 * 轮询重打标进度。仓库里 SSE 只服务「运行」，这个任务照 media 的 jobId 轮询形态做，
 * 不为了它新开一条事件通道。
 */
async function pollRetag(jobId: string): Promise<void> {
  const deadline = Date.now() + 30 * 60_000;
  let failure: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    let job: RetagJobView;
    try {
      job = await api.get<RetagJobView>(`/api/taxonomy/jobs/${jobId}`);
    } catch (err) {
      failure = err instanceof Error ? err.message : "查询重打标进度失败";
      break;
    }
    retagJob.value = job;
    if (job.status === "running") continue;
    retagRunning.value = false;
    if (job.status === "done") {
      toast.success(job.message);
      // 词库可能被 AI 补了叶子，得把服务端的最新状态取回来。
      await store.load();
      fillForm();
      await refreshRetagPlan();
    } else {
      toast.error(job.error ?? "重打标失败");
    }
    return;
  }
  retagRunning.value = false;
  if (failure) toast.error(failure);
  else if (retagJob.value?.status === "running") toast.error("重打标超过 30 分钟仍未结束，请稍后重试");
}

/* ---------------------------------------------- 相关笔记：全库回补（不花钱） */

const relatedPlanning = ref(false);
const relatedRunning = ref(false);

/*
 * 按钮的"忙碌态"一律走 `useDelayedBusy`：**200ms 内返回的请求什么都不显示**（下面这些标志全程为 false），
 * 慢的话才把左侧图标换成转圈（文字永不改变——改文字会让可访问名在动作中途变，观感上也是"闪"）。
 * 依据与数字见 docs/research/loading-flicker-research.md。
 *
 * 注意两类操作的差别：
 * · **只读操作**（自检、预估、读列表、刷新）用延迟标志去控制 `:disabled`，配合处理器开头的防重入守卫：
 *   快请求时按钮连灰一下都不会有。
 * · **写操作**（回补、备份、恢复、清理、推/拉）的 `:disabled` 仍绑原始标志（立即生效），
 *   否则延迟窗口里能被点第二次；它们本来就要跑几秒，不存在闪的问题。
 */
const showAiTesting = useDelayedBusy(aiTesting);
const showAsrTesting = useDelayedBusy(asrTesting);
const showSearchTesting = useDelayedBusy(searchTesting);
const showNutstoreTesting = useDelayedBusy(nutstoreTesting);
const showNutstoreReading = useDelayedBusy(nutstoreReading);
const showNutstoreSyncing = useDelayedBusy(nutstoreSyncing);
const showNutstoreBackingUp = useDelayedBusy(nutstoreBackingUp);
const showNutstoreRestoring = useDelayedBusy(nutstoreRestoring);
const showDataLoading = useDelayedBusy(dataLoading);
const showRelatedPlanning = useDelayedBusy(relatedPlanning);
const showRelatedRunning = useDelayedBusy(relatedRunning);
const showRetagPlanning = useDelayedBusy(retagPlanning);
const showRetagRunning = useDelayedBusy(retagRunning);
/** 清理是逐个目标跑的，转圈跟着当前那个目标。 */
const showPrune = (target: PruneTarget | "all") => useDelayedBusy(computed(() => pruneRunning.value === target));

const nutstoreBackupFiles = ref<Array<{ path: string; name: string; type: "folder" | "file"; size?: number }>>([]);

const relatedPlan = ref<RelatedPlanView | null>(null);
const relatedJob = ref<RelatedJobView | null>(null);

/** 样例里的三种动作，给人看得懂的说法。 */
const RELATED_MODE_LABEL: Record<RelatedNoteMode, string> = { add: "新增", update: "更新", remove: "清掉" };

/**
 * 相关笔记由「抽取字段 + 开关 + 上限」共同决定，三者任一没保存，回补用的就是旧口径。
 * 与重打标的 `obsidianDirty` 分开：那边还管词库，改字段不该挡住重打标。
 */
const relatedDirty = computed(() => {
  const saved = store.settings?.obsidian;
  if (!saved) return false;
  return (
    form.obsidianVaultPath.trim() !== saved.vaultPath.trim() ||
    JSON.stringify(form.obsidianExtractFields) !== JSON.stringify(saved.extractFields ?? []) ||
    form.obsidianAutoLinkEnabled !== saved.autoLinkEnabled ||
    form.obsidianAutoLinkMax !== saved.autoLinkMax
  );
});

/**
 * 预估（不花钱，只扫本地）。
 *
 * **不要把已有结果清掉再请求**：面板一消失，它下面整块内容会缩掉一百多像素、新结果回来再弹回去——
 * 实测表单高度 3414 → 3283 → 3414（快的时候 20ms 一次来回），用户看到的就是"点一下抖一下"。
 * 现在保留旧结果并在重新预估期间压暗它（`.is-stale`），高度不变，只有按钮上的「正在看…」在动。
 */
async function refreshRelatedPlan(): Promise<void> {
  if (relatedPlanning.value) return;
  relatedPlanning.value = true;
  try {
    relatedPlan.value = await api.post<RelatedPlanView>("/api/related-notes/plan", {});
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "预估失败");
  } finally {
    relatedPlanning.value = false;
  }
}

async function startRelatedBackfill(): Promise<void> {
  relatedRunning.value = true;
  relatedJob.value = null;
  try {
    const created = await api.post<{ jobId: string }>("/api/related-notes/run", {});
    await pollRelated(created.jobId);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "回补启动失败");
    relatedRunning.value = false;
  }
}

/** 纯本地任务，正常几秒内结束；给 10 分钟上限只是不让轮询悬着。 */
async function pollRelated(jobId: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  let failure: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    let job: RelatedJobView;
    try {
      job = await api.get<RelatedJobView>(`/api/related-notes/jobs/${jobId}`);
    } catch (err) {
      failure = err instanceof Error ? err.message : "查询回补进度失败";
      break;
    }
    relatedJob.value = job;
    if (job.status === "running") continue;
    relatedRunning.value = false;
    if (job.status === "done") {
      toast.success(job.message);
      await refreshRelatedPlan();
    } else {
      toast.error(job.error ?? "回补失败");
    }
    return;
  }
  relatedRunning.value = false;
  if (failure) toast.error(failure);
  else if (relatedJob.value?.status === "running") toast.error("回补超过 10 分钟仍未结束，请稍后重试");
}

/* ---------------------------------------- 库自检与笔记预览（「存到哪」的反馈） */

const vaultCheck = ref<ObsidianVaultCheck | null>(null);
const vaultChecking = ref(false);

/** 备份目录填本地还是云端，由输入形状自动判定（没有模式开关）。 */
const nutstoreBackupLocation = computed(() => backupLocationOf(form.nutstoreBackupDir));

/* ---------------------------------------- 「抽取哪些属性」的建议来源 */

/** 库里用过的属性名（按篇数）与常用名，去掉已经选中的那些——下拉里不必再出现一遍。 */
const vaultFieldSuggestions = computed(() =>
  store.obsidianFieldNames.filter((item) => !form.obsidianExtractFields.includes(item.name)),
);
const commonFieldSuggestions = computed(() =>
  COMMON_EXTRACT_FIELDS.filter((field) => !form.obsidianExtractFields.includes(field)),
);

/**
 * 用户自己敲出来的属性名。
 *
 * el-select 的 `allow-create` **不会**把创建出来的值放回候选列表（element-plus 的 issue 11892，仍未修），
 * 于是"删掉一个自定义词再想加回来"只能重打。这里在 `@change` 里把新面孔记下来补进下拉，
 * 也就是调研里说的"业务层回填"。
 */
const createdFields = ref<string[]>([]);
const createdFieldSuggestions = computed(() =>
  createdFields.value.filter((field) => !form.obsidianExtractFields.includes(field)),
);

function onExtractFieldsChange(values: string[]) {
  const known = new Set([...store.obsidianFieldNames.map((item) => item.name), ...COMMON_EXTRACT_FIELDS, ...createdFields.value]);
  for (const value of values) {
    if (!known.has(value)) createdFields.value.push(value);
  }
}

/** 建议区的一句话说明：扫到上限时要说清这是下限，否则看起来像"库里就这么几个"。 */
const vaultFieldHint = computed(() => {
  if (store.obsidianFieldsScanned === 0) return "";
  const base = `已扫过 ${store.obsidianFieldsScanned} 篇笔记的头部`;
  return store.obsidianFieldsCapped ? `${base}（到上限了，实际可能更多）` : base;
});

/** 「高级」折叠区的展开状态。 */
const nutstoreAdvancedOpen = ref<string[]>([]);

/**
 * 折叠区标题上的状态摘要。
 *
 * 收起不等于"藏起来"——有功能就得有入口，所以标题自己说明里面配了什么、什么开着。
 * 这样即使折叠着，用户也能一眼看出"直连是不是开着"。
 */
const nutstoreAdvancedSummary = computed(() => {
  const bits = [form.nutstoreAccount.trim() ? "账号已配" : "账号未配"];
  bits.push(store.settings?.nutstore.hasPassword ? "密码已存" : "密码未存");
  bits.push(form.nutstoreObsidianMode ? "笔记直连已开" : "笔记直连未开");
  return bits.join(" · ");
});

/** 转圈只在检查真的慢时才出现：本地检查通常几十毫秒，闪现一下比不显示更烦。 */
const vaultSpinnerVisible = useDelayedBusy(vaultChecking);
/** 连发检查时丢弃过期结果：慢的那个后回来会把新结果盖掉，等于给出错误结论。 */
let vaultCheckSeq = 0;

/**
 * 只由"上一次结论"决定，**不看 `vaultChecking`**。
 *
 * 早先这里把"正在检查"也算成未知，于是失焦重检时绿色对勾会先消失再出现（实测序列：绿勾 → 空 → 绿勾），
 * 闪一下。本地检查太快，旧结论在拿到新结论前保持可见才是对的；只有检查真的慢（>180ms）时才用转圈顶替它。
 */
const vaultState = computed<"unknown" | "ok" | "bad">(() => {
  if (!vaultCheck.value) return "unknown";
  return vaultCheck.value.problem ? "bad" : "ok";
});

/**
 * 检查库：纯本地（数文件、看权限），不联网不花钱。
 *
 * 刻意**不挂按钮**：这是本地操作、几十毫秒就完，做成"点一下 → 文案变一下 → 结果出现在别处"
 * 只会让人以为点了没反应。改成输入框自带状态（转圈 / 打勾 / 警告），改路径或离开输入框都自动跑。
 */
async function checkVault(): Promise<void> {
  const seq = ++vaultCheckSeq;
  vaultChecking.value = true;
  try {
    const query = new URLSearchParams({ vaultPath: form.obsidianVaultPath, folder: form.obsidianFolder });
    const result = await api.get<ObsidianVaultCheck>(`/api/settings/obsidian/check?${query.toString()}`);
    if (seq !== vaultCheckSeq) return; // 有更新的检查在跑，这次结果作废
    vaultCheck.value = result;
    // 库能用就顺手刷新文件夹列表与属性名建议，省掉一个「刷新」按钮。
    if (!result.problem) {
      void store.loadObsidianFolders();
      void store.loadObsidianFieldNames();
    }
  } catch (err) {
    if (seq !== vaultCheckSeq) return;
    vaultCheck.value = null;
    toast.error(err instanceof Error ? err.message : "检查库失败");
  } finally {
    if (seq === vaultCheckSeq) vaultChecking.value = false;
  }
}

/** 「重新检查」：检查、文件夹列表、属性名建议一起重来（给"我就是想再按一下"的安全感）。 */
async function recheckVault(): Promise<void> {
  await Promise.all([checkVault(), store.loadObsidianFolders(), store.loadObsidianFieldNames()]);
}

const vaultCardTitle = computed(() => {
  if (vaultState.value === "bad") return "现在还存不进去";
  if (!vaultCheck.value) return "还没检查这个库文件夹";
  return `可以保存：没单独指定目录的节点写进「${form.obsidianFolder || "00-Inbox"}」`;
});

/** 属性类型图标：照 Obsidian 属性面板的做法，左列每个属性名前挂一个类型图标。 */
const PROPERTY_ICONS = { text: Type, link: Link2, date: Calendar, list: List, tags: Tag };

interface NotePreviewProp {
  name: string;
  kind: "text" | "link" | "date" | "list" | "tags";
  value?: string;
  values?: string[];
}

/**
 * 笔记头部的预览：**按 Obsidian 自己的属性面板来画**——左列属性名 + 类型图标、右列值，
 * 列表值画成 chip、`tags` 画成紫色 chip——而不是把 raw markdown 倒进一个等宽框。
 * 那个框没人愿意读，而这一段要回答的恰恰是「我在这页设的几项，最后长什么样」。
 *
 * 数据全部来自当前设置：改抽取字段、改词库、开关 AI，这张预览跟着变。
 */
const notePreviewModel = computed(() => {
  // 例子里优先用「话题」那一支：它才是这个功能的主角，来源/类型那些是兜底分类，
  // 拿它们当示例会让人以为标签就该长这样。
  const topics = taxonomy.value["话题"] ?? [];
  const owned = form.obsidianAutoTagEnabled
    ? topics.length > 0
      ? topics.slice(0, 2).map((name) => `话题/${name}`)
      : writableTags(taxonomy.value).slice(0, 2)
    : [];

  const props: NotePreviewProp[] = [
    { name: "标题", kind: "text", value: "〈视频标题〉" },
    { name: "类型", kind: "text", value: "视频笔记" },
    { name: "来源", kind: "text", value: "B站" },
    { name: "作者", kind: "text", value: "某某 UP" },
    { name: "原始链接", kind: "link", value: "https://www.bilibili.com/video/BV1xxxxxxxxx" },
    // 日期与引擎写的一致（`process.obsidian` 分支用的是同一个表达式），免得预览挂着一个过期的日子
    { name: "创建日期", kind: "date", value: new Date().toISOString().slice(0, 10) },
  ];
  if (form.obsidianAutoTagEnabled) {
    // 抽取属性按用户配的字段名生成，给两个示例值：一个是列表、两个才看得出"列表"
    for (const field of form.obsidianExtractFields.slice(0, 3)) {
      props.push({ name: field, kind: "list", values: ["〈示例 1〉", "〈示例 2〉"] });
    }
  }
  // 两个自动标签跟开关走：预览要跟真实写出来的东西一致（引擎那边是同一个判据）。
  const autoTags = [
    ...(form.obsidianSourceTagEnabled ? [`${SOURCE_TAXONOMY_GROUP}/B站`] : []),
    ...(form.obsidianUpTagEnabled ? [`${UP_TAXONOMY_GROUP}/某某-UP`] : []),
  ];
  props.push({ name: "tags", kind: "tags", values: [...autoTags, ...owned] });

  return {
    props,
    // 相关笔记段要不要出现，条件与引擎一字不差（`process.obsidian` 分支）：
    // 关联开关 + 上限 > 0 + 有字段 + **抽取开关也开着**——最后一个尤其容易被漏：
    // 属性是抽取那一步写下的，没抽取就没有可比对的东西，段子也就不会生成。
    // 早先这里只看"关联开关 + 有字段"，于是关掉 AI 时预览还在承诺一段不会出现的文字。
    related:
      form.obsidianAutoLinkEnabled &&
      form.obsidianAutoLinkMax > 0 &&
      form.obsidianExtractFields.length > 0 &&
      form.obsidianAutoTagEnabled,
  };
});

// 切到这一栏（或直接落在这一栏）就自动检查一次；之后改库路径/子目录也自动重跑，400ms 防抖。
watch(
  active,
  (key) => {
    if (key === "obsidian") void checkVault();
  },
  { immediate: true },
);

let vaultDebounce: number | undefined;
watch(
  () => [form.obsidianVaultPath, form.obsidianFolder],
  () => {
    if (active.value !== "obsidian") return;
    window.clearTimeout(vaultDebounce);
    vaultDebounce = window.setTimeout(() => void checkVault(), 400);
  },
);

const seriesFilter = ref("all");
const versionFilter = ref("all");

function blockSeries(block: PromptBlock): string {
  return block.series || (block.builtin ? "其他内置" : "自定义");
}

const seriesOptions = computed(() => {
  const seen = new Set<string>();
  for (const block of promptsStore.allBlocks) seen.add(blockSeries(block));
  return Array.from(seen);
});

const versionOptions = computed(() => {
  const seen = new Set<string>();
  for (const block of promptsStore.allBlocks) {
    if (seriesFilter.value !== "all" && blockSeries(block) !== seriesFilter.value) continue;
    if (block.version) seen.add(block.version);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const filteredBlocks = computed(() => {
  return promptsStore.allBlocks.filter((block) => {
    // 展示范围里收起的节点，它的块也不在这里出现（如阴阳师攻略系列）。
    if (block.requiresNode && form.hiddenNodes.includes(block.requiresNode)) return false;
    if (seriesFilter.value !== "all" && blockSeries(block) !== seriesFilter.value) return false;
    if (versionFilter.value !== "all" && block.version !== versionFilter.value) return false;
    return true;
  });
});

watch(seriesFilter, () => {
  if (versionFilter.value !== "all" && !versionOptions.value.includes(versionFilter.value)) {
    versionFilter.value = "all";
  }
});

function blockVariants(block: PromptBlock): PromptBlock[] {
  const series = blockSeries(block);
  return promptsStore.allBlocks.filter((candidate) => blockSeries(candidate) === series);
}

function toggleBlockExpanded(block: PromptBlock) {
  expandedBlockId.value = expandedBlockId.value === block.id ? null : block.id;
}

function blockRecipeText(block: PromptBlock): string {
  if (!block.recipe?.steps?.length) return "";
  const recipe = [
    "【配方 / Recipe】",
    `步骤数：${block.recipe.steps.length}`,
    ...block.recipe.steps.map((step, index) => {
      const expects = step.expects ? `\n期望输出：${step.expects.kind}${step.expects.asserts?.length ? `（${step.expects.asserts.length} 条断言）` : ""}` : "";
      return `\n[步骤 ${index + 1} / ${step.id}] ${step.label}${expects}\n${step.system}`;
    }),
  ].join("\n");
  return `${block.prompt}\n\n${recipe}`;
}

function copyBlockPrompt(block: PromptBlock) {
  void copyText(block.prompt, `已复制「${block.name}」的提示词`);
}

function copyBlockFull(block: PromptBlock) {
  const content = block.recipe?.steps?.length ? blockRecipeText(block) : block.prompt;
  void copyText(content, `已复制「${block.name}」的提示词${block.recipe?.steps?.length ? "与配方" : ""}`);
}

function openBlockCompare(block?: PromptBlock) {
  compareInitialBlockId.value = block?.id ?? "";
  compareDialogOpen.value = true;
}

function editBlock(block: PromptBlock) {
  blockForm.id = block.id;
  blockForm.name = block.name;
  blockForm.prompt = block.prompt;
}

function resetBlockForm() {
  blockForm.id = "";
  blockForm.name = "";
  blockForm.prompt = "";
}

async function saveBlock() {
  try {
    if (blockForm.id) await promptsStore.updateBlock(blockForm.id, { name: blockForm.name, prompt: blockForm.prompt });
    else await promptsStore.addBlock(blockForm.name, blockForm.prompt);
    resetBlockForm();
    toast.success("提示词块已保存");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "保存失败");
  }
}

async function removeBlock(block: PromptBlock) {
  try {
    await ElMessageBox.confirm(`删除提示词块「${block.name}」？引用它的节点将无法再选中该块。`, "删除提示词块", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    await promptsStore.removeBlock(block.id);
    if (blockForm.id === block.id) resetBlockForm();
    toast.success("已删除");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "删除失败");
  }
}

async function loadDataInfo() {
  // 禁用被延迟了（快请求时按钮根本不灰），重复点击得在这里挡。
  if (dataLoading.value) return;
  dataLoading.value = true;
  dataError.value = "";
  try {
    dataInfo.value = await api.get<DataOverview>("/api/settings/data");
  } catch (err) {
    dataError.value = err instanceof Error ? err.message : "读取数据目录失败";
  } finally {
    dataLoading.value = false;
  }
}

function cleanupItems(targets: PruneTarget[]): PruneItem[] {
  const all = dataInfo.value?.cleanup ?? [];
  return all.filter((item) => targets.includes(item.target));
}

const pruneAllTargets = computed<PruneTarget[]>(
  () => (dataInfo.value?.cleanup ?? []).filter((item) => item.count > 0).map((item) => item.target),
);

const hasReclaimable = computed(() => (dataInfo.value?.reclaimableBytes ?? 0) > 0);

/** 清理前把「清什么、清多少、释放多少」摊开给用户看，避免一键清理变成黑箱。 */
async function runPrune(targets: PruneTarget[], key: PruneTarget | "all") {
  const items = cleanupItems(targets).filter((item) => item.count > 0);
  if (items.length === 0) return;
  const summary = items.map((item) => `${item.label} ${item.count} 项（${formatBytes(item.bytes)}）`).join("；");
  try {
    await ElMessageBox.confirm(`将清理：${summary}。释放约 ${formatBytes(items.reduce((acc, item) => acc + item.bytes, 0))}，此操作不可撤销。`, "清理本地数据", {
      confirmButtonText: "清理",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  pruneRunning.value = key;
  try {
    const result = await api.post<{ outcomes: PruneOutcome[]; removed: number; bytes: number; errors: string[] }>("/api/settings/prune", { targets });
    pruneOutcomes.value = result.outcomes;
    await loadDataInfo();
    await runsStore.load();
    if (result.errors.length > 0) toast.warning(`已清理 ${result.removed} 项（释放 ${formatBytes(result.bytes)}），有 ${result.errors.length} 项失败`);
    else toast.success(`已清理 ${result.removed} 项，释放 ${formatBytes(result.bytes)}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "清理失败");
  } finally {
    pruneRunning.value = "";
  }
}

async function revealDir(target: "data" | "output") {
  revealTesting.value = true;
  try {
    const result = await api.post<{ ok: boolean; path: string }>(`/api/settings/reveal-${target}-dir`);
    toast.success(`已在系统文件管理器中打开${target === "data" ? "数据目录" : "输出目录"}：${result.path}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : `打开${target === "data" ? "数据目录" : "输出目录"}失败`);
  } finally {
    revealTesting.value = false;
  }
}

function revealDataDir() {
  return revealDir("data");
}

function revealOutputDir() {
  return revealDir("output");
}

/** 文件名模板的实时预览；示例值固定，用户改模板就能看见最终文件名长什么样。 */
const fileNamePreview = computed(
  () => `${renderFileNameTemplate(form.fileNameTemplate, { project: "某期视频笔记", node: "观点提炼", now: new Date() })}.md`,
);

/** 打开「运行结束提醒」时顺带申请浏览器通知权限——浏览器只允许在用户手势里申请。 */
async function toggleRunEndNotify(value: boolean) {
  if (!value) {
    form.runEndNotify = false;
    return;
  }
  const permission = await ensureNotifyPermission();
  if (permission === "granted") {
    form.runEndNotify = true;
    return;
  }
  form.runEndNotify = false;
  toast.warning(
    permission === "denied"
      ? "浏览器拒绝了通知权限，需要到浏览器地址栏的站点设置里手动允许后才能开启"
      : "当前环境不支持系统通知（浏览器通常在 https 或 localhost 下才允许）",
  );
}

function syncAiModelOptions(models?: string[]) {
  const options = models && models.length > 0 ? [...models] : [...DEEPSEEK_DEFAULT_MODELS];
  if (form.aiModel && !options.includes(form.aiModel)) options.unshift(form.aiModel);
  aiModelOptions.value = options;
}

async function refreshAiModels() {
  if (form.aiProvider !== "deepseek") return;
  aiModelLoading.value = true;
  try {
    const models = await store.fetchAiModels({
      provider: form.aiProvider,
      baseUrl: form.aiBaseUrl,
      model: form.aiModel,
      apiKey: form.aiKey || undefined,
    });
    if (models.length > 0) {
      // 这里不要改写 form.aiModel：列表只对得上「服务端这次返回了什么」，对不上用户存的值。
      // 例如存的是 deepseek-v4-flash 而端点只提供 deepseek-flash / deepseek-v4-pro，
      // 改写就等于「打开设置页」这个动作偷偷改了配置，再点一次保存就把用户的值写没了。
      // 存的值继续保留，由 syncAiModelOptions 把它补进选项里让人看得见、能改。
      syncAiModelOptions(models);
    }
  } catch {
    // 拉取模型列表失败不阻塞页面加载或保存
  } finally {
    aiModelLoading.value = false;
  }
}

function toggleHiddenNode(type: NodeType, hidden: boolean) {
  form.hiddenNodes = hidden ? [...new Set([...form.hiddenNodes, type])] : form.hiddenNodes.filter((item) => item !== type);
}

function fillForm() {
  if (!store.settings) return;
  form.aiProvider = store.settings.ai.provider;
  form.aiBaseUrl = store.settings.ai.baseUrl;
  form.aiModel = store.settings.ai.model;
  form.asrEngine = store.settings.asr.engine;
  form.asrBaseUrl = store.settings.asr.baseUrl;
  form.asrModel = store.settings.asr.model;
  form.searchProvider = store.settings.search.provider;
  form.searchMaxResults = store.settings.search.maxResults;
  form.concurrency = store.settings.general.concurrency;
  form.outputDir = store.settings.general.outputDir;
  form.fileNameTemplate = store.settings.general.fileNameTemplate;
  form.maxRetries = store.settings.general.maxRetries;
  form.retryBackoffSec = store.settings.general.retryBackoffSec;
  form.runEndNotify = store.settings.general.runEndNotify;
  form.runEndSound = store.settings.general.runEndSound;
  form.hiddenNodes = [...(store.settings.visibility?.hiddenNodes ?? [])];
  form.obsidianVaultPath = store.settings.obsidian.vaultPath;
  form.obsidianFolder = store.settings.obsidian.folder;
  form.obsidianTagView = store.settings.obsidian.tagView;
  form.obsidianAutoTagEnabled = store.settings.obsidian.autoTagEnabled;
  form.obsidianSourceTagEnabled = store.settings.obsidian.sourceTagEnabled;
  form.obsidianUpTagEnabled = store.settings.obsidian.upTagEnabled;
  form.obsidianAllowNewTags = store.settings.obsidian.allowNewTags;
  form.obsidianExtractFields = [...store.settings.obsidian.extractFields];
  taxonomy.value = JSON.parse(JSON.stringify(store.settings.obsidian.tagTaxonomy ?? {})) as TagTaxonomy;
  form.obsidianTagMinCount = store.settings.obsidian.tagMinCount;
  form.obsidianTagMaxCount = store.settings.obsidian.tagMaxCount;
  form.obsidianAutoLinkEnabled = store.settings.obsidian.autoLinkEnabled;
  form.obsidianAutoLinkMax = store.settings.obsidian.autoLinkMax;
  form.nutstoreServerUrl = store.settings.nutstore.serverUrl;
  form.nutstoreAccount = store.settings.nutstore.account;
  form.nutstoreBackupDir = store.settings.nutstore.backupDir;
  // 直连开着就把高级区展开：正在生效的配置不该被折叠藏起来。
  nutstoreAdvancedOpen.value = store.settings.nutstore.obsidianMode ? ["advanced"] : [];
  form.nutstoreObsidianRemotePath = store.settings.nutstore.obsidianRemotePath;
  form.nutstoreObsidianMode = store.settings.nutstore.obsidianMode;
  form.aiKey = store.aiKeyDraft || "";
  form.asrKey = store.asrKeyDraft || "";
  if (form.aiProvider === "deepseek") {
    if (aiModelOptions.value.length === 0) syncAiModelOptions();
    else if (form.aiModel && !aiModelOptions.value.includes(form.aiModel)) aiModelOptions.value.unshift(form.aiModel);
  } else {
    aiModelOptions.value = [];
  }
}

onMounted(async () => {
  // 支持 ?group=search 这类深链：画布节点上的「去配置」按钮需要直接落到对应分组。
  const group = String(route.query.group ?? "");
  if (groups.some((item) => item.key === group)) active.value = group as GroupKey;
  // 设置常已被 AppLayout / 画布节点预取过：先用内存里的值同步填一遍。
  // 不这么做，用户看到的就是「默认值一闪 → 真实值跳进来」，而这份数据本来就在手里。
  fillForm();
  await store.load();
  fillForm();
  // 目录列表由 store.load() 自己并发拉取（它只喂 Obsidian 那一栏的下拉框），这里不再重复请求。
  await promptsStore.load();
  // 账本必须在进页面时就读：只靠「刷新」按钮触发会让这一页长期显示空值。
  await loadDataInfo();
  if (form.aiProvider === "deepseek" && (store.settings?.ai.hasKey || form.aiKey)) {
    await refreshAiModels();
  }
});

function switchProvider(provider: AiProvider) {
  form.aiProvider = provider;
  if (provider === "deepseek") {
    form.aiBaseUrl = "https://api.deepseek.com/v1";
    form.aiModel = "deepseek-chat";
    syncAiModelOptions();
  } else if (provider === "openai") {
    form.aiBaseUrl = "https://api.openai.com/v1";
    form.aiModel = "gpt-4o-mini";
    aiModelOptions.value = [];
  } else {
    aiModelOptions.value = [];
  }
}

function switchAsr(engine: AsrEngine) {
  form.asrEngine = engine;
  if (engine === "mimo") {
    form.asrBaseUrl = "https://api.xiaomimimo.com/v1";
    form.asrModel = "mimo-v2.5-asr";
  } else {
    form.asrBaseUrl = "";
    form.asrModel = "whisper-1";
  }
}

async function saveAll() {
  try {
    if (form.aiProvider === "deepseek") await refreshAiModels();
    await store.save({
      ai: { provider: form.aiProvider, baseUrl: form.aiBaseUrl, model: form.aiModel, apiKey: form.aiKey || undefined },
      asr: { engine: form.asrEngine, baseUrl: form.asrBaseUrl, model: form.asrModel, apiKey: form.asrKey || undefined },
      search: { provider: form.searchProvider, apiKey: form.searchKey || undefined, maxResults: form.searchMaxResults },
      general: {
        concurrency: form.concurrency,
        outputDir: form.outputDir,
        fileNameTemplate: form.fileNameTemplate,
        maxRetries: form.maxRetries,
        retryBackoffSec: form.retryBackoffSec,
        runEndNotify: form.runEndNotify,
        runEndSound: form.runEndSound,
      },
      visibility: { hiddenNodes: [...form.hiddenNodes] },
      obsidian: {
        vaultPath: form.obsidianVaultPath,
        folder: form.obsidianFolder,
        tagView: form.obsidianTagView,
        tagTaxonomy: taxonomy.value,
        autoTagEnabled: form.obsidianAutoTagEnabled,
        sourceTagEnabled: form.obsidianSourceTagEnabled,
        upTagEnabled: form.obsidianUpTagEnabled,
        allowNewTags: form.obsidianAllowNewTags,
        extractFields: form.obsidianExtractFields,
        tagMinCount: form.obsidianTagMinCount,
        tagMaxCount: form.obsidianTagMaxCount,
        autoLinkEnabled: form.obsidianAutoLinkEnabled,
        autoLinkMax: form.obsidianAutoLinkMax,
      },
      nutstore: {
        serverUrl: form.nutstoreServerUrl,
        account: form.nutstoreAccount,
        password: form.nutstorePassword || undefined,
        backupDir: form.nutstoreBackupDir,
        obsidianRemotePath: form.nutstoreObsidianRemotePath,
        obsidianMode: form.nutstoreObsidianMode,
      },
    });
    toast.success("设置已保存");
    await store.load();
    fillForm();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "保存失败");
  }
}

async function testAi() {
  // 禁用被延迟了（快请求时按钮根本不灰），重复点击得在这里挡。
  if (aiTesting.value) return;
  aiTesting.value = true;
  aiModelLoading.value = true;
  try {
    const result = await store.testAi({
      provider: form.aiProvider,
      baseUrl: form.aiBaseUrl,
      model: form.aiModel,
      apiKey: form.aiKey || undefined,
    });
    toast.success(`AI 连接正常：${(result.content ?? "连接正常").slice(0, 40)}`);
    if (result.models?.length > 0) {
      if (form.aiModel && !result.models.includes(form.aiModel)) form.aiModel = result.models[0];
      syncAiModelOptions(result.models);
    }
    if (result.modelsError) toast.warning(`连接正常，但拉取模型列表失败：${result.modelsError}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "AI 连接失败");
  } finally {
    aiTesting.value = false;
    aiModelLoading.value = false;
  }
}

async function testAsr() {
  // 禁用被延迟了（快请求时按钮根本不灰），重复点击得在这里挡。
  if (asrTesting.value) return;
  asrTesting.value = true;
  try {
    const content = await store.testAsr({
      engine: form.asrEngine,
      baseUrl: form.asrBaseUrl,
      model: form.asrModel,
      apiKey: form.asrKey || undefined,
    });
    toast.success(`ASR 连接正常：${(content ?? "连接正常").slice(0, 40)}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "ASR 连接失败");
  } finally {
    asrTesting.value = false;
  }
}

async function testSearch() {
  // 禁用被延迟了（快请求时按钮根本不灰），重复点击得在这里挡。
  if (searchTesting.value) return;
  searchTesting.value = true;
  try {
    const result = await store.testSearch({
      provider: form.searchProvider,
      apiKey: form.searchKey || undefined,
      maxResults: form.searchMaxResults,
    });
    const authority = Object.entries(result.authorityCounts ?? {});
    const authorityText = authority.length > 0
      ? `，其中 ${authority.map(([tier, count]) => `${TRACE_SOURCE_AUTHORITY_LABELS[tier as keyof typeof TRACE_SOURCE_AUTHORITY_LABELS]} ${count} 条`).join("、")}`
      : "";
    const sample = result.sample ? `，示例：${result.sample.slice(0, 30)}` : "";
    toast.success(`检索连通，可用来源 ${result.count} 条${authorityText}${sample}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "检索失败");
  } finally {
    searchTesting.value = false;
  }
}

async function testNutstore() {
  // 禁用被延迟了（快请求时按钮根本不灰），重复点击得在这里挡。
  if (nutstoreTesting.value) return;
  nutstoreTesting.value = true;
  try {
    const webdav = await store.testNutstore({
      serverUrl: form.nutstoreServerUrl,
      account: form.nutstoreAccount,
      password: form.nutstorePassword || undefined,
      remotePath: "/",
    });
    toast.success(`坚果云连接正常：${webdav}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "坚果云连接失败");
  } finally {
    nutstoreTesting.value = false;
  }
}

async function loadNutstoreFolders() {
  // 禁用被延迟了（快请求时按钮根本不灰），重复点击得在这里挡。
  if (nutstoreReading.value) return;
  nutstoreReading.value = true;
  try {
    const dirs = await store.listNutstoreFolders(form.nutstoreObsidianRemotePath, 3);
    nutstoreRemoteFolders.value = dirs;
    nutstoreResult.value = {
      action: "读取云端目录",
      detail: `读取完成，共发现 ${dirs.length} 个子目录（根：${form.nutstoreObsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian"}）`,
      items: dirs,
    };
    toast.success(`已读取坚果云 Obsidian 目录：${dirs.length} 个`);
  } catch (err) {
    nutstoreResult.value = { action: "读取云端目录", errors: [{ path: form.nutstoreObsidianRemotePath || "", message: err instanceof Error ? err.message : "读取坚果云目录失败" }] };
    toast.error(err instanceof Error ? err.message : "读取坚果云目录失败");
  } finally {
    nutstoreReading.value = false;
  }
}

async function loadNutstoreFiles() {
  // 禁用被延迟了（快请求时按钮根本不灰），重复点击得在这里挡。
  if (nutstoreReading.value) return;
  nutstoreReading.value = true;
  try {
    const result = await store.listNutstore(form.nutstoreObsidianRemotePath);
    nutstoreRemoteFiles.value = result.items;
    const markdownFiles = result.items.filter((item) => item.type === "file" && item.name.endsWith(".md"));
    nutstoreResult.value = {
      action: "读取云端文件",
      detail: `读取完成：目录项 ${result.items.length} 个，其中 Markdown ${markdownFiles.length} 个（根：${form.nutstoreObsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian"}）${result.truncated ? "；注意：结果可能不完整" : ""}`,
      items: markdownFiles.map((item) => item.name),
    };
    if (result.truncated) toast.warning("目录项较多，坚果云单次列表可能不完整，建议按子目录逐层读取");
    else toast.success(`已读取坚果云文件：${result.items.length} 个`);
  } catch (err) {
    nutstoreResult.value = { action: "读取云端文件", errors: [{ path: form.nutstoreObsidianRemotePath || "", message: err instanceof Error ? err.message : "读取坚果云文件失败" }] };
    toast.error(err instanceof Error ? err.message : "读取坚果云文件失败");
  } finally {
    nutstoreReading.value = false;
  }
}

async function previewRemoteFile(path: string) {
  try {
    const result = await store.readNutstore(path);
    remotePreview.value = { path: result.path, content: result.content.slice(0, 5000) };
    nutstoreResult.value = { action: "读取远程笔记", detail: `已读取 ${result.path}（${result.size} 字节）` };
  } catch (err) {
    nutstoreResult.value = { action: "读取远程笔记", errors: [{ path, message: err instanceof Error ? err.message : "读取坚果云笔记失败" }] };
    toast.error(err instanceof Error ? err.message : "读取坚果云笔记失败");
  }
}

async function pushObsidian() {
  nutstoreSyncing.value = true;
  try {
    const result = await store.pushNutstore(undefined, form.nutstoreObsidianRemotePath);
    nutstoreResult.value = {
      action: "推送本地到坚果云",
      detail: `完成：推送 ${result.transferred} 篇，跳过/冲突 ${result.skipped} 篇，失败 ${result.errors.length} 篇`,
      transferred: result.transferred,
      skipped: result.skipped,
      skippedItems: result.skippedItems,
      errors: result.errors,
    };
    const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个（云端较新/冲突）` : "";
    const errors = result.errors.length > 0 ? `，${result.errors.length} 个失败` : "";
    toast.success(`已推送 ${result.transferred} 篇笔记到坚果云${skipped}${errors}`);
  } catch (err) {
    nutstoreResult.value = { action: "推送本地到坚果云", errors: [{ path: "", message: err instanceof Error ? err.message : "推送失败" }] };
    toast.error(err instanceof Error ? err.message : "推送失败");
  } finally {
    nutstoreSyncing.value = false;
  }
}

async function pullObsidian() {
  nutstoreSyncing.value = true;
  try {
    const result = await store.pullNutstore(undefined, form.nutstoreObsidianRemotePath);
    nutstoreResult.value = {
      action: "拉取坚果云到本地",
      detail: `完成：拉取 ${result.transferred} 篇，跳过/冲突 ${result.skipped} 篇，失败 ${result.errors.length} 篇`,
      transferred: result.transferred,
      skipped: result.skipped,
      skippedItems: result.skippedItems,
      errors: result.errors,
    };
    const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个（本地较新/冲突）` : "";
    const errors = result.errors.length > 0 ? `，${result.errors.length} 个失败` : "";
    toast.success(`已从坚果云拉取 ${result.transferred} 篇笔记${skipped}${errors}`);
  } catch (err) {
    nutstoreResult.value = { action: "拉取坚果云到本地", errors: [{ path: "", message: err instanceof Error ? err.message : "拉取失败" }] };
    toast.error(err instanceof Error ? err.message : "拉取失败");
  } finally {
    nutstoreSyncing.value = false;
  }
}

async function backupToNutstore() {
  nutstoreBackingUp.value = true;
  try {
    const result = await store.backupNutstore();
    nutstoreBackups.value = await store.listNutstoreBackups();
    const where = result.location === "local" ? "本地文件夹" : "坚果云云端";
    nutstoreResult.value = { action: `备份到${where}`, detail: `备份完成：${result.dir}`, items: result.files };
    toast.success(`已备份到${where}：${result.dir}`);
  } catch (err) {
    nutstoreResult.value = { action: "备份到坚果云", errors: [{ path: "", message: err instanceof Error ? err.message : "备份失败" }] };
    toast.error(err instanceof Error ? err.message : "备份失败");
  } finally {
    nutstoreBackingUp.value = false;
  }
}

async function loadNutstoreBackups() {
  nutstoreBackingUp.value = true;
  try {
    nutstoreBackups.value = await store.listNutstoreBackups();
    nutstoreBackupFiles.value = [];
    nutstoreResult.value = { action: "读取备份列表", detail: `读取到 ${nutstoreBackups.value.length} 个备份（${nutstoreBackupLocation.value === "local" ? "本地文件夹" : "云端"}）` };
  } catch (err) {
    nutstoreResult.value = { action: "读取备份列表", errors: [{ path: "", message: err instanceof Error ? err.message : "读取备份列表失败" }] };
    toast.error(err instanceof Error ? err.message : "读取备份列表失败");
  } finally {
    nutstoreBackingUp.value = false;
  }
}

async function loadNutstoreBackupFiles(backupPath: string) {
  nutstoreReading.value = true;
  try {
    const result = await store.listNutstore(backupPath);
    nutstoreBackupFiles.value = result.items.filter((item) => item.type === "file").map((item) => ({ path: item.path, name: item.name, type: item.type, size: item.size }));
    nutstoreResult.value = {
      action: "读取备份内容",
      detail: `读取备份目录：${backupPath}，共 ${nutstoreBackupFiles.value.length} 个文件`,
      items: nutstoreBackupFiles.value.map((file) => file.name),
    };
    remotePreview.value = null;
  } catch (err) {
    nutstoreResult.value = { action: "读取备份内容", errors: [{ path: backupPath, message: err instanceof Error ? err.message : "读取备份内容失败" }] };
    toast.error(err instanceof Error ? err.message : "读取备份内容失败");
  } finally {
    nutstoreReading.value = false;
  }
}

async function restoreNutstoreBackup(backup: { path: string; name: string }) {
  const where = nutstoreBackupLocation.value === "local" ? "本地备份文件夹" : "坚果云云端";
  try {
    await ElMessageBox.confirm(
      `用备份「${backup.name}」覆盖本机全部数据（项目/文件夹/运行记录/设置/提示词块）？恢复前会自动把当前数据再备份一份到${where}；此操作不可撤销。`,
      "从备份恢复",
      {
        confirmButtonText: "恢复",
        cancelButtonText: "取消",
        type: "warning",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return; // 用户取消
  }
  nutstoreRestoring.value = true;
  try {
    const result = await store.restoreNutstore(backup.path);
    nutstoreResult.value = {
      action: "从备份恢复",
      detail: `已恢复备份 ${backup.name}（${result.tables.length} 张表）；恢复前自动备份：${result.autoBackupPath}`,
      items: result.tables,
    };
    toast.success("恢复成功，页面即将刷新");
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    nutstoreResult.value = { action: "从坚果云恢复", errors: [{ path: backup.path, message: err instanceof Error ? err.message : "恢复失败" }] };
    toast.error(err instanceof Error ? err.message : "恢复失败");
    nutstoreRestoring.value = false;
  }
}
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
      <template v-if="active === 'ai'">
        <h2 class="sf-settings-title">AI 模型</h2>
        <p class="sf-settings-desc">AI 校对与 AI 加工节点使用 OpenAI 兼容接口，密钥只保存在服务端。</p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">提供商</span>
            <el-select v-model="form.aiProvider" class="sf-field-control" @change="switchProvider">
              <el-option v-for="opt in aiProviderOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </label>
          <label class="sf-field">
            <span class="sf-field-label">接口地址</span>
            <el-input v-model="form.aiBaseUrl" class="sf-field-control" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">模型</span>
            <el-select
              v-if="form.aiProvider === 'deepseek'"
              v-model="form.aiModel"
              class="sf-field-control"
              filterable
              :loading="aiModelLoading"
              placeholder="deepseek-chat"
            >
              <el-option v-for="model in aiModelOptions" :key="model" :label="model" :value="model" />
            </el-select>
            <el-input v-else v-model="form.aiModel" class="sf-field-control" placeholder="deepseek-chat" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">
              API Key
              <span v-if="store.settings?.ai.hasKey" class="sf-chip sf-chip--success">已保存</span>
              <span v-else class="sf-chip sf-chip--warning">未配置</span>
            </span>
            <el-input v-model="form.aiKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.ai.hasKey ? '已保存，留空则不修改' : 'sk-…'" />
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="showAiTesting" @click="testAi">
              <Loader2 v-if="showAiTesting" :size="14" class="sf-spin" />
              <PlugZap v-else :size="14" /><span>测试连接</span>
            </button>
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'asr'">
        <h2 class="sf-settings-title">语音识别</h2>
        <p class="sf-settings-desc">转写节点使用云 ASR，支持 MiMo-V2.5 与 OpenAI 兼容端点。</p>
        <div class="sf-settings-form">
          <div class="sf-field">
            <span class="sf-field-label">引擎</span>
            <ModelSelect
              v-model="form.asrEngine"
              :options="asrOptions"
              placeholder="选择 ASR 引擎"
              :prefix-icon="Mic"
              @change="(value: string) => switchAsr(value as AsrEngine)"
            />
          </div>
          <label class="sf-field">
            <span class="sf-field-label">接口地址</span>
            <el-input v-model="form.asrBaseUrl" class="sf-field-control" :placeholder="form.asrEngine === 'mimo' ? 'https://api.xiaomimimo.com/v1' : 'https://api.openai.com/v1'" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">模型</span>
            <el-input v-model="form.asrModel" class="sf-field-control" :placeholder="form.asrEngine === 'mimo' ? 'mimo-v2.5-asr' : 'whisper-1'" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">
              API Key
              <span v-if="store.settings?.asr.hasKey" class="sf-chip sf-chip--success">已保存</span>
              <span v-else class="sf-chip sf-chip--warning">未配置</span>
            </span>
            <el-input v-model="form.asrKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.asr.hasKey ? '已保存，留空则不修改' : 'API Key'" />
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="showAsrTesting" @click="testAsr">
              <Loader2 v-if="showAsrTesting" :size="14" class="sf-spin" />
              <PlugZap v-else :size="14" /><span>测试连接</span>
            </button>
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'search'">
        <h2 class="sf-settings-title">联网检索</h2>
        <p class="sf-settings-desc">
          所有需要「上网查」的模块共用这一份「搜索服务」密钥。目前在用它的有两个：
          <strong>信息溯源</strong>拿它做外部联网核查（按来源权威度给出「外部可印证 / 仅非权威来源 / 有反证 / 未找到出处」）；
          <strong>知识巩固（练一练）</strong>拿它按知识点上网找同类练习题，供出题时参考考察角度与干扰项。
        </p>
        <p class="sf-settings-desc">
          哪些节点会用到它，节点卡上会直接显示渠道与密钥状态。没配置也能跑：溯源跳过外部核查，练一练完全依据原文出题。
        </p>
        <p class="sf-settings-desc">
          注意：它和「AI 模型」页里那个跑模型的密钥不是同一个。即使两边都用智谱，也各自需要一个单独的 Key——
          模型 Key 用来生成内容，这里的 Key 只用来检索网页。两边都不用填对方的值。
        </p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">检索渠道</span>
            <el-select v-model="form.searchProvider" class="sf-field-control">
              <el-option v-for="opt in searchProviderOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </label>
          <p class="sf-settings-desc">
            智谱 BigModel 为国内渠道（支付宝/微信充值），密钥在 open.bigmodel.cn 的「API Keys」页创建；Tavily 需要国外支付方式。
            切换渠道后请重新填写该渠道的密钥。
          </p>
          <label class="sf-field">
            <span class="sf-field-label">
              API Key
              <span v-if="store.settings?.search.hasKey" class="sf-chip sf-chip--success">已保存</span>
              <span v-else class="sf-chip sf-chip--warning">未配置</span>
            </span>
            <el-input v-model="form.searchKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.search.hasKey ? '已保存，留空则不修改' : searchKeyPlaceholder" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">每个检索词最多返回结果数</span>
            <el-input-number v-model="form.searchMaxResults" :min="1" :max="10" />
          </label>
          <p class="sf-settings-desc">
            这是「每个检索词取几条结果」的上限，两个模块都受它约束：溯源核查逐条取来源，练一练按知识点的检索词取参考资料。
            调大能拿到更多候选，也更慢、更贵。
          </p>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="showSearchTesting" @click="testSearch">
              <Loader2 v-if="showSearchTesting" :size="14" class="sf-spin" />
              <PlugZap v-else :size="14" /><span>测试连接</span>
            </button>
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'general'">
        <h2 class="sf-settings-title">常规</h2>
        <p class="sf-settings-desc">运行与产出的全局默认。这里放的是「没被单独配置的东西」——节点卡上自己配了重试，就以节点为准。</p>

        <div class="sf-settings-divider">运行</div>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">并发数</span>
            <el-input-number v-model="form.concurrency" :min="GENERAL_LIMITS.concurrency.min" :max="GENERAL_LIMITS.concurrency.max" />
            <p class="sf-hint">同时跑几个节点。调大能多占带宽，也更吃机器；下载与转写这类节点本身就慢，2-3 够用。</p>
          </label>
          <label class="sf-field">
            <span class="sf-field-label">失败自动重试次数</span>
            <el-input-number v-model="form.maxRetries" :min="GENERAL_LIMITS.maxRetries.min" :max="GENERAL_LIMITS.maxRetries.max" />
            <p class="sf-hint">
              节点卡上没有单独配重试时用这个值。只对会走外部调用的节点生效（B 站下载、转写、AI 加工、练一练）；
              密钥缺失、条件不满足、断言未通过这类不重试——重试也不会变对。
            </p>
          </label>
          <label class="sf-field">
            <span class="sf-field-label">重试等待（秒）</span>
            <el-input-number v-model="form.retryBackoffSec" :min="GENERAL_LIMITS.retryBackoffSec.min" :max="GENERAL_LIMITS.retryBackoffSec.max" />
            <p class="sf-hint">第一次重试前等多久，之后按次数线性递增：填 3 就是等 3 秒、6 秒、9 秒……</p>
          </label>
        </div>

        <div class="sf-settings-divider">产出</div>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">输出目录</span>
            <el-input v-model="form.outputDir" class="sf-field-control" placeholder="outputs" />
            <p class="sf-hint">
              留空用默认的 <strong>outputs</strong>（落在数据目录里）；填相对路径同理；
              想直接把成稿写进自己的笔记文件夹，就填绝对路径，例如 <strong>D:\笔记\ScribeFlow</strong>。
            </p>
            <p class="sf-hint">当前生效：<span class="sf-data-dir">{{ store.settings?.general.resolvedOutputDir || "（保存后显示）" }}</span></p>
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="revealTesting" @click="revealOutputDir"><ExternalLink :size="14" /><span>打开输出目录</span></button>
          </div>
          <label class="sf-field">
            <span class="sf-field-label">文件名模板</span>
            <el-input v-model="form.fileNameTemplate" class="sf-field-control" placeholder="{project}" />
            <p class="sf-hint">
              占位符：
              <strong v-for="item in FILE_NAME_TOKENS" :key="item.token" class="sf-token">{{ item.token }}（{{ item.label }}）</strong>
            </p>
            <p class="sf-hint">
              预览：<strong>{{ fileNamePreview }}</strong>；
              一次跑出多份产物而模板里没写 <strong>{node}</strong> 时，会自动在后面补节点名，避免互相覆盖。
            </p>
          </label>
        </div>

        <div class="sf-settings-divider">运行结束提醒</div>
        <div class="sf-settings-form">
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">发系统通知</span>
            <el-switch :model-value="form.runEndNotify" @change="(value) => void toggleRunEndNotify(Boolean(value))" />
          </label>
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">播放提示音</span>
            <el-switch v-model="form.runEndSound" />
          </label>
          <p class="sf-hint">
            运行是「下载 → 转写 → AI 加工」，几分钟到十几分钟都正常，可以放心切走去做别的。
            只提醒成功与失败；自己点的停止不提醒。
          </p>
        </div>

        <div class="sf-settings-actions">
          <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
        </div>
      </template>

      <template v-else-if="active === 'visibility'">
        <h2 class="sf-settings-title">展示范围</h2>
        <p class="sf-settings-desc">
          勾上的节点<strong>不出现在界面里</strong>：节点面板、新建工程与快捷新建的链路列表、提示词块库
          都会把它连同用到它的链路一起收起来。适合演示时先把用不到的能力收好，或者自己不用某个垂直节点。
        </p>
        <p class="sf-settings-desc">
          这<strong>只影响「新建时能选什么」</strong>：已有工程里出现的节点照常显示、照常运行——收起一个入口不该让旧工程失效。
        </p>
        <div class="sf-settings-form">
          <div class="sf-vis-list">
            <label v-for="type in NODE_TYPE_ORDER" :key="type" class="sf-field sf-field-row sf-vis-row">
              <span class="sf-field-label">
                {{ NODE_TYPE_LABELS[type] }}
                <span class="sf-vis-type">{{ type }}</span>
              </span>
              <el-switch
                :model-value="form.hiddenNodes.includes(type)"
                @change="(value) => toggleHiddenNode(type, Boolean(value))"
              />
            </label>
          </div>
          <p class="sf-hint">
            当前收起 {{ form.hiddenNodes.length }} 个节点<template v-if="form.hiddenNodes.length > 0">：{{ form.hiddenNodes.map((type) => NODE_TYPE_LABELS[type]).join("、") }}</template>。
            保存后生效（面板与链路列表随设置刷新）。
          </p>
        </div>

        <div class="sf-settings-actions">
          <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
        </div>
      </template>

      <template v-else-if="active === 'obsidian'">
        <h2 class="sf-settings-title">Obsidian</h2>
        <p class="sf-settings-desc">
          「Obsidian 笔记」节点把跑出来的笔记写进你的 Obsidian 库。这一页只有三件事要你确认，从上往下看一遍就懂了。
        </p>
        <div class="sf-settings-form">
          <div class="sf-settings-divider">① 存到哪</div>
          <label class="sf-field">
            <span class="sf-field-label">Obsidian 库文件夹 <span class="sf-tag-required">必填</span></span>
            <el-input
              v-model="form.obsidianVaultPath"
              class="sf-field-control"
              placeholder="例如 D:\知识库，或坚果云同步文件夹"
              @blur="checkVault"
            >
              <template #suffix>
                <Loader2 v-if="vaultSpinnerVisible" :size="14" class="sf-spin" />
                <CircleCheck v-else-if="vaultState === 'ok'" :size="14" class="sf-state sf-state--ok" />
                <CircleAlert v-else-if="vaultState === 'bad'" :size="14" class="sf-state sf-state--bad" />
              </template>
            </el-input>
            <p class="sf-hint">改完这个路径会<strong>自动检查</strong>（只读本地文件、不联网），不用点按钮。</p>
            <!--
              开着「坚果云直连」时新笔记不写这里。不写清楚的话，这一栏的绿勾会让人以为写的就是它——
              用户就这么疑惑过（"库文件夹显示 D:\笔记，实际却写到坚果云那个目录"）。
              本地路径在直连模式下仍然要填：回补相关笔记 / 词库回补 / 属性名与标签用量的扫描都只在本地跑。
            -->
            <p v-if="form.nutstoreObsidianMode" class="sf-settings-desc sf-settings-desc--warn">
              <strong>注意：现在开着「坚果云直连」。</strong>新笔记会写进云端目录
              <code>{{ form.nutstoreObsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian" }}</code>，<strong>不是这里的本地库</strong>。
              这个本地路径仍然必须填——「回补相关笔记」「词库回补」「属性名与标签用量的扫描」都只在本地跑。
              想让笔记写进本地库，去「坚果云」那一页把那个开关关掉。
            </p>
          </label>

          <div class="sf-vault" :class="`sf-vault--${vaultState === 'bad' ? 'bad' : vaultState === 'ok' ? 'ok' : 'idle'}`">
            <div class="sf-vault-head">
              <component :is="vaultState === 'bad' ? CircleAlert : CircleCheck" :size="15" class="sf-vault-icon" />
              <span class="sf-vault-title">{{ vaultCardTitle }}</span>
              <button type="button" class="sf-text-btn sf-vault-recheck" @click="recheckVault">
                <RefreshCw :size="12" /><span>重新检查</span>
              </button>
            </div>
            <p v-if="vaultCheck?.problem" class="sf-vault-problem">{{ vaultCheck.problem }}</p>
            <dl v-else-if="vaultCheck" class="sf-vault-rows">
              <div class="sf-vault-row">
                <dt>库里笔记</dt>
                <dd>{{ vaultCheck.noteCount }}{{ vaultCheck.noteCountCapped ? "+" : "" }} 篇</dd>
              </div>
              <div class="sf-vault-row">
                <dt>云端同步</dt>
                <dd>{{ vaultCheck.syncFolder === "nutstore" ? "坚果云同步文件夹，客户端会自动上云" : "不在同步文件夹，笔记只留在本机" }}</dd>
              </div>
            </dl>
            <p v-else class="sf-vault-problem">填入库文件夹后会自动检查——路径写错的话，到运行该节点时才报错就晚了。</p>
          </div>

          <label class="sf-field">
            <span class="sf-field-label">默认写进库里哪个文件夹<em class="sf-field-note">只是默认值</em></span>
            <el-select
              v-model="form.obsidianFolder"
              class="sf-field-control"
              filterable
              allow-create
              default-first-option
              placeholder="00-Inbox"
            >
              <el-option v-for="dir in store.obsidianFolders" :key="dir" :label="dir" :value="dir" />
            </el-select>
            <p class="sf-hint">
              真正决定去向的是链路里「Obsidian 笔记」节点卡片上的「保存目录」——那里选了就按那里，
              <strong>只有留空的节点才用这里</strong>。库已读到 {{ store.obsidianFolders.length }} 个文件夹，
              跟着库路径自动刷新；也可以直接输入一个新名字。
            </p>
          </label>

          <div class="sf-settings-divider">② 笔记里有什么</div>
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">默认让 AI 读一遍笔记，补上话题标签与属性<em class="sf-field-note">只是默认值</em></span>
            <el-switch v-model="form.obsidianAutoTagEnabled" />
          </label>
          <p class="sf-hint">
            「Obsidian 笔记」节点的高级设置里可以按这一篇单独改——<strong>不同风格的视频可以各抽各的</strong>，
            不用回这一页改。
          </p>

          <!-- 开关的从属块：缩进 + 左侧竖线，让"这块归上面那个开关管"看得见，而不是靠变灰暗示。 -->
          <div v-if="form.obsidianAutoTagEnabled" class="sf-subblock">
            <label class="sf-field">
              <span class="sf-field-label">默认抽取哪些属性<em class="sf-field-note">节点可覆盖</em></span>
              <el-select
                v-model="form.obsidianExtractFields"
                class="sf-field-control"
                multiple
                filterable
                allow-create
                default-first-option
                :reserve-keyword="false"
                :multiple-limit="MAX_EXTRACT_FIELDS"
                placeholder="输入属性名回车创建；点开下拉有建议"
                @change="onExtractFieldsChange"
              >
                <el-option-group v-if="createdFieldSuggestions.length > 0" label="你自己加过的">
                  <el-option v-for="field in createdFieldSuggestions" :key="`c-${field}`" :label="field" :value="field" />
                </el-option-group>
                <el-option-group v-if="vaultFieldSuggestions.length > 0" :label="vaultFieldHint || '你库里出现过的'">
                  <el-option v-for="item in vaultFieldSuggestions" :key="`v-${item.name}`" :label="item.name" :value="item.name">
                    <span>{{ item.name }}</span>
                    <span class="sf-option-meta">库里 {{ item.count }} 篇用过</span>
                  </el-option>
                </el-option-group>
                <el-option-group label="常用属性名">
                  <el-option v-for="field in commonFieldSuggestions" :key="`k-${field}`" :label="field" :value="field" />
                </el-option-group>
                <!-- 常用组合放下拉页脚：既不像原来那样常驻一行，也不会被建议列表滚出去 -->
                <template #footer>
                  <div class="sf-combo-row">
                    <span class="sf-combo-label">套用一组</span>
                    <button
                      v-for="preset in EXTRACT_FIELD_PRESETS"
                      :key="preset.id"
                      type="button"
                      class="sf-preset"
                      @click="form.obsidianExtractFields = [...preset.fields]"
                    >
                      {{ preset.label }}
                    </button>
                  </div>
                </template>
              </el-select>
            </label>
            <p class="sf-hint">
              这些属性会写进笔记头部（列表形式），也是「关联相关笔记」的比较依据；<strong>一个都不选就不抽</strong>。
              最多 {{ MAX_EXTRACT_FIELDS }} 个。节点卡片的高级设置里可以按这一篇换成别的字段。
            </p>
          </div>
          <p v-else class="sf-hint">
            关闭时：笔记照样保存，带 UP 主与话题标签，不抽额外属性、也不做关联。
          </p>

          <p class="sf-settings-desc">每篇保存出来的笔记，长这样（下面这张是模板，不是你已有的笔记）：</p>
          <!--
            拟 Obsidian 属性面板：左列属性名 + 类型图标，右列值；列表值画成 chip、`tags` 画成紫色 chip。
            画成 Ob 的样子而不是倒一段 raw markdown —— 这一段要回答的是「我在这页设的几项，最后长什么样」，
            一段 YAML 没人愿意读。取值全部跟着当前设置变（见 notePreviewModel）。
          -->
          <div class="sf-ob-note">
            <dl class="sf-ob-props">
              <template v-for="prop in notePreviewModel.props" :key="prop.name">
                <dt class="sf-ob-prop-name">
                  <component :is="PROPERTY_ICONS[prop.kind]" :size="12" />
                  <span>{{ prop.name }}</span>
                </dt>
                <dd class="sf-ob-prop-value">
                  <span v-if="prop.kind === 'link'" class="sf-ob-link">
                    {{ prop.value }}<ExternalLink :size="11" />
                  </span>
                  <span v-else-if="prop.values" class="sf-ob-chips">
                    <span
                      v-for="(value, index) in prop.values"
                      :key="`${value}-${index}`"
                      class="sf-ob-chip"
                      :class="{ 'sf-ob-chip--tag': prop.kind === 'tags' }"
                    >{{ value }}<span class="sf-ob-chip-x" aria-hidden="true">×</span></span>
                  </span>
                  <span v-else>{{ prop.value }}</span>
                </dd>
              </template>
            </dl>
            <div class="sf-ob-body">
              <p class="sf-ob-title">〈视频标题〉</p>
              <p class="sf-ob-text">（AI 整理出来的正文）</p>
              <template v-if="notePreviewModel.related">
                <p class="sf-ob-heading">{{ RELATED_SECTION_TITLE }}</p>
                <p class="sf-ob-text sf-ob-wikilink">- [[另一篇同题材的旧笔记]]</p>
              </template>
            </div>
          </div>
          <p class="sf-hint">
            话题标签由 AI 从下面的词库里挑，<strong>你自己写的标签不会被改</strong>。标签只写二级（如 <code>话题/AI泡沫</code>）——
            Obsidian 里按一级筛选会自动带上它下面所有二级。
          </p>

          <div class="sf-settings-divider">③ 词库：决定笔记带什么标签，也决定你怎么找回来</div>

          <!--
            两个自动标签：只在生成笔记时按元数据写，用户只能决定写不写。
            它们**不进下面的词库**（不参与 AI 分配，也不参与「回补旧笔记」），
            所以这里给的是开关而不是可编辑的分组——见 docs/tagging.md。
          -->
          <div class="sf-auto-tags">
            <label class="sf-field sf-field-row">
              <span class="sf-field-label">写来源标签<em class="sf-field-note">来源/B站 这种</em></span>
              <el-switch v-model="form.obsidianSourceTagEnabled" />
            </label>
            <label class="sf-field sf-field-row">
              <span class="sf-field-label">写 UP 主标签<em class="sf-field-note">UP主名称/某某 这种</em></span>
              <el-switch v-model="form.obsidianUpTagEnabled" />
            </label>
            <p class="sf-hint">
              这两个标签<strong>不用你维护、也不靠 AI 判断</strong>：来源取自笔记的「来源」属性（B站 / 本地文件 / 文本…），
              UP 主取自作者，生成笔记时就已经知道。所以它们不在下面的词库里，也不参与「回补旧笔记」——
              要改就让旧笔记自己在 Obsidian 里改。节点卡片上可以按这一篇单独覆盖。
            </p>
          </div>

          <p class="sf-settings-desc">
            下面这一栏是<strong>你自己维护的话题词库</strong>：一级是分类、二级是具体标签。
            标签不能含空格，保存时会自动换成 <code>-</code>。
          </p>
          <p class="sf-hint">
            <strong>这一栏怎么填，取决于你想按什么找笔记。</strong>想要「某个话题大家怎么说」，就建一个
            <code>话题</code> 一级，把想追踪的议题一个个加成二级（如 <code>话题/平台抽成</code>）。
            完整上手步骤见左栏「项目文档」里的《标签与合集：怎么用》。
          </p>
          <!--
            词库编辑器：三种显示样式由用户自己挑（纯展示，不改数据）。
            手势都做成看得见的：删除常显、改名是单击标签名（键盘 F2）、拖拽有常驻把手槽位。
            依据与实测见 docs/research/taxonomy-editor-research.md。
          -->
          <!--
            显示样式三选一（图标模式，默认单色）。依据与两次返工的原因都在
            docs/research/view-mode-switcher-research.md：
            ① 文字标签的分段控件不需要引导说明句（Apple HIG），所以那句解释已删；
            ② 但需要一个可见标签（GitLab），就是左边这四个字；el-radio-group 的默认可访问名是
               英文 "radio-group"，必须自己传 aria-label；
            ③ 三段**分开排**，不再拼成一条：拼接式分段控件里，选中段那圈 1px 描边与邻居共边，
               DOM 靠后的邻居会把它盖掉——用户看到的"右侧线是浅的"就是这么来的。
               留 4px 间隙就没有共边，也就没有这条缝。
            图标只给眼睛看：名字靠 title（鼠标）与一段视觉隐藏文字（读屏）。
          -->
          <div class="sf-tag-toolbar">
            <span class="sf-field-label">显示样式</span>
            <el-radio-group v-model="form.obsidianTagView" class="sf-tag-view-group" aria-label="显示样式">
              <el-radio-button
                v-for="mode in TAG_VIEW_MODES"
                :key="mode.id"
                :value="mode.id"
                :title="`${mode.label}：${mode.hint}`"
              >
                <component :is="TAG_VIEW_ICONS[mode.id]" :size="14" />
                <span class="sf-visually-hidden">{{ mode.label }}</span>
              </el-radio-button>
            </el-radio-group>
          </div>

          <div class="sf-tag-tree" :class="`sf-tag-tree--${form.obsidianTagView}`">
            <div v-for="(children, group, groupIndex) in taxonomy" :key="group" class="sf-tag-group">
              <div class="sf-tag-group-head">
                <button
                  type="button"
                  class="sf-tag-caret"
                  :aria-expanded="!isCollapsed(group)"
                  :title="isCollapsed(group) ? '展开这一组' : '收起这一组'"
                  @click="toggleGroupCollapsed(group)"
                >{{ isCollapsed(group) ? "▸" : "▾" }}</button>
                <span v-if="form.obsidianTagView === 'color'" class="sf-tag-dot" :style="{ background: groupToneOf(group, groupIndex).dot }"></span>
                <span class="sf-tag-group-name">{{ group }}</span>
                <span class="sf-tag-group-count">
                  {{ (children ?? []).length }} 个<template v-if="groupUsage(group) !== null"> · {{ groupUsage(group) }} 篇用过</template>
                </span>
                <div class="sf-tag-group-actions">
                  <button type="button" class="sf-tag-icon-btn" :title="`复制在 Obsidian 里的搜索串：tag:#${group}`" @click="copyTagSearch(group)">
                    <Copy :size="13" />
                  </button>
                  <button type="button" class="sf-tag-icon-btn" title="在这一组里加一个二级标签" @click="startAddChild(group)">
                    <Plus :size="14" />
                  </button>
                  <button type="button" class="sf-tag-icon-btn" title="重命名 / 删除这个一级" @click="groupMenu = groupMenu === group ? '' : group">
                    <MoreHorizontal :size="14" />
                  </button>
                </div>
              </div>

              <div v-if="groupMenu === group" class="sf-tag-group-menu">
                <button type="button" class="sf-tag-menu-btn" @click="renameGroup(group)">重命名这个一级</button>
                <button type="button" class="sf-tag-menu-btn sf-tag-menu-btn--danger" @click="removeGroup(group)">
                  <Trash2 :size="13" /><span>删除这个一级</span>
                </button>
              </div>

              <div v-if="!isCollapsed(group)" class="sf-tag-body">
                <!-- 空组不写"暂无"文案：把"创建第一个"作为这一组唯一的内容（Airtable 的空组就是这样） -->
                <p v-if="(children ?? []).length === 0 && addingInGroup !== group" class="sf-tag-empty">
                  还没有二级标签，一级本身也能当标签用。
                  <button type="button" class="sf-tag-link-btn" @click="startAddChild(group)">加一个</button>
                </p>

                <div class="sf-tag-children">
                  <span
                    v-for="(child, index) in children ?? []"
                    :key="child"
                    class="sf-tag-chip"
                    :class="{
                      'sf-tag-chip--editing': editingTag?.group === group && editingTag?.index === index,
                      'sf-tag-chip--dragging': draggingTag?.group === group && draggingTag?.index === index,
                      'sf-tag-chip--over': dragOverTag?.group === group && dragOverTag?.index === index,
                    }"
                    :style="form.obsidianTagView === 'color' ? { background: groupToneOf(group, groupIndex).soft } : undefined"
                    tabindex="0"
                    draggable="true"
                    @dragstart="onTagDragStart(group, index, $event)"
                    @dragover.prevent="dragOverTag = { group, index }"
                    @dragleave="dragOverTag = null"
                    @drop.prevent="onTagDrop(group, index)"
                    @dragend="draggingTag = null; dragOverTag = null"
                    @keydown.f2.prevent="startRenameWith(group, index, String(child))"
                    @keydown.delete.prevent="removeChild(group, String(child))"
                    @keydown.backspace.prevent="removeChild(group, String(child))"
                    @keydown.alt.up.prevent="moveChild(group, index, -1)"
                    @keydown.alt.down.prevent="moveChild(group, index, 1)"
                  >
                    <span class="sf-tag-chip-grip" title="拖动可以调顺序；键盘用 Alt+↑/↓" aria-hidden="true">⣿</span>
                    <el-input
                      v-if="editingTag?.group === group && editingTag?.index === index"
                      v-model="renameDraft"
                      class="sf-tag-chip-input"
                      size="small"
                      @keyup.enter="commitRename"
                      @keyup.esc="editingTag = null"
                      @blur="commitRename"
                    />
                    <template v-else>
                      <button type="button" class="sf-tag-chip-name" title="点一下改名（键盘 F2）" @click="startRenameWith(group, index, String(child))">
                        {{ child }}
                      </button>
                      <span v-if="tagUsage(group, String(child)) !== null" class="sf-tag-chip-usage">{{ tagUsage(group, String(child)) }}</span>
                      <!--
                        上移/下移：WCAG 2.5.7 要求"拖拽的功能必须能用单指针不拖拽完成"。
                        它们**不给 Tab 停靠点**（tabindex=-1）：键盘路径是 Alt+↑/↓，
                        指针路径是"指向这一项 → 按钮浮现 → 点一下"。这样停靠点数量不涨。
                      -->
                      <span class="sf-tag-chip-move">
                        <button
                          type="button"
                          tabindex="-1"
                          class="sf-tag-chip-move-btn"
                          :disabled="index === 0"
                          :aria-label="`把 ${child} 移到前一位`"
                          title="移到前一位（键盘 Alt+↑）"
                          @click.stop="moveChild(group, index, -1)"
                        >↑</button>
                        <button
                          type="button"
                          tabindex="-1"
                          class="sf-tag-chip-move-btn"
                          :disabled="index === (children ?? []).length - 1"
                          :aria-label="`把 ${child} 移到后一位`"
                          title="移到后一位（键盘 Alt+↓）"
                          @click.stop="moveChild(group, index, 1)"
                        >↓</button>
                      </span>
                      <button
                        type="button"
                        class="sf-tag-chip-remove"
                        :aria-label="`删除 ${group}/${child}`"
                        :title="`删除 ${group}/${child}`"
                        @click="removeChild(group, String(child))"
                      ><X :size="12" /></button>
                    </template>
                  </span>

                  <el-input
                    v-if="addingInGroup === group"
                    v-model="newChildDraft[group]"
                    class="sf-tag-add-input"
                    :data-group="group"
                    size="small"
                    placeholder="标签名，回车添加"
                    @keyup.enter="addChild(group)"
                    @keyup.esc="addingInGroup = ''"
                    @blur="addingInGroup = ''"
                  />
                  <button v-else type="button" class="sf-tag-add-btn" @click="startAddChild(group)">
                    <Plus :size="12" /><span>添加</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="sf-tag-add-group">
              <el-input v-model="newGroupName" size="small" placeholder="新增一级分类，回车确认" @keyup.enter="addGroup" />
              <button type="button" class="sf-btn" @click="addGroup"><span>添加一级</span></button>
            </div>
          </div>

          <label class="sf-field sf-field-row">
            <span class="sf-field-label">允许 AI 自己补二级标签</span>
            <el-switch v-model="form.obsidianAllowNewTags" />
          </label>
          <p class="sf-hint">
            关掉时模型只能从上面这棵树里挑——好处是<strong>同一个话题全库只有一个名字</strong>，搜出来才是完整的合集。
            打开后它能补二级（一级结构始终由你定），补进去的会出现在上面这棵树里。
          </p>
          <p class="sf-hint">
            一级和二级的名字都可以<strong>点一下改</strong>（键盘 F2）；复制搜索串是组头左边那个 <Copy :size="12" /> 按钮——
            点它会拿到如 <code>tag:#话题/AI泡沫</code> 的串。带把手的标签可以<strong>拖动调顺序</strong>（键盘 Alt+↑/↓）。
            在 Obsidian 里搜这条串、或把它加进「书签」，<strong>就是那个话题的合集</strong>——不用在这个工具里另做什么。
            搜 <code>tag:#UP主名称/某某UP</code> 就是某个人的合集。
          </p>
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">额外：让同题材的旧笔记互相链接</span>
            <el-switch v-model="form.obsidianAutoLinkEnabled" />
          </label>
          <p class="sf-hint">
            按上面配置的<strong>抽取字段</strong>在库里找相关笔记（值相同的算强相关），在文末加一段 <code>[[链接]]</code>。
            字段留空就没有可比较的东西，自然不会关联——所以这个开关单独打开也不会有副产物。
          </p>
          <label v-if="form.obsidianAutoLinkEnabled" class="sf-field">
            <span class="sf-field-label">每篇最多关联几篇</span>
            <el-input-number v-model="form.obsidianAutoLinkMax" :min="0" :max="20" />
          </label>

          <template v-if="form.obsidianAutoLinkEnabled">
            <div class="sf-settings-divider">属性改了，回补旧笔记的相关笔记</div>
            <p class="sf-settings-desc">
              只有<strong>新笔记</strong>会在保存那一刻算一次相关笔记；改了上面的属性字段之后，已经存在的笔记要跑一次这里才会跟上。
              这一步<strong>不调模型、不花钱</strong>，纯本地按属性比对。
            </p>
            <p class="sf-hint">
              依据是每篇笔记 front matter 里<strong>已经抽好的属性</strong>——在这个功能之前保存、或当时没开抽取的笔记没有依据，
              补不出链接（这些篇数会记在下面的「没有属性」里）。每篇最多关联几篇、开关本身也按当前设置来。
            </p>
            <p v-if="relatedDirty" class="sf-settings-desc sf-settings-desc--warn">
              属性字段或开关有未保存的改动——先点「保存设置」，否则这一轮用的是旧口径。
            </p>
            <div class="sf-settings-actions">
              <button
                type="button"
                class="sf-btn"
                :disabled="showRelatedPlanning || relatedRunning || relatedDirty"
                @click="refreshRelatedPlan"
              >
                <Loader2 v-if="showRelatedPlanning" :size="14" class="sf-spin" />
                <ListChecks v-else :size="14" /><span>先看要动多少（不花钱）</span>
              </button>
              <button
                type="button"
                class="sf-btn sf-btn--primary"
                :disabled="relatedRunning || relatedDirty || !relatedPlan"
                @click="startRelatedBackfill"
              >
                <Loader2 v-if="showRelatedRunning" :size="14" class="sf-spin" />
                <RefreshCw v-else :size="14" /><span>回补相关笔记</span>
              </button>
            </div>
            <div v-if="relatedPlan" class="sf-nutstore-result" :class="{ 'is-stale': relatedPlanning }" :aria-busy="relatedPlanning">
              <h3 class="sf-nutstore-result-title">这一轮要动多少：全库 {{ relatedPlan.totalNotes }} 篇</h3>
              <div class="sf-nutstore-result-stats">
                <span>要改 <strong>{{ relatedPlan.willUpdate }}</strong></span>
                <span>不用动 <strong>{{ relatedPlan.unchanged }}</strong></span>
                <span>没有属性 <strong>{{ relatedPlan.noFields }}</strong></span>
                <span>会写出 <strong>{{ relatedPlan.plannedLinks }}</strong> 条链接</span>
              </div>
              <p v-if="relatedPlan.willUpdate === 0" class="sf-hint">没有要改的——旧笔记的相关笔记已经和当前口径一致。</p>
              <ul v-else class="sf-nutstore-result-list">
                <li v-for="item in relatedPlan.samples" :key="item.relPath">
                  <span class="sf-nutstore-result-path">{{ item.relPath }}</span>
                  <span class="sf-nutstore-result-reason">{{ RELATED_MODE_LABEL[item.mode] }} · 关联 {{ item.relatedCount }} 篇</span>
                </li>
                <li v-if="relatedPlan.willUpdate > relatedPlan.samples.length" class="sf-nutstore-result-more">
                  …… 还有 {{ relatedPlan.willUpdate - relatedPlan.samples.length }} 篇未展示
                </li>
              </ul>
            </div>
            <div v-if="relatedJob" class="sf-nutstore-result">
              <h3 class="sf-nutstore-result-title">
                回补：{{ relatedJob.status === "running" ? relatedJob.message : relatedJob.status === "done" ? "完成" : "失败" }}
              </h3>
              <p v-if="relatedJob.status === 'running'" class="sf-nutstore-result-detail">
                阶段 {{ relatedJob.stage }} · {{ relatedJob.processed }}/{{ relatedJob.total }}
              </p>
              <p v-else-if="relatedJob.error" class="sf-nutstore-result-detail">{{ relatedJob.error }}</p>
              <template v-if="relatedJob.report">
                <div class="sf-nutstore-result-stats">
                  <span>写入 <strong>{{ relatedJob.report.written }}</strong></span>
                  <span>未变 <strong>{{ relatedJob.report.unchanged }}</strong></span>
                  <span>链接 <strong>{{ relatedJob.report.linksWritten }}</strong> 条</span>
                  <span v-if="relatedJob.report.failed.length > 0">失败 <strong>{{ relatedJob.report.failed.length }}</strong></span>
                </div>
                <ul v-if="relatedJob.report.failed.length > 0" class="sf-nutstore-result-list sf-nutstore-result-list--error">
                  <li v-for="(item, index) in relatedJob.report.failed.slice(0, 20)" :key="`${item.relPath}-${index}`">
                    <span class="sf-nutstore-result-path">{{ item.relPath }}</span>
                    <span class="sf-nutstore-result-reason">{{ item.reason }}</span>
                  </li>
                </ul>
              </template>
            </div>
          </template>

          <div class="sf-settings-divider">词库改了，回补旧笔记</div>
          <p class="sf-settings-desc">
            加了新话题之后，<strong>只有新笔记</strong>会带上它；已经存在的笔记要跑一次这里才会补上。平时不用跑。
          </p>
          <p class="sf-hint">
            先点「先看要动多少」，它<strong>不调模型、不花钱</strong>，只告诉你这一轮要动多少篇、大约几次调用。
            <strong>只改词库里的标签</strong>，你自己写的标签不碰；读不出结构的文件会跳过并列出，不会被覆盖。
          </p>
          <p v-if="obsidianDirty" class="sf-settings-desc sf-settings-desc--warn">
            词库或库路径有未保存的改动——先点「保存设置」，否则这一轮用的是旧词库。
          </p>
          <div class="sf-settings-actions">
            <button
              type="button"
              class="sf-btn"
              :disabled="showRetagPlanning || retagRunning || obsidianDirty"
              @click="refreshRetagPlan"
            >
              <Loader2 v-if="showRetagPlanning" :size="14" class="sf-spin" />
              <ListChecks v-else :size="14" /><span>先看要动多少（不花钱）</span>
            </button>
            <button
              type="button"
              class="sf-btn sf-btn--primary"
              :disabled="retagRunning || obsidianDirty || !retagPlan"
              @click="startRetag"
            >
              <Loader2 v-if="showRetagRunning" :size="14" class="sf-spin" />
              <RefreshCw v-else :size="14" /><span>开始回补</span>
            </button>
          </div>
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">深度重扫（更贵：能补上"换个说法"的笔记）</span>
            <el-switch v-model="retagDeep" />
          </label>
          <p class="sf-hint">
            默认只把「正文里出现过标签名」的笔记送去判定，这是省钱的主要来源；代价是换个说法的笔记会漏。
            比如新标签叫「平台经济」而笔记里只写了「抽成」，默认扫不到——这时再开深度重扫补一次。
          </p>

          <div v-if="retagPlan" class="sf-nutstore-result" :class="{ 'is-stale': retagPlanning }" :aria-busy="retagPlanning">
            <h3 class="sf-nutstore-result-title">这一轮要动多少：全库 {{ retagPlan.totalNotes }} 篇</h3>
            <div class="sf-nutstore-result-stats">
              <span>要重新判定 <strong>{{ retagPlan.fullCount }}</strong></span>
              <span>只判新标签 <strong>{{ retagPlan.incrementalCount }}</strong></span>
              <span>只补写/清理标签 <strong>{{ retagPlan.cleanupCount }}</strong></span>
              <span>不用动 <strong>{{ retagPlan.unchanged }}</strong></span>
              <span>预计调用 <strong>{{ retagPlan.estimatedCalls }}</strong> 次</span>
            </div>
            <p v-if="retagPlan.addedTags.length > 0" class="sf-nutstore-result-detail">
              词库新增：{{ retagPlan.addedTags.join("、") }}
            </p>
            <p v-if="retagPlan.removedTags.length > 0" class="sf-nutstore-result-detail">
              词库已删（会从笔记里清掉）：{{ retagPlan.removedTags.join("、") }}
            </p>
            <ul v-if="retagPlan.unparsable.length > 0" class="sf-nutstore-result-list sf-nutstore-result-list--error">
              <li v-for="item in retagPlan.unparsable.slice(0, 20)" :key="item.relPath">
                <span class="sf-nutstore-result-path">{{ item.relPath }}</span>
                <span class="sf-nutstore-result-reason">{{ item.reason }}</span>
              </li>
              <li v-if="retagPlan.unparsable.length > 20" class="sf-nutstore-result-more">
                …… 还有 {{ retagPlan.unparsable.length - 20 }} 条未展示
              </li>
            </ul>
          </div>

          <div v-if="retagJob" class="sf-nutstore-result">
            <h3 class="sf-nutstore-result-title">
              回补：{{ retagJob.status === "running" ? retagJob.message : retagJob.status === "done" ? "完成" : "失败" }}
            </h3>
            <p v-if="retagJob.status === 'running'" class="sf-nutstore-result-detail">
              阶段 {{ retagJob.stage }} · {{ retagJob.processed }}/{{ retagJob.total }}
            </p>
            <p v-else-if="retagJob.error" class="sf-nutstore-result-detail">{{ retagJob.error }}</p>
            <template v-if="retagJob.report">
              <div class="sf-nutstore-result-stats">
                <span>写入 <strong>{{ retagJob.report.written }}</strong></span>
                <span>未变 <strong>{{ retagJob.report.unchanged }}</strong></span>
                <span>调用 <strong>{{ retagJob.report.calls }}</strong> 次</span>
                <span>输入 <strong>{{ retagJob.report.usage.promptTokens }}</strong> tokens</span>
                <span>命中缓存 <strong>{{ retagJob.report.usage.cachedTokens }}</strong></span>
                <span v-if="retagJob.report.failed.length > 0">失败 <strong>{{ retagJob.report.failed.length }}</strong></span>
              </div>
              <p v-if="retagJob.report.learnedTags.length > 0" class="sf-nutstore-result-detail">
                本次词库新增：{{ retagJob.report.learnedTags.join("、") }}
              </p>
              <ul v-if="retagJob.report.failed.length > 0" class="sf-nutstore-result-list sf-nutstore-result-list--error">
                <li v-for="(item, index) in retagJob.report.failed.slice(0, 20)" :key="`${item.relPath}-${index}`">
                  <span class="sf-nutstore-result-path">{{ item.relPath }}</span>
                  <span class="sf-nutstore-result-reason">{{ item.reason }}</span>
                </li>
              </ul>
            </template>
          </div>

          <div class="sf-settings-actions">
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'nutstore'">
        <h2 class="sf-settings-title">坚果云</h2>
        <p class="sf-settings-desc">
          日常只需要上边这一项——<strong>备份目录</strong>。把它填成坚果云同步文件夹里的路径，备份就交给客户端上传，不需要账号密码。
          下面「高级」里是给<strong>没装坚果云客户端</strong>的部署（Docker、另一台机器）用的：云端直连、云端浏览、笔记推送/拉取。
        </p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">备份目录</span>
            <el-input v-model="form.nutstoreBackupDir" class="sf-field-control" placeholder="D:\我的坚果云\ScribeFlow\backups 或 /我的坚果云/ScribeFlow/backups" />
            <p class="sf-hint">
              <strong>填本地文件夹</strong>（如 <code>D:\我的坚果云\ScribeFlow\backups</code>）→ 备份写进坚果云同步文件夹，由客户端上传，
              <strong>不需要账号密码</strong>；<strong>填云端路径</strong>（以 <code>/</code> 开头）→ 由本应用用 WebDAV 直连上传。
              当前识别为：<strong>{{ nutstoreBackupLocation === "local" ? "本地文件夹（客户端同步）" : "云端路径（WebDAV 直连）" }}</strong>
            </p>
          </label>

          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="nutstoreBackingUp" @click="backupToNutstore">
              <Loader2 v-if="showNutstoreBackingUp" :size="14" class="sf-spin" />
              <Save v-else :size="14" /><span>备份数据到{{ nutstoreBackupLocation === "local" ? "本地文件夹" : "坚果云云端" }}</span>
            </button>
            <button type="button" class="sf-btn" :disabled="nutstoreBackingUp" @click="loadNutstoreBackups"><RefreshCw :size="14" /><span>读取备份列表</span></button>
          </div>
          <div v-if="nutstoreBackups.length > 0" class="sf-nutstore-backup-list">
            <div v-for="backup in nutstoreBackups.slice(0, 10)" :key="backup.path" class="sf-nutstore-backup-row">
              <span class="sf-nutstore-tag">{{ backup.name }}</span>
              <button type="button" class="sf-text-btn" :disabled="nutstoreReading || nutstoreRestoring" @click="loadNutstoreBackupFiles(backup.path)">查看内容</button>
              <button
                type="button"
                class="sf-text-btn sf-text-btn--danger"
                :disabled="nutstoreReading || nutstoreRestoring || nutstoreBackingUp"
                @click="restoreNutstoreBackup(backup)"
              >
                <RotateCcw :size="13" />
                <Loader2 v-if="showNutstoreRestoring" :size="14" class="sf-spin" /><span>恢复</span>
              </button>
            </div>
            <span v-if="nutstoreBackups.length > 10" class="sf-settings-desc">…… 还有 {{ nutstoreBackups.length - 10 }} 个备份未展示</span>
            <p class="sf-settings-desc">「恢复」会用所选备份整库覆盖本机数据：恢复前自动备份当前库；有运行中流程时需先停止；成功后页面自动刷新。</p>
          </div>
          <div v-if="nutstoreBackupFiles.length > 0" class="sf-nutstore-backup-files">
            <button
              v-for="file in nutstoreBackupFiles"
              :key="file.path"
              type="button"
              class="sf-text-btn"
              :disabled="file.name !== 'backup.json'"
              @click="previewRemoteFile(file.path)"
            >
              <Cloud :size="13" /><span>{{ file.name }}{{ file.size != null ? `（${file.size} B）` : "" }}</span>
            </button>
            <p class="sf-settings-desc">提示：backup.json 可点击预览；scribe-flow.sqlite 是 SQLite 数据库文件，请用本地坚果云客户端或数据库工具打开。</p>
          </div>

          <el-collapse v-model="nutstoreAdvancedOpen" class="sf-advanced">
            <el-collapse-item name="advanced">
              <template #title>
                <span class="sf-advanced-title">高级：云端口令与直连</span>
                <span class="sf-advanced-status">{{ nutstoreAdvancedSummary }}</span>
              </template>
              <p class="sf-settings-desc">
                只有「备份目录填云端路径」「让笔记直接写云端」「用推送/拉取代替客户端同步」这三种用法才需要这里的账号密码。
                库放在同步文件夹里的话，这些都可以不管。
              </p>
              <label class="sf-field">
                <span class="sf-field-label">WebDAV 服务器</span>
                <el-input v-model="form.nutstoreServerUrl" class="sf-field-control" placeholder="https://dav.jianguoyun.com/dav/" />
              </label>
              <label class="sf-field">
                <span class="sf-field-label">账号（邮箱）</span>
                <el-input v-model="form.nutstoreAccount" class="sf-field-control" placeholder="you@example.com" />
              </label>
              <label class="sf-field">
                <span class="sf-field-label">
                  应用密码
                  <span v-if="store.settings?.nutstore.hasPassword" class="sf-chip sf-chip--success">已保存</span>
                  <span v-else class="sf-chip sf-chip--warning">未配置</span>
                </span>
                <el-input v-model="form.nutstorePassword" type="password" show-password class="sf-field-control" :placeholder="store.settings?.nutstore.hasPassword ? '已保存，留空则不修改' : '粘贴坚果云生成的应用密码'" />
                <p class="sf-hint">
                  坚果云应用密码在<strong>网页版</strong>生成：右上角头像 → 账户信息 → 安全选项 → 第三方应用管理 → 添加应用密码。
                  <a href="https://help.jianguoyun.com/?p=2064" target="_blank" rel="noreferrer">查看官方说明</a>
                </p>
              </label>
              <div class="sf-settings-actions">
                <button type="button" class="sf-btn" :disabled="showNutstoreTesting" @click="testNutstore">
                  <Loader2 v-if="showNutstoreTesting" :size="14" class="sf-spin" />
                  <PlugZap v-else :size="14" /><span>测试连接</span>
                </button>
              </div>

              <label class="sf-field">
                <span class="sf-field-label">Obsidian 云端目录</span>
                <el-input v-model="form.nutstoreObsidianRemotePath" class="sf-field-control" placeholder="/我的坚果云/ScribeFlow/Obsidian" />
                <p class="sf-hint">想让文件出现在本地坚果云客户端，请把路径放在你的同步文件夹下，例如 <strong>/我的坚果云/ScribeFlow</strong>；不要直接填 <strong>/ScribeFlow</strong>。</p>
              </label>
              <label class="sf-field sf-field-row">
                <span class="sf-field-label">Obsidian 笔记节点直接读写坚果云</span>
                <el-switch v-model="form.nutstoreObsidianMode" />
              </label>
              <p class="sf-settings-desc">开启后，Obsidian 节点写入与自动关联扫描都会走坚果云远程目录；目录下拉也会读取云端目录。</p>

              <div class="sf-settings-divider">读取云端</div>
              <div class="sf-settings-actions">
                <button type="button" class="sf-btn" :disabled="showNutstoreReading" @click="loadNutstoreFolders">
                  <Loader2 v-if="showNutstoreReading" :size="14" class="sf-spin" />
                  <FolderOpen v-else :size="14" /><span>读取云端目录</span>
                </button>
                <button type="button" class="sf-btn" :disabled="showNutstoreReading" @click="loadNutstoreFiles">
                  <Loader2 v-if="showNutstoreReading" :size="14" class="sf-spin" />
                  <RefreshCw v-else :size="14" /><span>读取云端文件</span>
                </button>
              </div>
              <p class="sf-settings-desc">已读取目录：{{ nutstoreRemoteFolders.length }} 个；目录按“{{ form.nutstoreObsidianRemotePath || '/我的坚果云/ScribeFlow/Obsidian' }}”为根递归最多 3 层。</p>
              <div v-if="nutstoreRemoteFolders.length > 0" class="sf-nutstore-list">
                <span v-for="dir in nutstoreRemoteFolders.slice(0, 30)" :key="dir" class="sf-nutstore-tag">{{ dir }}</span>
                <span v-if="nutstoreRemoteFolders.length > 30" class="sf-nutstore-tag sf-nutstore-more">+{{ nutstoreRemoteFolders.length - 30 }}</span>
              </div>
              <div v-if="nutstoreRemoteFiles.length > 0" class="sf-nutstore-list">
                <button
                  v-for="file in nutstoreRemoteFiles.filter((f) => f.type === 'file' && f.name.endsWith('.md')).slice(0, 20)"
                  :key="file.path"
                  type="button"
                  class="sf-text-btn"
                  @click="previewRemoteFile(file.path)"
                >
                  <Cloud :size="13" /><span>{{ file.name }}</span>
                </button>
              </div>
              <p v-if="remotePreview" class="sf-nutstore-preview">{{ remotePreview.content.slice(0, 800) }}{{ remotePreview.content.length > 800 ? "…" : "" }}</p>

              <div class="sf-settings-divider">本地 Obsidian ↔ 坚果云</div>
              <p class="sf-settings-desc">以 Obsidian 设置页里的“Obsidian 库路径”为本地端；只同步 .md 笔记。遇到不一致时会跳过并显示在下方「最近操作结果」中，不会自动覆盖对端较新的文件。库放在同步文件夹里时不需要它。</p>
              <div class="sf-settings-actions">
                <button type="button" class="sf-btn" :disabled="nutstoreSyncing" @click="pushObsidian">
                  <Loader2 v-if="showNutstoreSyncing" :size="14" class="sf-spin" />
                  <Upload v-else :size="14" /><span>推送本地到坚果云</span>
                </button>
                <button type="button" class="sf-btn" :disabled="nutstoreSyncing" @click="pullObsidian">
                  <Loader2 v-if="showNutstoreSyncing" :size="14" class="sf-spin" />
                  <Download v-else :size="14" /><span>拉取坚果云到本地</span>
                </button>
              </div>
            </el-collapse-item>
          </el-collapse>

          <div v-if="nutstoreResult" class="sf-nutstore-result">
            <h3 class="sf-nutstore-result-title">最近操作结果：{{ nutstoreResult.action }}</h3>
            <p v-if="nutstoreResult.detail" class="sf-nutstore-result-detail">{{ nutstoreResult.detail }}</p>
            <div v-if="nutstoreResult.transferred !== undefined || nutstoreResult.skipped !== undefined" class="sf-nutstore-result-stats">
              <span v-if="nutstoreResult.transferred !== undefined">已传输 <strong>{{ nutstoreResult.transferred }}</strong></span>
              <span v-if="nutstoreResult.skipped !== undefined">跳过/冲突 <strong>{{ nutstoreResult.skipped }}</strong></span>
              <span v-if="nutstoreResult.errors?.length">失败 <strong>{{ nutstoreResult.errors.length }}</strong></span>
            </div>
            <ul v-if="nutstoreResult.skippedItems && nutstoreResult.skippedItems.length > 0" class="sf-nutstore-result-list">
              <li v-for="item in nutstoreResult.skippedItems.slice(0, 20)" :key="item.path">
                <span class="sf-nutstore-result-path">{{ item.path }}</span>
                <span class="sf-nutstore-result-reason">{{ item.reason }}</span>
              </li>
              <li v-if="nutstoreResult.skippedItems.length > 20" class="sf-nutstore-result-more">…… 还有 {{ nutstoreResult.skippedItems.length - 20 }} 条未展示</li>
            </ul>
            <ul v-if="nutstoreResult.errors && nutstoreResult.errors.length > 0" class="sf-nutstore-result-list sf-nutstore-result-list--error">
              <li v-for="(item, index) in nutstoreResult.errors.slice(0, 20)" :key="`${item.path}-${index}`">
                <span class="sf-nutstore-result-path">{{ item.path || "操作" }}</span>
                <span class="sf-nutstore-result-reason">{{ item.message }}</span>
              </li>
              <li v-if="nutstoreResult.errors.length > 20" class="sf-nutstore-result-more">…… 还有 {{ nutstoreResult.errors.length - 20 }} 条未展示</li>
            </ul>
            <ul v-if="nutstoreResult.items && nutstoreResult.items.length > 0" class="sf-nutstore-result-list">
              <li v-for="(item, index) in nutstoreResult.items.slice(0, 20)" :key="`${item}-${index}`">
                <span class="sf-nutstore-result-path">{{ item }}</span>
              </li>
              <li v-if="nutstoreResult.items.length > 20" class="sf-nutstore-result-more">…… 还有 {{ nutstoreResult.items.length - 20 }} 条未展示</li>
            </ul>
          </div>

          <div class="sf-settings-actions">
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'prompts'">
        <h2 class="sf-settings-title">提示词块库</h2>
        <p class="sf-settings-desc">内置块只读，可按模板系列与版本筛选；自定义块由 AI 加工节点引用，修改后下一次运行生效。</p>
        <div class="sf-block-toolbar">
          <button type="button" class="sf-btn" @click="openBlockCompare()">对比任意块</button>
        </div>
        <div class="sf-block-filters">
          <label class="sf-field sf-block-filter">
            <span class="sf-field-label">模板系列</span>
            <el-select v-model="seriesFilter" class="sf-field-control" size="small">
              <el-option label="全部系列" value="all" />
              <el-option v-for="series in seriesOptions" :key="series" :label="series" :value="series" />
            </el-select>
          </label>
          <label class="sf-field sf-block-filter">
            <span class="sf-field-label">版本</span>
            <el-select v-model="versionFilter" class="sf-field-control" size="small" :disabled="versionOptions.length === 0">
              <el-option label="全部版本" value="all" />
              <el-option v-for="version in versionOptions" :key="version" :label="version" :value="version" />
            </el-select>
          </label>
        </div>
        <div class="sf-blocks">
          <article v-for="block in filteredBlocks" :key="block.id" class="sf-block-card">
            <header class="sf-block-head">
              <span class="sf-block-name">{{ block.name }}</span>
              <span v-if="block.builtin" class="sf-chip sf-chip--info">内置</span>
              <span v-if="block.version" class="sf-chip sf-chip--warning">{{ block.version }}</span>
              <span v-if="block.recommended" class="sf-chip sf-chip--success">推荐</span>
              <span class="sf-block-actions">
                <button v-if="blockVariants(block).length > 1" type="button" class="sf-text-btn" title="对比同一系列的不同版本" @click="openBlockCompare(block)">对比</button>
                <button type="button" class="sf-text-btn" @click="toggleBlockExpanded(block)">{{ expandedBlockId === block.id ? "收起" : "查看全文" }}</button>
                <template v-if="!block.builtin">
                  <button type="button" class="sf-text-btn" @click="editBlock(block)">编辑</button>
                  <button type="button" class="sf-text-btn sf-text-btn--danger" aria-label="删除提示词块" @click="removeBlock(block)"><Trash2 :size="13" /></button>
                </template>
              </span>
            </header>
            <p v-if="block.series" class="sf-block-series">{{ block.series }}</p>
            <p class="sf-block-prompt">{{ block.prompt.slice(0, 120) }}{{ block.prompt.length > 120 ? "…" : "" }}</p>
            <div v-if="expandedBlockId === block.id" class="sf-block-detail">
              <p v-if="block.description" class="sf-block-desc">{{ block.description }}</p>
              <div v-if="block.recipe?.steps?.length" class="sf-block-recipe">
                <h4 class="sf-block-recipe-title">配方步骤（recipe）</h4>
                <ol class="sf-block-recipe-list">
                  <li v-for="(step, index) in block.recipe.steps" :key="step.id" class="sf-block-recipe-item">
                    <span class="sf-block-recipe-step">{{ index + 1 }}. {{ step.label }}（{{ step.id }}）</span>
                    <pre class="sf-block-recipe-system">{{ step.system }}</pre>
                  </li>
                </ol>
              </div>
              <pre class="sf-block-full">{{ block.prompt }}</pre>
              <div class="sf-block-detail-actions">
                <button type="button" class="sf-text-btn" @click="copyBlockPrompt(block)">复制提示词</button>
                <button v-if="block.recipe?.steps?.length" type="button" class="sf-text-btn" @click="copyBlockFull(block)">复制提示词+配方</button>
              </div>
            </div>
          </article>
        </div>

        <div class="sf-block-form">
          <h3 class="sf-block-form-title">{{ blockForm.id ? "编辑自定义块" : "新增自定义块" }}</h3>
          <label class="sf-field">
            <span class="sf-field-label">名称</span>
            <el-input v-model="blockForm.name" class="sf-field-control" placeholder="如：会议纪要提炼" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">提示词</span>
            <el-input v-model="blockForm.prompt" type="textarea" :rows="6" class="sf-field-control" placeholder="输入系统提示词…" />
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn sf-btn--primary" :disabled="!blockForm.name.trim() || !blockForm.prompt.trim()" @click="saveBlock"><Save :size="14" /><span>保存提示词块</span></button>
            <button v-if="blockForm.id" type="button" class="sf-btn" @click="resetBlockForm"><span>取消编辑</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'data'">
        <h2 class="sf-settings-title">数据与工程</h2>
        <p class="sf-settings-desc">本地数据目录的占用账本与工程资产总览。每一项可清理的东西都标明能释放多少空间，清理按同一份规则重新核对后执行。</p>

        <div class="sf-storage-head">
          <div class="sf-storage-total">
            <span class="sf-storage-total-value tnum">{{ formatBytes(dataInfo?.totals.bytes ?? 0) }}</span>
            <span class="sf-storage-total-meta">
              {{ dataInfo?.totals.files ?? 0 }} 个文件 ·
              {{ dataInfo?.projects.total ?? 0 }} 个工程（{{ dataInfo?.projects.folders ?? 0 }} 个文件夹） ·
              {{ dataInfo?.runs.total ?? 0 }} 条运行记录（运行中 {{ dataInfo?.runs.running ?? 0 }}）
            </span>
          </div>
          <div class="sf-settings-actions sf-storage-head-actions">
            <button type="button" class="sf-btn" :disabled="revealTesting" @click="revealDataDir"><ExternalLink :size="14" /><span>打开数据目录</span></button>
            <button type="button" class="sf-btn" :disabled="showDataLoading" @click="loadDataInfo">
              <Loader2 v-if="showDataLoading" :size="14" class="sf-spin" />
              <RefreshCw v-else :size="14" /><span>刷新</span>
            </button>
          </div>
        </div>
        <p v-if="dataError" class="sf-storage-error">{{ dataError }}</p>

        <div class="sf-settings-divider">存储占用</div>
        <table class="sf-data-table">
          <thead>
            <tr><th>区域</th><th class="sf-data-num">文件</th><th class="sf-data-num">占用</th></tr>
          </thead>
          <tbody>
            <tr v-for="area in dataInfo?.areas ?? []" :key="area.key">
              <td>{{ area.label }}</td>
              <td class="sf-data-num tnum">{{ area.present ? area.files : "—" }}</td>
              <td class="sf-data-num tnum">{{ area.present ? formatBytes(area.bytes) : "尚未产生" }}</td>
            </tr>
          </tbody>
        </table>
        <p class="sf-hint">数据目录：<span class="sf-data-dir">{{ dataInfo?.dataDir ?? "—" }}</span></p>

        <div class="sf-settings-divider">工程资产</div>
        <p class="sf-settings-desc">「占用」是该工程全部运行记录对应的产物与中间文件；删掉这些运行记录即可回收。</p>
        <table v-if="(dataInfo?.projects.top.length ?? 0) > 0" class="sf-data-table">
          <thead>
            <tr><th>工程</th><th class="sf-data-num">运行记录</th><th class="sf-data-num">占用</th></tr>
          </thead>
          <tbody>
            <tr v-for="usage in dataInfo?.projects.top ?? []" :key="usage.id">
              <td>{{ usage.name }}</td>
              <td class="sf-data-num tnum">{{ usage.runCount }}</td>
              <td class="sf-data-num tnum">{{ formatBytes(usage.bytes) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="sf-hint">还没有任何运行记录，所以没有按工程统计的占用。</p>
        <p v-if="dataInfo && dataInfo.projects.total > dataInfo.projects.top.length" class="sf-hint">
          只列出占用最多的 10 个工程，另有 {{ dataInfo.projects.total - dataInfo.projects.top.length }} 个工程未展示。
        </p>

        <div class="sf-settings-divider">可回收空间</div>
        <p class="sf-settings-desc">
          合计可释放 <strong>{{ formatBytes(dataInfo?.reclaimableBytes ?? 0) }}</strong>（共 {{ dataInfo?.cleanup.length ?? 0 }} 类）。
          磁盘上还有 {{ formatBytes((dataInfo?.totals.bytes ?? 0) - (dataInfo?.reclaimableBytes ?? 0)) }} 属于正在用的工程数据与数据库。
        </p>
        <div class="sf-cleanup-list">
          <div v-for="item in dataInfo?.cleanup ?? []" :key="item.target" class="sf-cleanup-row" :data-target="item.target">
            <div class="sf-cleanup-info">
              <span class="sf-cleanup-label">{{ item.label }}</span>
              <span class="sf-cleanup-rule">{{ item.rule }}</span>
            </div>
            <span class="sf-cleanup-count tnum">{{ item.count }} 项</span>
            <span class="sf-cleanup-bytes tnum">{{ formatBytes(item.bytes) }}</span>
            <button
              type="button"
              class="sf-btn sf-btn--danger"
              :disabled="item.count === 0 || pruneRunning !== ''"
              @click="runPrune([item.target], item.target)"
            >
              <Loader2 v-if="showPrune(item.target)" :size="14" class="sf-spin" /><span>清理</span>
            </button>
          </div>
        </div>
        <div class="sf-settings-actions">
          <button type="button" class="sf-btn sf-btn--danger" :disabled="!hasReclaimable || pruneRunning !== ''" @click="runPrune(pruneAllTargets, 'all')">
            <Loader2 v-if="showPrune('all')" :size="14" class="sf-spin" />
            <span>清理全部可回收项（释放 {{ formatBytes(dataInfo?.reclaimableBytes ?? 0) }}）</span>
          </button>
        </div>

        <div v-if="pruneOutcomes.length > 0" class="sf-storage-result">
          <h3 class="sf-storage-result-title">最近一次清理</h3>
          <ul class="sf-storage-result-list">
            <li v-for="outcome in pruneOutcomes" :key="outcome.target">
              <span class="sf-storage-result-label">{{ outcome.label }}</span>
              <span class="sf-storage-result-value tnum">清理 {{ outcome.removed }} 项 · 释放 {{ formatBytes(outcome.bytes) }}</span>
            </li>
          </ul>
          <ul v-if="pruneOutcomes.some((outcome) => outcome.errors.length > 0)" class="sf-storage-result-list sf-storage-result-list--error">
            <li v-for="outcome in pruneOutcomes" :key="`${outcome.target}-errors`">
              <template v-for="message in outcome.errors" :key="message">
                <span class="sf-storage-result-label">{{ outcome.label }}</span>
                <span class="sf-storage-result-value">{{ message }}</span>
              </template>
            </li>
          </ul>
        </div>

        <p class="sf-hint">整库备份与恢复（含工程、运行记录与设置）在「坚果云」分组。</p>
      </template>

      <template v-else>
        <h2 class="sf-settings-title">{{ groups.find((g) => g.key === active)?.label }}</h2>
        <p class="sf-settings-desc">这个分组还没有对应的视图分支（开发提示：请在此处补 <code>template</code> 分支）。</p>
      </template>
    </section>

    <PromptBlockDiffDialog
      :open="compareDialogOpen"
      :blocks="promptsStore.allBlocks"
      :initial-block-id="compareInitialBlockId || undefined"
      @update:open="compareDialogOpen = $event"
    />
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
  background: var(--color-ink-soft);
  color: var(--color-text);
  font-weight: 500;
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
  font-size: var(--text-body-size);
  line-height: var(--text-leading);
  color: var(--color-text-secondary);
}

.sf-settings-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 460px;
}

.sf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sf-field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-field-control {
  width: 100%;
}

/* 输入框里的自检状态：转圈 / 打勾 / 警告。 */
.sf-spin {
  color: var(--color-text-tertiary);
  animation: sf-spin 900ms linear infinite;
}

@keyframes sf-spin {
  to {
    transform: rotate(360deg);
  }
}

.sf-state--ok {
  color: var(--color-success);
}

.sf-state--bad {
  color: var(--color-warning);
}

/*
 * 设置页里的数值增减器一律窄宽度（实测 120px；改之前套着 .sf-field-control 是 460px，
 * 中间那格输入框放一个「2」，剩下三百多像素全是空白）。
 *
 * 写在结构上而不是让每个调用点各自加一个类：本页的数值项只会越来越多（并发数、重试次数、
 * 每个检索词返回条数、最多关联篇数……），靠人记得加类迟早漏一个，而漏掉的那一个正好就是最丑的。
 * 选择器比 .sf-field-control 更具体，所以就算哪天有人手滑把宽度类加回来，也压得住。
 */
.sf-field .el-input-number {
  width: 120px;
}

.sf-field-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

/**
 * 设置页里的帮助文字（唯一一个类名）。
 *
 * 早先有两个名字干同一件事：`.sf-field-hint`（有规则、20 处）与 `.sf-settings-hint`（**没有任何规则**、12 处），
 * 于是同一页里"说明文字"有 11px/13px/14px 三套尺度。现在合并成 `.sf-hint` 一个名字、两个尺寸档：
 * 帮助 12px（这里）、说明段 13px（`.sf-settings-desc`）。
 * 取值与依据见 docs/research/settings-text-typography-research.md。
 */
.sf-hint {
  margin: 2px 0 10px;
  font-size: var(--text-help-size);
  line-height: var(--text-leading);
  color: var(--color-text-tertiary);
}

/* 加粗在这套小字里靠"更重 + 更深"两件事表达：600 由 app.css 统一给，这里补一次性加深 */
.sf-hint strong,
.sf-settings-desc strong {
  color: var(--color-text);
}

/**
 * 行内代码：底色药丸 + 跟随正文字体。
 * 不用等宽字体——它没有中文字形，浏览器会按字符回退，同一段 code 里出现两套度量（这是"挤"的机理之一）；
 * 也不缩字号——GitHub/antd 的 85% 是给 14–16px 正文用的，我们这里 12px 乘 0.85 会掉到 10.2px。
 * 代码里显式关掉中西文自动加空：它会改变"这段字面值"的观感。
 */
.sf-settings-body code {
  padding: 1px 5px;
  border-radius: var(--control-radius);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 1em;
  text-autospace: no-autospace;
  overflow-wrap: anywhere;
}

.sf-hint a {
  color: var(--color-text-secondary);
  text-decoration: underline;
}

.sf-settings-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.sf-token {
  margin-right: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.sf-settings-divider {
  margin: 4px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    opacity var(--dur-1) var(--ease-out);
}

.sf-btn:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sf-btn--primary {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-surface);
}

.sf-btn--primary:hover:not(:disabled) {
  border-color: var(--color-text);
  background: var(--color-text);
  color: var(--color-surface);
}

.sf-btn--danger {
  color: var(--color-error);
}

.sf-btn--danger:hover:not(:disabled) {
  background: var(--color-error-soft);
  color: var(--color-error);
}

.sf-chip {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.sf-chip--success {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.sf-chip--warning {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.sf-chip--info {
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
}

.sf-text-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-text-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-text-btn--danger {
  color: var(--color-error);
}

.sf-text-btn--danger:hover {
  background: var(--color-error-soft);
  color: var(--color-error);
}

.sf-block-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.sf-block-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.sf-block-filter {
  width: 180px;
}

.sf-blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

.sf-block-card {
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-block-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sf-block-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-block-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
}

.sf-block-series {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-block-prompt {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-block-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border);
}

.sf-block-desc {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-block-recipe {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sf-block-recipe-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-block-recipe-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
}

.sf-block-recipe-item {
  margin: 0;
}

.sf-block-recipe-step {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
}

.sf-block-recipe-system {
  margin: 4px 0 0;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}

.sf-block-full {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 420px;
  overflow-y: auto;
}

.sf-block-detail-actions {
  display: flex;
  gap: 6px;
}

.sf-block-form {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
}

.sf-block-form-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-storage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.sf-storage-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sf-storage-total-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.02em;
}

.sf-storage-total-meta {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-storage-head-actions {
  margin-top: 0;
}

.sf-storage-error {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-error-soft);
  color: var(--color-error);
  font-size: 12px;
}

.sf-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  color: var(--color-text);
}

.sf-data-table th {
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  text-align: left;
}

.sf-data-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

.sf-data-table tbody tr:last-child td {
  border-bottom: none;
}

.sf-data-table tbody tr:hover td {
  background: var(--color-surface-muted);
}

/* 必须写成 .sf-data-table th.sf-data-num 这种复合选择器：
   光靠 .sf-data-num 会被上面的 .sf-data-table th（权重更高）压回左对齐。 */
.sf-data-table th.sf-data-num,
.sf-data-table td.sf-data-num {
  text-align: right;
  white-space: nowrap;
}

.sf-cleanup-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sf-cleanup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px 84px auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-cleanup-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sf-cleanup-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-text);
}

.sf-cleanup-rule {
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

.sf-cleanup-count,
.sf-cleanup-bytes {
  text-align: right;
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.sf-cleanup-bytes {
  color: var(--color-text);
  font-weight: 500;
}

.sf-storage-result {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-storage-result-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-storage-result-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sf-storage-result-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  font-size: 11.5px;
}

.sf-storage-result-list--error li {
  background: var(--color-error-soft);
}

.sf-storage-result-label {
  color: var(--color-text);
  font-weight: 500;
}

.sf-storage-result-value {
  color: var(--color-text-secondary);
}

.sf-advanced {
  margin-top: 4px;
  border-top: 1px solid var(--color-border);
  --el-collapse-header-bg-color: transparent;
  --el-collapse-header-text-color: var(--color-text);
  --el-collapse-border-color: var(--color-border);
}

.sf-advanced :deep(.el-collapse-item__header) {
  gap: 8px;
  height: 40px;
  background: transparent;
}

.sf-advanced-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-advanced-status {
  flex: 1;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

/*
 * 库自检结果卡。
 *
 * 三条约束，都是踩过才写下的：
 * 1. **高度尽量不随内容变** —— 它下面是「默认写进库里哪个文件夹」和 ②③ 两段，卡片一长高就顶着它们跳。
 *    所以这里不放会折行的东西（完整路径不重复显示：它就在上面那个输入框里），每行文字都短到一行放得下。
 * 2. **标签与值分列**，不写成"完整路径 D:\…"这种一行到底的句子 —— 那既看不清值从哪开始，也没法对齐。
 * 3. hover 用 `.sf-text-btn` 那套中性色（灰底 + 文字加深），不要覆盖成品牌色：绿卡上出现蓝字是冲突的。
 */
.sf-vault {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-vault--ok {
  border-color: var(--color-success-border);
  background: var(--color-success-soft);
}

.sf-vault--bad {
  border-color: var(--color-warning-border);
  background: var(--color-warning-soft);
}

.sf-vault-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
}

.sf-vault-icon {
  flex: none;
}

.sf-vault--ok .sf-vault-icon {
  color: var(--color-success);
}

.sf-vault--bad .sf-vault-icon {
  color: var(--color-warning);
}

.sf-vault--idle .sf-vault-icon {
  color: var(--color-text-tertiary);
}

.sf-vault-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-vault-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  /* 41px = 两行 rows 的实测高度（见下方 .sf-vault-problem 的说明） */
  min-height: 41px;
}

.sf-vault-row {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 8px;
  align-items: baseline;
}

.sf-vault-row dt {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.sf-vault-row dd {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-vault-problem {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  /*
   * 42px = 「能存」状态下两行 rows 的实测高度 + 1（两种状态渲染取整差 1px）。
   * 写死这个数只为让"能存 / 不能存"两种结论下卡片一样高——不定高时实测差 22px（93 vs 71），
   * 结论一变就把下面的控件顶着走。文字超过两行时仍会变高，那是该给的（错误信息得说清）。
   */
  min-height: 42px;
}

.sf-vault-recheck {
  flex: none;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

/*
 * 开关的从属块：缩进 + 左侧竖线。比"把控件变灰"清楚——灰控件看不出是"归上面管"还是"坏了"。
 */
.sf-subblock {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
  padding-left: 12px;
  border-left: 2px solid var(--color-border);
}

.sf-field-note {
  margin-left: 6px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-style: normal;
}

/* 「套用一组」页脚：下拉底部的常驻一行，建议列表再长也压不住它。 */
.sf-combo-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.sf-combo-label {
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.sf-preset {
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-preset:hover {
  border-color: var(--color-text-tertiary);
  color: var(--color-text);
}

/* 选项右侧的次要说明（「库里 N 篇用过」）：数字弱化，名字照常。 */
.sf-option-meta {
  float: right;
  margin-left: 12px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.sf-tag-required {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--color-warning-soft);
  color: var(--color-warning);
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
}

/**
 * 拟 Obsidian 的笔记预览：白底卡片 = 那篇笔记，上半是属性面板、下半是正文。
 * 节奏照 Ob 的属性面板来：左列 92px 放属性名与类型图标，右列放值，行距 7px；
 * 列表值是 chip（灰底 + ×），tags 是紫色 chip（Ob 的标签就是这个色），
 * 原始链接是链接色 + 一个外链图标（**不做成真链接**：它是示例值，点过去只会 404）。
 */
.sf-ob-note {
  margin: 0 0 10px;
  padding: 12px 14px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-ob-props {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  row-gap: 7px;
  column-gap: 10px;
  margin: 0;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
}

.sf-ob-prop-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-help-size);
  line-height: 1.6;
}

.sf-ob-prop-value {
  margin: 0;
  min-width: 0;
  color: var(--color-text);
  font-size: var(--text-help-size);
  line-height: 1.6;
}

.sf-ob-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.sf-ob-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 5px 0 6px;
  border-radius: 4px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-size: var(--text-help-size);
  line-height: 18px;
}

/**
 * 标签 chip 的底色是 Ob 那个淡紫（`--color-accent-indigo-soft`），但**文字不用 `--color-accent-indigo`**：
 * 那个紫在 12px 下压在淡紫底上只有 3.86:1，不到 AA 的 4.5:1（Obsidian 自己用的紫比这个令牌深）。
 * 所以底色保留淡紫做"这是标签"的信号，文字走次要色（6.3:1）。
 */
.sf-ob-chip--tag {
  background: var(--color-accent-indigo-soft);
}

.sf-ob-chip-x {
  color: var(--color-text-tertiary);
}

.sf-ob-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-brand-pressed);
}

.sf-ob-body {
  padding-top: 10px;
}

.sf-ob-title {
  margin: 0 0 6px;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
}

.sf-ob-heading {
  margin: 10px 0 4px;
  color: var(--color-text);
  font-size: var(--text-body-size);
  font-weight: 600;
  line-height: 1.6;
}

.sf-ob-text {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-help-size);
  line-height: var(--text-leading);
}

.sf-ob-wikilink {
  color: var(--color-accent-indigo);
}

/* 两个自动标签（来源 / UP 主）的开关：它们不在下面的词库里，用一层浅框与词库编辑器分开 */
.sf-auto-tags {
  margin: 4px 0 14px;
  padding: 12px 14px 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.sf-auto-tags .sf-hint {
  margin-bottom: 8px;
}

/* ============================ 词库编辑器（三种显示样式共用一套结构） ============================ */

.sf-tag-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 2px 0 10px;
}

/* 图标按钮的形状照抄同一块里的组头图标按钮（`.sf-tag-icon-btn`：24×24、透明底、hover 淡灰），
   但三段之间留 4px 间隙——拼接式分段控件的选中描边会与邻居共边而被邻居盖掉（见模板里的注释）。
   24×24 也正好是 WCAG 2.5.8 的目标尺寸下限。 */
.sf-tag-view-group {
  gap: 4px;
}

.sf-tag-view-group :deep(.el-radio-button .el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-tertiary);
  /* 干掉 EP 每段自带的那圈 1px 浅描边：未选中的按钮靠图标本身就已经能认出来，
     轮廓留给选中态去表达（下面那条）。 */
  outline: none;
  /* **不能留 EP 的 `transition: all .3s`**：它会把 outline 一起动画，而基态 outline 的
     computed 颜色是 `currentColor`（悬停时就是近黑），于是选中瞬间先冒出一条近黑描边、
     再用约 250ms 褪成灰——用户报的「选中之后的异常黑边动效」就是它。
     实测时间线（灰色深浅）：0ms 近黑 → 40ms 几乎不变 → 150ms 明显变浅 → 250ms 才到 `--color-text-tertiary`。
     只保留底色与图标色淡入，描边就"出现即到位"（依据与实测见 docs/research/view-mode-switcher-research.md §11）。 */
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}

.sf-tag-view-group :deep(.el-radio-button .el-radio-button__inner:hover) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

/* 选中：淡灰底 + 一圈达标的描边 + 图标换成正文色（分开排之后这圈描边独占自己的边，不会被邻居盖住）。
   描边色用 `--color-text-secondary`：**这里要按真实相邻色算**——设置页正文的底色是 `--color-bg`（不是白），
   `--color-text-tertiary` 对它只有 **2.877:1**，不到 WCAG 1.4.11 要的 3:1；
   换成 secondary 后实测 **6.276:1**（内侧对自己那层淡灰底也过 6:1）。
   早先那句"对白底 3.14:1 达标"是按白底算的，用在设置页这一处是错的，已改。 */
.sf-tag-view-group :deep(.el-radio-button.is-active .el-radio-button__inner) {
  background: var(--color-ink-soft);
  color: var(--color-text);
  outline: 1px solid var(--color-text-secondary);
}

/* 键盘焦点环要压在选中态之上，否则聚焦到已选中那格时看不出焦点在哪。
   间隙 4px > offset 1px + 环宽 2px，所以这个环也不会碰到邻居。 */
.sf-tag-view-group :deep(.el-radio-button .el-radio-button__original-radio:focus-visible + .el-radio-button__inner) {
  outline: 2px solid var(--color-text);
  outline-offset: 1px;
}

/* 只给读屏看的名字：图标按钮没有文字，可访问名得有个来源。 */
.sf-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.sf-tag-tree {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 2px;
}

.sf-tag-group {
  padding: 8px 10px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-tag-group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 24px;
}

.sf-tag-caret {
  width: 14px;
  border: none;
  background: transparent;
  padding: 0;
  color: var(--color-text-tertiary);
  font-size: 10px;
  cursor: pointer;
}

.sf-tag-caret:hover {
  color: var(--color-text);
}

/* 一级的色相标记：8px 实色点，只有彩色模式显示（它是"这属于哪一组"最强的信号） */
.sf-tag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.sf-tag-group-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-tag-group-count {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-tag-group-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 组头上的三个动作常显：复制搜索串 / 加一个二级 / 重命名与删除。
   原来"删除一级"是一个红按钮常驻、复制藏在"点名字"这种自造手势里——两头都不对。 */
.sf-tag-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
}

.sf-tag-icon-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-tag-group-menu {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 2px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

.sf-tag-menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.sf-tag-menu-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.sf-tag-menu-btn--danger:hover {
  color: var(--color-error);
}

.sf-tag-body {
  margin-top: 6px;
}

.sf-tag-empty {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-tag-link-btn {
  border: none;
  background: transparent;
  padding: 0 2px;
  font: inherit;
  font-size: 11px;
  color: var(--color-brand-pressed);
  cursor: pointer;
  text-decoration: underline;
}

.sf-tag-children {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

/* ---- 二级 chip：24px 高、6px 圆角、常显删除（对比度 6.23 已实测）---- */

.sf-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 2px 0 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1;
}

.sf-tag-chip:hover {
  border-color: var(--color-border-strong);
}

.sf-tag-chip:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 1px;
}

/* 拖拽把手：16px 槽位**常驻**（避免 hover 时重排），淡显、指向 chip 时变实 */
.sf-tag-chip-grip {
  width: 16px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--color-text-tertiary);
  font-size: 9px;
  letter-spacing: -1px;
  opacity: 0.45;
  cursor: grab;
}

.sf-tag-chip:hover .sf-tag-chip-grip {
  opacity: 1;
}

.sf-tag-chip--dragging {
  opacity: 0.4;
}

/* 落点线 2px：Atlassian 的拖拽规格就是这个粗细 */
.sf-tag-chip--over {
  box-shadow: -2px 0 0 0 var(--color-text);
}

.sf-tag-chip-name {
  border: none;
  background: transparent;
  padding: 0 2px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  cursor: text;
}

.sf-tag-chip-usage {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.sf-tag-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.sf-tag-chip-remove:hover {
  color: var(--color-error);
  background: var(--color-error-soft);
}

/* 上移 / 下移：只在"指向或焦点在这一项"时浮现（指针路径）；键盘走 Alt+↑/↓。
   给它们设 tabindex=-1，所以不会把 Tab 停靠点从 55 抬到 79。 */
.sf-tag-chip-move {
  display: inline-flex;
  align-items: center;
  opacity: 0;
  pointer-events: none;
}

.sf-tag-chip:hover .sf-tag-chip-move,
.sf-tag-chip:focus-within .sf-tag-chip-move {
  opacity: 1;
  pointer-events: auto;
}

.sf-tag-chip-move-btn {
  width: 16px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.sf-tag-chip-move-btn:hover:not(:disabled) {
  background: var(--color-surface);
  color: var(--color-text);
}

.sf-tag-chip-move-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.sf-tag-chip-input {
  width: 120px;
}

.sf-tag-add-input {
  width: 148px;
}

.sf-tag-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 8px;
  border: 1px dashed var(--color-border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sf-tag-add-btn:hover {
  border-color: var(--color-text);
  color: var(--color-text);
}

.sf-tag-add-group {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

/* ---- 模式差异 ---- */

/* 单色：不上色，chip 就是一块浅灰（色点也不画，由模板的 v-if 控制） */
.sf-tag-tree--plain .sf-tag-chip {
  background: var(--color-surface-muted);
}

/* 清单：一行一个标签，带用量条——标签多的时候最好扫；
   代价是竖向更高（实测 24 个标签会到 1043px，比 chip 版高不少），所以它是"可选"而不是默认。 */
.sf-tag-tree--list .sf-tag-children {
  display: block;
}

.sf-tag-tree--list .sf-tag-chip {
  display: flex;
  width: 100%;
  height: 26px;
  border-color: transparent;
  background: transparent;
  border-radius: 5px;
}

.sf-tag-tree--list .sf-tag-chip:hover {
  background: var(--color-surface-muted);
}

.sf-tag-tree--list .sf-tag-chip-name {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.sf-tag-tree--list .sf-tag-chip-usage {
  width: 34px;
  text-align: right;
}

.sf-tag-tree--list .sf-tag-add-btn {
  width: 100%;
  justify-content: flex-start;
  border-style: dashed;
}


.sf-settings-desc--warn {
  color: var(--color-warning);
}

/* 重新预估期间：结果还在（避免整块塌陷），但压暗表示这组数字正在被重新计算。 */
.sf-nutstore-result.is-stale {
  opacity: 0.6;
}

.sf-nutstore-result {
  margin-top: 8px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}.sf-nutstore-result-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-nutstore-result-detail {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-nutstore-result-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-nutstore-result-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.sf-nutstore-result-list li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  font-size: 11px;
}

.sf-nutstore-result-list--error li {
  background: var(--color-error-soft);
}

.sf-nutstore-result-path {
  color: var(--color-text);
  font-weight: 500;
  word-break: break-all;
}

.sf-nutstore-result-reason {
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.sf-nutstore-result-more {
  color: var(--color-text-tertiary);
}

.sf-nutstore-backup-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0 6px;
}

.sf-nutstore-backup-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-nutstore-backup-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 4px;
}

.sf-nutstore-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 4px;
}

.sf-nutstore-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.sf-nutstore-more {
  background: transparent;
  border: 1px solid var(--color-border);
}

.sf-nutstore-preview {
  margin: 4px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}
</style>
