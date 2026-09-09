/**
 * 信息溯源 v2 的结构化数据契约。
 *
 * 溯源模块与笔记加工分离后，AI 加工节点输出一份“证据清单”，而不是一篇普通笔记。
 * 这份 JSON 直接由前端溯源报告阅读器消费；也保留一份 Markdown 导出，便于复制/下载。
 */

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
  | "contradicted"
  | "not_found"
  | "ambiguous";

/** 外部事实核查命中的参考来源。 */
export interface TraceExternalSource {
  title?: string;
  url?: string;
  snippet?: string;
}

export interface TraceExternalCheck {
  status: TraceExternalStatus;
  /** 实际用于联网检索的查询词。 */
  query?: string;
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
  /** 外部事实核查结果（由 Tavily/联网检索与 AI 比对生成；未配置检索时可为 undefined）。 */
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

const EXTERNAL_STATUSES: TraceExternalStatus[] = ["not_applicable", "unchecked", "verified", "contradicted", "not_found", "ambiguous"];

function parseExternalCheck(value: unknown): TraceExternalCheck | undefined {
  if (!isRecord(value)) return undefined;
  const status = asString(value.status) as TraceExternalStatus | undefined;
  if (!status || !EXTERNAL_STATUSES.includes(status)) return undefined;
  const sources = Array.isArray(value.sources)
    ? value.sources
        .map((source) => {
          if (!isRecord(source)) return null;
          const parsed: TraceExternalSource = {
            title: asString(source.title),
            url: asString(source.url),
            snippet: asString(source.snippet),
          };
          return parsed;
        })
        .filter((source): source is TraceExternalSource => source !== null)
    : [];
  return {
    status,
    query: asString(value.query),
    summary: asString(value.summary),
    sources,
    note: asString(value.note),
  };
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
  contradicted: "外部有矛盾/反证",
  not_found: "未找到外部出处",
  ambiguous: "存在争议/不明确",
};

function formatEvidenceLine(evidence: TraceEvidence): string {
  const sourceName = evidence.source?.name?.trim();
  const locator = (evidence.locator ?? evidence.source?.locator)?.trim();
  const sourcePart = [sourceName, locator].filter(Boolean).join(" · ");
  const location = sourcePart ? `（${sourcePart}）` : "";
  const note = evidence.note?.trim() ? ` — ${evidence.note.trim()}` : "";
  return `- ${location}“${evidence.quote.trim()}”${note}`;
}

/** 把结构化溯源报告转成可读 Markdown，供“复制/下载”与不支持结构化视图的场合使用。 */
export function traceReportToMarkdown(report: TraceReport): string {
  const lines: string[] = [];
  const title = report.title?.trim() || "信息溯源报告";
  lines.push(`# ${title}`);
  lines.push("");
  if (report.summary?.trim()) {
    lines.push(report.summary.trim());
    lines.push("");
  }
  if (report.items.length > 0) {
    lines.push(`## 可溯源信息（${report.items.length} 条）`);
    lines.push("");
    report.items.forEach((item, index) => {
      const confidence = TRACE_CONFIDENCE_LABELS[item.confidence] ?? item.confidence;
      const category = TRACE_CATEGORY_LABELS[item.category] ?? item.category;
      lines.push(`### ${index + 1}. [${category} · ${confidence}] ${item.claim}`);
      if (item.basis?.trim()) {
        lines.push("");
        lines.push(`- 判断依据：${item.basis.trim()}`);
      }
      if (item.attribution) {
        lines.push("");
        const attribution = item.attribution.kind === "external"
          ? `外部归因：${item.attribution.name ?? "未指明"}${item.attribution.detail ? `（${item.attribution.detail}）` : ""}`
          : item.attribution.kind === "self"
            ? "内部观点：视频作者/讲述者本人提出"
            : "归属不明：无法判断是作者原创还是转述外部来源";
        lines.push(`- ${attribution}`);
      }
      if (item.external) {
        lines.push("");
        const statusLabel = TRACE_EXTERNAL_STATUS_LABELS[item.external.status] ?? item.external.status;
        const query = item.external.query?.trim() ? `；检索词：${item.external.query.trim()}` : "";
        const summary = item.external.summary?.trim() ? `；结论：${item.external.summary.trim()}` : "";
        lines.push(`- 外部核查：${statusLabel}${query}${summary}`);
        for (const source of item.external.sources ?? []) {
          const title = source.title?.trim() ?? source.url?.trim() ?? "";
          const url = source.url?.trim() ? ` <${source.url.trim()}>` : "";
          if (title || url) lines.push(`  - ${title}${url}`);
        }
      }
      if (item.note?.trim()) {
        lines.push("");
        lines.push(`> 备注：${item.note.trim()}`);
      }
      if (item.evidence.length > 0) {
        lines.push("");
        lines.push("**原文依据**");
        for (const evidence of item.evidence) {
          lines.push(formatEvidenceLine(evidence));
        }
      } else {
        lines.push("");
        lines.push("_本条无直接原文引用，需结合备注判断。_");
      }
      if ((item.mentions ?? []).length > 0) {
        lines.push("");
        lines.push("**其他位置 / 其他来源的提及**");
        for (const mention of item.mentions ?? []) {
          lines.push(formatEvidenceLine(mention));
        }
      }
      lines.push("");
    });
  }
  const uncertainties = report.uncertainties ?? [];
  if (uncertainties.length > 0) {
    lines.push(`## 待核实`);
    lines.push("");
    for (const uncertainty of uncertainties) {
      lines.push(`- ${uncertainty.claim}：${uncertainty.reason}`);
    }
    lines.push("");
  }
  const warnings = report.warnings ?? [];
  if (warnings.length > 0) {
    lines.push(`## 提醒`);
    lines.push("");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
