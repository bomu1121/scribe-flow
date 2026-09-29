/**
 * 「对照」用的纯计算：文本指标 + 行级差异统计 + AI 差异判读的结构定义。
 *
 * 放在 shared 而不是结果页组件里的两个理由：
 * 1. 行级 diff 算法原本只存在于前端 `DiffViewer.vue` 里。对照视图要显示「删 X 行 / 增 Y 行 / 重合率」，
 *    如果各算一份，同一组数据就会出现两个数字——这个项目已经为「两处口径不一致」吃过亏。
 *    所以算法与统计只此一份，`DiffViewer` 也改成用它。
 * 2. 指标是纯函数，可以在 shared 的测试里直接钉住（相同文本 = 100%、空文本不报错、围栏计数等）；
 *    AI 判读的结构与解析也放这里，服务端产出与前端渲染共用一份定义，规则不会两边漂。
 *
 * 这些数字都是**机械统计**（字符/行/结构标记），不是语义相似度：
 * 两份内容全同但换一套措辞，重合率会很低——「重合率」是保守下界，不是「有多像」的评分。
 * 「差在哪、各自适合什么」由 AI 判读负责（见文末 CompareAnalysis），两者在界面上分开呈现。
 */

import { z } from "zod";

/** 一份文本的机械指标。全部按行统计，不依赖任何 AI。 */
export interface TextMetrics {
  /** 去掉所有空白后的字符数。 */
  chars: number;
  /** 行数（空文本记 0）。 */
  lines: number;
  /** 段落数：连续非空行算一段。 */
  paragraphs: number;
  /** 标题行数（`#` ~ `######` 开头）。 */
  headings: number;
  /** 列表项行数（`-` / `*` / `+` / `1.` 开头）。 */
  listItems: number;
  /** 表格行数（含 `|` 的行）。 */
  tableRows: number;
  /** 引用行数（`>` 开头）。 */
  quotes: number;
  /** 代码围栏块数（成对的 ``` 记一块）。 */
  codeBlocks: number;
}

/** 行级差异的一行：`add` = 只出现在右侧，`del` = 只出现在左侧。 */
export interface DiffLine {
  type: "add" | "del";
  text: string;
}

export interface DiffStats {
  /** 两侧都有的行数（行级 diff 的公共子序列长度）。 */
  unchanged: number;
  /** 只出现在左侧的行数。 */
  removed: number;
  /** 只出现在右侧的行数。 */
  added: number;
  /** 重合率（0–1）= 公共行 × 2 ÷ 总行数；两边都空时记 1。 */
  similarity: number;
}

export interface CompareReport {
  left: TextMetrics;
  right: TextMetrics;
  /** 逐行差异统计；内容超过行数上限时为 null（只看指标，不做逐行对比）。 */
  stats: DiffStats | null;
}

/** 逐行 diff 的行数上限：超过就不算（前端也据此展示「内容过长」）。 */
export const DIFF_MAX_LINES = 800;

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

/** 行数：空文本记 0（`splitLines("")` 会得到 1 个空行，直接数会误报）。 */
function countLines(text: string): number {
  return text.trim() ? splitLines(text).length : 0;
}

export function measureText(text: string): TextMetrics {
  const lines = text.trim() ? splitLines(text) : [];
  let paragraphs = 0;
  let headings = 0;
  let listItems = 0;
  let tableRows = 0;
  let quotes = 0;
  let fences = 0;
  let inParagraph = false;
  for (const line of lines) {
    const blank = line.trim().length === 0;
    if (blank) {
      inParagraph = false;
    } else if (!inParagraph) {
      paragraphs += 1;
      inParagraph = true;
    }
    if (/^\s{0,3}#{1,6}\s/.test(line)) headings += 1;
    if (/^\s*(?:[-*+]|\d+\.)\s/.test(line)) listItems += 1;
    if (/^\s*>/.test(line)) quotes += 1;
    if (line.includes("|")) tableRows += 1;
    if (/^\s*```/.test(line)) fences += 1;
  }
  return {
    chars: text.replace(/\s/g, "").length,
    lines: countLines(text),
    paragraphs,
    headings,
    listItems,
    tableRows,
    quotes,
    codeBlocks: Math.floor(fences / 2),
  };
}

/**
 * 行级 diff（LCS）。返回的行按「先删后增」的顺序给出，与 `DiffViewer` 的渲染顺序一致：
 * 它会在渲染时把相邻的「删 + 增」配成一对做字符级高亮。
 *
 * 返回 null 表示行数超过上限，调用方不要假装有结论。
 */
export function diffLines(before: string, after: string, maxLines = DIFF_MAX_LINES): DiffLine[] | null {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > maxLines || b.length > maxLines) return null;

  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS 长度（从后往前算）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      rows.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j] });
    j += 1;
  }
  return rows;
}

/** 把 diff 行统计成「删 / 增 / 重合率」。 */
export function summarizeDiff(before: string, after: string, rows: DiffLine[]): DiffStats {
  let removed = 0;
  let added = 0;
  for (const row of rows) {
    if (row.type === "del") removed += 1;
    else added += 1;
  }
  const leftLines = countLines(before);
  const rightLines = countLines(after);
  const unchanged = Math.max(0, Math.round((leftLines + rightLines - removed - added) / 2));
  const total = unchanged * 2 + removed + added;
  return { unchanged, removed, added, similarity: total === 0 ? 1 : (unchanged * 2) / total };
}

/** 一次对照的全部数字：两侧指标 + 逐行差异（超长时 stats 为 null）。 */
export function compareTexts(left: string, right: string): CompareReport {
  const rows = diffLines(left, right);
  return {
    left: measureText(left),
    right: measureText(right),
    stats: rows ? summarizeDiff(left, right, rows) : null,
  };
}

// ---------------------------------------------------------------------------
// AI 差异判读
// ---------------------------------------------------------------------------
// 行级 diff 在两份「同一素材、两套做法」的 AI 产物上几乎全是噪声：措辞一换，整行就算「变了」
// （实测一条真实运行的重合率只有 11%）。所以对照的结论由模型来给，机械统计只作硬数字旁证。
// 结构与解析放 shared：服务端产出、前端渲染都依赖同一份定义，规则不会两边漂。

/**
 * 一条「只在一侧出现」的内容点。
 * `detail` 只用来放原文里的专名、数字、位置，不要复述整段。
 */
export interface ComparePoint {
  point: string;
  detail?: string;
}

/** 两边都讲了、但结论或口径不一致的地方。 */
export interface CompareConflict {
  topic: string;
  left: string;
  right: string;
}

export interface CompareAnalysis {
  /** 一句话结论：两份的核心差别是什么（不评谁好谁坏）。 */
  summary: string;
  /** 只有左侧讲到的内容。 */
  onlyLeft: ComparePoint[];
  /** 只有右侧讲到的内容。 */
  onlyRight: ComparePoint[];
  /** 两边都讲但结论/口径冲突的地方。 */
  conflicts: CompareConflict[];
  /** 两边共同覆盖的要点（短句，不复述）。 */
  shared: string[];
  /** 各自更适合什么场景（各 1-3 条）。 */
  fit: { left: string[]; right: string[] };
  /** 两份内容几乎一致时的说明；正常时为空串。 */
  sameNote?: string;
}

const comparePointSchema = z.object({
  point: z.string().min(1),
  detail: z.string().optional(),
});

export const compareAnalysisSchema = z.object({
  summary: z.string().min(1),
  onlyLeft: z.array(comparePointSchema).default([]),
  onlyRight: z.array(comparePointSchema).default([]),
  conflicts: z
    .array(z.object({ topic: z.string().min(1), left: z.string().min(1), right: z.string().min(1) }))
    .default([]),
  shared: z.array(z.string().min(1)).default([]),
  fit: z.object({ left: z.array(z.string().min(1)).default([]), right: z.array(z.string().min(1)).default([]) }).default({ left: [], right: [] }),
  sameNote: z.string().optional(),
});

/** 模型偶尔会包一层 ```json 或写句开场白：取第一个 `{` 到最后一个 `}` 再解析。 */
export function parseCompareAnalysis(raw: string): CompareAnalysis {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 没有返回可解析的对照结论（没找到 JSON）");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new Error(`AI 返回的对照结论不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  const result = compareAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`AI 返回的对照结论字段不完整：${result.error.issues[0]?.message ?? "未知原因"}`);
  }
  return result.data;
}

/** 把结论写成可复制的 Markdown（对照页的「复制分析」用）。 */
export function compareAnalysisToMarkdown(analysis: CompareAnalysis, labels: { left: string; right: string }): string {
  const lines: string[] = [`# 对照分析：${labels.left} vs ${labels.right}`, "", analysis.summary, ""];
  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };
  const points = (title: string, items: ComparePoint[]) =>
    list(
      title,
      items.map((item) => (item.detail ? `${item.point}（${item.detail}）` : item.point)),
    );
  points(`只在「${labels.left}」里讲到的`, analysis.onlyLeft);
  points(`只在「${labels.right}」里讲到的`, analysis.onlyRight);
  if (analysis.conflicts.length > 0) {
    lines.push("## 两边不一致的地方", "");
    for (const item of analysis.conflicts) {
      lines.push(`- **${item.topic}**：${labels.left} 说「${item.left}」；${labels.right} 说「${item.right}」`);
    }
    lines.push("");
  }
  list("两边都讲到的", analysis.shared);
  list(`更适合「${labels.left}」的场景`, analysis.fit.left);
  list(`更适合「${labels.right}」的场景`, analysis.fit.right);
  if (analysis.sameNote) lines.push(analysis.sameNote, "");
  lines.push("> 以上为 AI 对两份内容的差异判读，可能有误；字数、结构等硬数字见对照页的「指标对比」。");
  return lines.join("\n");
}

/** 送入模型前每侧的字符上限（超出走头尾保留 + 省略标记）。 */
export const COMPARE_MAX_CHARS = 16_000;

/**
 * 输入过长时保留头尾：头 60% 才有结论与要点，尾 40% 常有结尾的结论/清单；
 * 中间省略处插显式标记，提示词里也要求「省略处的差异不许猜」。
 */
export function clampCompareText(text: string, maxChars = COMPARE_MAX_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  const omitted = text.length - maxChars;
  return {
    text: `${text.slice(0, head)}\n\n【…此处省略约 ${omitted} 字…】\n\n${text.slice(text.length - tail)}`,
    truncated: true,
  };
}
