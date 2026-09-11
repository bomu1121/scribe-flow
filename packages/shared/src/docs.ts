/**
 * 项目文档（docs/ 下的 markdown）的元数据契约，前后端共用。
 *
 * 关于 front matter 解析：`scripts/lib/docs-shared.mjs` 里有一份等价实现。两边刻意不共享代码——
 * scripts/ 下的门禁脚本必须能直接 `node xxx.mjs` 运行、不依赖任何构建步骤，所以不能 import TS。
 * 代价是两份解析器可能漂移，因此 `apps/server/src/lib/docs.test.ts` 里有一条对拍测试，
 * 用同一组样例断言两侧结果一致。改动任一侧都要跑它。
 */

/** 文档的生命周期分类；目录与 class 一一对应，见 AGENTS.md。 */
export type DocClass = "status" | "decision" | "plan" | "evidence" | "research";

export interface DocFrontMatter {
  title?: string;
  class?: string;
  status?: string;
  owner?: string;
  last_reviewed?: string;
  review_days?: string;
  frozen_at?: string;
  content_hash?: string;
  supersedes?: string;
  superseded_by?: string;
}

export interface DocSummary {
  /** 仓库相对路径，用 `/` 分隔，如 `docs 斜杠目录斜杠文档.md`。 */
  path: string;
  /** 所在目录的仓库相对路径，如 `docs/decisions`；用于界面分组。 */
  dir: string;
  /** 取正文首个 H1；没有 front matter 的文档只能靠它识别。 */
  title: string;
  frontMatter: DocFrontMatter | null;
  size: number;
  modifiedAt: number;
}

export interface DocContent extends DocSummary {
  /** 去掉 front matter 之后的正文。 */
  body: string;
}

/**
 * 解析 front matter。只支持 `key: value` 标量——够用且不引入 yaml 依赖。
 * 返回 null 表示该文件没有 front matter。
 */
export function parseDocFrontMatter(text: string): { data: DocFrontMatter; body: string } | null {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return null;

  const data: DocFrontMatter = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim();
    if (raw === "" || raw === "null" || raw === "~") continue;
    data[m[1] as keyof DocFrontMatter] = raw.replace(/^["']|["']$/g, "");
  }
  return { data, body: normalized.slice(end + 4) };
}

/** 取正文首个 H1 作为标题；没有就用文件名兜底。 */
export function docTitleFrom(text: string, fallback: string): string {
  const parsed = parseDocFrontMatter(text);
  const body = parsed ? parsed.body : text;
  const m = /^#\s+(.+)$/m.exec(body);
  if (m) return m[1].trim();
  if (parsed?.data.title) return parsed.data.title;
  return fallback;
}

/** 文档分类的中文名，界面与文档地图共用一套说法。 */
export const DOC_CLASS_LABELS: Record<DocClass, string> = {
  status: "现状",
  decision: "决策",
  plan: "计划",
  evidence: "证据",
  research: "调研",
};

/** 目录 → 分类。与 scripts/lib/docs-shared.mjs 的 DIRECTORY_CLASS 保持一致。 */
export function docClassOfDir(dir: string): DocClass | null {
  if (dir === "docs") return "status";
  if (dir === "docs/decisions") return "decision";
  if (dir === "docs/plans") return "plan";
  if (dir === "docs/evidence") return "evidence";
  if (dir === "docs/research") return "research";
  return null;
}
