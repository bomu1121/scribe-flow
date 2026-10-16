/**
 * 「这份产物是不是用另一个素材跑出来的」检测（运行前预检）。
 *
 * 起因（2026-10-15 实测）：用户在《中美社保对比》上跑完整条链路后，把来源卡换成了
 * 《美联储加息，能压住利率吗？》，然后只重跑溯源节点。`fromNode` 会沿用上游「校对」
 * 上一次的产物——于是那份溯源报告把社保的说法**归到了美联储那个视频头上**。
 * 报告看起来完全新鲜（新运行、新时间戳），只有翻开输入记录才知道算的是旧素材。
 * 这正是溯源最不能出的错，而当时没有任何提示。
 *
 * 判定靠的是**已有的**素材身份：`SegmentOption.key`（`bvid:BV…:P` / `file:…` / `node:…`）
 * 随产物落在 `run_node_inputs.item_key` 上，画布上则由 `collectMaterialOptions` 现算。
 * 两边都在，缺的只是比较。
 *
 * 边界：这里只认**素材身份**。改了提示词模板或节点配置导致的「产物是旧的」不在这一层——
 * 那需要给产物记输入指纹，是另一个量级的改动。
 */
import type { RunScope, WorkflowGraph } from "@scribe-flow/shared";
import { BUILTIN_PROMPT_BLOCKS, collectMaterialOptions, NODE_TYPE_LABELS } from "@scribe-flow/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { runNodeInputs, runNodeResults, runs } from "../db/schema";
import { nodeIdsForScope } from "./graph-scope";

/** 一次「产物用的是旧素材」的发现。 */
export interface StaleMaterialFinding {
  /** 承载那份产物的上游节点。 */
  upstreamNodeId: string;
  upstreamLabel: string;
  /** 目标节点（本次要跑、且会消费那份产物的那个）。 */
  targetNodeId: string;
  targetLabel: string;
  /** 产物消费过、但已不在当前画布上的素材身份。 */
  missingKeys: string[];
}

/**
 * 本次运行里，哪些节点会消费「与当前画布不一致的素材」。
 *
 * 只看 `fromNode` / `node` 两种范围：`all` 会把整条链重跑，不存在沿用旧产物的问题。
 * 上游不在范围内的边才会沿用历史产物（与引擎的 `resolveInputs` 同一口径）。
 * 判不出结论的一律放行——宁可漏拦，也不能把正常重跑拦下来。
 */
export function findStaleMaterials(
  db: AppDatabase,
  graph: WorkflowGraph,
  projectId: string,
  scope: RunScope,
  nodeId?: string,
): StaleMaterialFinding[] {
  if (scope === "all") return [];
  const scopeNodeIds = nodeIdsForScope(graph, scope, nodeId);

  // 图静态可推：上游不在范围内、且它的产物会被范围内节点消费的那些节点。
  const reusedUpstreamIds = new Set<string>();
  for (const edge of graph.edges) {
    if (scopeNodeIds.has(edge.target) && !scopeNodeIds.has(edge.source)) reusedUpstreamIds.add(edge.source);
  }
  if (reusedUpstreamIds.size === 0) return [];

  // 历史产物按工程取：与引擎的 `previousOutputs` 同一口径（它也只在本工程历次运行里找）。
  const runIds = db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .all()
    .map((row) => row.id);
  if (runIds.length === 0) return [];

  const findings: StaleMaterialFinding[] = [];
  for (const upstreamId of reusedUpstreamIds) {
    const upstream = graph.nodes.find((node) => node.id === upstreamId);
    if (!upstream) continue;
    // 上游最近一次成功产物：它消费过哪些素材（item_key 就记在它自己那次运行的输入行上）。
    const lastResult = db
      .select()
      .from(runNodeResults)
      .where(and(eq(runNodeResults.nodeId, upstreamId), eq(runNodeResults.status, "done"), inArray(runNodeResults.runId, runIds)))
      .orderBy(desc(runNodeResults.updatedAt))
      .limit(1)
      .get();
    if (!lastResult) continue;
    const usedKeys = db
      .select({ itemKey: runNodeInputs.itemKey })
      .from(runNodeInputs)
      .where(and(eq(runNodeInputs.runId, lastResult.runId), eq(runNodeInputs.targetNodeId, upstreamId)))
      .all()
      .map((row) => row.itemKey)
      .filter((key): key is string => Boolean(key));
    if (usedKeys.length === 0) continue; // 没记过身份（更早的版本或派生标识）：判不出来就放行

    // 谁在消费它？范围内、且有边指向的那些节点；各自的当前素材集合可能不同。
    const targets = graph.edges
      .filter((edge) => edge.source === upstreamId && scopeNodeIds.has(edge.target))
      .map((edge) => graph.nodes.find((node) => node.id === edge.target))
      .filter((node): node is WorkflowGraph["nodes"][number] => Boolean(node));
    for (const target of targets) {
      const alive = new Set(collectMaterialOptions(graph, target.id).map((option) => option.key));
      if (alive.size === 0) continue; // 当前图里追不到素材（例如来源卡被删）：不在这里判
      const missingKeys = usedKeys.filter((key) => !alive.has(key));
      if (missingKeys.length === 0) continue;
      findings.push({
        upstreamNodeId: upstreamId,
        upstreamLabel: nodeLabel(upstream),
        targetNodeId: target.id,
        targetLabel: nodeLabel(target),
        missingKeys,
      });
    }
  }
  return findings;
}

/**
 * 节点在文案里的名字。
 *
 * AI 加工节点默认就叫「AI 加工」，画布上往往有好几个——只说这个等于没说，所以带上它选的提示词
 * （「AI 加工（信息溯源 · 上网查证）」），用户才知道该去点哪一个。
 */
function nodeLabel(node: WorkflowGraph["nodes"][number]): string {
  const base = String((node.data as { label?: unknown }).label ?? "").trim() || NODE_TYPE_LABELS[node.type];
  const blockId = String((node.data as { promptBlockId?: unknown }).promptBlockId ?? "").trim();
  if (!blockId) return base;
  const block = BUILTIN_PROMPT_BLOCKS.find((candidate) => candidate.id === blockId);
  if (!block) return base;
  return `${base}（${[block.series, block.name].filter(Boolean).join(" · ")}）`;
}

/** 把素材标识写成能认出来的样子：`bvid:BV1xx:1` → `BV1xx 第 1 集/分P`。 */
export function describeMaterialKey(key: string): string {
  const bili = key.match(/^bvid:([^:]+)(?::(?:cid)?(.+))?$/);
  if (bili) {
    const [, bvid, page] = bili;
    if (!page) return bvid;
    return /^\d+$/.test(page) ? `${bvid} 第 ${page} 集/分P` : `${bvid}（${page}）`;
  }
  if (key.startsWith("file:")) return "本地文件";
  if (key.startsWith("node:")) return "文本素材";
  return key;
}

/**
 * 该从哪些节点开始重跑。
 *
 * 不能只说「运行上游节点」：上游自己也在沿用更上游的产物，逐级重跑会被连着拦几次——
 * 实测「只跑校对」同样被拦，因为它的上游「转写」消费的还是旧音频。
 * 真正的起点是**来源卡的直接下游**：它的产物才是按新素材算出来的第一站。
 */
function restartLabels(graph: WorkflowGraph, targetNodeId: string): string[] {
  const cards = new Set(collectMaterialOptions(graph, targetNodeId).map((option) => option.originNodeId));
  const labels = new Set<string>();
  for (const edge of graph.edges) {
    if (!cards.has(edge.source)) continue;
    const node = graph.nodes.find((candidate) => candidate.id === edge.target);
    if (node) labels.add(nodeLabel(node));
  }
  return [...labels];
}

/** 把发现写成一句能直接给用户看的拒绝理由。 */
export function describeStaleMaterials(findings: StaleMaterialFinding[], graph: WorkflowGraph): string {
  return findings
    .map((finding) => {
      const keys = finding.missingKeys.map(describeMaterialKey).join("、");
      const starts = restartLabels(graph, finding.targetNodeId);
      const action = starts.length > 0 ? `请从「${starts.join("」/「")}」开始跑，或直接跑全流程` : "请先跑上游节点，或直接跑全流程";
      return (
        `「${finding.targetLabel}」要沿用的上游「${finding.upstreamLabel}」的产物，是用 ${keys} 这个素材算的，` +
        `但它已经不在当前画布上了。${action}，让它按现在的素材重算。`
      );
    })
    .join("\n");
}
