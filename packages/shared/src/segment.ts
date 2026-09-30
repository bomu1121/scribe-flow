import type { GraphNode, NodePick, WorkflowGraph } from "./graph";

/**
 * 素材挑选（段级分流）。
 *
 * 背景：一张来源卡可以承载多个视频/分P，运行时会为每个素材产出一份独立产物，
 * 下游节点也本来就是逐个素材处理（转写、AI 加工、文本工具都是「一个输入一份输出」）。
 * 问题只在于「用户无法指定只处理其中几个」——本模块补上这个指定。
 *
 * 语义（与用户对齐的决策）：
 * - 未选中的素材不进入本节点，其下游因为拿不到数据而一并跳过；
 * - 段标识缺失的产物视为不可筛选，永远通过（整体产物如 merge 的文档不受影响）；
 * - 来源节点 id 不在 pick 里 = 该来源全部选中（旧工程兼容）。
 */

/**
 * 段标识：`bvid:<bvid>:<page>` 或 `node:<来源节点 id>`。
 * 只用来源素材自身的稳定信息拼成，不掺入数组下标，避免上游改选区后静默错位。
 */
export function segmentKey(originNodeId: string, item: { bvid?: string; page?: number; cid?: number }): string {
  const bvid = String(item.bvid ?? "").trim();
  if (bvid) {
    const page = Number(item.page ?? 0);
    if (page > 0) return `bvid:${bvid}:${page}`;
    const cid = Number(item.cid ?? 0);
    return cid > 0 ? `bvid:${bvid}:cid${cid}` : `bvid:${bvid}`;
  }
  return `node:${originNodeId}`;
}

/**
 * 「派生兜底标识」的前缀，形如 `pos:<产出节点 id>:<第几个>`。
 *
 * 产物自己没带段标识时（例如压平后的整篇文档、按入边顺序派生的兜底身份）由引擎补上。
 * 它表示「第 N 个产物」，**不代表素材身份**——界面永远不写这种键，所以拿它去查挑选表
 * 必然落空。识别来源时必须把它和「没有标识」同等对待：否则会把一个说不清身份的产物
 * 错当成某张来源卡的素材，轻则误排除、重则整节点报「没有选中任何素材」。
 */
export const DERIVED_ITEM_KEY_PREFIX = "pos:";

/** 本地文件素材的段标识：优先 fileId，其次文件名，最后路径。 */
export function fileSegmentKey(item: { fileId?: string; fileName?: string; filePath?: string }): string {
  const id = String(item.fileId ?? "").trim();
  if (id) return `file:${id}`;
  const name = String(item.fileName ?? "").trim();
  if (name) return `file:${name}`;
  return `file:${String(item.filePath ?? "").trim()}`;
}

/**
 * 单个产物是否通过某节点的挑选。
 * itemKey 为空的产物（合并文档、整体产物）不可筛选，一律通过。
 */
export function passesPick(pick: NodePick | undefined, sourceNodeId: string, itemKey: string | undefined): boolean {
  if (!pick) return true;
  const chosen = pick[sourceNodeId];
  if (chosen === undefined) return true;
  if (!itemKey) return true;
  return chosen.includes(itemKey);
}

export interface SegmentOption {
  /** 段标识；写进 pick 的值。 */
  key: string;
  /** 序号（该来源内的第几个素材，从 1 开始）。 */
  index: number;
  /** 素材标题；缺省用节点显示名。 */
  title: string;
  /** 分P / 番剧小标题等附属信息。 */
  part?: string;
  /** 时长（秒）。 */
  duration?: number;
  /** 产生该素材的来源节点。 */
  originNodeId: string;
  /** 来源节点显示名，用于分组标题。 */
  originLabel: string;
  sourceType: "bili" | "file" | "text";
}

/** 文本素材没有标题，用首行作展示名。 */
function firstLine(text: string): string {
  const line = text.split("\n").find((item) => item.trim())?.trim() ?? "";
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

function nodeDisplayName(node: GraphNode): string {
  const label = String((node.data as { label?: string }).label ?? "").trim();
  if (label) return label;
  if (node.type === "source.bili") return "B站视频";
  if (node.type === "source.file") return "本地文件";
  return "文本输入";
}

/**
 * 「一个输入一份结果」的节点：它的产出与输入一一对应，因此素材身份可以穿过它。
 *
 * 这类节点是挑选节点最常见的上游（用户的原话是「一个校对模块处理了八个输入」），
 * 识别时必须能穿过它们，否则卡片会识别不到任何素材。
 */
export const PER_INPUT_NODE_TYPES: ReadonlySet<string> = new Set([
  "process.transcribe",
  "process.refine",
  "process.prompt",
  "process.gameguide",
  "process.drill",
  "process.text",
  "flow.pick",
]);

/** 单张来源卡承载的素材清单（0 个表示这张卡没有可挑的素材）。 */
function sourceCardSegments(node: GraphNode): SegmentOption[] {
  if (node.type === "source.bili") {
    const data = node.data as { items?: unknown; bvid?: string; page?: number; title?: string };
    const items = Array.isArray(data.items)
      ? (data.items as { bvid?: string; page?: number; cid?: number; title?: string; part?: string; duration?: number }[])
      : [];
    if (items.length > 0) {
      return items.map((item, i) => ({
        key: segmentKey(node.id, { bvid: item.bvid ?? data.bvid, page: item.page, cid: item.cid }),
        index: i + 1,
        title: String(item.title ?? data.title ?? "").trim() || `第 ${i + 1} 个视频`,
        part: item.part ? String(item.part) : undefined,
        duration: typeof item.duration === "number" ? item.duration : undefined,
        originNodeId: node.id,
        originLabel: nodeDisplayName(node),
        sourceType: "bili" as const,
      }));
    }
    // 单链接卡：解析过之后也带 bvid，可以让用户在多张来源卡之间挑（例如「只加工这一条」）。
    const bvid = String(data.bvid ?? "").trim();
    if (!bvid) return [];
    return [
      {
        key: segmentKey(node.id, { bvid, page: Number(data.page ?? 1) }),
        index: 1,
        title: String(data.title ?? "").trim() || bvid,
        originNodeId: node.id,
        originLabel: nodeDisplayName(node),
        sourceType: "bili" as const,
      },
    ];
  }

  if (node.type === "source.text") {
    const data = node.data as { text?: string; label?: string };
    const text = String(data.text ?? "").trim();
    return [
      {
        key: segmentKey(node.id, {}),
        index: 1,
        title: String(data.label ?? "").trim() || firstLine(text) || "文本输入",
        originNodeId: node.id,
        originLabel: nodeDisplayName(node),
        sourceType: "text" as const,
      },
    ];
  }

  if (node.type === "source.file") {
    const data = node.data as { fileId?: string; fileName?: string; filePath?: string };
    return [
      {
        key: fileSegmentKey(data),
        index: 1,
        title: String(data.fileName ?? "").trim() || nodeDisplayName(node),
        originNodeId: node.id,
        originLabel: nodeDisplayName(node),
        sourceType: "file" as const,
      },
    ];
  }

  return [];
}

/**
 * 收集目标节点上游可挑选的素材。
 *
 * 识别规则（决定「连接时就识别到什么」）：
 * - 来源卡：按卡内素材逐个列出（一张多选卡 = N 个素材、N 张卡 = N 个素材）；
 * - 「一个输入一份结果」的模块（转写 / 校对 / AI 加工 / 攻略 / 练一练 / 文本工具 / 挑选）：
 *   **穿过去**继续往上追——这是最常见的场景（校对模块处理了 8 个输入，下游只要其中 3 个）；
 * - 压平型模块（合并 / 输出 / 章节切分 / 思维导图 / 条件分支）：**身份到此为止**。
 *   继续往上找的是它各条入边上的素材（「只让第一份进合并」也讲得通，引擎按入边过滤支持），
 *   但要注意这些素材与它压平后的产物之间没有一一对应关系——想按段分流必须发生在压平之前，
 *   也就是用「素材挑选」节点拦在中间。
 *
 * 注意这是**静态**识别（只看工程图、不依赖是否跑过）；返回空数组表示「没有可挑的余地」，
 * 调用方据此不展示选择器。
 */
export function collectSegmentOptions(graph: WorkflowGraph, targetNodeId: string): SegmentOption[] {
  const visited = new Set<string>();
  const cards: SegmentOption[][] = [];

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const material = sourceCardSegments(node);
    // 来源卡：它就是素材所在。source.text 是单份内容，sourceCardSegments 对它返回空。
    if (node.type.startsWith("source.")) {
      if (material.length > 0) cards.push(material);
      return;
    }
    if (material.length > 0) {
      cards.push(material);
      return;
    }
    // 中间模块本身不承载素材，继续沿入边往上游追：
    // 逐项模块（转写/校对/…）与压平型模块（合并/输出/…）都追，因此
    // 「校对模块处理了 8 个输入」与「三张文稿卡汇入合并」两种情况都能识别到上游素材。
    for (const edge of graph.edges) {
      if (edge.target === nodeId) visit(edge.source);
    }
  };

  visit(targetNodeId);
  // 只有当上游确实存在「两个及以上可挑素材」时才有挑选余地：
  // 单张卡承载 8 个素材是有余地的；一张卡一个素材（单链接卡 / 单个文件）则挑与不挑等价。
  const options = cards.flat();
  return options.length > 1 ? options : [];
}

/**
 * 一个产物在挑选表里的键：把它的产出方回溯到**承载它的来源卡**。
 *
 * 挑选表（`NodeBase.data.pick`）的键是来源卡节点 id——界面用 `collectSegmentOptions` 的
 * `originNodeId` 写进去，运行时必须按**同一个口径**读回来。产物的直接上游常常不是来源卡
 * （`B站链接 → 转写 → 校对 → 挑选` 里，挑选的直接上游是校对），所以要沿「一个输入一份结果」
 * 的链路往回走到来源卡，否则查表落空的语义恰好是「全选」，挑选会静默失效。
 *
 * 走到多张来源卡时用段标识消歧：`node:<卡 id>` 自带来源，`bvid:` / `file:` 与该卡自己的
 * 段标识逐字比对。仍无法唯一确定就返回 `undefined`——调用方按「不可筛选」处理，
 * 宁可漏筛（全放行）也不能错筛（把别的卡的素材误排除）。
 */
export function originSourceNodeId(graph: WorkflowGraph, nodeId: string, itemKey?: string): string | undefined {
  // 派生兜底标识不代表素材身份（见 DERIVED_ITEM_KEY_PREFIX），不参与来源回溯。
  if (!itemKey || itemKey.startsWith(DERIVED_ITEM_KEY_PREFIX)) return undefined;
  const candidates: GraphNode[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    if (node.type.startsWith("source.")) {
      candidates.push(node);
      return;
    }
    // 压平型模块（合并 / 输出 / 章节切分 / 导图）的身份到此为止：它的产物与上游素材没有
    // 一一对应关系，继续往回追会把「整篇文档」当成某一段素材。
    if (!PER_INPUT_NODE_TYPES.has(node.type)) return;
    for (const edge of graph.edges) {
      if (edge.target === id) visit(edge.source);
    }
  };
  visit(nodeId);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0].id;
  const matched = candidates.filter((card) => sourceCardSegments(card).some((option) => option.key === itemKey));
  return matched.length === 1 ? matched[0].id : undefined;
}

/** 按来源节点分组，供选择器渲染分组标题。 */
export function groupSegmentOptions(options: SegmentOption[]): { originNodeId: string; originLabel: string; items: SegmentOption[] }[] {
  const order: string[] = [];
  const map = new Map<string, { originNodeId: string; originLabel: string; items: SegmentOption[] }>();
  for (const option of options) {
    let group = map.get(option.originNodeId);
    if (!group) {
      group = { originNodeId: option.originNodeId, originLabel: option.originLabel, items: [] };
      map.set(option.originNodeId, group);
      order.push(option.originNodeId);
    }
    group.items.push(option);
  }
  return order.map((id) => map.get(id)!);
}

/** 已配置的挑选里，有哪些键指向了当前图上已不存在的素材（用于界面警示）。 */
export function stalePickKeys(options: SegmentOption[], pick: NodePick | undefined): string[] {
  if (!pick) return [];
  const alive = new Set(options.map((option) => `${option.originNodeId}\u0000${option.key}`));
  const stale: string[] = [];
  for (const [originNodeId, keys] of Object.entries(pick)) {
    for (const key of keys) {
      if (!alive.has(`${originNodeId}\u0000${key}`)) stale.push(key);
    }
  }
  return stale;
}

/**
 * 来源输出是否还需要被生产（用于避免「用户根本没选这个视频，却仍然把它下载/转写了一遍」）。
 *
 * 只要存在一条通往「会接受这个素材的消费者」的路径就算需要：消费者节点自己没配挑选时
 * 视为全收，因此旧工程与未配置挑选的链路行为完全不变。
 */
export function isSourceOutputNeeded(graph: WorkflowGraph, sourceNodeId: string, itemKey: string): boolean {
  const consumers = graph.edges.filter((edge) => edge.source === sourceNodeId).map((edge) => edge.target);
  // 没有下游（独立运行来源节点）：照常产出，供结果页查看。
  if (consumers.length === 0) return true;
  return consumers.some((consumerId) => {
    const consumer = graph.nodes.find((n) => n.id === consumerId);
    if (!consumer) return true;
    return passesPick((consumer.data as { pick?: NodePick }).pick, sourceNodeId, itemKey);
  });
}
