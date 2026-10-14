/**
 * 标签词库（受控词表）与标签名的规范化规则。
 *
 * 词库结构是「一级 → 二级」，两级都存成纯粹的字符串；其中有两个**保留分组名**
 * （`UP主名称` / `来源`）——它们只是词库这一侧的排除名单（AI 不许分配、全库回补不碰），
 * 见 `AUTO_TAG_GROUPS` / `writableTags` / `managedTags`。
 *
 * **两个自动标签在笔记里不带一级**：UP 主写成 `UP：某某`，来源写成裸值 `B站`。
 * 一级 `UP主名称/`、`来源/` 是历史形状——它们当初是词库里的组，现在只用来识别老笔记里的旧标签。
 *
 * 为什么需要规范化：Obsidian 的标签**不能含空白**，并且排除一批标点（半角 `:`、`[`、`]`、引号等，
 * 见下面 `UP_TAG_PREFIX` 的注释）；`/` 是层级分隔符。UP 主名字里带空格是常态，
 * 不规范化就会写出一堆 Obsidian 读不出来的标签。
 * 另外 Obsidian 的标签是**大小写不敏感**的，所以去重一律按小写比对。
 */

/** 词库：一级分组 → 二级标签数组。二级为空数组表示该一级自己就是可用的标签。 */
export type TagTaxonomy = Record<string, string[]>;

/**
 * 保留分组的名字。**只用于词库这一侧**（不让 AI 分配、不参与全库回补），笔记里已经不写这个形状了。
 *
 * 新笔记里 UP 主是 `UP：某某`、来源是裸值；老笔记里可能还留着 `UP主名称/某某`、`来源/B站`，
 * 这两个名字同时是**旧标签的识别依据**（`isAutoTag`），写入时按开关把它们清掉。
 */
export const UP_TAXONOMY_GROUP = "UP主名称";

/** 来源标签的保留分组名；取值与笔记 frontmatter 的 `来源:` 属性同源（B站 / 本地文件 / 文本…）。 */
export const SOURCE_TAXONOMY_GROUP = "来源";

/**
 * UP 主标签的前缀：写出来是 `UP：某某`。
 *
 * 用**全角**冒号是硬要求：Obsidian 的标签字符集来自它自己的正则，排除集合是
 * 「U+2000–U+206F + U+2E00–U+2E7F + 一串半角标点（含 `:`、`.`、`[`、`]`、反引号）+ 空白」
 * ——半角 `:` 在里面（`UP:某某` 会被当成读不出来的死标签），全角 `：`（U+FF1A）不在。
 * 加前缀是为了在没有一级的情况下仍然看得出这是个 UP 主名——来源那支不需要，裸值（`B站`）本身认得出来。
 */
export const UP_TAG_PREFIX = "UP：";

/**
 * 所有由元数据自动写入的保留分组。
 *
 * 用户对它们**只有一个决定权：写不写**（设置页两个开关；节点卡片可以逐篇覆盖）。
 * 词库里不维护、AI 不分配、全库回补既不新增也不清理——理由：这些值在生成笔记时就已经知道了，
 * 靠内容回补是不可靠的。要改就让用户去 Obsidian 里自己改。
 */
export const AUTO_TAG_GROUPS: readonly string[] = [UP_TAXONOMY_GROUP, SOURCE_TAXONOMY_GROUP];

/**
 * 64 位十六进制字符串哈希（两个不同种子的 32 位混合）。
 *
 * 只用于「这份内容跟上次比变没变」的比对，不做安全用途——所以刻意不引 `node:crypto`，
 * 好让 packages/shared 保持浏览器可直接加载。碰撞的后果是「该重打的笔记被跳过一次」，
 * 不是数据损坏。
 */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ code, 0x85ebca6b) + i) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * 把一个标签**片段**（不含 `/`）规范成 Obsidian 认得的形状。
 *
 * 空格与其它非法字符一律换成 `-`，连续 `-` 折叠成一个，首尾的 `-` 去掉。
 * 全数字片段会被丢掉（Obsidian 不把 `#123` 当标签），返回空串让调用方跳过——
 * 与其静默改名，不如让上层报告「这个名字不能用」。
 */
export function normalizeTagSegment(raw: string): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "";
  if (/^\d+$/.test(cleaned)) return "";
  return cleaned;
}

/** 规范化整条标签路径（`一级/二级`），逐段处理；任一段非法就整条作废。 */
export function normalizeTagPath(raw: string): string {
  const segments = String(raw ?? "")
    .split("/")
    .map(normalizeTagSegment)
    .filter(Boolean);
  return segments.join("/");
}

/** 标签的比对键：Obsidian 标签大小写不敏感。 */
export function tagKey(tag: string): string {
  return tag.toLowerCase();
}

/** 标签所属的一级分组；没有 `/` 时就是它自己。 */
export function tagPathGroup(tag: string): string {
  return tag.split("/")[0] ?? tag;
}

/** 是否是 UP 主标签：新形状（`UP：某某`）与旧形状（`UP主名称/某某`）都算。 */
export function isUpTag(tag: string): boolean {
  return tag.startsWith(UP_TAG_PREFIX) || tagPathGroup(tag) === UP_TAXONOMY_GROUP;
}

/**
 * 是否是**由工具按元数据写进去的**标签（UP 主 / 来源），用于写入时按开关清理旧标签。
 *
 * 只认得出有形状的那几种：新的 `UP：某某`、旧的 `UP主名称/某某` 与 `来源/B站`。
 * **来源那支的新写法是裸值**（`B站`），跟人自己写的标签在文件里长得一样——所以它认不出来，
 * 也就不会被当成"我们写的"清掉。宁可留一个多余的标签，也不误删人写的东西。
 */
export function isAutoTag(tag: string): boolean {
  return tag.startsWith(UP_TAG_PREFIX) || AUTO_TAG_GROUPS.includes(tagPathGroup(tag));
}

/**
 * 笔记里一个标签的规范化：`UP：某某` 原样保留，其余走 `normalizeTagPath` 逐段规范。
 *
 * UP 主标签必须单独放行：`normalizeTagSegment` 把非字母数字一律换成 `-`，于是 `UP：某某`
 * 会被就地改成 `UP-某某`——一次全库回补就把已经写好的标签改坏了，而且看起来像模型改的。
 * 旧写法（`UP主名称/某某`、`来源/B站`）本来就是路径形状，照旧逐段规范，不搞两套口径。
 */
export function normalizeNoteTag(tag: string): string {
  const trimmed = String(tag ?? "").trim();
  return trimmed.startsWith(UP_TAG_PREFIX) ? trimmed : normalizeTagPath(trimmed);
}

/**
 * 把任意来源的 JSON 收敛成干净的词库：丢掉非数组的二级、逐段规范化、按小写去重。
 * 设置接口、AI 新增、默认值三条入口都过这一层，坏数据不该让打标整条链路失败。
 */
export function sanitizeTaxonomy(raw: unknown): TagTaxonomy {
  const out: TagTaxonomy = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [rawGroup, rawChildren] of Object.entries(raw as Record<string, unknown>)) {
    const group = normalizeTagSegment(rawGroup);
    if (!group) continue;
    const seen = new Set(out[group]?.map(tagKey) ?? []);
    const children: string[] = [];
    if (Array.isArray(rawChildren)) {
      for (const child of rawChildren) {
        const name = normalizeTagSegment(String(child ?? ""));
        if (!name || seen.has(tagKey(name))) continue;
        seen.add(tagKey(name));
        children.push(name);
      }
    }
    out[group] = children;
  }
  return out;
}

/**
 * AI 可以分配的标签：每个一级的二级（一级没有二级时一级自己），但**排除保留分组**
 * ——那两支是来源元数据写的，让模型参与只会写出跟元数据不一致的名字。
 */
export function writableTags(taxonomy: TagTaxonomy): string[] {
  const out: string[] = [];
  for (const [group, children] of Object.entries(taxonomy)) {
    if (AUTO_TAG_GROUPS.includes(group)) continue;
    if (children.length === 0) out.push(group);
    else for (const child of children) out.push(`${group}/${child}`);
  }
  return out;
}

/**
 * 本功能「拥有」的标签集合：写过的都算，所以它包含一级本身
 * （用户可能只用一级打标，那个一级也要能被删除）。
 *
 * **排除保留分组**：`来源/*` 与 `UP主名称/*` 不由词库管理，所以全库回补既不该新增、
 * 也不该把它们当成"词库里删掉的条目"从老笔记里清掉。
 */
export function managedTags(taxonomy: TagTaxonomy): string[] {
  const out: string[] = [];
  for (const [group, children] of Object.entries(taxonomy)) {
    if (AUTO_TAG_GROUPS.includes(group)) continue;
    out.push(group);
    for (const child of children) out.push(`${group}/${child}`);
  }
  return out;
}

/** 词库内容的稳定指纹；排序后拼接，保证「同样的词库得到同样的哈希」。 */
export function taxonomyHash(taxonomy: TagTaxonomy): string {
  const canonical = Object.keys(taxonomy)
    .sort()
    .map((group) => `${group}=${[...taxonomy[group]].sort().join(",")}`)
    .join(";");
  return stableHash(canonical);
}

/**
 * 往词库里加一条二级标签（已存在则原样返回，按小写判重）。
 * 返回新对象，不改原对象——React/Vue 的响应式与撤销都靠这个。
 */
export function addTagToTaxonomy(taxonomy: TagTaxonomy, group: string, name: string): TagTaxonomy {
  const g = normalizeTagSegment(group);
  const n = normalizeTagSegment(name);
  if (!g || !n) return taxonomy;
  const children = taxonomy[g] ?? [];
  if (children.some((child) => tagKey(child) === tagKey(n))) return taxonomy;
  return { ...taxonomy, [g]: [...children, n] };
}

/* ------------------------------------------------------------ 全库重打标的接口形状 */

/** 一次模型调用的 token 用量；厂商没返回的字段按 0 记。 */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 命中上下文缓存的提示词 token：批量打标靠它验证"固定前缀真被缓存了"。 */
  cachedTokens: number;
}

/** 重打标要处理哪几类笔记。 */
export type RetagNoteMode = "full" | "incremental" | "cleanup";

/**
 * 重打标预估。**不含任何模型调用**，所以界面可以先给数、用户点了才发车。
 * 只带少量路径样例：上千条路径塞进响应没意义，用户要的是"大概动多少、要花几次调用"。
 */
export interface RetagPlanView {
  vaultPath: string;
  totalNotes: number;
  fullCount: number;
  incrementalCount: number;
  cleanupCount: number;
  unchanged: number;
  estimatedCalls: number;
  /** 相比历史记录，词库里多出来的标签。 */
  addedTags: string[];
  /** 已从词库移除、会被从笔记里清掉的标签。 */
  removedTags: string[];
  unparsable: { relPath: string; reason: string }[];
  samples: { relPath: string; mode: RetagNoteMode }[];
}

export interface RetagReportView {
  totalNotes: number;
  written: number;
  unchanged: number;
  failed: { relPath: string; reason: string }[];
  addedTags: string[];
  removedTags: string[];
  /** 本次由 AI 补进词库的新叶子标签。 */
  learnedTags: string[];
  calls: number;
  usage: ChatUsage;
}

export type RetagJobStatus = "running" | "done" | "error";

/** 重打标任务。没有 SSE 通道，界面按它轮询。 */
export interface RetagJobView {
  id: string;
  status: RetagJobStatus;
  stage: "scan" | "classify" | "write" | "done";
  processed: number;
  total: number;
  message: string;
  error?: string;
  /** 只有 status 为 done 时才有。 */
  report?: RetagReportView;
}
