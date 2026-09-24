import type { RunNodeResult, RunStatus } from "@scribe-flow/shared";

/**
 * 画布运行快照的合并规则（从「最近一次运行」与更早的运行里凑出要显示的节点状态）。
 *
 * 抽成纯函数是为了能单测：这套规则决定刷新/重进工程后卡片上还剩哪些状态，
 * 而它以前埋在 `ProjectEditorView` 里，回归了也没人发现。
 */

/**
 * 更早的运行能否用来回填缺失节点。
 *
 * 只跳过仍在跑的运行：一次运行结束（成功/失败/取消）后，其中标记为 `done` 的节点就是有产物的，
 * 与同一运行里别的节点是否失败无关。
 *
 * 这里曾经只认 `success`，结果「上次整跑失败 + 本次只跑单个节点」时，画布会把上一次已经跑完的
 * 上游卡片（来源/转写/校对）全退回未运行——失败运行里的完成节点同样该显示出来。
 */
export function canBackfillFromStatus(status: RunStatus): boolean {
  return status !== "running";
}

/**
 * 把一个更早运行的结果并入快照：
 * - 只认 `done`（失败/取消/跳过的节点不留旧状态，避免出现来路不明的红标）；
 * - 不覆盖已有节点（当前运行的结果优先）；
 * - 只认当前画布上存在的节点（工程改过之后旧节点不该复活）。
 */
export function backfillFromRun(
  resultMap: Map<string, RunNodeResult>,
  olderResults: RunNodeResult[],
  expectedNodeIds: Set<string>,
): void {
  for (const result of olderResults) {
    if (result.status !== "done") continue;
    if (!expectedNodeIds.has(result.nodeId)) continue;
    if (resultMap.has(result.nodeId)) continue;
    resultMap.set(result.nodeId, result);
  }
}

/** 是否已经把当前画布上的节点凑齐了（齐了就停止继续往回翻运行记录）。 */
export function snapshotIsComplete(resultMap: Map<string, RunNodeResult>, expectedNodeIds: Set<string>): boolean {
  return resultMap.size >= expectedNodeIds.size;
}
