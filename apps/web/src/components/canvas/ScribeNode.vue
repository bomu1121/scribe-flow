<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch, type Component } from "vue";
import { useRouter } from "vue-router";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElInput } from "element-plus/es/components/input/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { ElOption, ElSelect } from "element-plus/es/components/select/index.mjs";
import { ElSwitch } from "element-plus/es/components/switch/index.mjs";
import { ElTooltip } from "element-plus/es/components/tooltip/index.mjs";
import { ElUpload, type UploadRequestOptions } from "element-plus/es/components/upload/index.mjs";
import { PhBookOpenText, PhCloud, PhDotsThreeVertical, PhFileArrowDown, PhFileText, PhFunnel, PhGitBranch, PhGitMerge, PhListChecks, PhMagicWand, PhMicrophone, PhPlay, PhShareNetwork, PhSlidersHorizontal, PhSparkle, PhSwap, PhTreeStructure, PhUploadSimple, PhVideo, PhX } from "@phosphor-icons/vue";
import { ChevronDown, CircleAlert } from "lucide-vue-next";
import { toast } from "@/lib/toast";
import { Handle, Position, useVueFlow, type NodeProps } from "@vue-flow/core";
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { aiPromptBlocks, blockArtifact, COMMON_EXTRACT_FIELDS, extractBiliUrl, groupPromptBlocks, MAX_EXTRACT_FIELDS, NODE_PORTS, NODE_TYPE_LABELS, PROMPT_ARTIFACT_LABELS, SEARCH_PROVIDER_LABELS, type NodePick, type NodeType, type UploadedFile, type VideoPreview } from "@scribe-flow/shared";
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
import { buildOutletPlan } from "@/utils/artifact-plan";
import { renderMarkdown } from "@/lib/markdown";
import { cachePreview, readCachedPreview } from "@/utils/bili-preview-cache";
import { PICKER_COPY, collapsesAfterRun, pickerKey, pickerSummary, readPickerOpen, writePickerOpen, type PickerKind } from "@/utils/bili-picker";
import { fmtCharCount, fmtDuration } from "@/utils/run-segments";
import { usePromptsStore } from "@/stores/prompts";
import { useSettingsStore } from "@/stores/settings";
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
/**
 * el-select 的浮层同样 Teleport 到 body、同样不跟画布缩放（自研菜单走上面那份 `flowMenuStyle`）。
 * 它没法直接给浮层内层元素加 zoom，所以把缩放值以 CSS 变量的形式写进浮层，由 element-theme.css 那条规则消费。
 */
const selectPopperStyle = computed(() => ({ "--sf-canvas-zoom": String(flowZoom.value) }));
provide("sf-flow-zoom", flowZoom);

const promptsStore = usePromptsStore();
const settingsStore = useSettingsStore();
const router = useRouter();
const data = computed(() => props.data);

const selectedPages = ref<number[]>([]);
/** UGC 合集（多独立稿件）里勾选的集，用各集 bvid 标识。 */
const seasonSelected = ref<string[]>([]);
/**
 * 多选卡片上的「改选集」：在链接/选集界面重新编辑这张卡片，但不改 data.items，
 * 因此解析失败或用户反悔时已合并的选集都还在（纯本地视图开关）。
 */
const editingCollection = ref(false);

const biliItems = computed(() => (Array.isArray(data.value.items) ? data.value.items : []));
const distinctBvids = computed(() => new Set(biliItems.value.map((item) => item.bvid)).size);
const isCollection = computed(() => biliItems.value.length > 1);

/**
 * 选集面板：收起（一行摘要）/ 展开（列表）。勾选位**常驻可见**，悬停不改任何东西。
 *
 * 点行 = 把节点切到那一集；勾选框 = 攒「要合并的那几集」（≥ 2 项时底部才出动作条）。
 * 收紧在这里的还有几条实测过的老毛病：限高与行节律对齐（不切半行）、展开时把当前集滚进视野、
 * 合并完成与跑完一次都回到收起。措辞见 `utils/bili-picker.ts`；
 * 调研与这次返工的来龙去脉见 `docs/research/collection-picker-research.md`。
 */
const PICKER_KINDS: PickerKind[] = ["pages", "season"];
/** 展开态的键带 bvid：换视频回到收起态，同一个视频在节点被卸载重挂后保住状态。 */
function pickerStorageKey(kind: PickerKind) {
  return pickerKey(String(props.id ?? ""), data.value.bvid, kind);
}
const pickerOpen = reactive<Record<PickerKind, boolean>>({
  pages: readPickerOpen(pickerStorageKey("pages")),
  season: readPickerOpen(pickerStorageKey("season")),
});
function setPickerOpen(kind: PickerKind, open: boolean) {
  pickerOpen[kind] = open;
  writePickerOpen(pickerStorageKey(kind), open);
}

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
/** 链接解析的序号：链接被改过或节点换了视频时，让在飞的那次结果作废。 */
let previewSeq = 0;

/**
 * 只把真正变了的字段写回工程图。
 *
 * `updateData` 会立刻 emit 整张图，500ms 防抖后 PUT /graph，所以「照写一遍」不是空操作：
 * 画布开了视口裁剪，节点滚出视野会卸载、滚回来重新挂载，而重新挂载时这些远端值通常已经在了。
 */
function patchChanged(next: Partial<ScribeNodeData>) {
  const current = data.value as Partial<ScribeNodeData>;
  const changed = Object.fromEntries(
    Object.entries(next).filter(([key, value]) => JSON.stringify(current[key as keyof ScribeNodeData]) !== JSON.stringify(value)),
  );
  if (Object.keys(changed).length > 0) patch(changed);
}

/**
 * 解析结果落到卡片：预览本体 + 「哪些分P/哪几集勾着」的还原。
 * 缓存命中与真的请求回来共用这一份——两条路径要是各写一遍，拖出视野再拖回来的勾选状态
 * 就会和首次解析不一样。
 */
function applyPreview(url: string, result: VideoPreview) {
  preview.value = result;
  const bvid = result.bvid || url.match(/BV[0-9A-Za-z]+/)?.[0] || "";
  patchChanged({ bvid, title: result.title, cover: result.cover, uploader: result.uploader, duration: result.duration, pubdate: result.pubdate });
  if (result.pages.length > 0) {
    const savedPages = (data.value.items ?? []).map((item) => item.page).filter(Boolean);
    const savedPage = Number(data.value.pageInfo?.page ?? 0);
    const initial = result.pages.find((p) => p.page === savedPage) ?? result.pages[0];
    const restored = result.pages.filter((p) => savedPages.includes(p.page)).map((p) => p.page);
    selectedPages.value = restored.length > 0 ? restored : [initial.page];
    patchChanged({ pageInfo: { cid: initial.cid, page: initial.page, part: initial.part, duration: initial.duration } });
  } else {
    selectedPages.value = [];
  }
  // UGC 合集：优先还原卡片里已合并的选集（与上面的分P还原对称），否则默认勾选当前链接所在的这一集。
  seasonSelected.value = [];
  if (result.ugcSeason && result.ugcSeason.episodes.length > 0) {
    const savedBvids = (data.value.items ?? []).map((item) => item.bvid);
    const restored = result.ugcSeason.episodes.filter((ep) => savedBvids.includes(ep.bvid)).map((ep) => ep.bvid);
    const own = result.ugcSeason.episodes.find((ep) => ep.bvid === result.bvid);
    seasonSelected.value = restored.length > 0 ? restored : own ? [own.bvid] : [];
  }
}

function schedulePreview(url: string) {
  if (previewTimer) clearTimeout(previewTimer);
  const seq = ++previewSeq;
  preview.value = null;
  previewError.value = "";
  // 每次进来都要收掉上一次的转圈：改链接的请求在飞时被作废，finally 里看不到同一个 seq，
  // 而新链接又是空的（或在飞的那次已经被丢弃）时就没人负责关它，卡片会一直转。
  previewLoading.value = false;

  const value = url.trim();
  if (!value) return;
  if (!extractBiliUrl(value)) {
    previewError.value = "需要 B 站视频链接（支持 BV 号或 av 号）";
    return;
  }

  // 这个链接刚解析过就直接用缓存结果：节点滚出视野会被卸载，重新挂载时没有这一条
  // 会先闪一次「正在解析视频信息…」（实测 610ms）再白发一次请求。
  const cached = readCachedPreview(value);
  if (cached) {
    applyPreview(value, cached);
    return;
  }

  previewLoading.value = true;
  previewTimer = setTimeout(async () => {
    try {
      const result = await api.post<VideoPreview>("/api/videos/preview", { url: value });
      // 请求在飞的时候链接又变了（继续输入/切了工程）：这次结果作废，
      // 否则旧视频的 bvid/标题/封面会被 patch 进新节点。
      if (seq !== previewSeq) return;
      cachePreview(value, result);
      applyPreview(value, result);
    } catch (err) {
      if (seq !== previewSeq) return;
      previewError.value = err instanceof Error ? err.message : "解析失败，请检查链接";
    } finally {
      if (seq === previewSeq) previewLoading.value = false;
    }
  }, 500);
}

// —— 选择器：分两条互不重叠的轨道，避免「同一颗按钮按选中数量做两件事」——
//   单选 = 点行：这一行变成节点的当前来源，当前项用墨色底 + 加粗标出；
//   多选 = 勾选框 + 底部「合并为一张卡片」：至少 2 项才可用。

function togglePage(page: number) {
  selectedPages.value = selectedPages.value.includes(page)
    ? selectedPages.value.filter((p) => p !== page)
    : [...selectedPages.value, page];
}

/** 单选：切换到该分P（节点回到单链接形态，清掉多选 items）。 */
function switchToPage(page: number) {
  const current = preview.value;
  const target = current?.pages.find((p) => p.page === page);
  if (!current || !target) return;
  if (target.page === Number(data.value.pageInfo?.page ?? 0)) return;
  selectedPages.value = [target.page];
  editingCollection.value = false;
  patch({
    items: [],
    url: `https://www.bilibili.com/video/${current.bvid}`,
    bvid: current.bvid,
    title: current.title,
    cover: current.cover,
    uploader: current.uploader,
    duration: target.duration,
    pubdate: current.pubdate,
    pageInfo: { cid: target.cid, page: target.page, part: target.part, duration: target.duration },
  });
  commit();
}

/** 多选：把勾选的多个分P合并成一张卡片。 */
function mergePages() {
  const current = preview.value;
  if (!current) return;
  const pages = current.pages.filter((p) => selectedPages.value.includes(p.page));
  if (pages.length < 2) return;
  const items = pages.map((page) => ({
    bvid: current.bvid,
    cid: page.cid,
    page: page.page,
    part: page.part,
    title: current.title,
    cover: current.cover,
    uploader: current.uploader,
    duration: page.duration,
    pubdate: current.pubdate,
  }));
  const first = items[0];
  editingCollection.value = false;
  patch({
    items,
    url: `https://www.bilibili.com/video/${current.bvid}`,
    bvid: current.bvid,
    title: current.title,
    cover: current.cover,
    uploader: current.uploader,
    duration: first.duration,
    pubdate: current.pubdate,
    pageInfo: { cid: first.cid, page: first.page, part: first.part, duration: first.duration },
  });
  commit();
  // 合并完成 = 这一次选集结束了：收起面板（Android 上下文操作栏的 `mode.finish()` 同一意图）。
  setPickerOpen("pages", false);
  toast.success(PICKER_COPY.pages.merged(items.length));
}

function toggleSeasonEpisode(bvid: string) {
  seasonSelected.value = seasonSelected.value.includes(bvid)
    ? seasonSelected.value.filter((b) => b !== bvid)
    : [...seasonSelected.value, bvid];
}

/** 单选：切换到合集里的这一集（合集各集是不同的 BV，切过去就是一条独立链接）。 */
function switchToSeasonEpisode(bvid: string) {
  const current = preview.value;
  const target = current?.ugcSeason?.episodes.find((ep) => ep.bvid === bvid);
  if (!current || !target) return;
  if (target.bvid === String(data.value.bvid ?? "")) return;
  preview.value = {
    ...current,
    bvid: target.bvid,
    cid: target.cid,
    title: target.part,
    duration: target.duration,
    cover: target.cover || current.cover,
    pages: [{ page: 1, cid: target.cid, part: target.part, duration: target.duration }],
  };
  selectedPages.value = [1];
  seasonSelected.value = [target.bvid];
  editingCollection.value = false;
  patch({
    items: [],
    url: `https://www.bilibili.com/video/${target.bvid}`,
    bvid: target.bvid,
    title: target.part,
    cover: target.cover || current.cover,
    uploader: current.uploader,
    duration: target.duration,
    // 换成哪一集就是哪一集的日期；这一集没带出来（老接口）时不留上一集的日期。
    pubdate: target.pubdate,
    pageInfo: { cid: target.cid, page: 1, part: target.part, duration: target.duration },
  });
  commit();
}

/** 多选：把勾选的集数合并成一张卡片。 */
function mergeSeasonEpisodes() {
  const current = preview.value;
  const season = current?.ugcSeason;
  if (!current || !season) return;
  const picked = season.episodes.filter((ep) => seasonSelected.value.includes(ep.bvid));
  if (picked.length < 2) return;
  const items = picked.map((ep) => ({
    bvid: ep.bvid,
    cid: ep.cid,
    page: 1,
    part: ep.part,
    title: ep.part,
    cover: ep.cover || current.cover,
    uploader: current.uploader,
    duration: ep.duration,
    // 合集各集的发布日期不同：逐集带上，笔记的「发布日期」才能按集写对。
    pubdate: ep.pubdate,
  }));
  const first = items[0];
  editingCollection.value = false;
  patch({
    items,
    url: String(data.value.url ?? "") || `https://www.bilibili.com/video/${current.bvid}`,
    bvid: current.bvid,
    title: current.title,
    cover: current.cover,
    uploader: current.uploader,
    duration: first.duration,
    pubdate: current.pubdate,
    pageInfo: { cid: first.cid, page: 1, part: first.part, duration: first.duration },
  });
  commit();
  setPickerOpen("season", false);
  toast.success(PICKER_COPY.season.merged(picked.length));
}

/** 多选卡片 → 回到选集界面。「切换」与「合并」都能从多选卡片里重新到达。 */
function editCollection() {
  editingCollection.value = true;
  // 用户是专程回来改选集的，面板直接展开（而不是让他再点一次摘要行）。
  setPickerOpen("season", true);
  schedulePreview(String(data.value.url ?? ""));
}

function cancelEditCollection() {
  editingCollection.value = false;
}

/** 改选集时，当前链接是否提供了可调整的列表（分P 或 合集）。 */
const hasBiliPicker = computed(() => {
  const current = preview.value;
  if (!current) return false;
  return current.pages.length > 1 || (current.ugcSeason?.episodes.length ?? 0) > 0;
});

// —— 面板交互：一行只挂一种语义（浏览态点行切换 / 多选态点行勾选），不再并存 ——

/** 列表元素按 kind 存一份：展开时要靠它把当前项滚进视野。 */
const pickerListEls = new Map<PickerKind, HTMLElement>();
function setPickerListEl(kind: PickerKind, el: unknown) {
  // v-for 里的函数 ref：元素卸载时 Vue 会以 null 调一次，顺手把引用清掉。
  if (el instanceof HTMLElement) pickerListEls.set(kind, el);
  else pickerListEls.delete(kind);
}

/**
 * 把当前项滚到列表中间 —— Pilipala / bv 打开选集面板都这么定位当前集，
 * 而现状是停在顶部：当前集排在第 109 位时，等于「你说勾了这一集，但屏幕上找不到」。
 * 手算 scrollTop 而不用 scrollIntoView：后者会把外层容器（画布）一起滚走。
 */
function locateCurrent(kind: PickerKind) {
  const list = pickerListEls.get(kind);
  if (!list) return;
  const current = list.querySelector<HTMLElement>(".is-current");
  if (!current) return;
  const centered = current.offsetTop - list.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
  // 吸附到行边界：限高正好是 7 整行，落在边界上时上下都不会露出半截行
  // （不吸附的话，被切掉的那一行会从顶部露出一条勾选框的边，看着像渲染残留）。
  const rows = list.querySelectorAll<HTMLElement>(".sf-node-picker-row");
  const step = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : 0;
  list.scrollTop = step > 0 ? Math.max(0, Math.round(centered / step) * step) : Math.max(0, centered);
}

function togglePicker(kind: PickerKind) {
  const open = pickerOpen[kind];
  setPickerOpen(kind, !open);
  if (open) return;
  // 等列表真的渲染出来再定位（收起态里没有列表元素）。
  void nextTick(() => locateCurrent(kind));
}

/** 点行主体：把节点换到这一集（单条链接）。攒「要合并的那几集」只归勾选框。 */
function switchTo(kind: PickerKind, key: string) {
  if (kind === "pages") switchToPage(Number(key));
  else switchToSeasonEpisode(key);
}

function togglePick(kind: PickerKind, key: string) {
  if (kind === "pages") togglePage(Number(key));
  else toggleSeasonEpisode(key);
}

/** 清空勾选（连同默认勾着的当前这一项）：底部动作条在不足 2 项时自己就没了。 */
function clearPick(kind: PickerKind) {
  if (kind === "pages") selectedPages.value = [];
  else seasonSelected.value = [];
}

function isPicked(kind: PickerKind, key: string) {
  return kind === "pages" ? selectedPages.value.includes(Number(key)) : seasonSelected.value.includes(key);
}

function mergePicked(kind: PickerKind) {
  if (kind === "pages") mergePages();
  else mergeSeasonEpisodes();
}

interface PickerRow {
  key: string;
  title: string;
  duration: number;
  current: boolean;
  /** 悬停这一行时的提示：只说会发生什么，界面上不复述「点行 = 切换」。 */
  hint: string;
}

interface PickerView {
  kind: PickerKind;
  copy: (typeof PICKER_COPY)[PickerKind];
  summary: { title: string; meta: string };
  rows: PickerRow[];
  open: boolean;
  total: number;
  selected: number;
  /** 底部动作条（已选 N + 清空 + 合并）只在攒到 2 项以上时出现。 */
  showActions: boolean;
}

/**
 * 两个列表（分P / 合集）规格化成同一种视图，模板只写一遍。
 * 它们除了「一行是什么」之外完全同构，各写一份模板的结果就是两处措辞慢慢漂移。
 */
const pickers = computed<PickerView[]>(() => {
  const current = preview.value;
  if (!current) return [];
  const views: PickerView[] = [];

  if (current.pages.length > 1) {
    const total = current.pages.length;
    const selected = selectedPages.value.length;
    const open = pickerOpen.pages;
    views.push({
      kind: "pages",
      copy: PICKER_COPY.pages,
      summary: pickerSummary("pages", { total, selected, collapsed: !open }),
      rows: current.pages.map((page) => ({
        key: String(page.page),
        title: `P${page.page} · ${page.part || `第 ${page.page} 集`}`,
        duration: page.duration,
        current: page.page === Number(data.value.pageInfo?.page ?? 0),
        hint: PICKER_COPY.pages.rowHint,
      })),
      open,
      total,
      selected,
      showActions: selected >= 2,
    });
  }

  const season = current.ugcSeason;
  if (season && season.episodes.length > 0) {
    const total = season.episodes.length;
    const selected = seasonSelected.value.length;
    const open = pickerOpen.season;
    views.push({
      kind: "season",
      copy: PICKER_COPY.season,
      summary: pickerSummary("season", { title: season.title, total, selected, collapsed: !open }),
      rows: season.episodes.map((episode) => ({
        key: episode.bvid,
        title: episode.part,
        duration: episode.duration,
        current: episode.bvid === String(data.value.bvid ?? ""),
        hint: PICKER_COPY.season.rowHint,
      })),
      open,
      total,
      selected,
      showActions: selected >= 2,
    });
  }

  return views;
});

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
  // 提示词列表要按「有没有配检索密钥」过滤，而用户未必进过设置页。
  void settingsStore.ensureLoaded();
  // 多选收藏卡片不需要解析“第一个视频”的预览，所有项平等展示。
  if (props.data.url && !isCollection.value) schedulePreview(props.data.url);
});

/**
 * 清掉「本地解析出来的这一份预览」：预览、错误、勾选状态都属于当前解析结果，
 * 换视频时必须一起丢，否则合并选集会把上一个视频的分P/合集写进本节点。
 */
function resetLocalPreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewSeq += 1;
  preview.value = null;
  previewLoading.value = false;
  previewError.value = "";
  selectedPages.value = [];
  seasonSelected.value = [];
  editingCollection.value = false;
}

/**
 * 画布在工程之间是复用实例的（见 FlowCanvas 的 loadGraph），而模板里的节点 id 是固定的
 * （`n_src`…），于是切工程时同一个 ScribeNode 实例只是换了 data：上一个工程解析出的
 * preview（UP主/时长/合集列表）会留在本地 ref 里，卡片就显示成上一个工程的视频。
 * 以节点数据里的 bvid 为准判断本地预览是否还属于当前节点：对不上就重解析。
 */
watch(
  () => String(data.value.bvid ?? ""),
  (bvid) => {
    if (preview.value && bvid && preview.value.bvid === bvid) return;
    resetLocalPreview();
    // 展开态的键带 bvid：换了视频就重新按新键读一次，否则会沿用上一个视频的展开态。
    for (const kind of PICKER_KINDS) pickerOpen[kind] = readPickerOpen(pickerStorageKey(kind));
    if (data.value.url && !isCollection.value) schedulePreview(String(data.value.url));
  },
);

/**
 * 这个节点跑完一轮就把选集面板收起来 —— 用户的原话是「单视频执行了一次之后，下面那个列表就该收起来」。
 *
 * 只看终态不看过程：running → done 之间会刷新多次状态，没必要每次都算。
 * 非 immediate 的 watch 在节点重新挂载时不会触发（重挂载拿到的是一个「本来就是 done」的值），
 * 所以「拖出视野再拖回来」不会把用户刚点开的面板收掉。
 */
watch(
  () => data.value.status,
  (status) => {
    if (!collapsesAfterRun(status)) return;
    for (const kind of PICKER_KINDS) if (pickerOpen[kind]) setPickerOpen(kind, false);
  },
);

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  previewLoadSeq += 1;
  clearPreviewTimers();
});

const nodeType = computed<NodeType>(() => props.data.nodeType);
/** 思维导图节点的预览走“渲染后的导图”，其余节点维持文字/富文本预览。 */
const isMindMapNode = computed(() => nodeType.value === "process.mindmap");
const ports = computed(() => NODE_PORTS[nodeType.value]);
const defaultLabel = computed(() => NODE_TYPE_LABELS[nodeType.value]);
const label = computed(() => props.data.label || defaultLabel.value);
/** 运行进行中画布只读：可查看节点/结果，但不能修改节点配置或结构。 */
const readonly = computed(() => Boolean(props.data.ctx?.readonly));
/**
 * 本工程有运行在跑。与 `readonly` 分开是因为两者对「运行入口」的处置不同：
 * 编辑类操作一律禁用，而运行入口**不禁用**——点了是加入排队（当前运行结束后依次自动开始），
 * 见 `stores/run-queue.ts`。文案要跟着变，否则「点了没反应」的老问题会原样留在按钮上。
 */
const isRunning = computed(() => Boolean(props.data.ctx?.running));

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
  "process.prompt": "使用提示词对文稿做 AI 加工",
  "process.merge": "将多个笔记块合并为一份文档",
  "process.output": "将结果保存为 Markdown 文件",
  "flow.if": "根据条件决定下游执行分支",
  "flow.pick": "只放行其中几段素材",
  "process.text": "查找替换、正则或模板等文本处理",
  "process.chapter": "将长文稿切分为章节笔记",
  "process.gameguide": "将阴阳师攻略文稿整理为结构化攻略笔记",
  "process.mindmap": "将文稿整理为思维导图 Markdown",
  "process.obsidian": "将结果写入 Obsidian 笔记库",
  "process.drill": "从文稿提炼可考察的知识点并出题，在结果页答题；配置联网检索后还会上网找同类练习题",
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
    "process.obsidian",
    "process.drill",
  ].includes(nodeType.value);
  // 可挑选素材的节点也要能打开高级设置（合并/输出等节点同样需要按素材挑选）。
  // 「素材挑选」节点自身的挑选就在卡片正文里，不必再给一个重复入口。
  return base || (hasPickSection.value && nodeType.value !== "flow.pick");
});
const isVideoSource = computed(() => nodeType.value === "source.bili" || nodeType.value === "source.file");
/** 不涉及失败重试的节点（来源类、思维导图、Obsidian）标题保持简洁。 */
const advancedTitle = computed(() =>
  isVideoSource.value || nodeType.value === "process.mindmap" || nodeType.value === "process.obsidian" ? "高级设置" : "高级（失败重试）",
);
/**
 * 高级设置面板的开合**只由用户决定**：展开后不跟选中态走——点画布空白、点别的节点都不会把它收掉，
 * 只有面板头的「收起」和选中条上的「高级设置」两个入口能关。
 *
 * 原先写的是「取消选中就收起」，于是任何一次把卡片点掉选的点击都会顺手收掉面板：
 * 最常撞上的是收起卡内下拉那一下（浮层打开时点卡片，命中判定落在画布上）。
 * 那次点击本身已经不再取消选中（见 FlowCanvas 的 markDropdownOwner），但「点别处就把你刚展开的面板收走」
 * 这件事本身也不该发生——面板是用户为这一篇专门打开的，关它得由用户说。
 *
 * 取消选中时选中条会隐藏，所以面板自己必须带一个收起入口（见 .sf-node-advanced-close）。
 */
const advancedOpen = ref(false);

function toggleAdvanced() {
  if (!hasAdvanced.value) return;
  advancedOpen.value = !advancedOpen.value;
}

function closeAdvanced() {
  advancedOpen.value = false;
}

/**
 * 卡片是否需要渲染正文区。
 * process.refine（AI 校对）、process.mindmap（思维导图）节点默认无内联表单，
 * 不渲染空 body，让顶部栏与底部栏直接相连；仅当展开「高级设置」时才需要正文容器。
 */
const noInlineFormTypes: NodeType[] = ["process.refine", "process.mindmap"];
const hasBodyContent = computed(() => !noInlineFormTypes.includes(nodeType.value) || advancedOpen.value);

/**
 * 卡片头部的类型图标。
 *
 * 用 `Record<NodeType, …>` 而不是 switch：漏配一个类型会直接编译不过（`NODE_TYPE_LABELS` /
 * `NODE_CARD_WIDTH` / `NODE_PORTS` 都是这个套路）。这里曾经是 switch，`flow.pick` 漏了一支没人发现，
 * 素材挑选卡的头部就没有图标——标题比别的卡少缩进 17px，整张卡看起来不像同一套组件。
 */
const TYPE_ICONS: Record<NodeType, Component> = {
  "source.bili": PhVideo,
  "source.file": PhUploadSimple,
  "source.text": PhFileText,
  "process.transcribe": PhMicrophone,
  "process.refine": PhMagicWand,
  "process.prompt": PhSparkle,
  "process.merge": PhGitMerge,
  "process.output": PhFileArrowDown,
  "flow.if": PhGitBranch,
  "flow.pick": PhFunnel,
  "process.text": PhSwap,
  "process.chapter": PhTreeStructure,
  "process.gameguide": PhSparkle,
  "process.mindmap": PhShareNetwork,
  "process.obsidian": PhBookOpenText,
  "process.drill": PhListChecks,
};

const typeIcon = computed(() => TYPE_ICONS[nodeType.value]);

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

/** 检索密钥是否已配置：没配就不该让需要联网核查的模版出现在可选列表里。 */
const searchReady = computed(() => Boolean(settingsStore.settings?.search.hasKey));

/**
 * 提示词下拉的选项：**按系列分组**，组里只写成员名（详尽版 / 成文版 / 速览版）。
 *
 * 分组口径与设置页共用 `groupPromptBlocks`：只在系列有 ≥2 个成员时才给分组标题——单成员系列
 * （问答笔记、行动项清单这类）挂个与选项同名的标题只是白占一行。收起时触发器上会补出组名
 * （见 ModelSelect 的 `selectedLabel`），所以只看卡片也知道选的是「观点提炼 · 成文版」。
 *
 * 版本号、配方、内置、推荐这些说法都留在设置页的提示词库里（那里才是管版本的地方），卡片上不出现。
 * 可选提示词本身与快捷新建共用一份（`aiPromptBlocks`）：同一个提示词在两处必须都选得到，
 * 否则会出现画布上选得到、建工程时选不到的情况。
 */
const promptOptions = computed(() =>
  groupPromptBlocks(aiPromptBlocks(promptsStore.customBlocks, searchReady.value)).flatMap((group) =>
    group.members.map((block) => ({
      label: block.builtin ? block.name : `${block.name} · 我的`,
      value: block.id,
      group: group.members.length > 1 ? group.series : undefined,
      // 选的时候就标出产物类别：同一系列里未必同类，而用户是在这一刻做的决定
      suffix: PROMPT_ARTIFACT_LABELS[blockArtifact(block)],
    })),
  ),
);

/**
 * 当前选的模版会不会做联网核查（v2 是可选、v3 是必需）：决定「提示词」那一行要不要挂「联网」标记。
 * 渠道名与密钥状态本身不再上卡片（见 `promptNet`）。
 */
const selectedSearchBlock = computed(() => {
  const block = promptsStore.allBlocks.find((item) => item.id === promptBlockId.value);
  return block?.externalCheck ? block : undefined;
});

/**
 * 标题旁的产物徽章：这枚卡做出来的是哪一类东西。
 *
 * 起因是两张并排的「AI 加工」卡——一张出观点笔记、一张出溯源报告——在画布上长得一模一样，
 * 用户根本看不出产物是两类（详见 docs/research/trace-artifact-visibility-research.md）。
 * 判据是提示词自己声明的 `produces`：**每一枚 AI 加工卡都标**，包括默认的「笔记」——
 * 只标异常的那一枚的话，「没徽章」到底是笔记还是"这个功能上线前的旧卡"，看的人分不出来。
 */
const artifactBadge = computed(() => {
  if (nodeType.value !== "process.prompt") return undefined;
  const block = promptsStore.allBlocks.find((item) => item.id === promptBlockId.value);
  if (!block) return undefined;
  return PROMPT_ARTIFACT_LABELS[blockArtifact(block)];
});

/**
 * 出口卡（Obsidian 笔记）的「本次将写入什么」预告：几篇、哪几类、会不会互链。
 * 只读画布（连线与各卡选的提示词），不跑引擎也不写任何状态，改一条线就跟着变。
 */
const outletPlan = computed(() => {
  if (nodeType.value !== "process.obsidian") return undefined;
  const graph = data.value.ctx?.getGraph?.();
  if (!graph) return undefined;
  return buildOutletPlan({
    nodeId: props.id,
    nodes: graph.nodes,
    edges: graph.edges,
    blocks: promptsStore.allBlocks,
    splitByInput: data.value.splitByInput,
  });
});

/**
 * 检索渠道名。只在标记的悬停说明里用到——卡片上不再常驻渠道与密钥状态：
 * 「已配置」是没有动作可做的成功态，而渠道属于工作区设置（设置页「联网检索」里已经写着）。
 */
const searchChannelLabel = computed(() => {
  const provider = settingsStore.settings?.search.provider;
  return provider ? SEARCH_PROVIDER_LABELS[provider] : "读取中";
});

/**
 * 联网标记：**这枚卡会不会联网**——提示词的属性，所以挂在「提示词」那一行上，缺密钥时连同一行警示。
 *
 * 这块原先是一个灰底块（`联网核查 | 渠道 | 密钥已配置` + 两个按钮），占溯源卡 33% 的高度，
 * 而里面**一条可配置项都没有**。改成「常态零占用、只在异常时说」的评估与先例见
 * docs/research/search-status-block-research.md（同理：测试连接只留在设置页）。
 */
const promptNet = computed(() => {
  const block = selectedSearchBlock.value;
  if (!block) return undefined;
  const required = block.externalCheck === "required";
  return {
    hint: `会联网核查 · 渠道 ${searchChannelLabel.value}`,
    warning: required
      ? "未配置联网检索密钥（该提示词需要它，已从可选列表里隐去），本次不会联网核查"
      : "未配置联网检索密钥，本次只做原文核对，不联网核查",
  };
});

/**
 * 练一练的联网找同类题：**加分项**，缺密钥只是退化成纯原文出题（配方那一步自动跳过），
 * 所以缺配置时也用中性灰、不加警示色——它不是警告。
 */
const drillNet = computed(() => ({
  hint: `出题前上网找同类练习题供参考 · 渠道 ${searchChannelLabel.value}`,
  label: searchReady.value ? "联网找同类题" : "未配置检索密钥，本次不联网找题",
}));

function openSearchSettings() {
  void router.push({ path: "/settings", query: { group: "search" } });
}

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

/** overwrite：打开后保存目录里已有同名笔记就整篇重写它；默认关＝退让成「标题 (2).md」，不动已有那篇。 */
function setOverwrite(value: string | number | boolean) {
  patch({ overwrite: Boolean(value) });
  commit();
}

/**
 * splitByInput：一次运行收到多个输入时，每个输入各写一篇，而不是合并成一篇（默认开）。
 *
 * 单输入时两种模式等价，所以这里不做任何"输入数"的判断——开关只是把意图存下来，
 * 是不是真的分流由引擎在运行时按当时的输入份数决定（画布上的连线随时会变）。
 */
function setSplitByInput(value: string | number | boolean) {
  patch({ splitByInput: Boolean(value) });
  commit();
}

/* ------------- Obsidian 节点：「这一篇怎么抽」的覆盖项 ------------- */

/**
 * 「让 AI 读一遍笔记」在卡片上是三态：跟随设置 / 这一篇读 / 这一篇不读。
 *
 * 三态是必要的——`undefined` 只能有一个含义，要么当"跟随设置"、要么当"关"。
 * 这里选"跟随设置"，因为设置页那一栏现在只是默认值（与保存目录 `folder` 同一套约定）。
 */
const aiNoteMode = computed(() => {
  const value = data.value.autoTag;
  return value === undefined ? "follow" : value ? "on" : "off";
});

const aiNoteModeOptions = [
  { value: "follow", label: "跟随设置" },
  { value: "on", label: "这一篇：读" },
  { value: "off", label: "这一篇：不读" },
];

function setAiNoteMode(value: string) {
  patch({ autoTag: value === "follow" ? undefined : value === "on" });
  commit();
}

/** 两个自动标签的三态：它们由元数据写（来源取自「来源」属性、UP 主取自作者），这里只决定写不写。 */
function triStateOf(value: boolean | undefined): string {
  return value === undefined ? "follow" : value ? "on" : "off";
}

function triStatePatch(value: string): boolean | undefined {
  return value === "follow" ? undefined : value === "on";
}

const tagSwitchOptions = [
  { value: "follow", label: "跟随设置" },
  { value: "on", label: "这一篇：写" },
  { value: "off", label: "这一篇：不写" },
];

const sourceTagMode = computed(() => triStateOf(data.value.sourceTag));
const upTagMode = computed(() => triStateOf(data.value.upTag));

/** 卡片上的字段列表：留空即跟随设置，与保存目录同一套约定。 */
const nodeExtractFields = computed(() => data.value.extractFields ?? []);

function setNodeExtractFields(value: string[]) {
  patch({ extractFields: value.length > 0 ? value : undefined });
  commit();
}

/** 设置页里那份默认字段——卡片用它显示"留空会跟随成什么"。 */
const inheritedExtractFields = computed(() => settingsStore.settings?.obsidian.extractFields ?? []);

const nodeExtractFieldsPlaceholder = computed(() =>
  inheritedExtractFields.value.length > 0 ? `跟随设置：${inheritedExtractFields.value.join(" / ")}` : "跟随设置（当前：不抽）",
);

const nodeExtractFieldsHint = computed(() => {
  const inherited = inheritedExtractFields.value;
  return inherited.length > 0
    ? `留空即跟随设置里的默认（${inherited.join(" / ")}）；选了就以这里的为准`
    : "留空即跟随设置（设置页当前是「不抽」）";
});

/** 建议项：库里用过的属性名 + 常用名，去掉已经选上的（与设置页那份是同一个来源）。 */
const nodeFieldSuggestions = computed(() => {
  const picked = new Set(nodeExtractFields.value);
  const vault = settingsStore.obsidianFieldNames.map((item) => item.name);
  return [...new Set([...vault, ...COMMON_EXTRACT_FIELDS])].filter((field) => !picked.has(field));
});

/** 卡片上的字段列表要跟着设置页那份默认走，所以进设置页前先把设置加载进来。 */
watch(
  () => nodeType.value === "process.obsidian",
  (isObsidian) => {
    if (isObsidian) void settingsStore.ensureLoaded();
  },
  { immediate: true },
);

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
                <DropdownMenuItem class="sf-node-menu-item" :title="isRunning ? '当前有运行进行中，点击后加入排队' : '只跑这一个节点'" @select="props.data.ctx?.runNode()">{{ isRunning ? "运行此节点（排队）" : "运行此节点" }}</DropdownMenuItem>
                <DropdownMenuItem class="sf-node-menu-item" :title="isRunning ? '当前有运行进行中，点击后加入排队' : '该节点及其全部下游'" @select="props.data.ctx?.runFromNode()">{{ isRunning ? "从此节点运行（排队）" : "从此节点运行" }}</DropdownMenuItem>
                <DropdownMenuSeparator class="sf-node-menu-sep" />
                <DropdownMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="renameNode">重命名</DropdownMenuItem>
                <DropdownMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="props.data.ctx?.duplicate()">复制</DropdownMenuItem>
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
            <span
              v-if="artifactBadge"
              class="sf-node-artifact"
              :title="`这枚卡的产物：${artifactBadge}（由所选提示词自己声明）`"
              :aria-label="`产物类别：${artifactBadge}`"
            >{{ artifactBadge }}</span>
            <el-tooltip v-if="data.status === 'error'" :content="data.summary || '节点运行失败'" placement="top" effect="dark" :show-after="120" :hide-after="0">
              <span class="sf-node-error-trigger" tabindex="0" aria-label="错误详情">
                <CircleAlert :size="14" />
              </span>
            </el-tooltip>
            <button
              type="button"
              class="sf-node-run-btn nodrag"
              :title="isRunning ? '当前有运行进行中，点击后加入排队' : '从此节点运行'"
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
            <template v-if="isCollection && !editingCollection">
              <div class="sf-node-collection">
                <div class="sf-node-collection-head">
                  <div class="sf-node-collection-meta">
                    <span class="sf-node-collection-count tnum">{{ biliItems.length }} 项</span>
                    <span class="sf-node-collection-tag">{{ distinctBvids > 1 ? "多视频" : "多P" }}</span>
                  </div>
                  <button type="button" class="sf-node-collection-edit" title="回到选集界面：可把某一集切成单独一条链接，或调整合并哪些集" @click="editCollection">
                    改选集
                  </button>
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
              <!-- 多选卡片上的「改选集」回到这里：只露出选集列表，不露出链接输入（改链接等于改这个节点的身份）。 -->
              <div v-if="editingCollection" class="sf-node-collection-editing">
                <span class="sf-node-collection-editing-text">改选集中 · 卡片现有 {{ biliItems.length }} 项</span>
                <button type="button" class="sf-node-collection-edit" @click="cancelEditCollection">返回卡片</button>
              </div>
              <div v-if="!editingCollection" class="sf-node-field">
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
              <!-- 选集面板：收起 = 一行摘要（默认态，跑完一次也回到这里）；展开后一行只挂一种语义
                   （点行 = 换到那一集；勾选框 = 攒合并）。两种模式与措辞见 utils/bili-picker.ts。 -->
              <div v-for="picker in pickers" :key="picker.kind" class="sf-node-picker">
                <button
                  type="button"
                  class="sf-node-picker-head"
                  :aria-expanded="picker.open"
                  :title="picker.open ? '收起选集' : '展开选集'"
                  @click="togglePicker(picker.kind)"
                >
                  <span class="sf-node-picker-title">{{ picker.summary.title }}</span>
                  <span class="sf-node-picker-count tnum">{{ picker.summary.meta }}</span>
                  <ChevronDown class="sf-node-picker-chevron" :size="13" />
                </button>

                <template v-if="picker.open">
                  <div :ref="(el) => setPickerListEl(picker.kind, el)" class="sf-node-picker-list" @wheel="onInnerListWheel">
                    <div v-for="row in picker.rows" :key="row.key" class="sf-node-picker-row" :class="{ 'is-current': row.current }">
                      <!-- 勾选位常驻（不玩「悬停才出现」那一套：鼠标划过每行都闪一下勾选框，
                           而且「哪几项已勾选」会变成要悬停才看得见）。点它 = 攒进待合并的选集。 -->
                      <input
                        type="checkbox"
                        class="sf-node-picker-check"
                        :checked="isPicked(picker.kind, row.key)"
                        :aria-label="`勾选以合并：${row.title}`"
                        @change="togglePick(picker.kind, row.key)"
                      />
                      <!-- 行主体只干一件事：把这个节点换成这一集（单条链接）。 -->
                      <button
                        type="button"
                        class="sf-node-picker-main"
                        :aria-current="row.current ? 'true' : undefined"
                        :title="row.hint || undefined"
                        @click="switchTo(picker.kind, row.key)"
                      >
                        <span class="sf-node-picker-name">{{ row.title }}</span>
                      </button>
                      <span class="sf-node-picker-duration tnum">{{ fmtDuration(row.duration) }}</span>
                    </div>
                  </div>
                  <!-- 攒到 2 项以上才出动作条（默认只勾着当前这一集，那时没什么可合并的） -->
                  <div v-if="picker.showActions" class="sf-node-picker-actions">
                    <span class="sf-node-picker-picked tnum">{{ picker.copy.selected(picker.selected) }}</span>
                    <el-button size="small" text @click="clearPick(picker.kind)">清空</el-button>
                    <el-button size="small" type="primary" class="sf-node-picker-merge" @click="mergePicked(picker.kind)">
                      {{ picker.copy.merge }}
                    </el-button>
                  </div>
                </template>
              </div>
              <div v-if="editingCollection && preview && !previewError && !hasBiliPicker" class="sf-node-picker-hint">
                这个视频没有分P或合集列表，没有可调整的选集。
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
              <div class="sf-node-field-head">
                <span class="sf-node-field-label">提示词</span>
                <span
                  v-if="promptNet"
                  class="sf-node-net"
                  :class="{ 'is-missing': !searchReady }"
                  :title="promptNet.hint"
                >联网</span>
              </div>
              <ModelSelect
                v-model="promptBlockId"
                :options="promptOptions"
                size="small"
                clearable
                filterable
                placeholder="选择提示词"
                :prefix-icon="PhSparkle"
              />
              <!-- 缺密钥才出声：这是「你选的做法里有一步跑不了」，不是常态 -->
              <p v-if="promptNet && !searchReady" class="sf-node-net-note">
                {{ promptNet.warning }} ·
                <button type="button" class="sf-node-net-link nodrag" @click="openSearchSettings">去设置</button>
              </p>
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
            <ObsidianCard :folder="data.folder" :plan="outletPlan" @update="patchObsidian" />
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
            <!-- 联网找同类题：与溯源共用同一份检索渠道，但它是加分项，所以一行中性灰、缺配置也不报警 -->
            <p class="sf-node-net-line" :title="drillNet.hint">
              {{ drillNet.label }}
              <template v-if="!searchReady">· <button type="button" class="sf-node-net-link nodrag" @click="openSearchSettings">去设置</button></template>
            </p>
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
            <div class="sf-node-advanced-head">
              <span class="sf-node-advanced-title">{{ advancedTitle }}</span>
              <button
                type="button"
                class="sf-node-advanced-close"
                title="收起高级设置"
                aria-label="收起高级设置"
                @click.stop="closeAdvanced"
                @dblclick.stop
              >
                <PhX :size="11" />
              </button>
            </div>
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
              <template v-if="nodeType === 'process.obsidian'">
                <!--
                  「这一篇怎么抽」放在卡片上：设置页只定默认值。
                  一个人会用不同风格处理不同视频，若只能改全局设置，每换一类都得回设置页改一次。
                  下面是三态——跟随设置 / 这一篇读 / 这一篇不读（后者也是唯一能连话题标签一起关掉的地方）。
                -->
                <label class="sf-node-field">
                  <NodeFieldLabel
                    label="让 AI 读一遍笔记"
                    hint="默认跟随设置页；这一篇可以单独改。关掉就不判话题标签、也不抽属性"
                  />
                  <ModelSelect
                    :model-value="aiNoteMode"
                    :options="aiNoteModeOptions"
                    size="small"
                    @update:model-value="(v: string) => setAiNoteMode(v)"
                  />
                </label>
                <label class="sf-node-field sf-node-field--stack">
                  <NodeFieldLabel label="抽取哪些属性" :hint="nodeExtractFieldsHint" />
                  <el-select
                    class="sf-node-control"
                    size="small"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    clearable
                    popper-class="sf-canvas-zoom-popper"
                    :popper-style="selectPopperStyle"
                    :reserve-keyword="false"
                    :multiple-limit="MAX_EXTRACT_FIELDS"
                    :model-value="nodeExtractFields"
                    :placeholder="nodeExtractFieldsPlaceholder"
                    @update:model-value="(v: string[]) => setNodeExtractFields(v)"
                  >
                    <el-option v-for="field in nodeFieldSuggestions" :key="field" :label="field" :value="field" />
                  </el-select>
                </label>
                <!--
                  两个自动标签的逐篇开关：它们不是话题标签，不由 AI 判、不在词库里维护，
                  取值在生成笔记时已经知道（来源 = 素材类型，UP 主 = 作者），所以这里只决定写不写。
                -->
                <label class="sf-node-field">
                  <NodeFieldLabel label="写来源标签" hint="形如「B站」这种裸值，跟笔记的「来源」属性同源" />
                  <ModelSelect
                    :model-value="sourceTagMode"
                    :options="tagSwitchOptions"
                    size="small"
                    @update:model-value="(v: string) => { patch({ sourceTag: triStatePatch(v) }); commit(); }"
                  />
                </label>
                <label class="sf-node-field">
                  <NodeFieldLabel label="写 UP 主标签" hint="形如「UP：某某」，取值跟笔记的「作者」同源" />
                  <ModelSelect
                    :model-value="upTagMode"
                    :options="tagSwitchOptions"
                    size="small"
                    @update:model-value="(v: string) => { patch({ upTag: triStatePatch(v) }); commit(); }"
                  />
                </label>
                <!--
                  写几篇、撞名怎么办，是两件事：先决定「多篇」，再决定「同名覆盖」。
                  这一版把顺序按这条链路排——上面的开关管篇数，下面的管名字。
                  两态的显示与引擎同一套口径：这里显示什么，运行时就按什么走（缺省＝开 / 缺省＝关）。
                -->
                <div class="sf-node-advanced-row">
                  <span
                    class="sf-node-advanced-label"
                    title="默认开：一次运行收到多个输入（比如同一个文稿挂了几版提示词配方）时，每个输入各写一篇笔记，篇名取各篇正文的第一个 H1，各篇各自判标签、抽属性（模型调用按篇数增加）。关掉＝合并成一篇，几版的标题与导读挤在同一份文档里。只有一份输入时两种模式一样。"
                  >每个输入一篇笔记</span>
                  <el-switch size="small" :model-value="data.splitByInput !== false" @update:model-value="setSplitByInput" />
                </div>
                <div class="sf-node-advanced-row">
                  <span
                    class="sf-node-advanced-label"
                    title="默认关：保存目录里已有同名笔记时，改写「标题 (2).md」而不动已有那篇；重复运行会接着排 (3)、(4)。打开＝直接覆盖已有那篇（整篇重写，人写的正文会被替换，人写的标签留下），重复运行只更新它自己，不产生 (2)。"
                  >同名笔记直接覆盖</span>
                  <el-switch size="small" :model-value="data.overwrite === true" @update:model-value="setOverwrite" />
                </div>
              </template>
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
              <!-- Obsidian 节点不在可重试名单里，重试字段对它无效，不给这个空档。 -->
              <RetryFields v-if="nodeType !== 'process.obsidian'" :retry="data.retry" @update="patchRetry" />
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
                      <span class="sf-seg-item-len tnum">{{ fmtCharCount(segment.size) }}</span>
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
                      <span class="sf-seg-item-len tnum">{{ fmtCharCount(previewFullChars) }}</span>
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
        <ContextMenuItem class="sf-node-menu-item" :title="isRunning ? '当前有运行进行中，点击后加入排队' : '只跑这一个节点'" @select="props.data.ctx?.runNode()">{{ isRunning ? "运行此节点（排队）" : "运行此节点" }}</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :title="isRunning ? '当前有运行进行中，点击后加入排队' : '该节点及其全部下游'" @select="props.data.ctx?.runFromNode()">{{ isRunning ? "从此节点运行（排队）" : "从此节点运行" }}</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="renameNode">重命名</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="readonly" title="运行中不可编辑" @select="props.data.ctx?.duplicate()">复制</ContextMenuItem>
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

/**
 * 产物徽章：标题右侧的「笔记 / 报告」，说明这枚卡做出来的是哪一类东西。
 * 尺寸按标题行高（22px）配，是标题行的一部分，不是正文里的字段。
 */
.sf-node-artifact {
  flex-shrink: 0;
  height: 16px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-info-border);
  border-radius: 4px;
  background: var(--color-info-soft);
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  user-select: none;
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

/*
 * 联网标记（常态零占用、只在异常时出声）。
 *
 * 它取代了原先那个灰底块（`.sf-node-search`：胶囊 + 渠道 + 「密钥已配置」+ 测试连接/去设置），
 * 那一块占溯源卡 33% 的高度，而里面一条可配置项都没有。评估与先例见
 * docs/research/search-status-block-research.md。
 */
.sf-node-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sf-node-net {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 16px;
  cursor: help;
}

.sf-node-net.is-missing {
  color: var(--color-warning);
}

/* 缺密钥那一行：警告色 + 一个动作。行内按钮做成文字链，不再出现第二个同权重按钮 */
.sf-node-net-note {
  margin: 0;
  color: var(--color-warning);
  font-size: 11px;
  line-height: 17px;
}

.sf-node-net-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-info);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.sf-node-net-line {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 16px;
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

/* 运行中不再置灰：点了是加入排队，不是「不可用」。 */
.sf-node-run-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
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

.sf-node-collection-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 低权重的文字按钮：卡片头部的「改选集」与改选集态里的「返回卡片」共用（同 .sf-pick-all 的写法） */
.sf-node-collection-edit {
  flex: none;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-text-tertiary);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}

.sf-node-collection-edit:hover {
  color: var(--color-text-secondary);
}

.sf-node-collection-editing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
}

.sf-node-collection-editing-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--color-text-secondary);
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

/*
 * 选集面板（分P / UGC 合集）。
 *
 * 布局只有两条对齐线：左边缘（标题、勾选位）与右边缘（集数、时长、箭头、动作）。
 * 勾选位常驻 14px 占位：浏览态它的勾选框是透明的、悬停该行才现 —— 这样 hover 与进入选择模式
 * 都不会让标题和时长挪位置（改造前正是「hover 时时长位移 + 冒出一个『切换』」）。
 */
.sf-node-picker {
  margin-top: 8px;
}

/* 收起态那一行：标题 + 计数 + 箭头。没有底色盒子、也没有分割线。
   右内边距 14 = 行内边距 8 + 列表滚动条 6（见 .sf-node-picker-list 的 scrollbar-gutter），
   这样箭头、时长、动作按钮的右边缘落在同一条竖线上。 */
.sf-node-picker-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 14px 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}

.sf-node-picker-head:hover {
  background: var(--color-ink-soft-glass);
}

.sf-node-picker-head:focus-visible {
  outline: 2px solid var(--color-text);
  outline-offset: 1px;
}

.sf-node-picker-chevron {
  flex: none;
  margin-left: auto;
  color: var(--color-text-tertiary);
  transition: transform var(--dur-2) var(--ease-out);
}

.sf-node-picker-head[aria-expanded="true"] .sf-node-picker-chevron {
  transform: rotate(180deg);
}

.sf-node-picker-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-node-picker-count {
  flex: none;
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/*
 * 限高 224px = **7 整行 × 32px 行距 + 2px 下内边距**，且行高被钉成整数 30px（不是让 12px 字撑，
 * 那会撑出 31.6 这种小数）。两者都是为了同一件事：**任何落在行边界上的滚动位置都恰好是 7 整行**。
 *   · 上一版限高 224 但行高是小数：224 ÷ 31.2 = 7.18，第 7 行只露 79%，像渲染被截断；
 *   · 中间一版改成 232px 且行高仍是小数：滚到底时浏览器把 scrollTop 夹在最大值（不是行边界），
 *     顶部反而露出上一行的 10px（勾选框露一条边那条「残影」）。
 * 行距 32 × 7 = 224，且整段内容的滚动上限 3264 也是 32 的整数倍，所以到底也不会有半截行。
 *
 * `scrollbar-gutter: stable` 是给对齐用的：滚动条占 6px 布局宽度，不预留的话
 * 「有滚动条时的时长」比「没有滚动条时的箭头」少 6px —— 短列表与长列表的右边缘会不一样齐。
 * （overlay 滚动条的平台不占宽度，那 6px 会体现为整体右移，视觉上仍然是一条线。）
 */
.sf-node-picker-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 224px;
  margin-top: 2px;
  padding: 0 0 2px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

/*
 * 行高钉成 30px（= 32 的行距减去 2 的 gap）：行距是整数，滚动位置才能和行边界对齐。
 * `flex: none` 不能省：列向 flex 容器里给了显式 height 之后，min-height:auto 会从「内容高」
 * 退化成更小的值，109 行会被压扁到 18px 高（实测 step 从 32 掉到 20）—— 是 flex 子项被压的标准坑。
 */
.sf-node-picker-row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
}

.sf-node-picker-row:hover {
  background: var(--color-ink-soft-glass);
}

/* 当前项：与下拉选中项、文档列表同款——墨色底 + 加粗，不用品牌色 */
.sf-node-picker-row.is-current {
  background: var(--color-ink-soft);
}

.sf-node-picker-row.is-current .sf-node-picker-name {
  font-weight: 600;
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

/* 行主体：浏览态点它 = 换到这一集（整行都是热区，但只有这一块有动作） */
.sf-node-picker-main {
  flex: 1;
  min-width: 0;
  display: block;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: none;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
}

.sf-node-picker-main:focus-visible {
  outline: 2px solid var(--color-text);
  outline-offset: 2px;
}

/* 当前项点了没有动作（已经在这一条上），别给可点的手感；选择模式里它照样能勾。 */
.sf-node-picker-row.is-current .sf-node-picker-main {
  cursor: default;
}

.sf-node-picker-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 时长：定宽右对齐，逐行成一条线，任何状态下都不位移 */
.sf-node-picker-duration {
  flex: none;
  min-width: 44px;
  text-align: right;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sf-node-picker-hint {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-text-tertiary);
}

/* 选择模式的动作条：已选 N + 取消 + 合并（按钮用 Element Plus，与对话框里的主按钮同一套墨色） */
.sf-node-picker-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding-left: 8px;
  padding-right: 14px;
}

.sf-node-picker-picked {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 主操作按钮：与 SourcePickerDialog 的确认键、设置页保存键同一套墨色（不用品牌蓝） */
.sf-node-picker-merge.el-button--primary {
  --el-button-bg-color: var(--color-ink);
  --el-button-border-color: var(--color-ink);
  --el-button-text-color: var(--color-surface);
  --el-button-hover-bg-color: var(--color-text);
  --el-button-hover-border-color: var(--color-text);
  --el-button-hover-text-color: var(--color-surface);
  --el-button-active-bg-color: var(--color-ink);
  --el-button-active-border-color: var(--color-ink);
  --el-button-active-text-color: var(--color-surface);
  --el-button-disabled-bg-color: var(--color-border-strong);
  --el-button-disabled-border-color: var(--color-border-strong);
  --el-button-disabled-text-color: var(--color-surface);
}

/* 小按钮的高度与原来自绘按钮一致（26px），免得卡片里这一行突然变高 */
.sf-node-picker-actions :deep(.el-button) {
  height: 26px;
  font-size: 12px;
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

/*
 * 高级设置：**不画分界线、也不套盒子**，靠 24px 留白 + 11px 小标题分组。
 *
 * 两步都记在这里：
 * ① 去盒子——调研的 10 个画布/工作流产品 + 7 套设计系统里没有第二家把高级设置放进卡内嵌套盒子
 *    （n8n/Node-RED 的卡片只有标题、配置在 NDV/modal；Dify/Langflow/Tines 是右侧面板），
 *    GOV.UK 更明确要求「别把 Details/Accordion/Tabs 互相嵌套」。实测高级区 339.2 → 247.8px。
 * ② 去分界线——那条线原来是满宽的，而 Material 对满宽分隔线的定义是 "separate larger sections of
 *    unrelated content" / "separate interactive areas from non-interactive areas"：画在同一张卡的表单区
 *    中间、两边还是同一组设置，属于用错了层级（读起来像「把卡片切断」）。
 *    "separate related content within a section" 对应的是内缩线，不是满宽线。
 *    密集设置区用留白 + 小标题分节是有系统级出处的：Windows 11 官方设置页示例的区块标题就是
 *    「Margin="1,30,0,6" + 小标题」（注释写明 following the correct Windows 11 design specifications）、
 *    GNOME HIG「each list can be given a heading」、libadwaita AdwPreferencesGroup 本身就是 title + description。
 *    我们按 300px 卡片把 30px 收到 24px（上间距 = 这里的 16px + body 的 8px gap）。
 *
 * 实测（四字段的 Obsidian 卡片，真机 Chrome，设计像素）：
 *   盒式 339.2 / 卡片 525.1 → 行式+分界线 247.8 / 431.7 → 行式+留白（现在）238.8 / 430.7。
 * 依据、候选与取舍见 docs/research/advanced-settings-card-styles.md §6.2 与
 * docs/research/advanced-settings-divider-demos.html。
 */
.sf-node-advanced {
  margin-top: 16px;
  padding-top: 0;
}

/*
 * 行式排法：文案左、控件右（Windows 11 SettingsExpander 的 SettingsCard 就是「控件右对齐」+ 文案在左；
 * libadwaita 的 AdwActionRow 是「标题 + 右侧控件」）。
 * 原文给的 12/16epx 间距是给 1000px 宽设置页的，这里按 300px 卡片收窄成 gap 8px、行距 6px（有意偏离）。
 * justify-content 用 space-between：标签保持自己的文字宽度、控件贴右边；标签只在装不下时收缩并截断
 * （flex 是 `0 1 auto` 而不是 `1 1 auto`——后者会让标签和「吃剩余宽度」的输入框互相抢：
 * 实测「导图标题（可选）」被压到 71px 截了尾，改 0 1 auto + 输入框基准 0 之后标签是 99.8px、不再截断）。
 */
.sf-node-advanced > .sf-node-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: var(--control-height-sm);
}

.sf-node-advanced > .sf-node-field > .sf-node-field-label {
  flex: 0 1 auto;
  min-width: 0;
}

/*
 * 紧凑控件定宽 → 右边缘成一条线；--stack 那一段（整行字段）不进这套，控件仍是全宽。
 * 128px 不是拍的：最长的一个选项是「自动（4-7 个）」，104px 时会被截成「自动(4-7 …」（实测），
 * 128px 能放下它，同时三个标签订单行（让 AI 读一遍笔记 109.6 + 8 + 128 = 245.6 ≤ 273 的内容宽）。
 */
.sf-node-advanced > .sf-node-field:not(.sf-node-field--stack) > .sf-model-select {
  flex: none;
  width: 128px;
}

.sf-node-advanced > .sf-node-field:not(.sf-node-field--stack) > .el-select {
  flex: none;
  width: 148px;
}

/*
 * 文本输入不是「一格选项」，让它吃掉剩余宽度，别也压到 104px。
 * 基准必须写 `0`（而不是 auto）：`.sf-node-control` 把宽度设成了 100%，用 auto 基准时
 * 输入框的基准宽度就是整行宽，撑爆行后按比例反向挤压标签——实测「导图标题（可选）」被压到 71px 截了尾。
 */
.sf-node-advanced > .sf-node-field:not(.sf-node-field--stack) > .el-input {
  flex: 1 1 0;
  width: auto;
  min-width: 96px;
}

/*
 * 例外：标签型控件（「抽取哪些属性」是 multiple 的 el-select）不进行式。
 * 它的取值是 chips，塞进 148px 会换行成两三行；而且默认态的占位文案
 * 「跟随设置：人物 / 事件 / 时期」本身就有 11 个字，窄格子里会被截掉关键信息。
 * 它按整行「标签在上、控件全宽」排，与卡片正文里的字段一致。
 */
.sf-node-advanced > .sf-node-field--stack {
  flex-direction: column;
  /* 行式那套是「水平居中 + 两端对齐」，换成纵向排法后这两个值会把标签水平居中——必须显式还原 */
  align-items: stretch;
  justify-content: flex-start;
  gap: 6px;
}

/* 行与行 6px；--stack 那段是整行字段，前后各留 10px 与行分开 */
.sf-node-advanced > .sf-node-field + .sf-node-field,
.sf-node-advanced > .sf-node-field + .sf-node-advanced-row,
.sf-node-advanced > .sf-node-advanced-row + .sf-node-field {
  margin-top: 6px;
}

.sf-node-advanced > .sf-node-field--stack + .sf-node-field,
.sf-node-advanced > .sf-node-field + .sf-node-field--stack,
.sf-node-advanced > .sf-node-advanced-row + .sf-node-field--stack {
  margin-top: 10px;
}

.sf-node-advanced-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.sf-node-advanced-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary);
}

/*
 * 面板自己的收起入口：取消选中时选中条会隐藏（「高级设置」按钮在里面），
 * 只留选中条那一个入口的话，面板会留在卡片上没法关。尺寸对齐 .sf-node-hint-trigger 那种小图标按钮。
 */
.sf-node-advanced-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sf-node-advanced-close:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

/*
 * 高级设置里相邻字段之间的间距，见上方 .sf-node-advanced 那一段（行式 6px、整行字段前后 10px）。
 * 历史：这里曾经是「字段之间 0px」→ 先改成 12px（标签在上的排法下那是对的）→ 改行式后由上面那组规则接管。
 */

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
  /* 与行式字段同高：开关行和下拉行并排时不出现两种行高 */
  min-height: var(--control-height-sm);
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
