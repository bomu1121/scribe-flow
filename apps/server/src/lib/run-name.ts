import { eq } from "drizzle-orm";
import { NODE_TYPE_LABELS, type RunScope, type WorkflowGraph } from "@scribe-flow/shared";
import { runs } from "../db/schema";
import type { AppDatabase } from "../db/client";

/**
 * 运行记录的默认名。
 *
 * 为什么不靠界面上的时间与短 id：那一栏是当笔记目录读的——「11:30」过两天就认不出是哪一次，
 * 而详情页的 `#44f110b` 是随机短 id，人记不住也念不出来。所以每次运行**落库时就带上名字**，
 * 名字是「第 N 次运行」（N 按该工程内的创建顺序），用户可以随时改名覆盖。
 *
 * 编号只按创建顺序数，不因删除而重排：已经写进笔记里的「第 7 次运行」不会哪天变成第 5 次。
 */

/** 该工程已有多少条运行；+1 就是本次的序号（要在插入之前算）。 */
function nextRunOrdinal(db: AppDatabase, projectId: string): number {
  return db.select().from(runs).where(eq(runs.projectId, projectId)).all().length + 1;
}

export function defaultRunName(ordinal: number): string {
  return `第 ${ordinal} 次运行`;
}

/**
 * 从某个节点重跑时在名字后带上节点名。
 * 「第 7 次运行」看不出它只重跑了哪一步，而重跑一个节点与跑全图在列表里长得一样。
 */
export function runNameForScope(base: string, graph: WorkflowGraph, scope: RunScope, nodeId?: string): string {
  if (scope === "all" || !nodeId) return base;
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const label = node ? (node.data.label ?? NODE_TYPE_LABELS[node.type]) : "未知节点";
  return `${base} · 重跑「${label}」`;
}

/** 创建运行时的默认名：一次算好序号与后缀，路由与引擎都不必再拼字符串。 */
export function defaultRunNameFor(db: AppDatabase, projectId: string, graph: WorkflowGraph, scope: RunScope, nodeId?: string): string {
  return runNameForScope(defaultRunName(nextRunOrdinal(db, projectId)), graph, scope, nodeId);
}
