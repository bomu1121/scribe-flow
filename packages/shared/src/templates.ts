import type { GraphEdge, GraphNode, NodeType, WorkflowGraph } from "./graph";
import type { WorkflowTemplate } from "./project";

function node(type: NodeType, id: string, x: number, y: number, data: GraphNode["data"]): GraphNode {
  return { id, type, position: { x, y }, data } as GraphNode;
}

function edge(id: string, source: string, target: string, sourceHandle: string, targetHandle: string): GraphEdge {
  return { id, source, target, sourceHandle, targetHandle };
}

/**
 * 工作流模板只描述「加工路径的形状」：
 * - 提示词块（观点提炼/技术文案提炼/信息溯源/自定义）不在工程模板里预绑，
 *   而是在画布的「AI 加工」节点检查器中选择。
 * - AI 节点默认不指定 promptBlockId，用户选择后才可运行。
 */

/** 模板一：视频转笔记（单线）。 */
function videoBasicGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 40, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", 300, 40, { label: "转写" }),
      node("process.refine", "n_refine", 600, 40, { label: "AI 校对" }),
      node("process.prompt", "n_prompt", 900, 40, { label: "AI 加工", outputName: "加工结果" }),
      node("process.output", "n_out", 1200, 40, { label: "输出", fileName: "笔记.md" }),
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
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 80, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", 300, 80, { label: "转写" }),
      node("process.prompt", "n_prompt_a", 600, 0, { label: "AI 加工 A", outputName: "加工 A" }),
      node("process.prompt", "n_prompt_b", 600, 160, { label: "AI 加工 B", outputName: "加工 B" }),
      node("process.merge", "n_merge", 900, 80, { label: "合并", title: "合并笔记" }),
      node("process.output", "n_out", 1200, 80, { label: "输出", fileName: "笔记.md" }),
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
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 120, { label: "已有文稿", text: "" }),
      node("process.prompt", "n_a", 340, -40, { label: "AI 加工 A", outputName: "加工 A" }),
      node("process.prompt", "n_b", 340, 120, { label: "AI 加工 B", outputName: "加工 B" }),
      node("process.prompt", "n_c", 340, 280, { label: "AI 加工 C", outputName: "加工 C" }),
      node("process.merge", "n_merge", 680, 120, { label: "合并", title: "多路对照" }),
      node("process.output", "n_out", 980, 120, { label: "输出", fileName: "对照笔记.md" }),
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
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 40, { label: "已有文稿", text: "" }),
      node("process.refine", "n_refine", 300, 40, { label: "AI 校对" }),
      node("process.prompt", "n_prompt", 600, 40, { label: "AI 加工", outputName: "加工结果" }),
      node("process.output", "n_out", 900, 40, { label: "输出", fileName: "笔记.md" }),
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
  return {
    schemaVersion: 1,
    nodes: [
      node("source.text", "n_text", 0, 80, { label: "已有文稿", text: "" }),
      node("process.refine", "n_refine", 340, 80, { label: "AI 校对" }),
      node("process.mindmap", "n_mindmap", 680, 80, {
        label: "思维导图",
        branchSize: "auto",
        maxDepth: 4,
        theme: "paper",
        retry: { maxRetries: 2, backoffMs: 3000 },
      }),
      node("process.output", "n_out", 1020, 80, { label: "输出", fileName: "思维导图.md" }),
    ],
    edges: [
      edge("e1", "n_text", "n_refine", "transcript", "transcript"),
      edge("e2", "n_refine", "n_mindmap", "transcript", "in"),
      edge("e3", "n_mindmap", "n_out", "doc", "noteDoc"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 模板六：视频转思维导图（B站视频 → 转写 → 校对 → 思维导图 → 输出）。 */
function videoMindMapGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node("source.bili", "n_src", 0, 80, { label: "B站链接", url: "" }),
      node("process.transcribe", "n_asr", 340, 80, { label: "转写" }),
      node("process.refine", "n_refine", 680, 80, { label: "AI 校对" }),
      node("process.mindmap", "n_mindmap", 1020, 80, {
        label: "思维导图",
        branchSize: "auto",
        maxDepth: 4,
        theme: "paper",
        retry: { maxRetries: 2, backoffMs: 3000 },
      }),
      node("process.output", "n_out", 1360, 80, { label: "输出", fileName: "思维导图.md" }),
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
];
