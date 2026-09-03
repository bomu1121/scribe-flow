import { NODE_CARD_WIDTH, type GraphEdge, type GraphNode, type NodeType, type WorkflowGraph } from "./graph";
import type { WorkflowTemplate } from "./project";

function node(type: NodeType, id: string, x: number, y: number, data: GraphNode["data"]): GraphNode {
  return { id, type, position: { x, y }, data } as GraphNode;
}

function edge(id: string, source: string, target: string, sourceHandle: string, targetHandle: string): GraphEdge {
  return { id, source, target, sourceHandle, targetHandle };
}

/** 模板节点横向最小间距：按节点实际宽度排布，避免新建工程时相邻卡片重叠。 */
const TEMPLATE_H_GAP = 80;

/** 已知 fromX 处放置 type 节点后，下一个同排节点的 x 坐标。 */
function nextColumnX(type: NodeType, fromX: number): number {
  return fromX + NODE_CARD_WIDTH[type] + TEMPLATE_H_GAP;
}

/**
 * 工作流模板只描述「加工路径的形状」：
 * - 提示词块（观点提炼/技术文案提炼/信息溯源/自定义）不在工程模板里预绑，
 *   而是在画布的「AI 加工」节点检查器中选择。
 * - AI 节点默认不指定 promptBlockId，用户选择后才可运行。
 */

/** 模板一：视频转笔记（单线）。 */
function videoBasicGraph(): WorkflowGraph {
  const asrX = nextColumnX("source.bili", 0);
  const refineX = nextColumnX("process.transcribe", asrX);
  const promptX = nextColumnX("process.refine", refineX);
  const outX = nextColumnX("process.prompt", promptX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 40, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", asrX, 40, { label: "转写" }),
      node("process.refine", "n_refine", refineX, 40, { label: "AI 校对" }),
      node("process.prompt", "n_prompt", promptX, 40, { label: "AI 加工" }),
      node("process.output", "n_out", outX, 40, { label: "输出", fileName: "笔记.md" }),
    ],
    edges: [
      edge("e1", "n_src", "n_asr", "audio", "audio"),
      edge("e2", "n_asr", "n_refine", "transcript", "transcript"),
      edge("e3", "n_refine", "n_prompt", "transcript", "transcript"),
      edge("e4", "n_prompt", "n_out", "noteBlock", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板二：视频多路笔记（同一视频并行两个 AI 加工分支）。 */
function videoBranchesGraph(): WorkflowGraph {
  const asrX = nextColumnX("source.bili", 0);
  const promptX = nextColumnX("process.transcribe", asrX);
  const mergeX = nextColumnX("process.prompt", promptX);
  const outX = nextColumnX("process.merge", mergeX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 80, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", asrX, 80, { label: "转写" }),
      node("process.prompt", "n_prompt_a", promptX, 0, { label: "AI 加工 A" }),
      node("process.prompt", "n_prompt_b", promptX, 160, { label: "AI 加工 B" }),
      node("process.merge", "n_merge", mergeX, 80, { label: "合并", title: "合并笔记" }),
      node("process.output", "n_out", outX, 80, { label: "输出", fileName: "笔记.md" }),
    ],
    edges: [
      edge("e1", "n_src", "n_asr", "audio", "audio"),
      edge("e2", "n_asr", "n_prompt_a", "transcript", "transcript"),
      edge("e3", "n_asr", "n_prompt_b", "transcript", "transcript"),
      edge("e4", "n_prompt_a", "n_merge", "noteBlock", "noteBlock"),
      edge("e5", "n_prompt_b", "n_merge", "noteBlock", "noteBlock"),
      edge("e6", "n_merge", "n_out", "noteDoc", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板三：文稿多路对照（已有文稿并行三个 AI 加工分支）。 */
function textCompareGraph(): WorkflowGraph {
  const promptX = nextColumnX("source.text", 0);
  const mergeX = nextColumnX("process.prompt", promptX);
  const outX = nextColumnX("process.merge", mergeX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 120, { label: "已有文稿", text: "" }),
      node("process.prompt", "n_a", promptX, -40, { label: "AI 加工 A" }),
      node("process.prompt", "n_b", promptX, 120, { label: "AI 加工 B" }),
      node("process.prompt", "n_c", promptX, 280, { label: "AI 加工 C" }),
      node("process.merge", "n_merge", mergeX, 120, { label: "合并", title: "多路对照" }),
      node("process.output", "n_out", outX, 120, { label: "输出", fileName: "对照笔记.md" }),
    ],
    edges: [
      edge("e1", "n_text", "n_a", "transcript", "transcript"),
      edge("e2", "n_text", "n_b", "transcript", "transcript"),
      edge("e3", "n_text", "n_c", "transcript", "transcript"),
      edge("e4", "n_a", "n_merge", "noteBlock", "noteBlock"),
      edge("e5", "n_b", "n_merge", "noteBlock", "noteBlock"),
      edge("e6", "n_c", "n_merge", "noteBlock", "noteBlock"),
      edge("e7", "n_merge", "n_out", "noteDoc", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板四：文稿转笔记（粘贴文稿 → 校对 → 单线加工）。 */
function textPolishGraph(): WorkflowGraph {
  const refineX = nextColumnX("source.text", 0);
  const promptX = nextColumnX("process.refine", refineX);
  const outX = nextColumnX("process.prompt", promptX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 40, { label: "已有文稿", text: "" }),
      node("process.refine", "n_refine", refineX, 40, { label: "AI 校对" }),
      node("process.prompt", "n_prompt", promptX, 40, { label: "AI 加工" }),
      node("process.output", "n_out", outX, 40, { label: "输出", fileName: "笔记.md" }),
    ],
    edges: [
      edge("e1", "n_text", "n_refine", "transcript", "transcript"),
      edge("e2", "n_refine", "n_prompt", "transcript", "transcript"),
      edge("e3", "n_prompt", "n_out", "noteBlock", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板五：文稿转思维导图（粘贴文稿 → 校对 → 思维导图 → 输出）。 */
function textMindMapGraph(): WorkflowGraph {
  const refineX = nextColumnX("source.text", 0);
  const mindmapX = nextColumnX("process.refine", refineX);
  const outX = nextColumnX("process.mindmap", mindmapX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 80, { label: "已有文稿", text: "" }),
      node("process.refine", "n_refine", refineX, 80, { label: "AI 校对" }),
      node("process.mindmap", "n_mindmap", mindmapX, 80, {
        label: "思维导图",
        branchSize: "auto",
        maxDepth: 4,
        theme: "paper",
        retry: { maxRetries: 2, backoffMs: 3000 },
      }),
      node("process.output", "n_out", outX, 80, { label: "输出", fileName: "思维导图.md" }),
    ],
    edges: [
      edge("e1", "n_text", "n_refine", "transcript", "transcript"),
      edge("e2", "n_refine", "n_mindmap", "transcript", "in"),
      edge("e3", "n_mindmap", "n_out", "doc", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板七：视频转 Obsidian 笔记（B站视频 → 转写 → 校对 → AI 加工 → Obsidian 笔记）。 */
function videoObsidianGraph(): WorkflowGraph {
  const asrX = nextColumnX("source.bili", 0);
  const refineX = nextColumnX("process.transcribe", asrX);
  const promptX = nextColumnX("process.refine", refineX);
  const obsidianX = nextColumnX("process.prompt", promptX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 80, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", asrX, 80, { label: "转写" }),
      node("process.refine", "n_refine", refineX, 80, { label: "AI 校对" }),
      node("process.prompt", "n_prompt", promptX, 80, {
        label: "AI 加工",
        retry: { maxRetries: 2, backoffMs: 3000 },
      }),
      node("process.obsidian", "n_obsidian", obsidianX, 80, {
        label: "Obsidian 笔记",
        tags: "视频笔记",
        folder: "00-Inbox",
      }),
    ],
    edges: [
      edge("e1", "n_src", "n_asr", "audio", "audio"),
      edge("e2", "n_asr", "n_refine", "transcript", "transcript"),
      edge("e3", "n_refine", "n_prompt", "transcript", "transcript"),
      edge("e4", "n_prompt", "n_obsidian", "noteBlock", "in"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板八：文稿转 Obsidian 笔记（已有文稿 → 校对 → AI 加工 → Obsidian 笔记）。 */
function textObsidianGraph(): WorkflowGraph {
  const refineX = nextColumnX("source.text", 0);
  const promptX = nextColumnX("process.refine", refineX);
  const obsidianX = nextColumnX("process.prompt", promptX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 80, { label: "已有文稿", text: "" }),
      node("process.refine", "n_refine", refineX, 80, { label: "AI 校对" }),
      node("process.prompt", "n_prompt", promptX, 80, {
        label: "AI 加工",
        retry: { maxRetries: 2, backoffMs: 3000 },
      }),
      node("process.obsidian", "n_obsidian", obsidianX, 80, {
        label: "Obsidian 笔记",
        tags: "学习笔记",
        folder: "00-Inbox",
      }),
    ],
    edges: [
      edge("e1", "n_text", "n_refine", "transcript", "transcript"),
      edge("e2", "n_refine", "n_prompt", "transcript", "transcript"),
      edge("e3", "n_prompt", "n_obsidian", "noteBlock", "in"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板六：视频转思维导图（B站视频 → 转写 → 校对 → 思维导图 → 输出）。 */
function videoMindMapGraph(): WorkflowGraph {
  const asrX = nextColumnX("source.bili", 0);
  const refineX = nextColumnX("process.transcribe", asrX);
  const mindmapX = nextColumnX("process.refine", refineX);
  const outX = nextColumnX("process.mindmap", mindmapX);
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 80, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", asrX, 80, { label: "转写" }),
      node("process.refine", "n_refine", refineX, 80, { label: "AI 校对" }),
      node("process.mindmap", "n_mindmap", mindmapX, 80, {
        label: "思维导图",
        branchSize: "auto",
        maxDepth: 4,
        theme: "paper",
        retry: { maxRetries: 2, backoffMs: 3000 },
      }),
      node("process.output", "n_out", outX, 80, { label: "输出", fileName: "思维导图.md" }),
    ],
    edges: [
      edge("e1", "n_src", "n_asr", "audio", "audio"),
      edge("e2", "n_asr", "n_refine", "transcript", "transcript"),
      edge("e3", "n_refine", "n_mindmap", "transcript", "in"),
      edge("e4", "n_mindmap", "n_out", "doc", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "template.video-basic",
    name: "视频转笔记（单线）",
    description: "B站视频 → 转写 → AI 校对 → 一个 AI 加工步骤 → 输出",
    graph: videoBasicGraph(),
  },
  {
    id: "template.video-branches",
    name: "视频多路笔记",
    description: "同一视频并行两个 AI 加工分支，合并为一份对照笔记",
    graph: videoBranchesGraph(),
  },
  {
    id: "template.text-compare",
    name: "文稿多路对照",
    description: "已有文稿并行三个 AI 加工分支，合并后对照阅读",
    graph: textCompareGraph(),
  },
  {
    id: "template.text-polish",
    name: "文稿转笔记",
    description: "粘贴已有文稿 → AI 校对 → 一个 AI 加工步骤 → 输出",
    graph: textPolishGraph(),
  },
  {
    id: "template.text-mindmap",
    name: "文稿转思维导图",
    description: "已有文稿 → AI 校对 → 思维导图 → 输出，把长文/讲稿整理成导图",
    graph: textMindMapGraph(),
  },
  {
    id: "template.video-mindmap",
    name: "视频转思维导图",
    description: "B站视频 → 转写 → AI 校对 → 思维导图 → 输出，把视频内容整理成导图",
    graph: videoMindMapGraph(),
  },
  {
    id: "template.video-obsidian",
    name: "视频转 Obsidian 笔记",
    description: "B站视频 → 转写 → AI 校对 → AI 加工 → 直接保存到 Obsidian 库",
    graph: videoObsidianGraph(),
  },
  {
    id: "template.text-obsidian",
    name: "文稿转 Obsidian 笔记",
    description: "已有文稿 → AI 校对 → AI 加工 → 直接保存到 Obsidian 库",
    graph: textObsidianGraph(),
  },
];
