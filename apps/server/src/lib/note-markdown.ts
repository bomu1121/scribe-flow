/**
 * 笔记 Markdown 的 front matter 读写。
 *
 * 仓库没有 YAML 库（实测），所以这里是手写的定点改写：**只碰 `tags:` 这一个字段，
 * 其余字节原样保留**。改整个库的东西不能有"顺手重排格式"的行为。
 *
 * 三条硬规矩：
 * 1. 分不清结构就不写（`isFrontMatterBroken`）——宁可漏一篇，不可毁一篇；
 * 2. 写完自校验：把结果再解析一遍，`tags` 对不上就整篇放弃（见 `upsertFrontMatterTags`）；
 * 3. 内容没变就不回写，避免无意义的 mtime 变动与同步风暴。
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/** 库内跳过的目录：模板与附件目录从来不是笔记。 */
const SKIP_DIRS = new Set(["90-Templates", "Attachments"]);

/** YAML 里当标量会被解释成别的东西，写出去必须加引号。 */
const YAML_AMBIGUOUS = /^(y|n|yes|no|true|false|on|off|null|~)$/i;
/** 无需引号的保守白名单：标签规范化后只会剩下这些字符。 */
const YAML_PLAIN = /^[\p{L}\p{N}_/-]+$/u;

export interface FrontMatterParts {
  /** `---` 之间的原文（不含分隔行）；没有 front matter 时为 null。 */
  yaml: string | null;
  /** front matter 之后（含其后的空行）的原文。 */
  body: string;
}

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(content: string): FrontMatterParts {
  const match = FRONT_MATTER_RE.exec(content);
  if (!match) return { yaml: null, body: content };
  return { yaml: match[1], body: content.slice(match[0].length) };
}

/**
 * 开头写着 `---` 却没有收尾的 `---`：Obsidian 自己也会犯迷糊的形状。
 * 这种文件一律跳过——往它前面再插一段 front matter 只会得到两份互相打架的元数据。
 */
export function isFrontMatterBroken(content: string): boolean {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  if (!/^---[ \t]*$/.test(firstLine)) return false;
  return splitFrontMatter(content).yaml === null;
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

/**
 * 解析 front matter 里的列表字段。
 *
 * 比旧实现多容忍两件事：**CRLF 换行**（旧的正则只认 `\n`，Windows 上写的笔记会一个实体都读不出来）
 * 与字段名大小写。行内写法（`tags: a, b`）与块状写法（`tags:` 后跟 `- a`）都支持。
 */
export function parseYamlFieldList(content: string, field: string): string[] {
  const { yaml } = splitFrontMatter(content);
  if (yaml === null) return [];
  const lines = yaml.split(/\r?\n/);
  const result: string[] = [];
  const fieldBlock = new RegExp(`^${field}:[ \\t]*$`, "i");
  const fieldInline = new RegExp(`^${field}:[ \\t]*(.+)$`, "i");
  let inField = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inField && fieldBlock.test(trimmed)) {
      inField = true;
      continue;
    }
    if (inField) {
      const item = trimmed.match(/^-[ \t]*(.+)$/);
      if (item) {
        result.push(unquote(item[1]));
        continue;
      }
      if (trimmed && !/^-/.test(trimmed)) inField = false;
    }
    const inline = fieldInline.exec(trimmed);
    if (inline) {
      result.push(...inline[1].split(/[,，\s]+/).map(unquote).filter(Boolean));
    }
  }
  return result.filter(Boolean);
}

/**
 * 解析**单值**字段（标题、来源、作者、原始链接…）。
 *
 * 与 `parseYamlFieldList` 分开是必须的：列表字段按逗号/空白切分，而单值字段里的空格是值的一部分——
 * `作者: 某个 UP 主` 用列表解析只会得到「某个」，含空格的 UP 名会被静默截断。
 */
export function parseYamlScalar(content: string, field: string): string {
  const { yaml } = splitFrontMatter(content);
  if (yaml === null) return "";
  const line = yaml.split(/\r?\n/).find((candidate) => new RegExp(`^[ \\t]*${field}:[ \\t]*\\S`, "i").test(candidate));
  if (!line) return "";
  const value = new RegExp(`^[ \\t]*${field}:[ \\t]*(.*)$`, "i").exec(line.trim())?.[1] ?? "";
  return unquote(value);
}

/** 扫描正文里的行内标签 `#标签`；代码块里的不算。 */
export function parseInlineTags(content: string): string[] {
  const body = splitFrontMatter(content).body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const tags = new Set<string>();
  for (const match of body.matchAll(/(?:^|[\s(（[【])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) {
    const tag = match[1].replace(/\/+$/, "");
    if (tag) tags.add(tag);
  }
  return [...tags];
}

export interface NoteTags {
  /** front matter 的 `tags:` 列表。 */
  frontmatter: string[];
  /** 正文里的行内 `#标签`（Obsidian 同样把它们算作标签）。 */
  inline: string[];
}

export function parseNoteTags(content: string): NoteTags {
  return {
    frontmatter: parseYamlFieldList(content, "tags"),
    inline: parseInlineTags(content),
  };
}

function yamlScalar(value: string): string {
  if (value && YAML_PLAIN.test(value) && !YAML_AMBIGUOUS.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderTagsBlock(tags: string[]): string[] {
  return ["tags:", ...tags.map((tag) => `  - ${yamlScalar(tag)}`)];
}

/**
 * 定位 `tags:` 字段占的行区间（`yaml` 内的 0-based 行下标，左闭右开）。
 * 支持行内写法与块状写法；找不到返回 null。
 */
function findTagsRange(lines: string[]): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = /^[ \t]*tags:[ \t]*(.*)$/i.exec(line);
    if (!match) continue;
    const rest = match[1].trim();
    if (rest) return { start: i, end: i + 1 };
    let end = i + 1;
    while (end < lines.length && /^[ \t]*-/.test(lines[end] ?? "")) end += 1;
    return { start: i, end };
  }
  return null;
}

export type ApplyTagsResult = { ok: true; content: string; changed: boolean } | { ok: false; reason: string };

/**
 * 把 `tags:` 换成给定的列表（其余 front matter 字段原样保留）。
 *
 * 返回 `changed: false` 表示新旧一致、不必回写。**写完会再解析一遍做自校验**，
 * 校验不过就返回失败——手写 YAML 改写一旦悄悄写坏，损失是用户整个库里的笔记。
 */
export function upsertFrontMatterTags(content: string, tags: string[]): ApplyTagsResult {
  if (isFrontMatterBroken(content)) return { ok: false, reason: "front matter 缺少收尾的 ---" };
  const parts = splitFrontMatter(content);
  if (parts.yaml === null && tags.length === 0) return { ok: true, content, changed: false };

  const existing = parseYamlFieldList(content, "tags");
  const same =
    existing.length === tags.length && existing.every((tag, index) => tag === tags[index]);
  if (same) return { ok: true, content, changed: false };

  const lines = parts.yaml === null ? [] : parts.yaml.split(/\r?\n/);
  const block = tags.length > 0 ? renderTagsBlock(tags) : [];
  const range = findTagsRange(lines);
  const next = range ? [...lines.slice(0, range.start), ...block, ...lines.slice(range.end)] : [...lines, ...block];

  // 去掉因替换而留下的连续空行，避免每改一次就多一行空白。
  const compacted = next.filter((line, index) => !(line.trim() === "" && (next[index - 1] ?? "").trim() === "" && index > 0));
  const yaml = compacted.join("\n").replace(/^\n+|\n+$/g, "");
  const body = parts.yaml === null ? `\n${parts.body.replace(/^\n+/, "")}` : parts.body;
  const out = `---\n${yaml}\n---\n${body}`;

  const verify = parseYamlFieldList(out, "tags");
  if (verify.length !== tags.length || verify.some((tag, index) => tag !== tags[index])) {
    return { ok: false, reason: "写回后自校验不一致" };
  }
  return { ok: true, content: out, changed: true };
}

/**
 * 能否安全改写这篇笔记的 `tags:`。
 * 全库重打标要动几千篇文件，先做一次"能不能写"的判断，比写完再发现坏掉便宜得多。
 */
export function canRewriteTags(content: string): { ok: true } | { ok: false; reason: string } {
  if (isFrontMatterBroken(content)) return { ok: false, reason: "front matter 缺少收尾的 ---" };
  return { ok: true };
}

/**
 * 分类用的「特征」：标题 + 标题行 + 正文开头一段。
 *
 * 刻意不送全文——一部长视频笔记上万字，而判定"讲什么话题"用开头几百字加全部小标题就够；
 * 这也是全库重打标成本能压下来的原因之一。**特征必须逐字节稳定**，因为指纹靠它比对。
 */
export function extractFeatures(fileName: string, content: string): string {
  const { body } = splitFrontMatter(content);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const title = parseYamlScalar(content, "标题") || heading || fileName;
  const headings = (body.match(/^#{1,6}\s+.+$/gm) ?? []).slice(0, 20).join(" / ");
  const lead = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+.+$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  return [title, headings, lead].filter(Boolean).join("\n");
}

/**
 * 只数 `.md` 篇数、不读内容——"检查库"要快，不能因为库大有上万篇就把按钮点成转圈。
 * 到上限就停，并用 `capped` 说明这个数是下限。
 */
export async function countMarkdownFiles(root: string, cap = 2000): Promise<{ count: number; capped: boolean }> {
  let count = 0;
  const walk = async (dir: string): Promise<boolean> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (await walk(join(dir, entry.name))) return true;
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        count += 1;
        if (count >= cap) return true;
      }
    }
    return false;
  };
  const capped = await walk(root);
  return { count, capped };
}

export interface VaultFile {
  /** 库内相对路径，`/` 分隔（跨平台存同一个键）。 */
  relPath: string;
  absPath: string;
  /** 不含 `.md` 的文件名，作为标题兜底。 */
  fileName: string;
  content: string;
}

/** 递归列出库里的 Markdown 笔记；隐藏目录、模板目录、附件目录不进来。 */
export async function walkMarkdownFiles(root: string, options: { excludePaths?: string[] } = {}): Promise<VaultFile[]> {
  const excluded = new Set((options.excludePaths ?? []).filter(Boolean).map((p) => resolve(p)));
  const files: VaultFile[] = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        if (excluded.has(resolve(abs))) continue;
        const content = await readFile(abs, "utf8").catch(() => "");
        if (!content.trim()) continue;
        files.push({
          relPath: relative(root, abs).split(sep).join("/"),
          absPath: abs,
          fileName: entry.name.replace(/\.md$/, ""),
          content,
        });
      }
    }
  };
  await walk(root);
  return files;
}
