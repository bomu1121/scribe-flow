import type { RunNodeInput, RunNodeResult, WorkflowGraph } from "@scribe-flow/shared";
import { NODE_TYPE_LABELS } from "@scribe-flow/shared";

/**
 * 一个节点产出的「可独立阅读的一段」。
 *
 * 背景：一张多选来源卡片（如 8 个视频）经过同一个转写/AI 节点时，会产出 8 份互相独立的结果；
 * 引擎把它们合并成一份主输出（用分隔线首尾相接）供下游与导出使用，但阅读时那样堆在一起无法定位。
 * 这里把「每个输入对应一份结果」的事实还原成结构化分段，供结果页 / 画布预览 / 日志弹窗共用。
 *
 * 数据来源是运行时的 run_node_inputs：每个输入一行，带 position 与独立文本；
 * 标签则沿链路向上游走到原始素材（视频标题 / 文件名），因此历史运行无需重跑即可分段。
 */
export interface RunSegment {
  /** 段序号（0 起），展示为「3/8」。 */
  index: number;
  /** 对应 run_node_inputs.position：与日志的 input_index 对齐，用于把日志归到某一段。 */
  position: number;
  /** 该段内容来自哪个上游节点（可联动来源卡片与媒体）。 */
  sourceNodeId: string;
  /** 该段对应的输入行 id（在运行内唯一，作列表 key）。 */
  inputId: string;
  /** 标题：视频标题（多 P 带 P 号）/ 文件名 / 上游节点名。 */
  label: string;
  /** 副标题：UP 主、时长、文件大小等；无可用信息时为空串。 */
  meta: string;
  text: string;
  size: number;
}

/** 「一个输入一份结果」的加工节点：独立结果就存在自己的输入行上（text / resultText）。 */
const PER_INPUT_RESULT_TYPES = new Set([
  "process.transcribe",
  "process.refine",
  "process.prompt",
  "process.gameguide",
]);

/** 整篇产物的节点：主输出就是各输入首尾相接，因此输入行天然是它的分段。 */
const SECTION_TYPES = new Set(["process.output", "process.merge", "flow.if"]);

function sortByPosition(rows: RunNodeInput[]): RunNodeInput[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

function nodeTypeOf(nodeId: string, resultMap: Map<string, RunNodeResult>, graph?: WorkflowGraph): string {
  const result = resultMap.get(nodeId);
  if (result?.nodeType) return result.nodeType;
  return graph?.nodes.find((node) => node.id === nodeId)?.type ?? "";
}

function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSize(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 沿链路向上游走，把一段内容对应回原始素材的标题。
 * `sourceIndex` 是该行在「同一来源节点」内的序号（多选卡片的第几个视频 / 分 P）。
 */
function resolveSegmentLabel(
  row: RunNodeInput,
  rows: RunNodeInput[],
  resultMap: Map<string, RunNodeResult>,
  graph: WorkflowGraph | undefined,
  sourceIndex: number,
): string {
  let current = row;
  for (let depth = 0; depth < 12; depth += 1) {
    const result = resultMap.get(current.sourceNodeId);
    const graphNode = graph?.nodes.find((node) => node.id === current.sourceNodeId);
    const nodeType = result?.nodeType ?? graphNode?.type ?? "";
    if (nodeType.startsWith("source.")) {
      const data = (graphNode?.data ?? {}) as Record<string, unknown>;
      if (nodeType === "source.bili") {
        const items = Array.isArray(data.items) ? (data.items as { title?: string; part?: string; page?: number }[]) : [];
        const entry = items[sourceIndex];
        if (entry?.title || entry?.part) {
          const base =
            entry.title ||
            (typeof data.title === "string" ? data.title : "") ||
            result?.nodeLabel ||
            NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] ||
            nodeType;
          // 单 P 视频的 part 与标题相同，重复拼一遍反而更难读；只有真正的分 P 名才补在后面。
          const part = entry.part && entry.part !== base ? ` · P${entry.page ?? sourceIndex + 1} ${entry.part}` : "";
          return `${base}${part}`;
        }
        if (typeof data.title === "string" && data.title) return data.title;
      }
      if (nodeType === "source.file" && typeof data.fileName === "string" && data.fileName) return data.fileName;
      return result?.nodeLabel || NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] || nodeType;
    }
    // 中间节点：按 position 继续向上游追溯同一条内容
    const next = rows.find((candidate) => candidate.targetNodeId === current.sourceNodeId && candidate.position === current.position);
    if (!next) break;
    current = next;
  }
  const result = resultMap.get(row.sourceNodeId);
  const graphNode = graph?.nodes.find((node) => node.id === row.sourceNodeId);
  const nodeType = result?.nodeType ?? graphNode?.type ?? "";
  return result?.nodeLabel || NODE_TYPE_LABELS[nodeType as keyof typeof NODE_TYPE_LABELS] || row.sourceNodeId;
}

/** 该段来源的补充信息（UP 主 / 时长 / 文件大小）；取不到时返回空串。 */
function resolveSegmentMeta(
  row: RunNodeInput,
  rows: RunNodeInput[],
  graph: WorkflowGraph | undefined,
  sourceIndex: number,
): string {
  let current: RunNodeInput | undefined = row;
  for (let depth = 0; depth < 12 && current; depth += 1) {
    const graphNode = graph?.nodes.find((node) => node.id === current?.sourceNodeId);
    const data = (graphNode?.data ?? {}) as Record<string, unknown>;
    if (graphNode?.type === "source.bili") {
      const items = Array.isArray(data.items)
        ? (data.items as { uploader?: string; duration?: number }[])
        : [];
      const entry = items[sourceIndex];
      const uploader = entry?.uploader || (typeof data.uploader === "string" ? data.uploader : "");
      const duration = entry?.duration ?? (typeof data.duration === "number" ? data.duration : 0);
      const parts = [uploader, fmtDuration(duration)].filter(Boolean);
      if (items.length > 1 && !entry) parts.push(`第 ${sourceIndex + 1} 项`);
      return parts.join(" · ");
    }
    if (graphNode?.type === "source.file") {
      return fmtSize(row.size);
    }
    const next = rows.find((candidate) => candidate.targetNodeId === current?.sourceNodeId && candidate.position === current?.position);
    current = next;
  }
  return "";
}

/**
 * 把某个节点的产出拆成可独立阅读的分段。
 *
 * 返回空数组表示「这个节点只有一份内容」，调用方沿用原来的整篇阅读即可。
 * 仅在确实存在两份以上内容时返回，避免单输入节点多出一层无意义的选择器。
 */
export function buildNodeSegments(
  nodeId: string,
  inputRows: RunNodeInput[],
  resultMap: Map<string, RunNodeResult>,
  graph?: WorkflowGraph,
): RunSegment[] {
  if (!nodeId || inputRows.length === 0) return [];
  const nodeType = nodeTypeOf(nodeId, resultMap, graph);
  // 来源节点自身是音视频素材（多选卡片由媒体分页承载），它的「下游文稿」属于加工节点，不在这里分段。
  if (nodeType.startsWith("source.")) return [];

  /** 同来源节点的序号：多选卡片里第几个视频 / 分 P。 */
  const indexWithinSource = new Map<string, number>();
  const cursor = new Map<string, number>();
  for (const row of inputRows) {
    if (row.targetNodeId !== nodeId) continue;
    const next = cursor.get(row.sourceNodeId) ?? 0;
    indexWithinSource.set(row.id, next);
    cursor.set(row.sourceNodeId, next + 1);
  }

  const toSegments = (rows: RunNodeInput[]): RunSegment[] => {
    const contentful = sortByPosition(rows).filter((row) => (row.resultText ?? row.text ?? "").trim().length > 0);
    if (contentful.length < 2) return [];
    return contentful.map((row, index) => {
      const text = (row.resultText ?? row.text ?? "").trim();
      const sourceIndex = indexWithinSource.get(row.id) ?? index;
      return {
        index,
        position: row.position,
        sourceNodeId: row.sourceNodeId,
        inputId: row.id,
        label: resolveSegmentLabel(row, inputRows, resultMap, graph, sourceIndex),
        meta: resolveSegmentMeta(row, inputRows, graph, sourceIndex),
        text,
        size: text.length,
      };
    });
  };

  const inputSegments = () => toSegments(inputRows.filter((row) => row.targetNodeId === nodeId));

  // 1) 一个输入一份结果的加工节点 / 整篇产物的节点：自己的输入行就是分段。
  if (PER_INPUT_RESULT_TYPES.has(nodeType) || SECTION_TYPES.has(nodeType)) {
    const segments = inputSegments();
    if (segments.length > 1) return segments;
  }

  // 2) 其余节点（文本工具 / 章节切分等）：看它交付给同一个下游节点的多份内容，那才是它的产出。
  const downstream = new Map<string, RunNodeInput[]>();
  for (const row of inputRows) {
    if (row.sourceNodeId !== nodeId) continue;
    const list = downstream.get(row.targetNodeId) ?? [];
    list.push(row);
    downstream.set(row.targetNodeId, list);
  }
  const delivered = [...downstream.values()]
    .filter((group) => group.length > 1 && group.some((row) => row.kind === "text" && (row.text || row.resultText)))
    .sort((a, b) => b.length - a.length)[0];
  if (delivered) {
    const segments = toSegments(delivered);
    if (segments.length > 1) return segments;
  }

  // 3) 兜底：仍按自己的输入行切分（覆盖历史运行里没有下游记录的终态节点）。
  const fallback = inputSegments();
  return fallback.length > 1 ? fallback : [];
}

/** 一次运行里每个节点各自的分段（key = nodeId），供画布预览与日志弹窗直接查表。 */
export function buildSegmentMap(
  inputRows: RunNodeInput[],
  resultMap: Map<string, RunNodeResult>,
  graph?: WorkflowGraph,
): Map<string, RunSegment[]> {
  const nodeIds = new Set<string>();
  for (const row of inputRows) {
    nodeIds.add(row.targetNodeId);
    nodeIds.add(row.sourceNodeId);
  }
  const result = new Map<string, RunSegment[]>();
  for (const nodeId of nodeIds) {
    const segments = buildNodeSegments(nodeId, inputRows, resultMap, graph);
    if (segments.length > 1) result.set(nodeId, segments);
  }
  return result;
}
