/**
 * 项目文档的读取。只读、且只允许读取 docs/ 下的 `.md`。
 *
 * 路径包含性用 `path.relative` 判断，不用字符串前缀比较——后者在 Windows 上会被
 * `data-evil\` 这类同前缀目录绕过（`apps/server/src/routes/media.ts` 现存的前缀比较就是这个隐患）。
 * 这里同时对 realpath 再判一次，避免软链接把读取引到 docs/ 之外。
 */
import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
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
 * 列表接口一次读取的字节数上限。
 *
 * 列出全部文档只需要「front matter + 首个 H1」，而全仓文档合计 643 KB。只读头部后实际读取
 * 301 KB（9 篇退回整读），listDocs 中位耗时 5.77 → 4.69 ms（A/B 交替取样 25 轮）。
 *
 * 这个改动**不是数量级的**：省下的 342 KB 只换来 1.08 ms。按 57 个文件折算，逐个 open/read/
 * close 再 UTF-8 解码的固定成本约 82 µs/文件（只 stat 不读是 4.7 µs/文件，说明单个系统调用
 * 本身便宜、开销在读取与解码这一段），而多读的字节只值约 3 µs/KB——所以省字节能省的有限。
 * 保留它的理由是它把 I/O 字节减半（冷盘上更明显），且结果与整读等价。
 *
 * 注意测量局限：以上都是**页缓存已热**的数字。
 *
 * 12 篇抓取存档（`docs/research/raw/`）全文没有 H1，其中 9 篇超过 4096 字节，因此它们走退回
 * 路径（另有首个 H1 在 4 KB 之后的少数文档）。这是刻意选择：为了"省一次读"而放弃正确性不值当。
 */
const HEAD_BYTES = 4096;

/** 读文件开头若干字节。size 由调用方传入——它本来就要 stat 一次拿文件大小。 */
function readHead(abs: string, size: number, limit = HEAD_BYTES): { text: string; truncated: boolean } {
  const fd = openSync(abs, "r");
  try {
    const buf = Buffer.allocUnsafe(Math.min(limit, size));
    const read = readSync(fd, buf, 0, buf.length, 0);
    return { text: buf.subarray(0, read).toString("utf8"), truncated: size > read };
  } finally {
    closeSync(fd);
  }
}

/**
 * 只读到文件头时，能否断定「与整读结果一致」。
 *
 * 需要两个条件：front matter 已经闭合（否则可能是没读到结尾）、首个 H1 已完整落在读到的
 * 片段里（否则它可能被截断，而 `/^#\s+(.+)$/m` 会把截断的半行也匹配出标题）。
 * 任何一条不满足就退回整读，宁可慢一次也不给出与整读不同的结果。
 */
function headIsConclusive(text: string, truncated: boolean): boolean {
  if (!truncated) return true;
  const hasFrontMatterStart = /^---\r?\n/.test(text);
  const parsed = parseDocFrontMatter(text);
  if (hasFrontMatterStart && !parsed) return false;
  const body = parsed ? parsed.body : text;
  const match = /^#\s+(.+)$/m.exec(body);
  if (!match) return false;
  // H1 行在片段内必须已经换行结束
  return body.slice(match.index + match[0].length).includes("\n");
}

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

/** 列表项；`body` 只在显式要求时出现。 */
export type DocListItem = DocSummary & { body?: string };

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

/**
 * 列出 docs/ 下的全部 markdown（含调研原文存档）。
 *
 * `withBody` 为真时一并返回正文，供阅读器「一次请求拿全」用（见 `routes/docs.ts`）。
 * 正文只在这里被整读过一次，元数据与正文来自同一份文本，不会出现两者口径不一致。
 */
export function listDocs(docsDir: string, options: { withBody?: boolean } = {}): DocListItem[] {
  const out: DocListItem[] = [];
  const withBody = options.withBody === true;

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
        // 只对软链接做 realpath 判定：普通文件每篇判两次 realpath 是白付的系统调用。
        if (entry.isSymbolicLink() && !isInsideDocs(docsDir, abs)) continue;
        try {
          const stat = statSync(abs);
          const repoPath = toRepoDocPath(docsDir, abs);
          const { text, body } = loadDocText(abs, stat.size, withBody);
          out.push({
            path: repoPath,
            dir: repoPath.slice(0, repoPath.lastIndexOf("/")),
            title: docTitleFrom(text, entry.name),
            frontMatter: parseDocFrontMatter(text)?.data ?? null,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            ...(withBody ? { body: body ?? "" } : {}),
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

/**
 * 取「元数据所需的文本」，需要时同时得到正文。
 *
 * 不要求正文时只读文件头；一旦头部不足以得出结论（`headIsConclusive` 为假）就退回整读——
 * 退回是安全的默认方向：结果与整读一致，代价只是一次多余的读。
 */
function loadDocText(
  abs: string,
  size: number,
  withBody: boolean,
): { text: string; body: string | null } {
  if (withBody) {
    const text = readFileSync(abs, "utf8");
    const parsed = parseDocFrontMatter(text);
    return { text, body: parsed ? parsed.body : text };
  }
  const head = readHead(abs, size);
  if (headIsConclusive(head.text, head.truncated)) return { text: head.text, body: null };
  return { text: readFileSync(abs, "utf8"), body: null };
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
