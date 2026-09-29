import DOMPurify from "dompurify";
import { marked, type RendererThis, type Tokens } from "marked";

/** 标题转 id 用的 slug：只留字母 / 数字 / 连字符 / 下划线，空标题回落到 `section`。 */
export function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "");
  return base || "section";
}

/** 同名标题（同一篇文档内）依次加序号：`sec-x`、`sec-x-1`、`sec-x-2`… */
export function uniqueHeadingId(text: string, seen: Map<string, number>): string {
  const base = slugify(text);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return `sec-${base}${count ? `-${count}` : ""}`;
}

/** 目录里的一个标题：id 与渲染出的标题锚点同源，text 是用户写的那行 Markdown 原文。 */
export interface DocumentHeading {
  /** 标题层级（1-4；与改动前一致，5/6 级不给 id 也不进目录）。 */
  level: number;
  /**
   * 锚点 id，与 `renderMarkdown` 写进 HTML 的 id 是同一个——
   * 两者在同一趟渲染里产出，所以按 id 找 DOM 元素必然找得到。
   */
  id: string;
  /** 目录显示文本：Markdown 行内原文，`[链接](…)`、`` `代码` ``、`**加粗**` 原样保留。 */
  text: string;
}

/**
 * 目录显示文本：沿用「行首 1-4 个 # 之后到行尾」的老口径，逐字保留用户写的那行
 * （`## 标题 ##` 的尾随 # 也照旧显示）。
 *
 * 匹配不上时返回 null，例如 setext 标题（`标题\n===`）、缩进标题、引用块里的标题：
 * 这些标题照旧只拿锚点、不进目录——这轮只修「点了不跳」，不顺手改变目录里出现哪些条目。
 */
function headingDisplayText(raw: string): string | null {
  const firstLine = raw.split("\n")[0] ?? "";
  const match = firstLine.match(/^(#{1,4})\s+(.*)$/);
  return match ? (match[2] ?? "").trim() : null;
}

/**
 * 一趟渲染同时产出 HTML 与标题清单（层级 / 锚点 id / 显示文本）。
 *
 * 为什么必须同一趟：目录按 id 去 DOM 里找标题锚点，如果两边各算一次 slug 就会分叉——
 * 目录拿到的是 Markdown 原文（`[链接](http://x)`），锚点拿到的是渲染后的文本（`链接`），
 * 一个算成 `sec-链接httpx`、一个算成 `sec-链接`，点目录什么都不发生。
 * 所以 id 只在这里生成一次，目录直接复用这份清单。
 */
function renderWithHeadings(source: string): { html: string; headings: DocumentHeading[] } {
  const headings: DocumentHeading[] = [];
  const seen = new Map<string, number>();
  const renderer = new marked.Renderer();
  renderer.heading = function (this: RendererThis, { tokens, depth, raw }: Tokens.Heading): string {
    const inner = this.parser.parseInline(tokens);
    // 5/6 级标题与改动前一致：不给 id（目录也只列到 4 级）。
    if (depth > 4) return `<h${depth}>${inner}</h${depth}>\n`;
    const id = uniqueHeadingId(inner.replace(/<[^>]+>/g, "").trim(), seen);
    const text = headingDisplayText(raw);
    if (text !== null) headings.push({ level: depth, id, text });
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  };
  const html = marked.parse(source, { async: false, gfm: true, breaks: true, renderer }) as string;
  return { html, headings };
}

/** 只要标题清单（结果页目录用）；与 renderMarkdown 同源，id 必然对得上。 */
export function documentHeadings(source: string): DocumentHeading[] {
  if (!source) return [];
  // 这里不需要安全的 HTML，所以跳过 sanitize：id 在 sanitize 之前就写进 HTML，
  // 而 renderMarkdown 用 ADD_ATTR 让 DOMPurify 保留它，两边的 id 是同一个。
  return renderWithHeadings(source).headings;
}

/** 把 Markdown 渲染为安全的 HTML；会为标题补 id 供目录跳转使用。 */
export function renderMarkdown(source: string): string {
  if (!source) return "";
  const { html } = renderWithHeadings(source);
  return DOMPurify.sanitize(html, { ADD_ATTR: ["id"] });
}
