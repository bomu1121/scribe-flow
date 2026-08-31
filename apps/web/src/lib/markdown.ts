import DOMPurify from "dompurify";
import { marked } from "marked";

function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "");
  return base || "section";
}

function uniqueHeadingId(text: string, seen: Map<string, number>): string {
  const base = slugify(text);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return `sec-${base}${count ? `-${count}` : ""}`;
}

function addHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(/<h([1-4])([^>]*)>(.*?)<\/h\1>/g, (_, level: string, attrs: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const id = uniqueHeadingId(text, seen);
    return `<h${level} id="${id}"${attrs}>${inner}</h${level}>`;
  });
}

/** 把 Markdown 渲染为安全的 HTML；会为标题补 id 供目录跳转使用。 */
export function renderMarkdown(source: string): string {
  if (!source) return "";
  const raw = marked.parse(source, { async: false, gfm: true, breaks: true }) as string;
  const withIds = addHeadingIds(raw);
  return DOMPurify.sanitize(withIds, { ADD_ATTR: ["id"] });
}
