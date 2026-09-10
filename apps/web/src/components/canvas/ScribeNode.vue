<script setup lang="ts">
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { ElInput, ElMessageBox, ElSwitch, ElTooltip, ElUpload, type UploadRequestOptions } from "element-plus";
import { PhBookOpenText, PhCloud, PhDotsThreeVertical, PhFileArrowDown, PhFileText, PhGitBranch, PhGitMerge, PhListChecks, PhMagicWand, PhMicrophone, PhPlay, PhShareNetwork, PhSlidersHorizontal, PhSparkle, PhSwap, PhTreeStructure, PhUploadSimple, PhVideo } from "@phosphor-icons/vue";
import { CircleAlert } from "lucide-vue-next";
import { toast } from "@/lib/toast";
import { Handle, Position, useVueFlow, type NodeProps } from "@vue-flow/core";
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodePick, type NodeType, type UploadedFile, type VideoPreview } from "@scribe-flow/shared";
import ModelSelect from "../ModelSelect.vue";
import NodeFieldLabel from "./NodeFieldLabel.vue";
import IfCard from "./node-cards/IfCard.vue";
import TextToolCard from "./node-cards/TextToolCard.vue";
import ChapterCard from "./node-cards/ChapterCard.vue";
import RetryFields from "./node-cards/RetryFields.vue";
import ObsidianCard from "./node-cards/ObsidianCard.vue";
import DrillCard from "./node-cards/DrillCard.vue";
import PickCard from "./node-cards/PickCard.vue";
import PickFields from "./node-cards/PickFields.vue";
import { useSegmentPick } from "@/composables/useSegmentPick";
import { renderMarkdown } from "@/lib/markdown";
import { usePromptsStore } from "@/stores/prompts";
import { api } from "@/lib/api";
import type { NodePreviewOutput, ScribeNodeData } from "@/utils/flow";

/**
 * 思维导图节点的右下角预览渲染器：复用 MindMapViewer（markmap）渲染真实导图。
 * 按需异步加载，避免 markmap/d3 依赖拖累画布主包；加载与失败时给出内联占位提示。
 */
const MindMapPreview = defineAsyncComponent({
  loader: () => import("../MindMapViewer.vue"),
  delay: 0,
  loadingComponent: () =>
    h(
      "div",
      { class: "sf-node-result-preview__mindmap-hint" },
      h("span", { class: "sf-loading-hint" }, [
        h("span", { class: "sf-loading-spinner", "aria-hidden": "true" }),
        "正在渲染思维导图…",
      ]),
    ),
  errorComponent: () => h("div", { class: "sf-node-result-preview__mindmap-hint sf-node-result-preview__mindmap-hint--error" }, "思维导图渲染器加载失败"),
});

const props = defineProps<NodeProps<ScribeNodeData>>();

const { viewport } = useVueFlow();
const flowZoom = computed(() => viewport.value.zoom);
const flowMenuStyle = computed(() => ({ zoom: String(flowZoom.value) }));
provide("sf-flow-zoom", flowZoom);

const promptsStore = usePromptsStore();
const data = computed(() => props.data);

const selectedPages = ref<number[]>([]);
/** UGC 合集（多独立稿件）里勾选的集，用各集 bvid 标识。 */
const seasonSelected = ref<string[]>([]);

const biliItems = computed(() => (Array.isArray(data.value.items) ? data.value.items : []));
const distinctBvids = computed(() => new Set(biliItems.value.map((item) => item.bvid)).size);
const isCollection = computed(() => biliItems.value.length > 1);

/** 合集/多P列表行的标题：同一视频的多P合并行显示“P序号·分P名”，多视频各自保留主标题。 */
function collectionRowTitle(item: (typeof biliItems.value)[number]): string {
  if (distinctBvids.value <= 1 && item.part) return `P${item.page} · ${item.part}`;
  return item.title || item.part || (item.page ? `P${item.page}` : "");
}

async function uploadFile(options: UploadRequestOptions) {
  const form = new FormData();
  form.append("file", options.file);
  try {
    const result = await api.upload<UploadedFile>("/api/files/upload", form);
    patch({ fileId: result.fileId, fileName: result.fileName, filePath: result.storedPath, size: result.size });
    commit();
    toast.success(`已上传「${result.fileName}」`);
    options.onSuccess?.(result);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "上传失败");
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
      // UGC 合集：默认勾选当前链接所在的这一集，供用户扩展选择其他集。
      seasonSelected.value = [];
      if (result.ugcSeason && result.ugcSeason.episodes.length > 0) {
        const own = result.ugcSeason.episodes.find((ep) => ep.bvid === result.bvid);
        if (own) seasonSelected.value = [own.bvid];
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
  toast.success(items.length > 1 ? `已选择 ${items.length} 个分P，合并为一张卡片` : `已选择 P${first.page}`);
}

function toggleSeasonEpisode(bvid: string) {
  seasonSelected.value = seasonSelected.value.includes(bvid)
    ? seasonSelected.value.filter((b) => b !== bvid)
    : [...seasonSelected.value, bvid];
}

function confirmSeasonSelection() {
  const current = preview.value;
  const season = current?.ugcSeason;
  if (!current || !season) return;
  const picked = season.episodes.filter((ep) => seasonSelected.value.includes(ep.bvid));
  if (picked.length === 0) return;
  const first = picked[0];
  const single = picked.length === 1;
  if (single) {
    // 只选当前集：切换到该集的独立稿件链接（合集各集是不同的 BV）。
    const next = {
      ...current,
      bvid: first.bvid,
      cid: first.cid,
      title: first.part,
      duration: first.duration,
      cover: first.cover || current.cover,
      pages: [{ page: 1, cid: first.cid, part: first.part, duration: first.duration }],
    };
    preview.value = next;
    selectedPages.value = [1];
    seasonSelected.value = [first.bvid];
    patch({
      items: [],
      url: `https://www.bilibili.com/video/${first.bvid}`,
      bvid: first.bvid,
      title: first.part,
      cover: first.cover || current.cover,
      uploader: current.uploader,
      duration: first.duration,
      pageInfo: { cid: first.cid, page: 1, part: first.part, duration: first.duration },
    });
  } else {
    const items = picked.map((ep) => ({
      bvid: ep.bvid,
      cid: ep.cid,
      page: 1,
      part: ep.part,
      title: ep.part,
      cover: ep.cover || current.cover,
      uploader: current.uploader,
      duration: ep.duration,
    }));
    patch({
      items,
      url: String(data.value.url ?? "") || `https://www.bilibili.com/video/${current.bvid}`,
      bvid: current.bvid,
      title: current.title,
      cover: current.cover,
      uploader: current.uploader,
      duration: first.duration,
      pageInfo: { cid: first.cid, page: 1, part: first.part, duration: first.duration },
    });
  }
  props.data.ctx?.commit();
  toast.success(single ? `已切换到第 ${first.index} 集` : `已选择 ${picked.length} 集，合并为一张卡片`);
}

/**
 * 节点内部滚动列表的滚轮守卫：
 * - 只要光标还在列表内，滚轮事件一律不再冒泡到画布（**滑到边界也不会变成缩放画布**）；
 * - 列表还能继续滚动时保留默认滚动；
 * - 已到边界时 preventDefault，避免滚动链把滚动继续传给外层容器。
 */
function onInnerListWheel(event: WheelEvent) {
  event.stopPropagation();
  const el = event.currentTarget as HTMLElement;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  const canScroll = event.deltaY < 0 ? !atTop : !atBottom;
  if (!canScroll) event.preventDefault();
}

/**
 * 文本框/文本域内的滚轮守卫：光标在输入类控件里时，滚轮不再冒泡到画布缩放。
 * 只 stopPropagation，不阻止默认行为，因此文本域自身的滚动仍然保留。
 */
function onNodeBodyWheel(event: WheelEvent) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest("input, textarea, [contenteditable]")) return;
  event.stopPropagation();
}

onMounted(() => {
  // 多选收藏卡片不需要解析“第一个视频”的预览，所有项平等展示。
  if (props.data.url && !isCollection.value) schedulePreview(props.data.url);
});

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  previewLoadSeq += 1;
  clearPreviewTimers();
});

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const nodeType = computed<NodeType>(() => props.data.nodeType);
/** 思维导图节点的预览走“渲染后的导图”，其余节点维持文字/富文本预览。 */
const isMindMapNode = computed(() => nodeType.value === "process.mindmap");
const ports = computed(() => NODE_PORTS[nodeType.value]);
const defaultLabel = computed(() => NODE_TYPE_LABELS[nodeType.value]);
const label = computed(() => props.data.label || defaultLabel.value);
/** 运行进行中画布只读：可查看节点/结果，但不能修改节点配置或结构。 */
const readonly = computed(() => Boolean(props.data.ctx?.readonly));

/**
 * 素材挑选：上游可挑素材由 useSegmentPick 统一算出（与「素材挑选」节点卡片共用一份逻辑）。
 * 单素材链路返回空数组，选择器与「高级设置」入口都不出现——不靠藏，是真的没有。
 */
const { options: pickOptions, staleKeys: pickStale, visible: hasPickSection, selectedCount: pickSelectedCount } = useSegmentPick(
  () => props.data,
  () => props.id,
);

function patchPick(value: NodePick) {
  patch({ pick: Object.keys(value).length > 0 ? value : undefined });
  commit();
}

// 若运行开始时焦点正在节点表单里，主动失焦，避免只读后仍能继续键入造成“改了但没生效”的误解。
watch(readonly, (locked) => {
  if (!locked) return;
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest(".sf-node-body")) active.blur();
});

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
  "flow.pick": "只放行其中几段素材",
  "process.text": "查找替换、正则或模板等文本处理",
  "process.chapter": "将长文稿切分为章节笔记",
  "process.gameguide": "将阴阳师攻略文稿整理为结构化攻略笔记",
  "process.mindmap": "将文稿整理为思维导图 Markdown",
  "process.obsidian": "将结果写入 Obsidian 笔记库",
  "process.drill": "从文稿提炼可考察的知识点并出题，在结果页答题",
};

const nodeDescription = computed(() => nodeDescriptions[nodeType.value] ?? "");

const hasAdvanced = computed(() => {
  const base = [
    "source.bili",
    "source.file",
    "process.transcribe",
    "process.refine",
    "process.prompt",
    "process.chapter",
    "process.gameguide",
    "process.mindmap",
    "process.drill",
  ].includes(nodeType.value);
  // 可挑选素材的节点也要能打开高级设置（合并/输出等节点同样需要按素材挑选）。
  // 「素材挑选」节点自身的挑选就在卡片正文里，不必再给一个重复入口。
  return base || (hasPickSection.value && nodeType.value !== "flow.pick");
});
const isVideoSource = computed(() => nodeType.value === "source.bili" || nodeType.value === "source.file");
/** 来源节点的「高级设置」不涉及失败重试，标题保持简洁。 */
const advancedTitle = computed(() => (isVideoSource.value || nodeType.value === "process.mindmap" ? "高级设置" : "高级（失败重试）"));
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

/**
 * 卡片是否需要渲染正文区。
 * process.refine（AI 校对）、process.mindmap（思维导图）节点默认无内联表单，
 * 不渲染空 body，让顶部栏与底部栏直接相连；仅当展开「高级设置」时才需要正文容器。
 */
const noInlineFormTypes: NodeType[] = ["process.refine", "process.mindmap"];
const hasBodyContent = computed(() => !noInlineFormTypes.includes(nodeType.value) || advancedOpen.value);

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
    case "process.gameguide":
      return PhSparkle;
    case "process.mindmap":
      return PhShareNetwork;
    case "process.obsidian":
      return PhBookOpenText;
    case "process.drill":
      return PhListChecks;
  }
});

const statusClass = computed(() => (props.data.status ? `is-${props.data.status}` : "is-idle"));
const sizeClass = computed(() => `sf-node--${nodeType.value.replaceAll(".", "-")}`);

const canViewOutput = computed(() =>
  ["source.text", "process.transcribe", "process.refine", "process.prompt", "process.merge", "process.output", "flow.if", "process.text", "process.chapter", "process.gameguide", "process.mindmap", "process.obsidian"].includes(
    nodeType.value,
  ),
);

const hasResult = computed(() => Boolean(data.value.summary));
/** 底部状态条可悬停预览：仅已完成、有摘要、类型可查看输出且数据通路可用（运行/跳过/失败不弹）。 */
const canPreview = computed(
  () => props.data.status === "done" && hasResult.value && canViewOutput.value && Boolean(props.data.ctx?.fetchNodeOutput),
);

// ---------- 底部状态条 → 悬停预览浮层 ----------
const previewOpen = ref(false);
const previewPinned = ref(false);
const outputPreviewLoading = ref(false);
const outputPreviewError = ref("");
const previewOutput = ref<NodePreviewOutput | null>(null);
/** 多输入分段：-1 = 合并全文；>=0 = 选中第 N 段。默认落在第 1 段，不再把 8 个视频塞成一整段。 */
const previewSegmentIndex = ref(-1);
let previewOpenTimer: ReturnType<typeof setTimeout> | null = null;
let previewCloseTimer: ReturnType<typeof setTimeout> | null = null;
let previewLoadSeq = 0;

const previewSegments = computed(() => previewOutput.value?.segments ?? []);
const previewSegment = computed(
  () => previewSegments.value.find((segment) => segment.index === previewSegmentIndex.value) ?? null,
);
/** 分段下拉的展开态（浮层内联列表，不做二级 Portal，避免嵌套浮层互相关闭）。 */
const segmentListOpen = ref(false);
const previewFullChars = computed(() => (previewOutput.value?.text ?? "").replace(/\s/g, "").length);
const previewText = computed(() => previewSegment.value?.text || previewOutput.value?.text || data.value.preview || "");
const renderedPreviewText = computed(() => (previewText.value ? renderMarkdown(previewText.value) : ""));
const previewTitle = computed(() => previewOutput.value?.nodeLabel || label.value);
const previewRunLabel = computed(() => (previewOutput.value?.runId ? `运行 #${previewOutput.value.runId.slice(-6)}` : ""));
const previewCharLabel = computed(() => {
  const text = previewText.value;
  if (!text) return "";
  const count = text.replace(/\s/g, "").length;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k 字` : `${count} 字`;
});

/** 打开浮层时先落到第 1 段：默认视图本身就是「一个视频的完整结果」。 */
function resetPreviewSegment() {
  previewSegmentIndex.value = previewSegments.value.length > 1 ? 0 : -1;
  segmentListOpen.value = false;
}

function choosePreviewSegment(index: number) {
  previewSegmentIndex.value = index;
  segmentListOpen.value = false;
}

function fmtSegmentChars(size: number): string {
  if (!size) return "";
  return size >= 10000 ? `${(size / 10000).toFixed(1)} 万字` : `${size} 字`;
}

/** 顺序切段：只在 1..N 之间走，「全文」由下拉列表进入（避免顺序阅读时误跳合并稿）。 */
function stepPreviewSegment(delta: number) {
  const count = previewSegments.value.length;
  if (count === 0) return;
  const current = previewSegmentIndex.value;
  const next = current < 0 ? (delta > 0 ? 0 : -1) : Math.min(count - 1, Math.max(0, current + delta));
  if (next !== current) previewSegmentIndex.value = next;
}

function clearPreviewOpenTimer() {
  if (previewOpenTimer) clearTimeout(previewOpenTimer);
  previewOpenTimer = null;
}

function clearPreviewCloseTimer() {
  if (previewCloseTimer) clearTimeout(previewCloseTimer);
  previewCloseTimer = null;
}

function clearPreviewTimers() {
  clearPreviewOpenTimer();
  clearPreviewCloseTimer();
}

/** 离开预览相关的运行态（重跑/状态变化）时清空内容，避免下次悬停展示旧结果。 */
function resetPreview() {
  previewLoadSeq += 1;
  clearPreviewTimers();
  previewOpen.value = false;
  previewPinned.value = false;
  outputPreviewLoading.value = false;
  outputPreviewError.value = "";
  previewOutput.value = null;
  previewSegmentIndex.value = -1;
  segmentListOpen.value = false;
}

function schedulePreviewOpen() {
  if (previewPinned.value) return;
  clearPreviewCloseTimer();
  if (previewOpenTimer) return;
  previewOpenTimer = setTimeout(() => {
    previewOpenTimer = null;
    previewOpen.value = true;
    void ensurePreviewOutput();
  }, 250);
}

function schedulePreviewClose() {
  if (previewPinned.value) return;
  clearPreviewOpenTimer();
  if (previewCloseTimer) return;
  // 留出从触发条移动到浮层的“桥接”时间，避免面板一闪而过。
  previewCloseTimer = setTimeout(() => {
    previewCloseTimer = null;
    previewOpen.value = false;
  }, 180);
}

function onPreviewTriggerEnter() {
  if (previewPinned.value) return;
  clearPreviewCloseTimer();
  schedulePreviewOpen();
}

function onPreviewTriggerLeave() {
  schedulePreviewClose();
}

function onPreviewContentEnter() {
  if (previewPinned.value) return;
  clearPreviewCloseTimer();
  if (!previewOpen.value) {
    previewOpen.value = true;
    void ensurePreviewOutput();
  }
}

function onPreviewContentLeave() {
  schedulePreviewClose();
}

/** 点击触发条 = 固定/取消固定（在捕获阶段拦截，避免 Reka 自带的 toggle 覆盖 pin 语义）。 */
function onPreviewTriggerClickCapture(event: MouseEvent) {
  event.stopPropagation();
  activatePreview();
}

function onPreviewTriggerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activatePreview();
}

function activatePreview() {
  if (previewPinned.value) {
    previewPinned.value = false;
    previewOpen.value = false;
  } else {
    previewPinned.value = true;
    previewOpen.value = true;
    void ensurePreviewOutput();
  }
}

function openFullPreview() {
  const segmentIndex = previewSegment.value?.index;
  previewPinned.value = false;
  previewOpen.value = false;
  props.data.ctx?.viewOutput(segmentIndex);
}

async function ensurePreviewOutput() {
  const fetchOutput = props.data.ctx?.fetchNodeOutput;
  if (!fetchOutput || outputPreviewLoading.value || previewOutput.value) return;
  const seq = ++previewLoadSeq;
  outputPreviewLoading.value = true;
  outputPreviewError.value = "";
  try {
    const output = await fetchOutput();
    if (seq !== previewLoadSeq) return;
    if (output) {
      previewOutput.value = output;
      resetPreviewSegment();
    } else {
      outputPreviewError.value = "未找到该节点的运行输出";
    }
  } catch (err) {
    if (seq !== previewLoadSeq) return;
    outputPreviewError.value = err instanceof Error ? err.message : "完整输出加载失败";
  } finally {
    if (seq === previewLoadSeq) outputPreviewLoading.value = false;
  }
}

watch(previewOpen, (open) => {
  if (open) {
    // 点击固定发生在悬停 250ms 定时器尚未触发之前时，作废该定时器。
    clearPreviewOpenTimer();
    return;
  }
  previewPinned.value = false;
  clearPreviewTimers();
});

watch(
  () => props.data.status,
  (status) => {
    if (status !== "done") resetPreview();
  },
);

watch(canPreview, (ok) => {
  if (!ok) resetPreview();
});

function onNodeDoubleClick(event: MouseEvent) {
  if (!canViewOutput.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, button, select, [contenteditable], .el-upload, .el-select, .el-input-number, .sf-model-select, .sf-node-run-btn")) return;
  props.data.ctx?.viewOutput();
}

const asrOptions = [
  { label: "MiMo-V2.5", value: "mimo", icon: PhMicrophone },
  { label: "OpenAI 兼容", value: "openai-compatible", icon: PhCloud },
];

const gameGuideModeOptions = [
  { label: "核对版（推荐，稳）", value: "audited", icon: PhSparkle },
  { label: "快速版（省时）", value: "standard", icon: PhSparkle },
];

const promptOptions = computed(() =>
  promptsStore.allBlocks
    .filter((block) => block.series !== "阴阳师攻略加工")
    .map((block) => {
      const parts = [block.name];
      if (block.version) parts.push(block.version);
      if (block.recipe) parts.push("配方");
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

const gameGuideMode = computed<string>({
  get: () => (data.value.mode as string | undefined) ?? "audited",
  set: (value) => {
    patch({ mode: value });
    commit();
  },
});

function patch(p: Record<string, unknown>) {
  props.data.ctx?.updateData(p);
}

function commit() {
  props.data.ctx?.commit();
}

/** keepVideo：下载完整视频并在结果页提供播放（B站/本地文件共用）。 */
const videoQnOptions = [
  { qn: 16, label: "360P" },
  { qn: 32, label: "480P" },
  { qn: 64, label: "720P" },
  { qn: 80, label: "1080P" },
];
const currentVideoQn = computed(() => Number(data.value.videoQn ?? 80));

function setKeepVideo(value: string | number | boolean) {
  const on = Boolean(value);
  patch({ keepVideo: on, ...(on && !data.value.videoQn ? { videoQn: 80 } : {}) });
  commit();
}

function setVideoQn(qn: number) {
  patch({ videoQn: qn });
  commit();
}

async function renameNode() {
  if (readonly.value) return;
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

function patchDrill(value: Record<string, unknown>) {
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
      <div class="sf-node" :class="[statusClass, sizeClass, { 'is-selected': props.selected, 'is-bodyless': !hasBodyContent, 'is-readonly': readonly }]" @dblclick="onNodeDoubleClick">
        <Handle
          v-for="port in ports.inputs"
          :key="port.id"
          :id="port.id"
          type="target"
          :position="Position.Left"
          class="sf-handle sf-handle--target"
        />

        <div v-if="props.selected" class="sf-node-selection-bar nodrag" :inert="readonly ? true : undefined">
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
                <DropdownMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="renameNode">重命名</DropdownMenuItem>
                <DropdownMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="props.data.ctx?.duplicate()">复制</DropdownMenuItem>
                <DropdownMenuItem class="sf-node-menu-item" :disabled="true" title="M4 接入">复制输出</DropdownMenuItem>
                <DropdownMenuSeparator class="sf-node-menu-sep" />
                <DropdownMenuItem class="sf-node-menu-item sf-node-menu-item--danger" :disabled="readonly" title="运行中不可编辑" @select="props.data.ctx?.remove()">删除</DropdownMenuItem>
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
            <el-tooltip v-if="data.status === 'error'" :content="data.summary || '节点运行失败'" placement="top" effect="dark" :show-after="120" :hide-after="0">
              <span class="sf-node-error-trigger" tabindex="0" aria-label="错误详情">
                <CircleAlert :size="14" />
              </span>
            </el-tooltip>
            <button
              type="button"
              class="sf-node-run-btn nodrag"
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

        <div v-if="hasBodyContent" class="sf-node-body nodrag" :inert="readonly ? true : undefined" @wheel="onNodeBodyWheel">
          <!-- 来源：B 站链接 / B 站多选收藏。多选时使用“平等列表”卡片，不再强调第一个视频。 -->
          <template v-if="nodeType === 'source.bili'">
            <template v-if="isCollection">
              <div class="sf-node-collection">
                <div class="sf-node-collection-head">
                  <span class="sf-node-collection-count tnum">{{ biliItems.length }} 项</span>
                  <span class="sf-node-collection-tag">{{ distinctBvids > 1 ? "多视频" : "多P" }}</span>
                </div>
                <div v-if="distinctBvids === 1 && (data.title || biliItems[0]?.title)" class="sf-node-collection-main" :title="data.title || biliItems[0]?.title">
                  {{ data.title || biliItems[0]?.title }}
                </div>
                <div class="sf-node-selected-list" @wheel="onInnerListWheel">
                  <div v-for="item in biliItems" :key="`${item.bvid}-${item.cid}`" class="sf-node-selected-row">
                    <template v-if="item.cover">
                      <div class="sf-node-selected-cover-wrap">
                        <img :src="item.cover" class="sf-node-selected-cover" alt="" referrerpolicy="no-referrer" loading="lazy" />
                        <span v-if="(item.duration ?? 0) > 0" class="sf-node-selected-cover-duration tnum">{{ fmtDuration(item.duration ?? 0) }}</span>
                      </div>
                    </template>
                    <div v-else class="sf-node-selected-cover sf-node-selected-cover--placeholder" />
                    <div class="sf-node-selected-info">
                      <span class="sf-node-selected-title" :title="collectionRowTitle(item)">{{ collectionRowTitle(item) }}</span>
                      <span v-if="item.uploader" class="sf-node-selected-meta tnum">{{ item.uploader }}</span>
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
              <div v-if="previewLoading" class="sf-node-preview sf-node-preview--loading tnum">
                <span class="sf-loading-spinner" aria-hidden="true" />
                <span>正在解析视频信息…</span>
              </div>
              <div v-else-if="preview" class="sf-node-preview">
                <div class="sf-node-cover-wrap">
                  <img :src="preview.cover" class="sf-node-cover" alt="视频封面" referrerpolicy="no-referrer" loading="lazy" />
                  <span v-if="preview.duration > 0" class="sf-node-cover-duration tnum">{{ fmtDuration(preview.duration) }}</span>
                </div>
                <div class="sf-node-preview-info">
                  <span class="sf-node-preview-title" :title="data.pageInfo?.part || preview.title">{{ data.pageInfo?.part || preview.title }}</span>
                  <span class="sf-node-preview-meta tnum">
                    {{ preview.uploader }}<template v-if="preview.pages.length > 1"> · {{ preview.pages.length }}P</template>
                  </span>
                </div>
              </div>
              <div v-else-if="previewError" class="sf-node-preview sf-node-preview--error">{{ previewError }}</div>
              <div v-if="preview && preview.pages.length > 1" class="sf-node-picker">
                <div class="sf-node-picker-head">
                  <span class="sf-node-picker-title">选择分P</span>
                  <span class="sf-node-picker-count tnum">共 {{ preview.pages.length }} P · 已选 {{ selectedPages.length }}</span>
                </div>
                <div class="sf-node-picker-list">
                  <label v-for="page in preview.pages" :key="page.page" class="sf-node-picker-row">
                    <input type="checkbox" class="sf-node-picker-check" :checked="selectedPages.includes(page.page)" @change="togglePage(page.page)" />
                    <span class="sf-node-picker-name">P{{ page.page }} · {{ page.part || `第 ${page.page} 集` }}</span>
                    <span class="sf-node-picker-duration tnum">{{ fmtDuration(page.duration) }}</span>
                  </label>
                </div>
                <div class="sf-node-picker-foot">
                  <span class="sf-node-picker-count tnum">{{ selectedPages.length > 0 ? `已选 ${selectedPages.length} 项` : "可多选" }}</span>
                  <button type="button" class="sf-node-picker-confirm" :disabled="selectedPages.length === 0" @click="confirmPageSelection">
                    生成所选分P
                  </button>
                </div>
              </div>
              <div v-if="preview && preview.ugcSeason && preview.ugcSeason.episodes.length > 0" class="sf-node-picker">
                <div class="sf-node-picker-head">
                  <span class="sf-node-picker-title" :title="preview.ugcSeason.title">合集《{{ preview.ugcSeason.title || "未命名合集" }}》</span>
                  <span class="sf-node-picker-count tnum">共 {{ preview.ugcSeason.episodes.length }} 集</span>
                </div>
                <div class="sf-node-picker-list" @wheel="onInnerListWheel">
                  <label v-for="ep in preview.ugcSeason.episodes" :key="ep.bvid" class="sf-node-picker-row">
                    <input type="checkbox" class="sf-node-picker-check" :checked="seasonSelected.includes(ep.bvid)" @change="toggleSeasonEpisode(ep.bvid)" />
                    <span class="sf-node-picker-name" :title="ep.part">{{ ep.part }}</span>
                    <span class="sf-node-picker-duration tnum">{{ fmtDuration(ep.duration) }}</span>
                  </label>
                </div>
                <div class="sf-node-picker-foot">
                  <span class="sf-node-picker-count tnum">{{ seasonSelected.length > 0 ? `已选 ${seasonSelected.length} 集` : "可多选" }}</span>
                  <button type="button" class="sf-node-picker-confirm" :disabled="seasonSelected.length === 0" @click="confirmSeasonSelection">
                    生成所选集数
                  </button>
                </div>
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
            <span class="sf-node-text-count tnum">{{ String(data.text ?? '').length }} / 50000</span>
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

          <template v-else-if="nodeType === 'flow.pick'">
            <PickCard
              :options="pickOptions"
              :pick="data.pick"
              :stale-keys="pickStale"
              :readonly="readonly"
              :selected-count="pickSelectedCount"
              @update="patchPick"
            />
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

          <template v-else-if="nodeType === 'process.gameguide'">
            <div class="sf-node-field">
              <span class="sf-node-field-label">整理强度</span>
              <ModelSelect v-model="gameGuideMode" :options="gameGuideModeOptions" size="small" placeholder="选择整理强度" :prefix-icon="PhSparkle" />
            </div>
            <p class="sf-node-desc sf-node-desc--block">输出：核心结论表 / 式神速查卡 / 配队 / 避坑 / 术语 / 版本时效</p>
          </template>

          <template v-else-if="nodeType === 'process.obsidian'">
            <ObsidianCard :folder="data.folder" @update="patchObsidian" />
          </template>

          <template v-else-if="nodeType === 'process.drill'">
            <DrillCard
              :point-count="data.pointCount"
              :kinds="data.kinds"
              :difficulty="data.difficulty"
              :with-extensions="data.withExtensions"
              :focus="data.focus"
              @update="patchDrill"
            />
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
            <div class="sf-node-advanced-title">{{ advancedTitle }}</div>
            <template v-if="isVideoSource">
              <div class="sf-node-advanced-row">
                <span class="sf-node-advanced-label" title="运行时下载完整视频，可在结果页直接播放；文件较大且默认不进云备份。">保留可播放视频</span>
                <el-switch size="small" :model-value="data.keepVideo === true" @update:model-value="setKeepVideo" />
              </div>
              <div v-if="data.keepVideo === true && nodeType === 'source.bili'" class="sf-node-advanced-qns">
                <button
                  v-for="opt in videoQnOptions"
                  :key="opt.qn"
                  type="button"
                  class="sf-node-advanced-qn"
                  :class="{ 'is-active': currentVideoQn === opt.qn }"
                  :aria-pressed="currentVideoQn === opt.qn"
                  :disabled="readonly"
                  @click="setVideoQn(opt.qn)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </template>
            <template v-else>
              <template v-if="nodeType === 'process.mindmap'">
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
                <div class="sf-node-advanced-subtitle">失败重试</div>
              </template>
              <template v-if="hasPickSection && nodeType !== 'flow.pick'">
                <div class="sf-node-advanced-subtitle">素材挑选</div>
                <PickFields :options="pickOptions" :pick="data.pick" :stale-keys="pickStale" :readonly="readonly" @update="patchPick" />
              </template>
              <RetryFields :retry="data.retry" @update="patchRetry" />
            </template>
          </div>
        </div>

        <div class="sf-node-result nodrag" :class="data.status ? `is-${data.status}` : 'is-idle'">
          <span class="sf-node-result-status" />
          <span class="sf-node-result-meta tnum">{{ data.summary }}</span>
          <PopoverRoot v-if="canPreview && data.delta" v-model:open="previewOpen">
            <PopoverTrigger as-child>
              <span
                class="sf-node-result-delta sf-node-result-delta--trigger tnum"
                :class="[`is-${data.delta.tone}`, { 'is-preview-open': previewOpen }]"
                role="button"
                tabindex="0"
                :aria-label="`${label} 结果变化：${data.delta.label}。悬停查看完整输出`"
                @click.capture="onPreviewTriggerClickCapture"
                @pointerenter="onPreviewTriggerEnter"
                @pointerleave="onPreviewTriggerLeave"
                @keydown.enter.prevent="onPreviewTriggerKeydown"
                @keydown.space.prevent="onPreviewTriggerKeydown"
                @dblclick.stop
              >
                {{ data.delta.label }}
              </span>
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent
                class="sf-node-result-preview"
                :class="{ 'is-mindmap': isMindMapNode }"
                side="top"
                align="start"
                :side-offset="6"
                :collision-padding="12"
                :style="flowMenuStyle"
                @open-auto-focus.prevent
                @pointerenter="onPreviewContentEnter"
                @pointerleave="onPreviewContentLeave"
              >
                <div class="sf-node-result-preview__head">
                  <span class="sf-node-result-preview__status" />
                  <span class="sf-node-result-preview__title">{{ previewTitle }}</span>
                  <span v-if="previewRunLabel" class="sf-node-result-preview__run tnum">{{ previewRunLabel }}</span>
                </div>
                <!-- 一个节点处理多个视频时：单行标题 + 下拉列表，不在 360px 里铺开 8 个按钮 -->
                <div v-if="previewSegments.length > 1" class="sf-node-result-preview__segments">
                  <div class="sf-seg-pick">
                    <button
                      type="button"
                      class="sf-seg-trigger"
                      aria-haspopup="listbox"
                      :aria-expanded="segmentListOpen"
                      :title="previewSegment ? `${previewSegment.index + 1}/${previewSegments.length} · ${previewSegment.label}` : `全文（${previewSegments.length} 段合并）`"
                      @click.stop="segmentListOpen = !segmentListOpen"
                      @keydown.down.prevent="stepPreviewSegment(1)"
                      @keydown.up.prevent="stepPreviewSegment(-1)"
                    >
                      <span class="sf-seg-trigger-idx tnum">
                        {{ previewSegmentIndex < 0 ? "—" : `${previewSegmentIndex + 1} / ${previewSegments.length}` }}
                      </span>
                      <span class="sf-seg-trigger-name">{{ previewSegment?.label || `全文（${previewSegments.length} 段合并）` }}</span>
                      <ChevronDown :size="12" class="sf-seg-trigger-caret" :class="{ 'is-open': segmentListOpen }" />
                    </button>
                    <button
                      type="button"
                      class="sf-seg-arrow"
                      aria-label="上一段"
                      :disabled="previewSegmentIndex <= -1"
                      @click.stop="stepPreviewSegment(-1)"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      class="sf-seg-arrow"
                      aria-label="下一段"
                      :disabled="previewSegmentIndex >= previewSegments.length - 1"
                      @click.stop="stepPreviewSegment(1)"
                    >
                      ›
                    </button>
                  </div>
                  <div v-if="segmentListOpen" class="sf-seg-list" role="listbox" aria-label="选择分段">
                    <button
                      v-for="segment in previewSegments"
                      :key="segment.inputId"
                      type="button"
                      role="option"
                      class="sf-seg-item"
                      :class="{ on: segment.index === previewSegmentIndex }"
                      :aria-selected="segment.index === previewSegmentIndex"
                      @click.stop="choosePreviewSegment(segment.index)"
                    >
                      <span class="sf-seg-item-idx tnum">{{ String(segment.index + 1).padStart(2, "0") }}</span>
                      <span class="sf-seg-item-name" :title="segment.label">{{ segment.label }}</span>
                      <span class="sf-seg-item-len tnum">{{ fmtSegmentChars(segment.size) }}</span>
                    </button>
                    <button
                      type="button"
                      role="option"
                      class="sf-seg-item sf-seg-item--full"
                      :class="{ on: previewSegmentIndex < 0 }"
                      :aria-selected="previewSegmentIndex < 0"
                      @click.stop="choosePreviewSegment(-1)"
                    >
                      <span class="sf-seg-item-idx tnum">—</span>
                      <span class="sf-seg-item-name">全文（{{ previewSegments.length }} 段合并）</span>
                      <span class="sf-seg-item-len tnum">{{ fmtSegmentChars(previewFullChars) }}</span>
                    </button>
                  </div>
                </div>
                <div class="sf-node-result-preview__body">
                  <div v-if="!previewText && outputPreviewLoading" class="sf-node-result-preview__hint sf-node-result-preview__hint--loading">
                    <span class="sf-loading-spinner" aria-hidden="true" />
                    <span>正在载入完整输出…</span>
                  </div>
                  <div v-else-if="!previewText && outputPreviewError" class="sf-node-result-preview__hint sf-node-result-preview__hint--error">{{ outputPreviewError }}</div>
                  <div v-else-if="previewText && isMindMapNode" class="sf-node-result-preview__mindmap">
                    <MindMapPreview :markdown="previewText" :animated="false" height="min(250px, calc(100vh - 212px))" />
                  </div>
                  <div v-else-if="previewText" class="sf-node-result-preview__markdown markdown-body" v-html="renderedPreviewText" />
                  <div v-else class="sf-node-result-preview__hint">该节点暂无文本输出</div>
                </div>
                <footer class="sf-node-result-preview__foot">
                  <span v-if="previewCharLabel" class="sf-node-result-preview__meta tnum">{{ previewCharLabel }}</span>
                  <span v-else-if="previewRunLabel" class="sf-node-result-preview__meta tnum">{{ previewRunLabel }}</span>
                  <button type="button" class="sf-node-result-preview__open" @click.stop="openFullPreview">查看完整输出</button>
                </footer>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
          <span v-else-if="data.delta" class="sf-node-result-delta tnum" :class="`is-${data.delta.tone}`">{{ data.delta.label }}</span>
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
        <ContextMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="renameNode">重命名</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="props.data.ctx?.duplicate()">复制</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M4 接入">复制输出</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item sf-node-menu-item--danger" :disabled="readonly" title="运行中不可编辑" @select="props.data.ctx?.remove()">删除</ContextMenuItem>
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
  cursor: default;
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
.sf-node--flow-pick {
  width: 280px;
}
.sf-node--process-text {
  width: 260px;
}
.sf-node--process-chapter {
  width: 240px;
}
.sf-node--process-gameguide {
  width: 300px;
}
.sf-node--process-mindmap {
  width: 300px;
}
.sf-node--process-obsidian {
  width: 300px;
}
.sf-node--process-drill {
  width: 300px;
}

.sf-node.is-selected {
  border-color: var(--control-border-focus);
}

/* 运行中只读：节点可查看/选中，但内部表单、上传、选择器等编辑区域不可交互。 */
.sf-node.is-readonly .sf-node-body,
.sf-node.is-readonly .sf-node-selection-bar {
  pointer-events: none;
  opacity: 0.82;
}

.sf-node.is-readonly .sf-node-head,
.sf-node.is-readonly .sf-node-head:active {
  cursor: default;
}

.sf-node.is-running {
  border-color: var(--node-running-border);
}

.sf-node.is-error {
  border-color: var(--color-error);
}

.sf-node.is-skipped {
  border-color: var(--color-border);
  opacity: 0.72;
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
  cursor: grab;
}

.sf-node-head:active {
  cursor: grabbing;
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
  cursor: grab;
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

/* 正文里的说明文字：换行完整显示，不做单行截断（头部那行空间有限才截断）。 */
.sf-node-desc--block {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  line-height: 1.55;
}

.sf-node-error-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--color-error);
  border-radius: 50%;
  cursor: help;
  flex-shrink: 0;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-node-error-trigger:hover,
.sf-node-error-trigger:focus-visible {
  color: var(--color-error);
  background: var(--color-error-soft);
  outline: none;
}

.sf-node-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 无正文卡片（如 AI 校对）：顶部栏与底部结果区直接相连，不留中间空白段 */
.sf-node.is-bodyless .sf-node-head {
  margin-bottom: 0;
}

.sf-node.is-bodyless .sf-node-result {
  margin-top: 0;
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

/* 预览热区只落在右侧 delta 徽标上：不提供任何 hover/聚焦视觉变化（无描边/阴影/滤镜），唯一反馈是 cursor */
.sf-node-result-delta--trigger {
  cursor: pointer;
  user-select: none;
}

.sf-node-result-delta--trigger:focus-visible {
  outline: none;
  box-shadow: none;
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
  animation: sf-pulse var(--dur-3) var(--ease-out) infinite alternate;
}

.sf-node-result.is-skipped .sf-node-result-status {
  background: var(--color-text-tertiary);
}

.sf-node-result-meta {
  flex: 1;
  min-width: 0;
  min-height: 1.4em;
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
  border-radius: var(--radius-xs);
  background: var(--color-surface);
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

.sf-node-cover-wrap {
  position: relative;
  display: flex;
  flex-shrink: 0;
}

.sf-node-cover {
  width: 96px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
}

.sf-node-cover-duration,
.sf-node-selected-cover-duration {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--color-scrim);
  color: var(--color-on-scrim);
  font-size: 10px;
  line-height: 16px;
  pointer-events: none;
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
  border-radius: var(--radius-xs);
  background: var(--color-surface);
}

.sf-node-selected-cover-wrap {
  position: relative;
  display: flex;
  flex-shrink: 0;
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
  /* 固定两行标题高度：无论 1 行还是 2 行标题，首行与下方 UP主 行在所有小卡间保持同一位置 */
  height: 2.8em;
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

.sf-node-collection-main {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

/* 选择面板（分P / UGC 合集）——与新版卡片语言一致：分隔线分组 + hover 行 + 自绘勾选框 */
.sf-node-picker {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.sf-node-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sf-node-picker-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-node-picker-count {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sf-node-picker-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 224px;
  margin-top: 8px;
  padding: 0 2px 2px;
  overflow-y: auto;
}

.sf-node-picker-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-text);
  cursor: pointer;
}

.sf-node-picker-row:hover {
  background: var(--color-ink-soft);
}

.sf-node-picker-check {
  position: relative;
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  appearance: none;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  cursor: pointer;
  transition: border-color var(--dur-1) var(--ease-out), background-color var(--dur-1) var(--ease-out);
}

.sf-node-picker-check:hover {
  border-color: var(--color-text-tertiary);
}

.sf-node-picker-check:checked {
  background: var(--color-ink);
  border-color: var(--color-ink);
}

.sf-node-picker-check:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid var(--color-surface);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.sf-node-picker-check:focus-visible {
  outline: 2px solid var(--color-text);
  outline-offset: 1px;
}

.sf-node-picker-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-node-picker-duration {
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sf-node-picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.sf-node-picker-confirm {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}

.sf-node-picker-confirm:hover:not(:disabled) {
  background: var(--color-ink-soft);
  border-color: var(--color-border-strong);
}

.sf-node-picker-confirm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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
  border-color: var(--color-border-strong);
  background: var(--color-ink-soft);
  color: var(--color-text);
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

.sf-node-text-count {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  text-align: right;
}

/* 高级设置：不用整行分割线，收进与 .sf-node-preview/.sf-node-picker 同级的柔和底纹小卡片 */
.sf-node-advanced {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted);
}

.sf-node-advanced-title {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary);
}

.sf-node-advanced-subtitle {
  margin-top: 12px;
  margin-bottom: 8px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-tertiary);
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

/* 结果预览浮层（Teleport 到 body）：基底/尺寸口径与 .sf-node-menu、.sf-model-select__menu 一致 */
.sf-node-result-preview {
  z-index: var(--z-dropdown-modal);
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100vw - 16px));
  max-width: calc(100vw - 16px);
  max-height: min(420px, calc(100vh - 32px));
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
  transform-origin: var(--reka-popper-transform-origin, top center);
  animation: sf-dropdown-in var(--dur-2) var(--ease-out);
}

.sf-node-result-preview[data-state="closed"] {
  animation: sf-dropdown-out var(--dur-1) var(--ease-out);
}

.sf-node-result-preview__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  flex-shrink: 0;
}

.sf-node-result-preview__status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  flex-shrink: 0;
}

.sf-node-result-preview__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-node-result-preview__run {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

/* 多输入分段选择：单行「03 / 08 标题 ▾」+ ‹ › 翻段；展开的列表浮在浮层内部（不嵌套 Portal） */
.sf-node-result-preview__segments {
  flex-shrink: 0;
  position: relative;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.sf-seg-pick {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sf-seg-trigger {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  cursor: pointer;
}

.sf-seg-trigger:hover {
  border-color: var(--color-border-strong);
  background: var(--color-ink-soft);
}

.sf-seg-trigger-idx {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-seg-trigger-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  text-align: left;
}

.sf-seg-trigger-caret {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform var(--dur-1) var(--ease-out);
}

.sf-seg-trigger-caret.is-open {
  transform: rotate(180deg);
}

.sf-seg-arrow {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.sf-seg-arrow:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-seg-arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sf-seg-list {
  position: absolute;
  top: calc(100% - 4px);
  left: 8px;
  right: 8px;
  z-index: var(--z-rail);
  max-height: 232px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}

.sf-seg-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.sf-seg-item:hover,
.sf-seg-item.on {
  background: var(--color-ink-soft);
}

.sf-seg-item-idx {
  flex-shrink: 0;
  width: 16px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-seg-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
}

.sf-seg-item-len {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.sf-seg-item--full {
  margin-top: 4px;
  border-top: 1px solid var(--color-border);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  color: var(--color-text-secondary);
}

.sf-node-result-preview__body {
  flex-shrink: 0;
}

.sf-node-result-preview__markdown {
  max-height: min(300px, calc(100vh - 210px));
  padding: 10px 14px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-secondary);
  word-break: break-word;
}

/* “缩小版”排版：标题紧凑、行距收紧，让长文一屏能多看到几段 */
.sf-node-result-preview__markdown h1,
.sf-node-result-preview__markdown h2,
.sf-node-result-preview__markdown h3,
.sf-node-result-preview__markdown h4 {
  margin: 8px 0 3px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.3;
}

.sf-node-result-preview__markdown h1 {
  font-size: 1.3em;
}

.sf-node-result-preview__markdown h2 {
  font-size: 1.18em;
}

.sf-node-result-preview__markdown h3 {
  font-size: 1.08em;
}

.sf-node-result-preview__markdown h4 {
  font-size: 1em;
}

.sf-node-result-preview__markdown p {
  margin: 4px 0;
}

.sf-node-result-preview__markdown ul,
.sf-node-result-preview__markdown ol {
  margin: 4px 0;
  padding-left: 18px;
}

.sf-node-result-preview__markdown li {
  margin: 2px 0;
}

.sf-node-result-preview__markdown blockquote {
  margin: 6px 0;
  padding: 2px 10px;
  border-left: 3px solid var(--color-border-strong);
  color: var(--color-text-tertiary);
}

.sf-node-result-preview__markdown pre {
  margin: 6px 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  overflow-x: auto;
  font-size: 11px;
}

.sf-node-result-preview__markdown code {
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.sf-node-result-preview__markdown img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}

.sf-node-result-preview__markdown table {
  font-size: 11px;
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.sf-node-result-preview__markdown hr {
  margin: 8px 0;
  border: none;
  border-top: 1px solid var(--color-border);
}

.sf-node-result-preview__hint {
  padding: 26px 16px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  text-align: center;
}

.sf-node-result-preview__hint--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.sf-node-result-preview__hint--error {
  color: var(--color-error);
}

.sf-node-result-preview__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 3px 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  flex-shrink: 0;
}

.sf-node-result-preview__meta {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.sf-node-result-preview__open {
  padding: 3px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}

.sf-node-result-preview__open:hover {
  background: var(--color-ink-soft);
}

/* 面板内文字按钮：聚焦用浅色背景反馈，不画 outline */
.sf-node-result-preview__open:focus-visible {
  outline: none;
  box-shadow: none;
  background: var(--color-ink-soft);
}

/* 思维导图节点预览：浮层加宽给导图留足横向空间，内嵌渲染器与画布/详情页同源 */
.sf-node-result-preview.is-mindmap {
  width: min(440px, calc(100vw - 16px));
}

.sf-node-result-preview__mindmap {
  /* 与内嵌渲染器同高：异步装入前后浮层高度一致，避免内容长高导致浮层二次定位（抖动） */
  min-height: min(250px, calc(100vh - 212px));
  padding: 10px 12px 12px;
}

.sf-node-result-preview.is-mindmap .sf-node-result-preview__mindmap-hint {
  display: grid;
  place-items: center;
  min-height: calc(min(250px, calc(100vh - 212px)) - 22px);
  padding: 12px;
}

.sf-node-result-preview__mindmap-hint {
  padding: 26px 16px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  text-align: center;
}

.sf-node-result-preview__mindmap-hint--error {
  color: var(--color-error);
}

/* keepVideo 选项（高级设置内）：紧凑单行，中性色 */
.sf-node-advanced-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 24px;
}

.sf-node-advanced-row + .sf-node-advanced-row {
  margin-top: 4px;
}

.sf-node-advanced-label {
  font-size: 12px;
  color: var(--color-text);
}

.sf-node-advanced-qns {
  display: flex;
  gap: 2px;
  margin-top: 6px;
}

.sf-node-advanced-qn {
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.sf-node-advanced-qn:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-node-advanced-qn.is-active {
  border-color: var(--color-border-strong);
  background: var(--color-ink-soft);
  color: var(--color-text);
  font-weight: 500;
}

.sf-node-advanced-qn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
