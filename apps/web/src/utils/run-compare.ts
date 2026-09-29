import type { RunNodeInput, RunNodeResult, WorkflowGraph } from "@scribe-flow/shared";
import { NODE_TYPE_LABELS } from "@scribe-flow/shared";
import { buildNodeSegments } from "./run-segments";
import { isStructuredOutput } from "./run-output";

/** 参与「对照」的一份产物：一个节点的整份产出，或它在多素材链路里的一段。 */
export interface CompareOption {
  /** 列表 key：整份产出用 nodeId，分段用 `nodeId#段号`。 */
  key: string;
  nodeId: string;
  nodeType: string;
  /** 下拉里显示的名字，如「AI 加工 A · 1. 芯片是怎么造出来的」。 */
  label: string;
  /** 副标题：素材来源 / UP 主等（分段才有）。 */
  meta?: string;
  text: string;
}

/**
 * 本次运行里可以用来对照的产物。
 *
 * 只取「已经跑完、有正文、且不是结构化 JSON」的节点产出；多素材链路（8 个视频走同一条链路）
 * 按段展开——这样「加工 A 的第 1 段 vs 加工 B 的第 1 段」才是同素材的两套加工，
 * 而不是把 8 份结果首尾相接去比。
 */
export function buildCompareOptions(
  nodes: RunNodeResult[],
  inputRows: RunNodeInput[],
  graph?: WorkflowGraph,
): CompareOption[] {
  const resultMap = new Map(nodes.map((node) => [node.nodeId, node]));
  const options: CompareOption[] = [];
  for (const node of nodes) {
    if (node.status !== "done") continue;
    const text = node.output?.text ?? "";
    if (!text.trim() || isStructuredOutput(node)) continue;
    const label = node.nodeLabel || NODE_TYPE_LABELS[node.nodeType as keyof typeof NODE_TYPE_LABELS] || node.nodeType;
    const segments = buildNodeSegments(node.nodeId, inputRows, resultMap, graph);
    if (segments.length > 1) {
      for (const segment of segments) {
        options.push({
          key: `${node.nodeId}#${segment.index}`,
          nodeId: node.nodeId,
          nodeType: node.nodeType,
          label: `${label} · ${segment.index + 1}. ${segment.label}`,
          meta: segment.meta,
          text: segment.text,
        });
      }
    } else {
      options.push({ key: node.nodeId, nodeId: node.nodeId, nodeType: node.nodeType, label, text });
    }
  }
  return options;
}

/**
 * 默认比哪两份。
 *
 * 规则：找**最后一对相邻的、同类型的节点**（链路上最深的一组并行分支，如「AI 加工 A / AI 加工 B」），
 * 然后各取它们的第一项——多素材场景下就是「同一条素材的两套加工」（加工 A 第 1 段 vs 加工 B 第 1 段），
 * 而不是把同一个节点的两段互相比。没有这样的分支时退回最后两份，
 * 用来覆盖「一条链路上游 vs 下游」这种天然对照。
 */
export function pickDefaultComparePair(options: CompareOption[]): { leftKey: string; rightKey: string } {
  if (options.length === 0) return { leftKey: "", rightKey: "" };
  if (options.length === 1) return { leftKey: options[0].key, rightKey: "" };

  // 按节点分组（保持运行顺序），再找相邻且同类型的一对。
  const groups: { nodeId: string; nodeType: string; options: CompareOption[] }[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last && last.nodeId === option.nodeId) last.options.push(option);
    else groups.push({ nodeId: option.nodeId, nodeType: option.nodeType, options: [option] });
  }
  for (let index = groups.length - 1; index >= 1; index -= 1) {
    const left = groups[index - 1];
    const right = groups[index];
    if (left.nodeType !== right.nodeType) continue;
    return { leftKey: left.options[0].key, rightKey: right.options[0].key };
  }
  return { leftKey: options[options.length - 2].key, rightKey: options[options.length - 1].key };
}
