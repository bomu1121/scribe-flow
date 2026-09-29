import type { RunNodeResult } from "@scribe-flow/shared";

/**
 * 产物形态的判定放一处，避免「同一个判断两处实现、各自漂移」：
 * 结果页（RunDetailView）用它决定某份产物走哪个阅读器，对照视图用它排除不适合逐行对照的产物。
 */

/** 知识巩固产物（process.drill）：结果页由 DrillViewer 消费，正文是练习集 JSON。 */
function isDrillProduct(text: string): boolean {
  return /"kind"\s*:\s*"drillSet"/.test(text);
}

/** 溯源报告：带 schema/items 根键的结构化 JSON（知识巩固同样带这两个键，先按 kind 排除）。 */
export function looksLikeTraceReport(text: string): boolean {
  if (isDrillProduct(text)) return false;
  return /"schema"\s*:\s*1/.test(text) && /"items"\s*:/.test(text);
}

export function isDrillOutput(node: RunNodeResult): boolean {
  return node.nodeType === "process.drill" || isDrillProduct(node.output?.text ?? "");
}

/**
 * 结构化产物（练习集 / 溯源报告）：正文是 JSON，逐行对照只会得到一堆字段噪音，
 * 所以它们不进对照的可选列表。
 */
export function isStructuredOutput(node: RunNodeResult): boolean {
  const text = node.output?.text ?? "";
  return isDrillOutput(node) || looksLikeTraceReport(text);
}
