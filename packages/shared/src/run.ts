import type { TagViewMode } from "./obsidian";
import type { AsrEngine, NodeType, WorkflowGraph } from "./graph";
import type { NutstoreSettings } from "./nutstore";
import type { RunMediaView } from "./media";
import type { ApiUsage, PriceCurrency } from "./usage";

/**
 * 运行的整体结局。
 *
 * `cancelled` 与 `interrupted` 刻意分开：前者是**人**主动停止（点停止/强制结束），
 * 后者是**服务**没了（进程重启、崩溃、断电）——运行被强行掐断，人并没有下过停止指令。
 * 两者在「运行记录」列表里必须能一眼分开，否则「我明明没取消，它却写着已取消」。
 */
export type RunStatus = "running" | "success" | "error" | "cancelled" | "interrupted";
export type NodeResultStatus = "queued" | "running" | "done" | "error" | "cancelled" | "skipped";

export interface RunMeta {
  id: string;
  projectId: string;
  projectName?: string;
  status: RunStatus;
  scope: RunScope;
  /** 当 scope 为 fromNode/node 时，记录本次运行的起点节点。 */
  nodeId?: string;
  createdAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  /**
   * 运行记录的名字（笔记标题）。服务端在创建时就给默认名「第 N 次运行」，从某节点重跑时带
   * `· 重跑「节点名」`（见 `apps/server/src/lib/run-name.ts`）；用户改名即覆盖，**只有手动清空才为空**，
   * 那时列表只显示时间。
   * 与 `summary` 各管一件事：summary 是机器算出来的产物摘要，name 是人能认的名字。
   */
  name?: string;
  /** 产出的文档摘要，如「视频转笔记 · 2.1k 字」。 */
  summary?: string;
  error?: string;
}

/** 运行记录名称的最大长度；服务端校验与输入框 maxlength 共用一份。 */
export const RUN_NAME_MAX_LENGTH = 80;

export type RunScope = "all" | "fromNode" | "node";

export interface StartRunRequest {
  scope: RunScope;
  nodeId?: string;
}

export interface RunNodeResult {
  nodeId: string;
  nodeType: string;
  nodeLabel?: string;
  status: NodeResultStatus;
  elapsedMs: number;
  attempts?: number;
  summary?: string;
  error?: string;
  output?: NodeOutput;
  /**
   * 这个节点本次（含重试）花掉的外部 API 用量。纯本地节点没有这一项。
   * token 是实测、金额要另算（见 `estimateChatCostYuan`），界面别把它当账单。
   */
  usage?: ApiUsage;
}

export type NodeOutputKind = "text" | "noteBlock" | "noteDoc" | "audio";

export interface NodeOutput {
  kind: NodeOutputKind;
  /** 小文本/笔记直接内联；大文本只存路径。 */
  text?: string;
  /** 音频/大文件的相对存储路径（data 目录内）。 */
  path?: string;
  size?: number;
  /**
   * 素材段标识（见 segmentKey）：该产物对应哪一个来源素材。
   * 缺失表示不可筛选的整体产物（如合并后的文档），一律通过节点的素材挑选。
   */
  itemKey?: string;
}

export interface RunNodeInput {
  id: string;
  runId: string;
  /** 消费该输入的节点（例如 process.transcribe / process.refine）。 */
  targetNodeId: string;
  /** 产生该输入的节点（来源或上游处理节点）。 */
  sourceNodeId: string;
  kind: "text" | "audio";
  text?: string;
  /** 该输入在目标节点处理后的独立结果（例如每个输入单独调用 AI 后的输出）。 */
  resultText?: string;
  path?: string;
  size?: number;
  /** 同一目标节点下的输入顺序（按连线顺序）。 */
  position: number;
  /** 该输入承载的素材段标识（见 segment.ts 的 segmentKey）；整体产物可能没有。 */
  itemKey?: string;
  /**
   * 该输入被节点的素材挑选排除，本次没有进入处理。
   * 记录它只为让结果页能说明「素材共 8 段、本次只加工 2 段」，不代表节点消费了它。
   */
  excluded?: boolean;
  createdAt: number;
}

export interface RunDetail extends RunMeta {
  nodeResults: RunNodeResult[];
  /** 运行时的工程图快照；旧运行可能缺失，前端可回退到当前工程图。 */
  graph?: WorkflowGraph;
  /** 各节点消费的输入明细；用于在结果页单独查看“这条链路身上的所有输入”。 */
  inputs?: RunNodeInput[];
  /** 各来源节点保留的可播放视频附件（keepVideo）。 */
  media?: RunMediaView[];
  /** 本次运行的用量汇总；一次外部调用都没有（纯本地链路）时为 undefined。 */
  usageSummary?: RunUsageSummary;
}

/**
 * 一次运行的用量汇总。
 *
 * 分两层是因为它们的可信度不一样：`usage` 是**实测**（厂商响应 + 厂商报的或自己量的音频秒数，
 * 含厂商直接报的 `billedCost`），`estimatedCost` 是**估算**（用户填的单价 × 实测用量）。
 * 界面必须把两者区分开显示。
 */
export interface RunUsageSummary {
  usage: ApiUsage;
  /**
   * 按单价估算的金额。**只算填了单价的那部分**：模型部分按「AI 模型」的输入/输出/缓存命中单价，
   * 音频转写部分按「语音识别」的每分钟单价。两处都没填时为 undefined，界面就只显示 token。
   */
  estimatedCost?: number;
  /** 其中音频转写那部分的估算金额；没填语音单价时为 undefined。 */
  audioCost?: number;
  /** 估算金额的币种（用户填单价时选的）。 */
  currency: PriceCurrency;
  /** 折算用的单价，随汇总一起回给界面——好把「按什么算出来的」原样写出来。 */
  prices: {
    /** 元（或美元）/ 百万输入 token。 */
    inputPerMillion: number;
    /** 元（或美元）/ 百万输出 token。 */
    outputPerMillion: number;
    /** 元（或美元）/ 百万缓存命中输入 token；0 表示按输入价算。 */
    cachedInputPerMillion: number;
    /** 元（或美元）/ 分钟。 */
    audioPerMinute: number;
  };
  /**
   * 这份单价是从哪来的：
   * - `run` —— 这次运行**开始时**快照下来的单价（改了设置页也不会动它）；
   * - `current` —— 这次运行没留下快照（升级前的旧运行，或当时还没填单价），退回用**当前**设置页的单价算。
   *
   * 界面必须写出来：同一个界面上的两个数，一个能当历史看、一个是"按今天的价目表看"，不能长得一样。
   */
  priceSource: "run" | "current";
}

export type RunNodeLogKind = "input" | "ai-request" | "ai-response" | "info" | "error";

export interface RunNodeLog {
  id: string;
  runId: string;
  nodeId: string;
  nodeLabel?: string;
  kind: RunNodeLogKind;
  content: string;
  /** M8-1：配方步骤 id（无配方/非配方节点的日志为空）。 */
  step?: string;
  /**
   * 多输入节点的输入归属：该条日志由第几个输入产生（对应 RunNodeInput.position）。
   * 一个节点处理 8 个视频时，8 组同名日志靠它分组到具体视频。
   */
  inputIndex?: number;
  /** 该节点本次执行的输入总数，用于展示「3/8」。 */
  inputTotal?: number;
  createdAt: number;
}

export interface ResultDelta {
  label: string;
  tone: "same" | "up" | "down" | "changed" | "new";
}

/** SSE 事件（M3 运行引擎；M8-1 增加配方步骤收尾事件）。 */
export type RunEvent =
  | { type: "run.started"; run: RunMeta }
  | { type: "node.started"; runId: string; nodeId: string }
  | { type: "node.progress"; runId: string; nodeId: string; progress: number; message: string }
  | { type: "node.retry"; runId: string; nodeId: string; attempt: number; maxRetries: number; error: string }
  | { type: "node.skipped"; runId: string; nodeId: string; reason: string }
  | { type: "node.done"; runId: string; nodeId: string; summary: string; preview?: string; delta?: ResultDelta; usage?: ApiUsage }
  | { type: "node.error"; runId: string; nodeId: string; error: string; usage?: ApiUsage }
  | { type: "node.step.done"; runId: string; nodeId: string; stepId: string; index: number; total: number; summary?: string }
  | { type: "node.step.error"; runId: string; nodeId: string; stepId: string; index: number; total: number; error: string }
  | { type: "run.done"; runId: string; status: RunStatus };

/** AI 提供商预设。 */
export type AiProvider = "deepseek" | "openai" | "custom";

export interface AiSettings {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  /**
   * 模型单价，**单位是「每百万 token」**——各家官网的报价页都是这个口径，用户是拿着那个页面来填的
   * （LibreChat / Lobe Chat / Dify / Cline 也都是每百万）。
   *
   * **0 表示没填**，界面只显示 token 不折算金额。不内置价目表的原因见
   * `docs/research/api-usage-cost-research.md` §5.3：聚合表的价不等于用户实际付的价（OpenRouter 是转售价、
   * DeepSeek 分峰谷、智谱与 Moonshot 分缓存 TTL 档），显示一个错的钱比不显示钱更糟。
   */
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  /** 缓存命中输入 token 的单价；**0 表示按输入价算**（不打折，偏高而非偏低）。 */
  cachedInputPricePerMillion: number;
  /** 单价的币种，只影响金额的显示与口径说明。 */
  priceCurrency: PriceCurrency;
}

export interface AsrSettings {
  engine: AsrEngine;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  /** 语音识别单价（元 / 分钟）；0 表示没填，界面只显示音频秒数不折算金额。 */
  pricePerMinute: number;
}

/** 外部溯源检索渠道：智谱 BigModel 联网搜索、Tavily Search API。 */
export type SearchProvider = "zhipu" | "tavily";

/** 渠道展示名，服务端错误信息与设置页共用一份。 */
export const SEARCH_PROVIDER_LABELS: Record<SearchProvider, string> = {
  zhipu: "智谱",
  tavily: "Tavily",
};

/** 外部溯源检索服务配置。 */
export interface SearchSettings {
  provider: SearchProvider;
  hasKey: boolean;
  maxResults: number;
}

/**
 * 「常规」分组的设置：运行与产出的全局默认。
 * 这里放的是**没被节点/工程单独指定的东西**，节点自己配了就以节点为准（重试策略就是这种关系）。
 */
export interface GeneralSettings {
  /** 节点执行并发数（1-4）。 */
  concurrency: number;
  /**
   * 产物根目录。相对路径相对数据目录解析，也可以直接填绝对路径把成稿写到数据目录之外。
   * 留空回落 DEFAULT_OUTPUT_DIR。
   */
  outputDir: string;
  /**
   * 服务端解析后的产物根目录绝对路径。
   * 只在设置接口的响应（与 engine 内部）里有值——数据目录是启动参数不是设置项，
   * 底层 `getSettings(db)` 拿不到它，所以这是可选的，界面按「有则回显」处理。
   */
  resolvedOutputDir?: string;
  /** 自动落盘的文件名模板，占位符见 FILE_NAME_TOKENS。 */
  fileNameTemplate: string;
  /** 节点没单独配 retry 时的默认最大重试次数（0-10）。 */
  maxRetries: number;
  /** 节点没单独配 retry 时的默认重试等待基数（秒，1-60）；按次数线性递增。 */
  retryBackoffSec: number;
  /** 运行结束时发系统通知。 */
  runEndNotify: boolean;
  /** 运行结束时播放提示音。 */
  runEndSound: boolean;
}

/** 新数值设置的取值范围；服务端校验、设置页输入框与服务端收口共用一份。 */
export const GENERAL_LIMITS = {
  concurrency: { min: 1, max: 4 },
  maxRetries: { min: 0, max: 10 },
  retryBackoffSec: { min: 1, max: 60 },
} as const;

/**
 * 展示范围：哪些节点**不放出来**。
 *
 * 用途是「不想让人看到的能力先收起来」——比如演示给别人看时，某个只服务自己玩的垂直节点不该出现在面板里。
 * 它只影响**新建时的可选项**（节点面板、链路列表、提示词库），已有工程里出现的节点照常渲染、照常运行：
 * 收起一个入口不该让旧工程失效。
 */
export interface VisibilitySettings {
  /** 不放进界面的节点类型。空数组表示全都放出来（默认）。 */
  hiddenNodes: NodeType[];
}

export interface AppSettings {
  ai: AiSettings;
  asr: AsrSettings;
  search: SearchSettings;
  general: GeneralSettings;
  visibility: VisibilitySettings;
  obsidian: {
    /** Obsidian 库根目录，例如 D:\\知识库。 */
    vaultPath: string;
    /** vault 内保存笔记的相对子目录，例如 00-Inbox。 */
    folder: string;
    /** 受控标签词表：维度 -> 标签数组。 */
    tagTaxonomy: Record<string, string[]>;
    /** 词库编辑器的显示样式（纯展示，不改数据）。 */
    tagView: TagViewMode;
    /** 是否启用 AI 自动补全标签。 */
    autoTagEnabled: boolean;
    /**
     * 要不要写**来源标签**（裸值 `B站`）。
     *
     * 这个标签不用维护、也不靠 AI 判断：它的取值跟笔记 frontmatter 的 `来源:` 属性同源，
     * 在生成笔记时就已经知道了。用户只有这一个决定权：写，还是不写。
     */
    sourceTagEnabled: boolean;
    /**
     * 要不要写 **UP 主标签**（`UP：某某`）。同上：取值来自视频元数据的作者，不靠 AI 判断。
     */
    upTagEnabled: boolean;
    /**
     * 要不要给**溯源笔记**写标签（默认关）。
     *
     * 溯源笔记是证据清单，标签会跟着进 Obsidian 的搜索与标签面板，反而干扰按正文找内容。
     * 关掉时：来源 / UP 主标签、AI 话题标签都不写，节点上手填的标签也不写，且不为它调用打标模型；
     * 全库重打标同样跳过溯源笔记（并清掉它已有的标签）。人自己写的笔记不受影响。
     */
    tagTraceNotes: boolean;
    /**
     * 允许 AI 往词库里**新增**标签（默认关）。
     * 关掉时模型只能从词库里挑——聚合口径不会被模型自己长出来的新写法冲散。
     */
    allowNewTags: boolean;
    /**
     * 从正文额外抽取的属性名（如「人物」「机构」）。AI 会把它们写进笔记的 front matter，
     * 也是「关联相关笔记」的比较依据。留空则不抽。默认是历史笔记那三个，可改成任意字段。
     */
    extractFields: string[];
    /** 最少标签数。 */
    tagMinCount: number;
    /** 最多标签数。 */
    tagMaxCount: number;
    /** 是否启用保存后自动关联相关笔记。 */
    autoLinkEnabled: boolean;
    /** 相关笔记最多数量。 */
    autoLinkMax: number;
  };
  nutstore: NutstoreSettings;
}

export interface UpdateSettingsRequest {
  ai?: {
    provider?: AiProvider;
    baseUrl?: string;
    model?: string;
    /** 只写密钥；留空表示不修改。 */
    apiKey?: string;
    /** 每百万 token 的价；0 表示清空（＝不折算金额）。 */
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
    /** 缓存命中输入 token 的每百万价；0 表示清空（＝按输入价算）。 */
    cachedInputPricePerMillion?: number;
    /** 单价币种。 */
    priceCurrency?: PriceCurrency;
  };
  asr?: {
    engine?: AsrEngine;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    /** 元 / 分钟；0 表示清空。 */
    pricePerMinute?: number;
  };
  search?: {
    provider?: SearchProvider;
    apiKey?: string;
    maxResults?: number;
  };
  general?: {
    concurrency?: number;
    outputDir?: string;
    fileNameTemplate?: string;
    maxRetries?: number;
    retryBackoffSec?: number;
    runEndNotify?: boolean;
    runEndSound?: boolean;
  };
  visibility?: {
    hiddenNodes?: NodeType[];
  };
  obsidian?: {
    vaultPath?: string;
    folder?: string;
    tagTaxonomy?: Record<string, string[]>;
    tagView?: TagViewMode;
    autoTagEnabled?: boolean;
    sourceTagEnabled?: boolean;
    upTagEnabled?: boolean;
    /** 给溯源笔记写标签；缺省/关闭＝不写（见 AppSettings.obsidian.tagTraceNotes）。 */
    tagTraceNotes?: boolean;
    allowNewTags?: boolean;
    /** 从正文额外抽取的属性名；空数组表示不抽。 */
    extractFields?: string[];
    tagMinCount?: number;
    tagMaxCount?: number;
    autoLinkEnabled?: boolean;
    autoLinkMax?: number;
  };
  nutstore?: {
    serverUrl?: string;
    account?: string;
    /** 只写密钥；留空表示不修改。 */
    password?: string;
    /** 备份目录：本地文件夹 或 云端路径，按形状自动判定。 */
    backupDir?: string;
    obsidianRemotePath?: string;
    obsidianMode?: boolean;
  };
}
