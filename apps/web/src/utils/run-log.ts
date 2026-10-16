import type { NodeRunStatus } from "@scribe-flow/shared";

/**
 * 卡片底部状态条上要不要给「查看日志」入口。
 *
 * 判据是「这次运行没有成功收场」：中断（服务重启掐断）与失败都要能顺着一条线索看到现场——
 * 「为什么断了」在运行日志里，不在卡片那一行字里。用户主动取消的也给：
 * 「取消前跑到哪一步」是同一个回头要问的问题，而且取消与中断在数据上都是 `cancelled`，
 * 在这里区分它们只会让中断漏掉入口。
 *
 * `done` 不给（有结果是看结果不是看日志）、`running` / `queued` / `idle` 不给（日志还在写）。
 */
export function showsRunLogEntry(status?: NodeRunStatus): boolean {
  return status === "cancelled" || status === "error";
}
