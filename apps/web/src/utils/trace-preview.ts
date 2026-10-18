import { FLAGGED_EXTERNAL_STATUSES, type TraceExternalStatus, type TraceItem, type TraceReport } from "@scribe-flow/shared";

/**
 * 画布节点浮层里「溯源报告」的摘要口径。
 *
 * 结果页读的是完整报告（分组、搜索、原文引证），而浮层只有 360px × 一屏高，
 * 唯一有意义的回答是「这份报告里哪些说法站不住」。所以这里只算三件事：
 * 总量 / 问题条数 / 先看哪几条，并保持与结果页同一套状态标签。
 */

/** 浮层里最多列几条主张：再多就不是「一眼看」了。 */
export const TRACE_PREVIEW_ITEM_LIMIT = 3;

/**
 * 严重程度（越小越靠前）：与导出分组的顺序一致（有反证 → 有争议 → 未找到出处 → 仅非权威），
 * 可印证在中段，未核查垫底。同档保持报告原文顺序。
 */
const STATUS_RANK: Record<TraceExternalStatus, number> = {
  contradicted: 0,
  ambiguous: 1,
  not_found: 2,
  weak_source: 3,
  verified: 4,
  unchecked: 5,
  not_applicable: 6,
};

/** 状态徽章的顺序：问题优先，与 STATUS_RANK 同一口径。 */
const CHIP_ORDER: TraceExternalStatus[] = ["contradicted", "ambiguous", "not_found", "weak_source", "verified", "unchecked"];

export interface TracePreviewChip {
  status: TraceExternalStatus;
  count: number;
}

export interface TracePreviewEntry {
  /** 第几份报告（0 起）：合并视图里多份报告的条目序号会重复，列表 key 需要带上它。 */
  reportIndex: number;
  /** 在这一份报告里的原始序号（0 起）；列表里按它显示 `01`，不因排序而改变。 */
  index: number;
  item: TraceItem;
}

export interface TracePreviewSummary {
  /** 主张总数（多份报告合并）。 */
  total: number;
  /** 真正进入联网核查的条数：状态不是 unchecked / not_applicable。 */
  checked: number;
  /** 其中需要留意（外部有反证 / 仅非权威来源 / 未找到出处）的条数。 */
  flagged: number;
  /** 核查到权威来源的条数。 */
  authoritative: number;
  uncertainties: number;
  warnings: number;
  /** 状态分布；没有任何联网核查时为空数组（此时一行「未联网核查 N」没有信息量）。 */
  chips: TracePreviewChip[];
  /** 先看哪几条：按严重程度排序，最多 TRACE_PREVIEW_ITEM_LIMIT 条。 */
  priorityItems: TracePreviewEntry[];
}

function isChecked(status: TraceExternalStatus | undefined): boolean {
  return status !== undefined && status !== "unchecked" && status !== "not_applicable";
}

function rankOf(item: TraceItem): number {
  return STATUS_RANK[item.external?.status ?? "unchecked"];
}

export function summarizeTraceReports(reports: TraceReport[], limit = TRACE_PREVIEW_ITEM_LIMIT): TracePreviewSummary {
  const entries: TracePreviewEntry[] = reports.flatMap((report, reportIndex) =>
    report.items.map((item, index) => ({ reportIndex, index, item })),
  );

  let checked = 0;
  let flagged = 0;
  let authoritative = 0;
  const counts = new Map<TraceExternalStatus, number>();

  for (const { item } of entries) {
    const status = item.external?.status;
    // 「没给 external」与「明确说未核查」对读者是同一件事，归进同一个徽章。
    const countKey: TraceExternalStatus = !status || status === "not_applicable" ? "unchecked" : status;
    counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
    if (!isChecked(status)) continue;
    checked += 1;
    if (status && FLAGGED_EXTERNAL_STATUSES.includes(status)) flagged += 1;
    if ((item.external?.sources ?? []).some((source) => source.authority === "authoritative")) authoritative += 1;
  }

  const priorityItems = [...entries]
    .sort((a, b) => rankOf(a.item) - rankOf(b.item) || a.index - b.index || a.reportIndex - b.reportIndex)
    .slice(0, limit);

  return {
    total: entries.length,
    checked,
    flagged,
    authoritative,
    uncertainties: reports.reduce((sum, report) => sum + (report.uncertainties?.length ?? 0), 0),
    warnings: reports.reduce((sum, report) => sum + (report.warnings?.length ?? 0), 0),
    chips:
      checked > 0
        ? CHIP_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 })).filter((chip) => chip.count > 0)
        : [],
    priorityItems,
  };
}

/** 状态徽章的色调：只给真问题上暖色（有反证=红，有争议/找不到出处=橙）。 */
export function traceStatusTone(status: TraceExternalStatus | undefined): "danger" | "warning" | "info" | "success" | "muted" {
  if (!status || status === "unchecked" || status === "not_applicable") return "muted";
  if (status === "contradicted") return "danger";
  if (status === "ambiguous" || status === "not_found") return "warning";
  if (status === "weak_source") return "info";
  return "success";
}
