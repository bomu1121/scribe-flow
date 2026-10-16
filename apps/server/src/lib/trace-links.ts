/**
 * 「笔记 ←→ 溯源笔记」的互链区。
 *
 * 背景：溯源报告原本只在结果页能看，落到库里就是另一篇独立笔记——两篇之间没有任何关系。
 * 这里在笔记里开一个区域（形态照 `> [!quote] 弦外之音` 那种 callout），放指向溯源笔记的链接。
 *
 * **为什么由写盘这一侧来补，而不是让溯源去读笔记**：那会形成循环——溯源要参考笔记，
 * 笔记的链接又要指向溯源，两边互为前提。改成「谁后写谁补链」就没有这个问题：
 * 先写笔记、后写溯源笔记时，由溯源笔记那一趟把链接回补进已有笔记；反过来则一次写就带上。
 *
 * 与 `related-notes.ts` 同一套纪律：
 * - 只动**我们自己写的那一段**（先摘掉旧的再追加），所以重跑不会越堆越多；
 * - 内容没变就不回写（`changed: false`），不让整个库的 mtime 无谓地变一遍。
 */
/** 区域标题：callout 的标题，也是幂等摘除的定位锚。 */
export const TRACE_SECTION_TITLE = "溯源";

/** 溯源笔记的 `类型` 值。用它把「哪篇是溯源笔记」变成一次 frontmatter 读取，而不是翻正文猜。 */
export const TRACE_NOTE_TYPE = "溯源笔记";

/**
 * 配对要读的 frontmatter 字段。
 *
 * 只读这两个：配对键是**来源链接**，判别标记是**类型**。抽取字段（人物/事件/时期）是
 * 「相关笔记」那条判定的输入，两件事不要混在一份扫描里——混了就会让任一方加字段都要动另一方的读取。
 */
export const TRACE_LINK_FIELDS = ["原始链接", "类型"];

/** callout 的首行。带中文标题是 Obsidian 的硬要求（不给标题会显示英文类型名）。 */
function calloutHeader(): string {
  return `> [!note] ${TRACE_SECTION_TITLE}`;
}

const HEADER_RE = new RegExp(`^>\\s*\\[!note\\]\\s*${TRACE_SECTION_TITLE}\\s*$`);

/** 链接名里带这些字符会让 `[[…]]` 语法坏掉（仓库里 `related-notes.ts` 有同一份判断）。 */
const UNLINKABLE = /[[\]|#^\r\n]/;

/**
 * 链接名一律去掉 `.md`。
 *
 * Obsidian 的规范形态是不带扩展名，而且库内扫描**两种模式给出的名字不一样**：
 * 本地扫描沿用 `walkMarkdownFiles` 的 `fileName`（带 `.md`，因为 `uniqueNoteFileName` 就返回带扩展名的），
 * 远端扫描显式剥掉了。不在这里统一，链接形态就会跟着用的是本地还是坚果云而变。
 */
export function linkName(name: string): string {
  return name.replace(/\.md$/i, "").trim();
}

function linkTargets(names: string[]): string[] {
  /*
   * 排序不只是为了好看：回补每次都是拿「扫描到的集合」重算一遍，集合相同但顺序不同的话
   * 内容就不同，`changed` 会判成 true 而把文件白写一遍（还会把库的 mtime 全搅动一遍）。
   */
  return [...new Set(names.map(linkName).filter((name) => name && !UNLINKABLE.test(name)))].sort((a, b) =>
    a.localeCompare(b, "zh"),
  );
}

/**
 * 我们那一段的行区间 `[start, end)`；找不到返回 null。
 *
 * 读链接与摘除**共用这一处**：两处各写一遍「哪几行属于我们」迟早会漂——那时会出现
 * 「读到的名字」与「摘掉的内容」不是同一段，回补开始丢链接或重复。
 * 局部的 `g` 标志也不行：正则带状态时 `.test()` 会跨调用记住位置，读数会随调用顺序变化。
 */
function findTraceSection(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => HEADER_RE.test(line.trim()));
  if (start < 0) return null;
  // callout 是连续的一整段 `> ` 行；从标题行往后吃到不再是引用行为止。
  let end = start;
  while (end < lines.length && (lines[end] ?? "").startsWith(">")) end += 1;
  return { start, end };
}

/**
 * 读出现有区域里已经写着的链接名。
 * **只在区域内部找**：用户自己在别处写的 `> - [[某笔记]]` 不属于这一段，不能吞进来。
 */
export function readTraceSectionNames(content: string): string[] {
  const lines = content.split("\n");
  const span = findTraceSection(lines);
  if (!span) return [];
  const names: string[] = [];
  for (const line of lines.slice(span.start, span.end)) {
    const match = line.match(/^>\s*-\s*\[\[([^\]]+)\]\]\s*$/);
    if (match) names.push(match[1]);
  }
  return names;
}

/** 摘掉我们自己写的那一段（连同前后多余的空行），找不到就原样返回。 */
export function stripTraceSection(content: string): { content: string; stripped: boolean } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split("\n");
  const span = findTraceSection(lines);
  if (!span) return { content, stripped: false };
  // 连同前面的空行一起删，免得每回补一次就多留一行空白。
  let cut = span.start;
  while (cut > 0 && (lines[cut - 1] ?? "").trim() === "") cut -= 1;
  const raw = [...lines.slice(0, cut), ...lines.slice(span.end)].join("\n").replace(/[ \t\r\n]+$/, "");
  return { content: raw ? `${raw}${eol}` : "", stripped: true };
}

/**
 * 把溯源链接写成一段 callout 接在正文末尾。
 *
 * `names` 是**完整集合**（调用方从一次库扫描里算出来），语义与 `upsertRelatedSection` 一致：
 * 传空集合等于删除这一段。所以溯源笔记从库里消失时链接会跟着消失（自愈），
 * 而不是像合并那样永远留着一条指向不存在文件的链接。
 * `changed: false` 表示文件不必回写。
 */
export function upsertTraceSection(content: string, names: string[]): { content: string; changed: boolean } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const stripped = stripTraceSection(content);
  const merged = linkTargets(names);
  if (merged.length === 0) return { content: stripped.content, changed: stripped.stripped };

  const base = stripped.content.replace(/(\r?\n)+$/, "");
  const block = [calloutHeader(), ...merged.map((name) => `> - [[${name}]]`)].join(eol);
  // 前后各留一个空行：callout 与相邻内容之间必须空行，否则会被并进上一段。
  const next = `${base}${eol}${eol}${block}${eol}`;
  return { content: next, changed: next !== content };
}

/** 该笔记是不是溯源笔记（`类型` 字段里写着 `溯源笔记`）。 */
export function isTraceNoteType(values: string[] | undefined): boolean {
  return (values ?? []).some((value) => value.trim() === TRACE_NOTE_TYPE);
}

/**
 * 两条来源链接是不是同一个素材。
 *
 * 只做保守归一：忽略协议、大小写、末尾斜杠与查询/锚点。**不猜站点的等价形式**——
 * 把两个不同的视频判成同一个，笔记就会链到错的溯源报告上，那比少链一次糟得多。
 */
export function sameSourceUrl(a?: string, b?: string): boolean {
  const norm = (value?: string): string => {
    const text = (value ?? "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const path = url.pathname.replace(/\/+$/, "");
      return `${host}${path}`;
    } catch {
      return text.replace(/\/+$/, "").toLowerCase();
    }
  };
  const left = norm(a);
  return Boolean(left) && left === norm(b);
}
