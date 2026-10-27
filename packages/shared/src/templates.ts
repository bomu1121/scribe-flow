import { NODE_CARD_WIDTH, NODE_PORTS, type GraphEdge, type GraphNode, type NodeType, type PageRef, type WorkflowGraph } from "./graph";
import { aiPromptBlocks, BUILTIN_PROMPT_BLOCKS, variantTitle, type PromptBlock } from "./prompt";

/**
 * 内置链路的组织方式：**模板 = 加工路径的形状，来源在新建时选**。
 *
 * 早期是「按来源成对铺开」（视频转笔记 / 文稿转笔记 / 视频转思维导图 / 文稿转思维导图……），
 * 后果是本机 11 个模板里 6 个从未被任何工程使用，全部是「同形状换个来源」；
 * 而真正要换来源时，用户是在画布上自己改来源节点的。调研与数据见
 * `docs/research/template-set-research.md`，取舍结论见
 * `docs/decisions/template-set-and-source-axis.md`。
 *
 * 于是模板只描述「从文稿开始往后的加工链」：来源节点与转写节点由构建器按来源种类补在前面。
 * 三种来源的差别只有一句话：
 * - `bili` / `file` → `source.bili` / `source.file` → `process.transcribe` → 加工链；
 * - `text` → `source.text`（本身就是文稿）→ 加工链。
 */

/** 模板可选的来源种类。 */
export type TemplateSourceKind = "bili" | "file" | "text";

export const TEMPLATE_SOURCE_LABELS: Record<TemplateSourceKind, string> = {
  bili: "B站链接",
  file: "本地文件",
  text: "粘贴文稿",
};

/** 模板里的一段加工，一律以「文稿」为入口。 */
export interface TemplateStage {
  /** 模板内唯一键，供后续 stage 用 `from` 引用；同时用作节点 id 后缀。 */
  key: string;
  type: NodeType;
  /** 上游 stage 的 key；缺省接上一个 stage（线性链）。 */
  from?: string[];
  /** 同列的纵向偏移（px），用于并排分支。 */
  dy?: number;
  /** 节点显示名；缺省用节点类型的中文名。 */
  label?: string;
  /** 节点数据预设：只写有含义的默认值，其余交给卡片与引擎的默认值。 */
  data?: Record<string, unknown>;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** 分组：通用链路 / 垂直领域链路。 */
  group: "通用" | "垂直";
  /** 允许的来源；缺省三种都允许（如「选段加工」只对音视频来源成立）。 */
  sources?: TemplateSourceKind[];
  /** 新建时的默认来源；缺省取允许列表的第一项。 */
  defaultSource?: TemplateSourceKind;
  stages: TemplateStage[];
}

/** 模板节点横向最小间距：按节点实际宽度排布，避免新建工程时相邻卡片重叠。 */
const TEMPLATE_H_GAP = 80;

/**
 * 「全提示词对照」的分支来源：**当前已放开的通用提示词**，与画布节点下拉、快捷新建下拉同一份清单
 * （`aiPromptBlocks`，见 `prompt.ts` 的审核白名单）。
 *
 * 刻意**算出来**而不是写死一份 id 清单：这条链路的名字承诺「全部开放提示词」，写死的话白名单里
 * 放开或新增一个提示词之后，它会悄悄少一条分支、而它自己看不出来。`searchReady = true`：需要联网核查的
 * 提示词也进模板（没配检索密钥时那条分支跳过核查，不会失败）。
 *
 * 已知边界：只含**内置**已放开提示词——模板在 shared 里构建，读不到用户库里的自定义提示词。
 */
const OPEN_PROMPT_BLOCKS: PromptBlock[] = aiPromptBlocks([], true);

/**
 * 并排分支的纵向间距（px）。
 *
 * 卡片高度由内容决定，没有固定值：真机上量下来「AI 加工」卡是 320×167（画布 px），
 * 所以 220 的间距给相邻两行留出约 53px 的空隙。「多路对照」两条分支的 dy 是 ∓110，
 * 也就是同一个间距（两卡相距 220）。
 */
const TEMPLATE_BRANCH_GAP = 220;

/** 「全提示词对照」的五个（或更多）分支：一条分支一个提示词，纵向错开铺在同一列。 */
const ALL_PROMPT_STAGES: TemplateStage[] = OPEN_PROMPT_BLOCKS.map((block, index) => ({
  key: `p${index + 1}`,
  type: "process.prompt",
  from: ["refine"],
  dy: Math.round((index - (OPEN_PROMPT_BLOCKS.length - 1) / 2) * TEMPLATE_BRANCH_GAP),
  // 分支卡片的默认名是类型名，几张卡长得一模一样：用提示词名，才分得清哪份结果对应哪套提示词。
  // 画布上的卡片看不到分组标题，所以这里要完整标题（「观点提炼 · 成文版」），只用成员名会认不出系列。
  label: variantTitle(block),
  data: { promptBlockId: block.id },
}));

/**
 * 按 id 取内置提示词：模板引用的提示词改名/删除时在这里当场失败，而不是建出一条空分支。
 * 分支卡片的标题也跟着 `variantTitle` 走，不手写字符串。
 */
function builtinBlock(id: string): PromptBlock {
  const block = BUILTIN_PROMPT_BLOCKS.find((item) => item.id === id);
  if (!block) throw new Error(`模板引用了不存在的内置提示词：${id}`);
  return block;
}

/** 「速览与溯源」的两条分支：一条给扫读，一条给查证。 */
const OVERVIEW_PROMPT = builtinBlock("builtin.insight.v6");
const TRACE_PROMPT = builtinBlock("builtin.trace.v3");

/**
 * 模板的描述**只讲结果**，不讲步骤：步骤由对话框按当前来源展开成一行小字
 * （同一句话在三种来源下的步骤并不一样，写进描述里必错一个）。
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "template.single-note",
    name: "单线笔记",
    description: "一条链路出一份笔记：一个 AI 加工步骤的结果直接落盘，最常用的一条",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      { key: "prompt", type: "process.prompt" },
    ],
  },
  {
    id: "template.transcript-only",
    name: "只到转写",
    description: "音视频只转成文稿，不做 AI 加工；适合交给外部模型自己消化",
    group: "通用",
    defaultSource: "bili",
    sources: ["bili", "file"],
    // 转写节点由来源轴自动补；这条链路在转写后就结束，所以没有任何 stage。
    stages: [],
  },
  {
    id: "template.refine-only",
    name: "只到校对",
    description: "音视频转写后再做一次 AI 校对，输出校对稿，不生成笔记文件",
    group: "通用",
    defaultSource: "bili",
    stages: [{ key: "refine", type: "process.refine" }],
  },
  {
    id: "template.multi-branch",
    name: "多路对照",
    // 不在链路末端放「合并」：两份内容首尾相接只是拼在一起，看不出差异；
    // 结果页的「对照」标签页会把同一素材的两套加工直接摆在一起比（指标 + 逐行 diff）。
    description: "同一份内容并行两套加工，在结果页的「对照」标签页里直接比差异",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      // 两条分支的卡片长一样：给个名字，用户才分得清哪个是哪个（改名只在画布上显示，不影响链路）。
      { key: "left", type: "process.prompt", from: ["refine"], dy: -110, label: "AI 加工 A" },
      { key: "right", type: "process.prompt", from: ["refine"], dy: 110, label: "AI 加工 B" },
    ],
  },
  {
    id: "template.overview-trace",
    name: "速览与溯源",
    // 两条分支各自绑死提示词：这里不是让用户挑提示词的链路，而是「同一份内容要两种产物」——
    // 一份扫读、一份查证。分支卡片默认全叫「AI 加工」，所以名字要写清楚是哪一版。
    description: "同一份内容并行两套：一版速览用来扫读，一份溯源报告用来查证，两份各写一篇 Obsidian 笔记",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      {
        key: "overview",
        type: "process.prompt",
        from: ["refine"],
        dy: -110,
        label: variantTitle(OVERVIEW_PROMPT),
        data: { promptBlockId: OVERVIEW_PROMPT.id },
      },
      {
        key: "trace",
        type: "process.prompt",
        from: ["refine"],
        dy: 110,
        label: variantTitle(TRACE_PROMPT),
        data: { promptBlockId: TRACE_PROMPT.id },
      },
      // 两份产物各写一篇笔记（默认 splitByInput，不写 data.splitByInput）；
      // 不写 data.folder / traceFolder：跟随设置页，节点上写死会永久压住用户的目录选择。
      { key: "obsidian", type: "process.obsidian", from: ["overview", "trace"] },
    ],
  },
  {
    id: "template.all-prompts",
    name: "全提示词对照",
    // 分支数不写在这句话里：它跟着白名单走，写「五版」明天就可能是六版。
    description: "同一份内容过一遍全部已放开的提示词，几版各写一篇 Obsidian 笔记",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      ...ALL_PROMPT_STAGES,
      // 分支收敛到一张 Obsidian：几版内容都交到同一个节点上（见 docs/nodes.md §1.2）。
      // 这个节点不写 data，跟着产品默认走——默认「每个输入一篇笔记」＝几版各写一篇；
      // 想在一篇里连着读几版（这条链路叫「对照」，那也是一种用法）就在节点高级设置里关掉那个开关。
      // 不写 data.folder：写了会永久压住设置页的「笔记写进哪个文件夹」。
      { key: "obsidian", type: "process.obsidian", from: ALL_PROMPT_STAGES.map((stage) => stage.key) },
    ],
  },
  {
    id: "template.mindmap",
    name: "思维导图",
    description: "把长内容整理成一张可以逐层展开的导图，在结果页直接看",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      { key: "mindmap", type: "process.mindmap" },
    ],
  },
  {
    id: "template.obsidian",
    name: "Obsidian 笔记",
    description: "加工成一份带 frontmatter 的笔记，直接写进 Obsidian 库",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      { key: "prompt", type: "process.prompt" },
      // 不写 data.folder：节点上写了就以节点为准，会把设置页的「笔记写进库里哪个文件夹」永久压住
      // ——用户改了设置却仍写进 00-Inbox（一个他库里可能并不存在的目录），卡片上还显示着这个名字。
      // 留空＝跟随设置，卡片会把实际会用的目录显示出来。
      { key: "obsidian", type: "process.obsidian" },
    ],
  },
  {
    id: "template.chapters",
    name: "分章笔记",
    description: "先按内容切章，再合成一份带章节的长文笔记；适合讲座、长视频与长报告",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      // granularity 在 schema 里是必填（卡片与引擎都有默认值，但图校验不放行缺省），模板要写死一个。
      { key: "chapter", type: "process.chapter", data: { granularity: "medium", maxChapters: 20 } },
      { key: "merge", type: "process.merge", data: { title: "分章笔记" } },
    ],
  },
  {
    id: "template.series-digest",
    name: "系列综述",
    description: "多份素材各出一份笔记再合成一篇；适合合集、系列课与多份文稿",
    group: "通用",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      { key: "prompt", type: "process.prompt" },
      { key: "merge", type: "process.merge", data: { title: "系列综述" } },
    ],
  },
  {
    id: "template.pick-segments",
    name: "选段加工",
    description: "多分P / 多份素材只把勾选的那几段送去 AI 加工，未选中的不进下游",
    group: "通用",
    defaultSource: "bili",
    sources: ["bili", "file"],
    stages: [
      { key: "pick", type: "flow.pick" },
      { key: "refine", type: "process.refine" },
      { key: "prompt", type: "process.prompt" },
    ],
  },
  {
    id: "template.gameguide",
    name: "阴阳师攻略",
    description: "阴阳师攻略专线：专名、数值与优先级逐条回文核对，输出可长期查阅的攻略",
    group: "垂直",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      { key: "guide", type: "process.gameguide", data: { mode: "audited" } },
    ],
  },
  {
    id: "template.drill",
    name: "练一练",
    description: "加工成笔记后提炼考察点、出题与延伸问题，在结果页直接答题",
    group: "垂直",
    defaultSource: "bili",
    stages: [
      { key: "refine", type: "process.refine" },
      { key: "prompt", type: "process.prompt" },
      { key: "drill", type: "process.drill" },
    ],
  },
];

/** 模板支持哪些来源。 */
export function availableSources(template: WorkflowTemplate): TemplateSourceKind[] {
  return template.sources ?? ["bili", "file", "text"];
}

/** 某个来源是否可用；新建对话框用它过滤列表（如「选段加工」在粘贴文稿时不出现）。 */
export function supportsSource(template: WorkflowTemplate, source: TemplateSourceKind): boolean {
  return availableSources(template).includes(source);
}

/** 新建时默认选中的来源。 */
export function defaultSourceOf(template: WorkflowTemplate): TemplateSourceKind {
  const allowed = availableSources(template);
  return template.defaultSource && allowed.includes(template.defaultSource) ? template.defaultSource : allowed[0];
}

/** 写入来源节点的 B 站解析结果（快捷新建用 `POST /api/videos/preview` 的结果填充）。 */
export interface BiliLinkSource {
  /** 节点里保存的链接；解析成功时写规范化后的稿件地址。 */
  url: string;
  page?: number;
  pageInfo?: PageRef;
  bvid?: string;
  title?: string;
  cover?: string;
  uploader?: string;
  duration?: number;
  /** 稿件发布时间（unix 秒）：笔记的「发布日期」属性取自卡片上这个值。 */
  pubdate?: number;
}

export interface BuildTemplateOptions {
  /** 来源种类；缺省用模板的 `defaultSource`。 */
  source?: TemplateSourceKind;
  /**
   * 写进来源节点的 B 站解析结果；来源不是 B 站或模板没有 B 站来源时忽略。
   * 快捷新建用它把标题/封面/UP 主/分P 一起写好。
   */
  bili?: BiliLinkSource;
  /**
   * 预绑到「AI 加工」（`process.prompt`）节点的提示词 id。
   * 自带提示词的加工节点（攻略加工、练一练）不受影响。
   */
  promptBlockId?: string;
}

/** 构建过程中的一个节点：记下它属于第几列，落坐标时再按列宽排。 */
interface PlacedNode {
  node: GraphNode;
  column: number;
}

/**
 * 按模板构建一份工程图。
 *
 * 返回 null 表示 templateId 未知，或该模板不支持选定的来源（调用方用
 * `availableSources` 决定下拉里给不给这一项）。
 */
export function buildTemplateGraph(templateId: string, options: BuildTemplateOptions = {}): WorkflowGraph | null {
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;
  const allowed = availableSources(template);
  const source = options.source ?? defaultSourceOf(template);
  if (!allowed.includes(source)) return null;

  const placed: PlacedNode[] = [];
  const edges: GraphEdge[] = [];
  /** stage key（含来源/转写的保留键）→ 节点。 */
  const byKey = new Map<string, GraphNode>();
  /** stage key → 列号。 */
  const columnOf = new Map<string, number>();
  let edgeSeq = 0;

  const push = (key: string, type: NodeType, column: number, data: GraphNode["data"], label?: string) => {
    const node = { id: `n_${key}`, type, position: { x: 0, y: 0 }, data } as GraphNode;
    if (label) node.data.label = label;
    placed.push({ node, column });
    byKey.set(key, node);
    columnOf.set(key, column);
    return node;
  };
  /** 连一条边：端口直接用两端的第一个口，避免手写 handle 字符串写错。 */
  const connect = (fromKey: string, toKey: string) => {
    const from = byKey.get(fromKey);
    const to = byKey.get(toKey);
    if (!from || !to) return;
    edgeSeq += 1;
    edges.push({
      id: `e${edgeSeq}`,
      source: from.id,
      target: to.id,
      sourceHandle: NODE_PORTS[from.type].outputs[0]?.id,
      targetHandle: NODE_PORTS[to.type].inputs[0]?.id,
    });
  };

  // 1. 来源节点。文本来源本身就是文稿，音视频来源还需要一个转写节点。
  if (source === "bili") {
    push("src", "source.bili", 0, { url: "" });
    if (options.bili) {
      const { bili } = options;
      const data = byKey.get("src")!.data as Record<string, unknown>;
      data.url = bili.url;
      data.page = bili.page ?? 1;
      if (bili.pageInfo) data.pageInfo = bili.pageInfo;
      if (bili.bvid) data.bvid = bili.bvid;
      if (bili.title) data.title = bili.title;
      if (bili.cover) data.cover = bili.cover;
      if (bili.uploader) data.uploader = bili.uploader;
      if (bili.duration !== undefined) data.duration = bili.duration;
      // 发布时间要一起写：笔记的「发布日期」只认卡片上的这个值（缺了整行不写）。
      if (bili.pubdate !== undefined) data.pubdate = bili.pubdate;
    }
  } else if (source === "file") {
    push("src", "source.file", 0, {});
  } else {
    push("src", "source.text", 0, { text: "" });
  }

  let previousKey = "src";
  if (source !== "text") {
    push("asr", "process.transcribe", 1, {});
    connect("src", "asr");
    previousKey = "asr";
  }

  // 2. 加工链：`from` 缺省接上一段，因此线性链只需要写节点本身。
  for (const stage of template.stages) {
    const fromKeys = stage.from?.length ? stage.from : [previousKey];
    const column = Math.max(...fromKeys.map((key) => columnOf.get(key) ?? 0)) + 1;
    const data = { ...(stage.data ?? {}) } as GraphNode["data"];
    // 模板自己给节点写死的提示词优先：`options.promptBlockId` 是「一层链路一个提示词」的旧口径，
    // 而「全提示词对照」的每条分支各绑一个提示词——被它统一覆盖会把几条分支压成同一套提示词。
    if (stage.type === "process.prompt" && options.promptBlockId && !(data as { promptBlockId?: string }).promptBlockId) {
      (data as { promptBlockId?: string }).promptBlockId = options.promptBlockId;
    }
    const node = push(stage.key, stage.type, column, data, stage.label);
    node.position.y = stage.dy ?? 0;
    for (const fromKey of fromKeys) connect(fromKey, stage.key);
    previousKey = stage.key;
  }

  // 3. 落坐标：x 按「本列最宽卡片 + 固定间距」累加，y 用 stage 的 dy（缺省 0）。
  const widthOfColumn = new Map<number, number>();
  for (const item of placed) {
    widthOfColumn.set(item.column, Math.max(widthOfColumn.get(item.column) ?? 0, NODE_CARD_WIDTH[item.node.type]));
  }
  const columns = [...widthOfColumn.keys()].sort((a, b) => a - b);
  const xOfColumn = new Map<number, number>();
  let cursor = 0;
  for (const column of columns) {
    xOfColumn.set(column, cursor);
    cursor += (widthOfColumn.get(column) ?? 0) + TEMPLATE_H_GAP;
  }
  for (const item of placed) item.node.position.x = xOfColumn.get(item.column) ?? 0;

  return {
    schemaVersion: 1,
    nodes: placed.map((item) => item.node),
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
