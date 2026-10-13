import type { RunScope } from "@scribe-flow/shared";

/**
 * 排队运行：画布上「运行 / 运行此节点 / 从此节点运行」的等待队列。
 *
 * 为什么有它：同一工程同时只能有一个运行（服务端 `createRun` 会拒第二次），所以运行期间
 * 画布只读、运行入口不能真的并发。但原先的做法是把按钮整体置灰——用户点了没反应，
 * 也没有任何文字说明；想跑「校对 → 三个加工」这种并列分支，就只能跑一个、盯一个、再点下一个。
 *
 * 现在运行中点击运行入口 = **加入排队**，当前运行结束后依次自动开始：语义仍是「同工程单运行」，
 * 只是把「等」从人手里挪进了队列。
 *
 * 本文件只放纯逻辑（去重键、位置、文案），副作用（POST、toast、排空触发）在
 * `stores/run-queue.ts`。抽开的理由和 `run-alert.ts` 一样：文案与去重规则埋在 watch 里，
 * 要验证就只能真跑一次完整运行去观察。
 */

export interface RunQueueItem {
  /** 去重键：同一工程里同 (scope, nodeId) 只排一个。 */
  key: string;
  scope: RunScope;
  nodeId?: string;
  /** 排队提示里显示的名字（节点名 / 「整个工程」）。入队时就算好，之后工程图变了也不影响这行文字。 */
  label: string;
}

export function runQueueKey(scope: RunScope, nodeId?: string): string {
  return `${scope}:${nodeId ?? ""}`;
}

/** 入队；同 (scope, nodeId) 已在队列里时返回 null，由调用方给「已在排队中」的提示。 */
export function pushQueueItem(items: RunQueueItem[], item: RunQueueItem): RunQueueItem[] | null {
  if (items.some((existing) => existing.key === item.key)) return null;
  return [...items, item];
}

export function dropQueueItem(items: RunQueueItem[], key: string): RunQueueItem[] {
  return items.filter((item) => item.key !== key);
}

/** 排队条目在提示里的名字：只跑一个节点时用节点名，从某个节点开始时说清是「从…开始」。 */
export function runQueueLabel(scope: RunScope, nodeLabel: string): string {
  if (scope === "all") return "整个工程";
  if (scope === "fromNode") return `从「${nodeLabel}」开始`;
  return `「${nodeLabel}」`;
}

/** 入队提示。位置从 1 数，说清「前面还有几条」，人就知道点完可以走开。 */
export function queuedToast(position: number): string {
  return position === 1 ? "已加入排队，当前运行结束后自动开始" : `已加入排队（第 ${position} 个），前面跑完依次开始`;
}

/** 排队计数的悬停提示：排的是哪些、什么时候开始、怎么取消。 */
export function queueTitle(items: RunQueueItem[]): string {
  if (items.length === 0) return "";
  return `已排队 ${items.length} 个：${items.map((item) => item.label).join("、")}（当前运行结束后依次开始，点击清空）`;
}
