import type { RunScope, WorkflowGraph } from "@scribe-flow/shared";

/**
 * 一次运行实际覆盖的节点集合（纯函数，无 IO）。
 *
 * 用来回答同一个问题：「这次运行到底要碰哪些节点」。以前问了两遍、答了两份实现——
 * 路由侧预检（缺密钥 / 空 B 站链接就别启动）用一份「从 nodeId 沿边收可达」，引擎侧
 * 执行集合用另一份「先取全图再剔除」，内层 `while (changed)` 逐字同构却各写一遍。
 * 两份一旦漂移，表现就是「预检说没问题、跑起来跳过一半」，且不报错。
 *
 * - `all`：全图节点（含孤立节点与上游节点）。
 * - `node`：只有 nodeId 自己，不考虑上游输入。
 * - `fromNode`：nodeId 加上它沿出边可达的所有节点；上游不在其中。
 *
 * `nodeId` 必须存在于图中（`createRun` 启动前已校验），否则这里对 `fromNode` 仍会返回
 * 只含它的集合，而引擎侧只从图中取节点——两边对「不存在的 nodeId」没有约定，别依赖。
 */
export function nodeIdsForScope(graph: WorkflowGraph, scope: RunScope, nodeId?: string): Set<string> {
  if (scope === "node" && nodeId) return new Set([nodeId]);
  if (scope !== "fromNode" || !nodeId) return new Set(graph.nodes.map((node) => node.id));

  const result = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (result.has(edge.source) && !result.has(edge.target)) {
        result.add(edge.target);
        changed = true;
      }
    }
  }
  return result;
}
