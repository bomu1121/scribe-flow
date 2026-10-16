/**
 * 信息溯源 v2 的结构化数据契约。
 *
 * 溯源模块与笔记加工分离后，AI 加工节点输出一份“证据清单”，而不是一篇普通笔记。
 * 这份 JSON 直接由前端溯源报告阅读器消费；也保留一份 Markdown 导出，便于复制/下载。
 */

import type { PromptArtifact } from "./prompt";

export type TraceCategory =
  | "fact"
  | "data"
  | "viewpoint"
  | "conclusion"
  | "term"
  | "step"
  | "caveat"
  | "other";

export type TraceConfidence = "confirmed" | "likely" | "uncertain";

/** 一条证据/提及的具体来源：哪条视频、哪个文件、哪篇文本、哪个 P、哪个时间点。 */
export interface TraceSourceRef {
  /** 来源类型，如 bili / file / text / transcript。 */
  type?: string;
  /** 来源名称，例如《视频标题》或文件名；优先展示这个。 */
  name: string;
  /** 作者 / UP 主。 */
  author?: string;
  /** 原始链接。 */
  url?: string;
  /** 视频/文稿内定位，例如 P2 / 00:12:34 / 第 3 段。 */
  locator?: string;
}

export interface TraceEvidence {
  /** 逐字摘自原文的短引用；用于在原文中高亮定位。 */
  quote: string;
  /** 兼容旧数据的顶层定位；新数据建议写到 source.locator。 */
  locator?: string;
  /** 这条证据具体来自哪个来源。 */
  source?: TraceSourceRef;
  /** 该条证据与主张的关系说明，例如“作者口述”“数据出处”。 */
  note?: string;
}

export type TraceExternalStatus =
  | "not_applicable"
  | "unchecked"
  | "verified"
  | "weak_source"
  | "contradicted"
  | "not_found"
  | "ambiguous";

/** 来源权威度分级：权威机构/学术/官方一档，百科与文档一档，自媒体与聚合站一档。 */
export type TraceSourceAuthority = "authoritative" | "reference" | "self-media" | "unknown";

/** 核查结论的证据力度：逐字引文，还是只有检索摘要。 */
export type TraceExternalEvidence = "verbatim" | "snippet";

/** 一条通过逐字校验的外部引文：摘自该来源网页正文的原句。 */
export interface TraceExternalQuote {
  /** 逐字摘自网页正文的片段（多段用 `…` 连接，每段都独立命中过正文）。 */
  text: string;
  note?: string;
}

/** 外部事实核查命中的参考来源。 */
export interface TraceExternalSource {
  title?: string;
  url?: string;
  snippet?: string;
  /**
   * 站点名（检索接口给出的 media）。相当一部分查询拿不到域名，只给标题+正文；
   * 有站点名时用它兜底判权威度，都没有就只能是未判定。
   */
  publisher?: string;
  /** 该来源的权威度分级；由服务端按域名判定。 */
  authority?: TraceSourceAuthority;
  /**
   * 本轮是否真的抓到了这一页的正文。
   *
   * `false` 不等于「这条来源是假的」，也不等于「抓取失败」：它包含三种情况——
   * ① 抓了但失败（此时 `fetchError` 有值）；② 本轮没去抓（每条主张只抓重排后最靠前的几条，且有一轮总预算）；
   * ③ 检索接口没返回链接。报告要如实区分它们：三种情况的含义与处置完全不同。
   */
  fetched?: boolean;
  /** **抓了但失败**的原因（HTTP 状态、超时、抽不出正文等）；没抓或抓成功时为空。 */
  fetchError?: string;
  /** 抓到的正文长度（字符）；未抓到时为空。 */
  contentChars?: number;
  /**
   * 逐字摘自该来源网页正文的片段；**由服务端校验后才写入**。
   * 模型给的引文只要有一处无法在正文里逐字命中就会被丢弃——这是「不捏造」的机械保证。
   */
  quotes?: TraceExternalQuote[];
}

export interface TraceExternalCheck {
  status: TraceExternalStatus;
  /** 主检索词（多条检索时取第一条），便于旧数据与单条展示。 */
  query?: string;
  /** 本次核查实际用过的全部检索词。 */
  queries?: string[];
  /** 本次核查拿到的来源里，各权威度档位的数量。 */
  authorityCounts?: Partial<Record<TraceSourceAuthority, number>>;
  /**
   * 本次结论建立在什么之上：
   * - `verbatim`：至少有一条来源抓到了正文、且有逐字命中正文的引文；
   * - `snippet`：只有检索摘要（没抓到正文，或抓到的正文里没能撞出可用引文）。
   *
   * 单独记这个字段，是因为「有权威来源」和「能看到来源里怎么写的」是两件事，
   * 只有前者时不该让报告读起来像后者。
   */
  evidence?: TraceExternalEvidence;
  /** 核查结论：外部来源是否支持/反对/无法确认视频里的说法。 */
  summary?: string;
  sources?: TraceExternalSource[];
  note?: string;
}

/** 这条信息在视频内部的归属：是作者原创观点，还是转述某个外部人物/机构/研究。 */
export interface TraceAttribution {
  kind: "self" | "external" | "unknown";
  /** 外部归属对象，如“某论文/某作者/某机构/某访谈”。 */
  name?: string;
  detail?: string;
}

/** 联网核查计划：这条信息要不要查、用什么检索词查。 */
export interface TraceVerifyPlan {
  needed?: boolean;
  /** 检索词，建议 1-2 条，含专名/数字/时间，不带主观问法。 */
  queries?: string[];
}

export interface TraceItem {
  /** 条目 id，建议形如 item-1。 */
  id?: string;
  category: TraceCategory;
  /** 一句话信息主张，用户可直接阅读的结论/事实/观点。 */
  claim: string;
  /** 该条信息与原文的关系：原文可见 / 间接推断 / 待核实。 */
  confidence: TraceConfidence;
  /** 为什么这样归类/定置信度：例如“原文第 2 段明确陈述，第 5 段再次出现同一数据”。 */
  basis?: string;
  /** 视频内归属：这句话是作者自己说的，还是转述/引用外部来源。 */
  attribution?: TraceAttribution;
  /** 联网核查计划；由溯源模版的抽取步产出，服务端据此发起检索。 */
  verify?: TraceVerifyPlan;
  /** 外部事实核查结果（由联网检索与 AI 比对生成；未配置检索渠道时可为 undefined）。 */
  external?: TraceExternalCheck;
  /** 原文证据，逐字引用。存疑条目允许为空数组。 */
  evidence: TraceEvidence[];
  /** 其他地方/其他来源对同一主张的佐证或提及。 */
  mentions?: TraceEvidence[];
  /** 为什么需要存疑/需要注意什么；可选。 */
  note?: string;
}

export interface TraceUncertainty {
  claim: string;
  reason: string;
}

export interface TraceReport {
  /** 固定为 1，便于未来演进。 */
  schema: 1;
  /** 报告标题，通常是素材名或主题。 */
  title?: string;
  /** 一段话摘要，放在报告顶部。 */
  summary?: string;
  /** 可溯源信息条目。 */
  items: TraceItem[];
  /** 原文未讲清、需要额外核实的疑问点。 */
  uncertainties?: TraceUncertainty[];
  /** 整体提醒，例如“部分时间戳来自转写稿，可能与原视频有偏差”。 */
  warnings?: string[];
}

const TRACE_CATEGORIES: TraceCategory[] = ["fact", "data", "viewpoint", "conclusion", "term", "step", "caveat", "other"];
const TRACE_CONFIDENCES: TraceConfidence[] = ["confirmed", "likely", "uncertain"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseSourceRef(value: unknown): TraceSourceRef | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name);
  if (!name) return null;
  return {
    type: asString(value.type),
    name,
    author: asString(value.author),
    url: asString(value.url),
    locator: asString(value.locator),
  };
}

function parseEvidence(value: unknown): TraceEvidence | null {
  if (!isRecord(value)) return null;
  const quote = asString(value.quote);
  if (!quote) return null;
  const source = parseSourceRef(value.source);
  return {
    quote,
    locator: asString(value.locator) ?? source?.locator,
    source: source ?? undefined,
    note: asString(value.note),
  };
}

function parseAttribution(value: unknown): TraceAttribution | undefined {
  if (!isRecord(value)) return undefined;
  const kind = asString(value.kind);
  const normalizedKind: TraceAttribution["kind"] = kind === "self" || kind === "external" ? kind : "unknown";
  const name = asString(value.name);
  const detail = asString(value.detail);
  if (normalizedKind === "unknown" && !name && !detail) return undefined;
  return { kind: normalizedKind, name, detail };
}

const EXTERNAL_STATUSES: TraceExternalStatus[] = ["not_applicable", "unchecked", "verified", "weak_source", "contradicted", "not_found", "ambiguous"];
const SOURCE_AUTHORITIES: TraceSourceAuthority[] = ["authoritative", "reference", "self-media", "unknown"];
const EXTERNAL_EVIDENCES: TraceExternalEvidence[] = ["verbatim", "snippet"];

function parseAuthorityCounts(value: unknown): Partial<Record<TraceSourceAuthority, number>> | undefined {
  if (!isRecord(value)) return undefined;
  const counts: Partial<Record<TraceSourceAuthority, number>> = {};
  for (const authority of SOURCE_AUTHORITIES) {
    const count = value[authority];
    if (typeof count === "number" && Number.isFinite(count) && count > 0) counts[authority] = count;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

/** 引文列表：只接受带 `text` 的条目（服务端校验通过的才会写进来，这里仍按宽松容错解析）。 */
function parseQuotes(value: unknown): TraceExternalQuote[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const quotes: TraceExternalQuote[] = [];
  for (const quote of value) {
    if (!isRecord(quote)) continue;
    const text = asString(quote.text);
    if (!text) continue;
    quotes.push({ text, note: asString(quote.note) });
  }
  return quotes.length > 0 ? quotes : undefined;
}

function parseExternalSource(source: unknown): TraceExternalSource | null {
  if (!isRecord(source)) return null;
  const authority = asString(source.authority) as TraceSourceAuthority | undefined;
  const contentChars = typeof source.contentChars === "number" && Number.isFinite(source.contentChars) ? source.contentChars : undefined;
  return {
    title: asString(source.title),
    url: asString(source.url),
    snippet: asString(source.snippet),
    publisher: asString(source.publisher),
    authority: authority && SOURCE_AUTHORITIES.includes(authority) ? authority : undefined,
    fetched: typeof source.fetched === "boolean" ? source.fetched : undefined,
    fetchError: asString(source.fetchError),
    contentChars,
    quotes: parseQuotes(source.quotes),
  };
}

function parseExternalCheck(value: unknown): TraceExternalCheck | undefined {
  if (!isRecord(value)) return undefined;
  const status = asString(value.status) as TraceExternalStatus | undefined;
  if (!status || !EXTERNAL_STATUSES.includes(status)) return undefined;
  const evidence = asString(value.evidence) as TraceExternalEvidence | undefined;
  const sources = Array.isArray(value.sources)
    ? value.sources.map(parseExternalSource).filter((source): source is TraceExternalSource => source !== null)
    : [];
  const queries = Array.isArray(value.queries)
    ? value.queries.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];
  return {
    status,
    query: asString(value.query) ?? queries[0],
    queries: queries.length > 0 ? queries : undefined,
    authorityCounts: parseAuthorityCounts(value.authorityCounts),
    evidence: evidence && EXTERNAL_EVIDENCES.includes(evidence) ? evidence : undefined,
    summary: asString(value.summary),
    sources,
    note: asString(value.note),
  };
}

function parseVerifyPlan(value: unknown): TraceVerifyPlan | undefined {
  if (!isRecord(value)) return undefined;
  const queries = Array.isArray(value.queries)
    ? value.queries.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];
  const needed = typeof value.needed === "boolean" ? value.needed : undefined;
  if (needed === undefined && queries.length === 0) return undefined;
  return { needed, queries: queries.length > 0 ? queries : undefined };
}

function parseItem(value: unknown): TraceItem | null {
  if (!isRecord(value)) return null;
  const claim = asString(value.claim);
  if (!claim) return null;
  const category = asString(value.category) as TraceCategory | undefined;
  const confidence = asString(value.confidence) as TraceConfidence | undefined;
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.map(parseEvidence).filter((item): item is TraceEvidence => item !== null)
    : [];
  const mentions = Array.isArray(value.mentions)
    ? value.mentions.map(parseEvidence).filter((item): item is TraceEvidence => item !== null)
    : [];
  return {
    id: asString(value.id),
    category: category && TRACE_CATEGORIES.includes(category) ? category : "other",
    claim,
    confidence: confidence && TRACE_CONFIDENCES.includes(confidence) ? confidence : evidence.length > 0 ? "likely" : "uncertain",
    basis: asString(value.basis),
    attribution: parseAttribution(value.attribution),
    verify: parseVerifyPlan(value.verify),
    external: parseExternalCheck(value.external),
    evidence,
    mentions,
    note: asString(value.note),
  };
}

function parseUncertainty(value: unknown): TraceUncertainty | null {
  if (!isRecord(value)) return null;
  const claim = asString(value.claim);
  const reason = asString(value.reason);
  if (!claim) return null;
  return { claim, reason: reason ?? "原文未明确说明" };
}

/**
 * 把 AI 输出解析为溯源报告。
 * 只做宽松的字段级容错：核心是 items 数组；缺省字段补默认值，坏条目丢弃。
 */
export function parseTraceReport(raw: string): TraceReport | null {
  const text = raw.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) return null;
  const items = parsed.items.map(parseItem).filter((item): item is TraceItem => item !== null);
  return {
    schema: 1,
    title: asString(parsed.title),
    summary: asString(parsed.summary),
    items,
    uncertainties: Array.isArray(parsed.uncertainties)
      ? parsed.uncertainties.map(parseUncertainty).filter((item): item is TraceUncertainty => item !== null)
      : undefined,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((item) => asString(item)).filter((item): item is string => Boolean(item))
      : undefined,
  };
}

/**
 * 部分运行会把多个输入的 JSON 报告用 `---` 拼在同一份输出里。
 * 这里按分隔符拆开后逐个解析，保留所有有效报告。
 */
export function parseTraceReports(raw: string): TraceReport[] {
  if (!raw?.trim()) return [];
  const segments = raw
    .split(/\n?\s*---\s*\n?/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const reports: TraceReport[] = [];
  for (const segment of segments) {
    const report = parseTraceReport(segment);
    if (report) reports.push(report);
  }
  return reports;
}

/**
 * 一份产物该不该按「溯源报告」处理——结果页给它套哪个阅读器、落盘要不要先转 Markdown、frontmatter 写不写
 * `类型: 溯源笔记`、与同源笔记要不要配对，都由这一句决定。结果页与落盘读的就是它，没有第二套判据。
 *
 * 两个来源，顺序固定：
 * 1. **产出方声明**（`PromptArtifact`）：这是契约。同一枚 AI 加工卡可以出两类产物，只有做法自己说得清；
 * 2. **正文格式兜底**：产出方没声明、而正文本身就是一份可解析的报告 JSON 时也算。给「文本来源节点里
 *    直接粘了一篇报告」「脚本把报告写进了文件」这类**没法声明**的入口兜底——它们进库时同样是报告，
 *    不兜的话整篇 JSON 会原样落进笔记库。这与 `maybeDrillToMarkdown`（练习集 JSON 不许原样进文档）
 *    是同一条下游规矩，只是那边没有「做法声明」这一层可读。
 *
 * 注意兜底只回答「这段文本是什么格式」，**不回答「这枚卡在做什么」**：画布徽章与出口卡预告只读声明，
 * 所以一个普通笔记节点不会因为正文里恰好有份报告 JSON 就被标成「报告」。
 */
export function isTraceReportProduct(text: string, artifact: PromptArtifact = "note"): boolean {
  if (artifact === "trace-report") return true;
  return parseTraceReport(text) !== null;
}

export const TRACE_CATEGORY_LABELS: Record<TraceCategory, string> = {
  fact: "客观信息",
  data: "数据",
  viewpoint: "观点",
  conclusion: "结论",
  term: "术语",
  step: "步骤",
  caveat: "注意",
  other: "其他",
};

export const TRACE_CONFIDENCE_LABELS: Record<TraceConfidence, string> = {
  confirmed: "原文可见",
  likely: "间接推断",
  uncertain: "待核实",
};

export const TRACE_EXTERNAL_STATUS_LABELS: Record<TraceExternalStatus, string> = {
  not_applicable: "不适用",
  unchecked: "未联网核查",
  verified: "外部可印证",
  weak_source: "仅非权威来源",
  contradicted: "外部有矛盾/反证",
  not_found: "未找到外部出处",
  ambiguous: "存在争议/不明确",
};

export const TRACE_SOURCE_AUTHORITY_LABELS: Record<TraceSourceAuthority, string> = {
  authoritative: "权威",
  reference: "参考",
  "self-media": "自媒体",
  unknown: "未判定",
};

export const TRACE_EVIDENCE_LABELS: Record<TraceExternalEvidence, string> = {
  verbatim: "有原文引证",
  // 不能说成「仅检索摘要」：抓到了正文却没引用句（比如结论是「来源与说法无关」）也落在这里，
  // 那时「摘要」这个词是错的。它表达的只有一件事：这条结论没有逐字引文撑着。
  snippet: "无原文引证",
};

/**
 * 报告的主来源：按 `evidence` 里出现次数最多的那个来源判定。
 *
 * 用途是**别再逐条重复视频名与「转写稿第 N 段」**：报告讲的就是这一段转写稿，
 * 而转写稿不会落进笔记库（它是运行中间产物），笔记的 front matter 里已经有 `原始链接` 与 `作者`。
 * 非主来源（文件、网页）仍然附出处——那时出处是真信息。
 */
function primaryEvidenceKey(report: TraceReport): string {
  const counts = new Map<string, number>();
  for (const item of report.items) {
    for (const evidence of item.evidence) {
      const key = `${evidence.source?.name ?? ""}|${evidence.source?.url ?? ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = "";
  let max = -1;
  for (const [key, count] of counts) {
    if (count > max) {
      max = count;
      best = key;
    }
  }
  return best;
}

/** 引文行：主来源只留原文；非主来源在后面补 `——（来源 · 定位）`。 */
function formatEvidenceLine(evidence: TraceEvidence, primaryKey: string, flat: boolean): string {
  const key = `${evidence.source?.name ?? ""}|${evidence.source?.url ?? ""}`;
  const locator = (evidence.locator ?? evidence.source?.locator)?.trim();
  const isPrimary = key === primaryKey;
  const ref = isPrimary
    ? ""
    : `——（${[evidence.source?.name?.trim(), locator].filter(Boolean).join(" · ") || "出处不详"}）`;
  const note = evidence.note?.trim() ? `（${evidence.note.trim()}）` : "";
  const quote = `“${evidence.quote.trim()}”${ref}${note}`;
  return flat ? quote : `- ${quote}`;
}

/**
 * 认定「需要留意」的核查结论：外部资料反证、只有非权威来源、没找到出处。
 * 「未联网核查」不算在内，但会计入速览的数量统计（见 traceReportToMarkdown）。
 */
export const FLAGGED_EXTERNAL_STATUSES: TraceExternalStatus[] = ["contradicted", "weak_source", "not_found"];

/**
 * 核查结论 → callout 类型。
 *
 * **只给「真问题」上暖色**（未找到出处 / 有反证），其余走中性蓝：实测一份 27 条的报告里
 * 有 13 条「需要留意」，按状态铺满暖色会让整页变成一条彩虹（用户反馈「色彩太鲜艳」）。
 * 类型名写死：Obsidian 里写错类型名不报错，会**静默回落成蓝色 note**。
 */
const TRACE_STATUS_CALLOUT: Record<TraceExternalStatus, string> = {
  contradicted: "danger",
  // 「存在争议/不明确」也是要留意的一类（来源互相矛盾），但比「有反证」轻一档
  ambiguous: "warning",
  not_found: "failure",
  weak_source: "info",
  verified: "info",
  unchecked: "info",
  not_applicable: "info",
};

/** 分组的顺序与标题：**问题优先**，组内保持原文顺序。 */
const TRACE_GROUP_ORDER: { status: TraceExternalStatus; title: string; hint: string }[] = [
  { status: "contradicted", title: "外部有反证", hint: "检索到与说法矛盾的权威来源——先看这一组。" },
  { status: "ambiguous", title: "存在争议或不明确", hint: "检索到的来源互相矛盾、或说不清，需要你自己判断。" },
  { status: "not_found", title: "未找到外部出处", hint: "网上查不到支持它的来源，只能当「视频里的说法」看。" },
  { status: "weak_source", title: "仅非权威来源", hint: "网上有说法，但都来自自媒体/未判定站点，不构成权威出处。" },
  { status: "verified", title: "外部可印证", hint: "拿到了权威来源（政府/学术/官方机构/官方媒体）。" },
];

const TRACE_UNCHECKED_TITLE = "未联网核查";
const TRACE_UNCHECKED_HINT = "作者观点、术语定义这类不需要外部出处的内容，或本轮未进入核查的条目。";

/** 某条主张属于哪一组：没有 external、或状态是「没查/不适用」的都归「未联网核查」。 */
function groupStatusOf(item: TraceItem): TraceExternalStatus | undefined {
  const status = item.external?.status;
  if (!status || status === "unchecked" || status === "not_applicable") return undefined;
  return status;
}


export interface TraceMarkdownOptions {
  /**
   * 报告自己没有给出可用标题时用的标题。
   *
   * 用途：写进 Obsidian 时，笔记名默认取正文第一个 H1。而模型产出的 `title` 常常就是
   * 「信息溯源报告」这个通用值——十份笔记全叫这个名，只能靠 (2)(3) 区分，等于没有名字。
   * 所以落盘那条路会传素材名进来（如 `《中美社保对比，有哪些不同？》 · 信息溯源`）。
   */
  fallbackTitle?: string;
}

/** 报告标题是否可用：非空、且不是那个通用默认值。 */
function usableTitle(value: string | undefined): boolean {
  const title = value?.trim();
  return Boolean(title) && title !== DEFAULT_TRACE_TITLE;
}

const DEFAULT_TRACE_TITLE = "信息溯源报告";

/** 来源行：`[权威] <链接>`，末尾按需带「没抓到正文」的说明。 */
function sourceMetaLine(source: TraceExternalSource): string {
  const authority = `[${source.authority ? TRACE_SOURCE_AUTHORITY_LABELS[source.authority] : "未判定"}]`;
  const link = source.url?.trim() ? `<${source.url.trim()}>` : "（本次检索未返回链接）";
  /*
   * 三种「没抓到」要分开写，否则读者会以为站点抓不动；也说明这条结论是**依据检索摘要**得出的，
   * 不是依据页面正文——这直接影响该不该信它。
   */
  const noFetch =
    source.fetched === false && source.url
      ? source.fetchError
        ? "（抓取失败，依据检索摘要）"
        : "（本轮未抓正文，依据检索摘要）"
      : "";
  return `${authority} ${link}${noFetch}`;
}

/** 联网核查块的正文：结论 → 来源与引文 → 检索词 → 说明。**分段之间空一行**，否则会被并成一段。 */
function traceExternalBody(item: TraceItem): string[] {
  const external = item.external;
  if (!external) return [];
  const body: string[] = [];
  if (external.summary?.trim()) body.push(external.summary.trim());
  for (const source of external.sources ?? []) {
    body.push("", `**${source.title?.trim() || source.url?.trim() || "来源"}**　${sourceMetaLine(source)}`);
    for (const quote of source.quotes ?? []) {
      body.push(`　原文：“${quote.text.trim()}”${quote.note?.trim() ? ` —— ${quote.note.trim()}` : ""}`);
    }
  }
  const queries = (external.queries ?? (external.query ? [external.query] : []))
    .map((query) => query.trim())
    .filter(Boolean);
  if (queries.length > 0) body.push("", `**检索词**：${queries.join(" / ")}`);
  if (external.note?.trim()) body.push("", `**说明**：${external.note.trim()}`);
  return body;
}

/**
 * 包一个 callout。`fold` 为真时默认折叠（官方语法：类型标识符后加 `-`）。
 *
 * 两个硬规则（写在 docs/research/obsidian-note-typography.md 与 trace-export-research.md 里）：
 * ① 标题必须是中文——不写标题时 Obsidian 用类型名做标题，会显示英文的 Summary / Question；
 * ② callout 与前后内容之间要空一行，否则会被上一条吞掉。空行在这里表现为 `>` 单独一行。
 */
function traceCallout(type: string, title: string, body: string[], fold = true): string[] {
  return [`> [!${type}]${fold ? "-" : ""} ${title}`, ...body.map((line) => (line ? `> ${line}` : ">")), ""];
}

/** `判断依据：…` → `**判断依据**：…`。冒号必须留在 `**` 外面（见下）。 */
function boldLabel(line: string): string {
  const at = line.indexOf("：");
  return at < 0 ? line : `**${line.slice(0, at)}**${line.slice(at)}`;
}

/**
 * 把结构化溯源报告转成可读 Markdown，供“复制/下载”、Obsidian 落盘与不支持结构化视图的场合使用。
 *
 * 形态是「**按核查结论分组 + 详情折叠 + 平铺行**」，取舍都对着实测：
 *
 * - **分组（问题优先）**：报告的第一用途是「哪些说法站不住」。旧版把这些放在速览里平铺，
 *   13 条平均 242 字（该区实测 2462px）——一个用来扫一眼的区成了第二篇长文。现在组标题就是答案，
 *   组内保持原文顺序。
 * - **详情折叠**（`> [!x]-`）：长结论、来源、引文默认折起来。单条从 863px 降到 409px，
 *   点开与旧版同量级；整篇折叠态 22691px → 约 10900px。
 * - **平铺行**：来源与引文都不用列表标记、不缩进——每套一层容器就吃掉一截行宽
 *   （callout 内边距约 40px + 列表标记与缩进约 58px，叠起来 700 → 526px，−25%），
 *   而最长的文本恰好是最深的层。平铺后最窄那层回到 584px。
 * - **只给真问题上暖色**（未找到出处 / 有反证）：一份 27 条的报告里 13 条「需要留意」，
 *   按状态铺满暖色会让整页变彩虹（用户反馈「色彩太鲜艳」）。
 * - **引文只留原文**：主来源（本报告那条视频）的引文不再逐条重复视频名与「转写稿第 N 段」
 *   ——转写稿是运行中间产物、不会落进笔记库，而 front matter 里已经有链接与作者。
 *
 * 评估、先例与六套候选的对照见 docs/research/trace-export-research.md。
 */
export function traceReportToMarkdown(report: TraceReport, options: TraceMarkdownOptions = {}): string {
  const lines: string[] = [];
  const title = (usableTitle(report.title) ? report.title!.trim() : options.fallbackTitle?.trim()) || DEFAULT_TRACE_TITLE;
  const primaryKey = primaryEvidenceKey(report);
  const indexOf = new Map(report.items.map((item, index) => [item, index + 1]));
  const groupOf = new Map(report.items.map((item) => [item, groupStatusOf(item)]));
  const countOf = (status: TraceExternalStatus) => [...groupOf.values()].filter((value) => value === status).length;
  const checked = report.items.filter((item) => groupOf.get(item) !== undefined);
  const unchecked = report.items.filter((item) => groupOf.get(item) === undefined);
  const authoritative = checked.filter((item) => (item.external?.sources ?? []).some((source) => source.authority === "authoritative")).length;
  const verbatim = checked.filter((item) => (item.external?.sources ?? []).some((source) => (source.quotes ?? []).length > 0)).length;

  lines.push(`# ${title}`, "");
  if (report.summary?.trim()) lines.push(report.summary.trim(), "");

  /*
   * 速览用 `[!summary]`：官方把 summary 定为「摘要」的语义槽（abstract 的别名），不是自造盒子。
   * 它**不罗列**要留意的条目——那些现在是分组标题，细节在各自条目里。
   */
  lines.push(
    ...traceCallout(
      "summary",
      "溯源速览",
      [
        `**${report.items.length}** 条主张 · 进入联网核查 **${checked.length}** 条 · 有权威来源 ${authoritative} 条 · 附来源原文引证 ${verbatim} 条`,
        "",
        ...TRACE_GROUP_ORDER.filter((group) => countOf(group.status) > 0).map((group) => `- ${group.title} **${countOf(group.status)}** 条`),
        ...(unchecked.length > 0 ? [`- ${TRACE_UNCHECKED_TITLE} **${unchecked.length}** 条`] : []),
        "",
        "条目**按上面的顺序分组**（问题优先），组内保持原文顺序。",
      ],
      false,
    ),
  );

  /** 一组条目的正文：`### 主张` + 一行元信息 + 折叠的核查块 + 折叠的原文依据 + 三类旁注。 */
  const appendItems = (items: TraceItem[]) => {
    for (const item of items) {
      const status = groupOf.get(item);
      const meta = [TRACE_CATEGORY_LABELS[item.category] ?? item.category, TRACE_CONFIDENCE_LABELS[item.confidence] ?? item.confidence];
      if (status) meta.push(TRACE_EXTERNAL_STATUS_LABELS[status] ?? status);
      lines.push(`### ${indexOf.get(item)}. ${item.claim}`, "", `\`${meta.join(" · ")}\``, "");
      if (item.external && status) {
        const evidence = item.external.evidence ? ` · ${TRACE_EVIDENCE_LABELS[item.external.evidence]}` : "";
        const statusLabel = TRACE_EXTERNAL_STATUS_LABELS[status] ?? status;
        lines.push(...traceCallout(TRACE_STATUS_CALLOUT[status] ?? "info", `联网核查 · ${statusLabel}${evidence}`, traceExternalBody(item)));
      }
      lines.push(
        ...traceCallout(
          "quote",
          "原文依据",
          item.evidence.length > 0
            ? item.evidence.map((evidence) => formatEvidenceLine(evidence, primaryKey, true))
            : ["_本条无直接原文引用，需结合备注判断。_"],
        ),
      );
      /*
       * 三类旁注各占一段、行间空一行。**空行不是排版偏好**：Markdown 会把连续多行并成一个段落，
       * 上一版就因为少了空行 + 冒号写进 `**` 里面（`**判断依据：**…` 的闭合 `**` 前面是全角标点、
       * 后面紧跟汉字，按 CommonMark 不构成右闭合），星号字面漏进了用户的笔记。
       */
      const sides: string[] = [];
      if (item.attribution) {
        sides.push(
          item.attribution.kind === "external"
            ? `外部归因：${item.attribution.name ?? "未指明"}${item.attribution.detail ? `（${item.attribution.detail}）` : ""}`
            : item.attribution.kind === "self"
              ? "内部观点：作者/讲述者本人提出"
              : "归属不明：无法判断是作者原创还是转述外部来源",
        );
      }
      if (item.basis?.trim()) sides.push(`判断依据：${item.basis.trim()}`);
      if (item.note?.trim()) sides.push(`备注：${item.note.trim()}`);
      for (const mention of item.mentions ?? []) {
        sides.push(`另处提及：${formatEvidenceLine(mention, primaryKey, true)}`);
      }
      for (const side of sides) lines.push(boldLabel(side), "");
    }
  };

  for (const group of TRACE_GROUP_ORDER) {
    const items = report.items.filter((item) => groupOf.get(item) === group.status);
    if (items.length === 0) continue;
    lines.push(`## ${group.title}（${items.length} 条）`, "", `_${group.hint}_`, "");
    appendItems(items);
  }
  if (unchecked.length > 0) {
    lines.push(`## ${TRACE_UNCHECKED_TITLE}（${unchecked.length} 条）`, "", `_${TRACE_UNCHECKED_HINT}_`, "");
    appendItems(unchecked);
  }

  const uncertainties = report.uncertainties ?? [];
  if (uncertainties.length > 0) {
    lines.push(`## 待核实（${uncertainties.length} 条）`, "");
    /*
     * 合并成一个 callout：旧版一条一个，10 条待核实就是 10 个橙框（用户反馈「色彩太鲜艳」）。
     * 标题固定写「待核实（N 条）」、claim 加粗放正文首行——claim 常常二三十个字，塞进标题带会挤成一团。
     */
    lines.push(
      ...traceCallout(
        "question",
        `待核实（${uncertainties.length} 条）`,
        uncertainties.flatMap((uncertainty) => [`**${uncertainty.claim.trim()}**`, "", uncertainty.reason?.trim() || "原文未明确说明", ""]),
      ),
    );
  }
  const warnings = report.warnings ?? [];
  if (warnings.length > 0) {
    lines.push("## 提醒", "");
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
