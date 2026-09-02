/**
 * 思维导图节点辅助：解析 LLM 返回的树、清洗结构、序列化为 Markmap Markdown。
 * 只依赖 Node 内置能力，便于单测。
 */

export interface MindMapTreeNode {
  text: string;
  children?: MindMapTreeNode[];
}

export interface MindMapTree {
  title?: string;
  nodes: MindMapTreeNode[];
}

export interface MindMapBuildOptions {
  /** 主分支数量倾向。 */
  branchSize?: "auto" | "few" | "many";
  /** 层级上限（不含中心主题）。 */
  maxDepth?: number;
  /** 主题标识。 */
  theme?: "paper" | "presentation" | "academic";
}

const MAX_NODES = 160;
const MAX_NODE_TEXT = 60;

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/^[#>*\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NODE_TEXT);
}

function extractJsonObject(raw: string): unknown {
  const text = raw.trim();
  // 去掉 ```json ... ``` 或 ``` ... ``` 包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    // 尝试截取第一个 { 到最后一个 }
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("思维导图结果不是有效 JSON");
  }
}

function normalizeNode(value: unknown, depth: number, maxDepth: number, counter: { count: number }): MindMapTreeNode | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const text = cleanText(record.text ?? record.title ?? record.name ?? "");
  if (!text) return null;
  if (counter.count >= MAX_NODES) return null;
  counter.count += 1;

  const childrenRaw = Array.isArray(record.children) ? record.children : Array.isArray(record.nodes) ? record.nodes : [];
  const children: MindMapTreeNode[] = [];
  if (depth < maxDepth) {
    for (const child of childrenRaw) {
      const normalized = normalizeNode(child, depth + 1, maxDepth, counter);
      if (normalized) children.push(normalized);
      if (counter.count >= MAX_NODES) break;
    }
  }
  return { text, children: children.length > 0 ? children : undefined };
}

/**
 * 把 LLM 返回内容解析成思维导图树，并做结构清洗。
 * 抛错时给出面向用户的中文信息。
 */
export function parseMindMapJson(raw: string, options: MindMapBuildOptions = {}): MindMapTree {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("思维导图结果不是有效 JSON 对象");
  }
  const record = parsed as Record<string, unknown>;
  const maxDepth = Math.min(5, Math.max(3, Number(options.maxDepth ?? 4) || 4));
  const counter = { count: 0 };

  const rawNodes = Array.isArray(record.nodes)
    ? record.nodes
    : Array.isArray(record.children)
      ? record.children
      : Array.isArray(record.branches)
        ? record.branches
        : [];

  const nodes: MindMapTreeNode[] = [];
  for (const item of rawNodes) {
    const node = normalizeNode(item, 1, maxDepth, counter);
    if (node) nodes.push(node);
    if (counter.count >= MAX_NODES) break;
  }

  if (nodes.length === 0) {
    throw new Error("思维导图结果没有可用分支");
  }

  const branchSize = options.branchSize ?? "auto";
  if (branchSize === "few" && nodes.length > 7) {
    nodes.length = 7;
  } else if (branchSize === "many" && nodes.length > 9) {
    nodes.length = 9;
  } else if (nodes.length > 8) {
    nodes.length = 8;
  }

  const title = cleanText(record.title ?? record.topic ?? record.name ?? "") || undefined;
  return { title, nodes };
}

/** 统计树节点总数（含所有层级）。 */
export function countMindMapNodes(nodes: MindMapTreeNode[]): number {
  let count = 0;
  const walk = (list: MindMapTreeNode[]) => {
    for (const node of list) {
      count += 1;
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return count;
}

function themeColors(theme?: "paper" | "presentation" | "academic"): string[] {
  switch (theme) {
    case "presentation":
      return ["#0B88C4", "#D9822B", "#18A058", "#6366F1", "#8A929E", "#C2410C"];
    case "academic":
      return ["#0B88C4", "#545B66", "#18A058", "#6366F1", "#8A929E", "#D9822B"];
    case "paper":
    default:
      return ["#0B88C4", "#18A058", "#D9822B", "#6366F1", "#8A929E"];
  }
}

function themeMaxWidth(theme?: "paper" | "presentation" | "academic"): number {
  return theme === "presentation" ? 320 : 260;
}

function renderChildren(nodes: MindMapTreeNode[], level: number): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (!node.text) continue;
    lines.push(`${"  ".repeat(level)}- ${escapeMarkdown(node.text)}`);
    if (node.children?.length) lines.push(renderChildren(node.children, level + 1));
  }
  return lines.join("\n");
}

function escapeMarkdown(text: string): string {
  // 只转义会导致 Markdown 层级混乱的行首字符；节点内普通标点保留。
  return text.replace(/^([-*#>])/g, "\\$1");
}

/**
 * 把思维导图树序列化为带 Markmap frontmatter 的 Markdown。
 */
export function mindMapToMarkdown(tree: MindMapTree, options: MindMapBuildOptions = {}): string {
  const title = tree.title?.trim() || "思维导图";
  const theme = options.theme ?? "paper";
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${escapeFrontmatter(title)}`);
  lines.push("markmap:");
  lines.push(`  colorFreezeLevel: 2`);
  lines.push(`  maxWidth: ${themeMaxWidth(theme)}`);
  lines.push(`  lineWidth: 1.5`);
  lines.push(`  color:`);
  for (const color of themeColors(theme)) lines.push(`    - "${color}"`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${title}`);
  lines.push("");
  for (const node of tree.nodes) {
    lines.push(`## ${escapeMarkdown(node.text)}`);
    if (node.children?.length) {
      lines.push("");
      lines.push(renderChildren(node.children, 0));
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function escapeFrontmatter(text: string): string {
  return text.replace(/"/g, '\\"');
}
