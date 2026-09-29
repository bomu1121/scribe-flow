import { NODE_TYPE_LABELS, type NodeType } from "./graph";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "./templates";

/**
 * 「展示范围」的过滤规则：哪些节点/链路/提示词块在当前设置下不该出现在界面上。
 *
 * 规则集中写在这里而不是散在四个组件里，是因为它要同时管住节点面板、新建工程的链路列表、
 * 快捷新建的下拉与提示词块库——四处各写一遍必然漂移（比如新增一个节点类型时漏掉一处）。
 *
 * 三条约定：
 * 1. **只影响新建时的可选项**：已有工程里出现的节点照常渲染、照常运行；收起入口不该让旧工程失效。
 * 2. 链路跟着节点走：链路里用到被隐藏的节点就整条不出现——否则建出来会多出一张「我没见过的卡」。
 * 3. 提示词块跟着承载它的节点走（`PromptBlock.requiresNode`）；通用块（观点笔记/科普笔记这类）
 *    由「AI 加工」承载，不随任何垂直节点隐藏。
 */

/** 全部节点类型（面板与设置页共用一份顺序：来源 → 转写 → 加工 → 逻辑 → 输出）。 */
export const NODE_TYPE_ORDER: NodeType[] = [
  "source.bili",
  "source.file",
  "source.text",
  "process.transcribe",
  "process.refine",
  "process.prompt",
  "process.gameguide",
  "process.chapter",
  "process.mindmap",
  "process.drill",
  "process.text",
  "flow.pick",
  "flow.if",
  "process.merge",
  "process.obsidian",
  "process.output",
];

/** 该节点类型是否被收起来了。 */
export function isNodeHidden(hidden: NodeType[] | undefined, type: NodeType): boolean {
  return Boolean(hidden?.includes(type));
}

export function nodeTypeLabel(type: NodeType): string {
  return NODE_TYPE_LABELS[type] ?? type;
}

/** 链路里用到、但已被收起的节点（空数组表示这条链路可以照常展示）。 */
export function hiddenNodesInTemplate(template: WorkflowTemplate, hidden: NodeType[] | undefined): NodeType[] {
  if (!hidden || hidden.length === 0) return [];
  const used = new Set<NodeType>();
  for (const stage of template.stages) used.add(stage.type);
  // 来源轴会补来源与转写节点：来源类型被收起时，这条链路同样不该出现。
  for (const source of template.sources ?? ["bili", "file", "text"]) {
    used.add(source === "text" ? "source.text" : source === "file" ? "source.file" : "source.bili");
    if (source !== "text") used.add("process.transcribe");
  }
  return [...used].filter((type) => hidden.includes(type));
}

/** 按展示范围过滤后的链路列表（新建工程 / 快捷新建共用）。 */
export function visibleTemplates(hidden: NodeType[] | undefined): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter((template) => hiddenNodesInTemplate(template, hidden).length === 0);
}
