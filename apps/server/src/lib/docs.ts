/**
 * 项目文档的读取。只读、且只允许读取 docs/ 下的 `.md`。
 *
 * 路径包含性用 `path.relative` 判断，不用字符串前缀比较——后者在 Windows 上会被
 * `data-evil\` 这类同前缀目录绕过（`apps/server/src/routes/media.ts` 现存的前缀比较就是这个隐患）。
 * 这里同时对 realpath 再判一次，避免软链接把读取引到 docs/ 之外。
 */
import { readFileSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  docTitleFrom,
  parseDocFrontMatter,
  type DocContent,
  type DocSummary,
} from "@scribe-flow/shared";

/** 生成门禁扫描时排除的抓取存档；阅读器仍可列出来。 */
const ARCHIVE_PREFIX = "docs/research/raw/";

/**
 * 由绝对路径得到仓库相对的文档路径。
 *
 * 刻意不通过 `docsDir/../..` 去猜仓库根——那个假设只在真实仓库布局下成立，
 * 换一个目录结构（例如测试的临时目录）就会算错。直接由 docsDir 出发构造，
 * 与 `resolveDocPath` 要求的 `docs/` 前缀契约严格一致。
 */
const toRepoDocPath = (docsDir: string, abs: string) =>
  `docs/${relative(docsDir, abs).split(sep).join("/")}`;

/** 绝对路径是否确实落在 docsDir 内（软链接按真实路径判断）。 */
function isInsideDocs(docsDir: string, abs: string): boolean {
  try {
    const rel = relative(realpathSync(docsDir), realpathSync(abs));
    return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

export class DocAccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DocAccessError";
    this.status = status;
  }
}

/**
 * 校验并解析一个文档路径。
 *
 * 入参是**仓库相对路径**（如 `docs 斜杠目录斜杠文档.md`），与 `DocSummary.path` 一致，
 * 也与全仓其它地方写文档路径的方式一致。必须带 `docs/` 前缀——这样仓库根下的文件
 * 从一开始就不可达，而不是靠后面的包含性判断兜住。
 *
 * @param rel 仓库相对路径，允许省略 `.md`。
 */
export function resolveDocPath(docsDir: string, rel: string): { abs: string; repoPath: string } {
  const raw = (rel ?? "").trim().replace(/\\/g, "/");
  if (!raw) throw new DocAccessError("缺少文档路径", 400);
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) throw new DocAccessError("文档路径必须是相对路径", 400);
  if (raw.includes("\0")) throw new DocAccessError("文档路径不合法", 400);

  const normalized = raw.replace(/^\.\//, "");
  if (!normalized.startsWith("docs/")) throw new DocAccessError("只能预览 docs/ 下的文档", 400);

  const relToDocs = normalized.slice("docs/".length);
  // 只在完全没有扩展名时补 .md；带了别的扩展名要明确拒绝，否则 `docs/status.ts` 会被
  // 补成 `status.ts.md` 而报「不存在」，语义不对。
  const lastSegment = relToDocs.slice(relToDocs.lastIndexOf("/") + 1);
  const withExt = lastSegment.includes(".") ? relToDocs : `${relToDocs}.md`;
  if (!withExt.toLowerCase().endsWith(".md")) throw new DocAccessError("只支持预览 Markdown 文档", 400);

  const abs = resolve(docsDir, withExt);
  // 必须用 path.relative 判包含性：字符串前缀比较会被 `docs-evil/` 这类同前缀目录绕过
  // （`apps/server/src/routes/media.ts` 现存的前缀比较就是这个隐患）。
  const relChecked = relative(docsDir, abs);
  if (!relChecked || relChecked.startsWith("..") || isAbsolute(relChecked)) {
    throw new DocAccessError("文档路径越界", 400);
  }

  // 软链接可能把目标引到 docs/ 之外，用 realpath 再判一次。
  let realAbs: string;
  let realDocs: string;
  try {
    realAbs = realpathSync(abs);
    realDocs = realpathSync(docsDir);
  } catch {
    throw new DocAccessError("文档不存在", 404);
  }
  const relReal = relative(realDocs, realAbs);
  if (!relReal || relReal.startsWith("..") || isAbsolute(relReal)) {
    throw new DocAccessError("文档路径越界", 400);
  }
  if (!statSync(realAbs).isFile()) throw new DocAccessError("文档不存在", 404);

  return { abs: realAbs, repoPath: toRepoDocPath(docsDir, realAbs) };
}

/** 列出 docs/ 下的全部 markdown（含调研原文存档）。 */
export function listDocs(docsDir: string): DocSummary[] {
  const out: DocSummary[] = [];

  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // 软链接指向 docs/ 之外时不列出——否则"列得出来却读不到"，行为自相矛盾。
        if (!isInsideDocs(docsDir, abs)) continue;
        try {
          const stat = statSync(abs);
          const text = readFileSync(abs, "utf8");
          const repoPath = toRepoDocPath(docsDir, abs);
          out.push({
            path: repoPath,
            dir: repoPath.slice(0, repoPath.lastIndexOf("/")),
            title: docTitleFrom(text, entry.name),
            frontMatter: parseDocFrontMatter(text)?.data ?? null,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          });
        } catch {
          // 单个文件读不到就跳过，不让整个列表失败
        }
      }
    }
  };

  walk(docsDir);
  return out.sort((a, b) => a.path.localeCompare(b.path, "zh"));
}

/** 读取单个文档：正文与元数据分开返回，界面上元数据单独呈现。 */
export function readDoc(docsDir: string, rel: string): DocContent {
  const { abs, repoPath } = resolveDocPath(docsDir, rel);
  const text = readFileSync(abs, "utf8");
  const stat = statSync(abs);
  const parsed = parseDocFrontMatter(text);
  const body = parsed ? parsed.body : text;
  return {
    path: repoPath,
    dir: repoPath.slice(0, repoPath.lastIndexOf("/")),
    title: docTitleFrom(text, repoPath.split("/").pop() ?? repoPath),
    frontMatter: parsed?.data ?? null,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    body,
  };
}

export const isArchivedDoc = (repoPath: string) => repoPath.startsWith(ARCHIVE_PREFIX);
