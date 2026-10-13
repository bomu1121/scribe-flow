/**
 * 「相关笔记」的判定与全库回补。
 *
 * ## 与全库重打标（tagging.ts）的根本区别
 * 判定是**纯本地的词法打分**：命中同一个配置属性是最强信号，出现在文件名/正文里依次递减。
 * 不调模型、不花钱。所以那边的预估是"先看清楚再决定要不要付钱"，这边只是"要动多少篇"，
 * 成本从模型调用降成了 IO 与字符串比对。
 *
 * ## 为什么保存路径也走这里
 * `engine.ts` 的 `process.obsidian` 保存时要算一遍相关笔记，回补时又要算一遍。两处各写一份
 * 迟早会漂——这个仓库已经因为"两处各写一份"栽过一次（快捷新建漏了 `process.drill` 的预检）。
 * 于是判定、取属性、段落读写都收在这一页，保存与回补共用。
 *
 * ## 已知边界
 * 比较依据只有**已经写进 front matter 的属性**。属性是保存那一刻由 AI 抽出来写下的，所以
 * 在本功能之前保存的笔记、或当时没开抽取的笔记，没有可比的依据、补不出链接——想让它们也补上，
 * 得先对它们重跑一次属性抽取，而那是花钱的，不在本模块范围内。
 *
 * 另一条边界是**规模**：判定是"每篇和全库比一遍"，O(篇数²)。实测见 `docs/usage.md` 的
 * 「回补相关笔记」一节（那里写的是跑出来的数字，不是估计）。
 */

import { readFile, writeFile } from "node:fs/promises";
import { RELATED_SECTION_TITLE, type RelatedNoteMode } from "@scribe-flow/shared";
import { noteTitle, parseYamlFieldList, walkMarkdownFiles, type VaultFile } from "./note-markdown";

/** 一篇笔记能提供、也需要参与比较的素材。 */
export interface RelatedNoteSource {
  /** 库内唯一键（相对路径）。判定时要靠它把自己排除出去——不同目录可以有同名笔记。 */
  key: string;
  /** 不含 `.md` 的文件名。Obsidian 的 `[[链接]]` 按它解析。 */
  name: string;
  fields: Record<string, string[]>;
  content: string;
}

/**
 * 判定用的预小写视图。
 *
 * 单独一层是必要的：回补是"N 篇各自和全库比一遍"，如果每次都现算 `toLowerCase()`，
 * 光是这一项就是 O(篇数²) 次整篇字符串小写——比真正的比较还贵。类型上把两者分开，
 * 忘掉预处理会直接编不过，而不是悄悄慢下来。
 */
export interface PreparedRelatedNote {
  name: string;
  lowerName: string;
  lowerContent: string;
  /** 字段名 → 小写属性值集合。「同字段同值」的判定要靠它做成 O(1)。 */
  fieldValues: Map<string, Set<string>>;
}

/** 从笔记正文里按字段名取出已写好的属性值（关联笔记的比较依据）。 */
export function pickFields(content: string, fields: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const field of fields) out[field] = parseYamlFieldList(content, field);
  return out;
}

export function prepareRelatedNotes(notes: RelatedNoteSource[]): PreparedRelatedNote[] {
  return notes.map((note) => ({
    name: note.name,
    lowerName: note.name.toLowerCase(),
    lowerContent: note.content.toLowerCase(),
    fieldValues: new Map(
      Object.entries(note.fields).map(([field, values]) => [field, new Set(values.map((value) => value.toLowerCase()))]),
    ),
  }));
}

/**
 * 按配置的字段名，找出库内相关笔记名。
 *
 * 打分对**每个字段一视同仁**：早先给「人物/事件」权重 4、「时期」权重 3，那是历史笔记的领域知识，
 * 换到别的门类只会造成偏差。命中同一字段的值是最强信号，出现在文件名/正文里依次递减；
 * 至少要有一处强信号（阈值 3）才算相关，避免只因为正文里出现过同一个词就连上。
 *
 * `prepared` 必须由 `prepareRelatedNotes` 生成并**在循环外复用**（回补时是全库共用一份）。
 */
export function findRelatedNoteNames(
  current: { fields: Record<string, string[]>; title: string },
  prepared: PreparedRelatedNote[],
  max: number,
): string[] {
  const title = current.title.toLowerCase();
  const scored: Array<{ name: string; score: number }> = [];
  for (const note of prepared) {
    let score = 0;
    for (const [field, values] of Object.entries(current.fields)) {
      const targets = note.fieldValues.get(field);
      for (const value of values) {
        if (!value) continue;
        const lower = value.toLowerCase();
        if (targets?.has(lower)) score += 4;
        if (note.lowerName.includes(lower)) score += 2;
        if (note.lowerContent.includes(lower)) score += 1;
      }
    }
    if (title && note.lowerName.includes(title)) score += 2;
    if (score >= 3) scored.push({ name: note.name, score });
  }
  // 同分时按名字排：不排的话顺序取决于目录读出来的次序（readdir 不保证有序），
  // 于是同一份库在不同机器上会连出不同的链接，回补也就永远"有变化"。
  scored.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return scored.slice(0, max).map((item) => item.name);
}

/* ---------------------------------------------------------------- 段落读写 */

/** 只认我们自己写的那种列表项：`- [[名字]]`（也接受 `- [[名字|别名]]`）。 */
const RELATED_ITEM_RE = /^[ \t]*-[ \t]*\[\[[^\]\n]+\]\][ \t]*$/;

/** 文件名里出现这些字符就没法安全地表示成 `[[链接]]`，判定时直接丢掉（见 `linkTargets`）。 */
const UNLINKABLE = /[[\]|#^\r\n]/;

function headingOf(title: string): RegExp {
  // 标题是固定词，但仍转义一遍：万一以后让人改标题，正则不该被它的字符带偏。
  return new RegExp(`^##[ \\t]*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`);
}

/** 定位我们写的那一段：最后一个 `## 相关笔记` 标题，且它之后到文件末尾全是列表项/空行。返回行下标或 -1。 */
function managedSectionStart(lines: string[], title: string): number {
  const heading = headingOf(title);
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    if (!heading.test(lines[start] ?? "")) continue;
    const rest = lines.slice(start + 1);
    // 必须是"延伸到末尾"的一段。用户自己在正文中间手写的、后面还接着别的正文，不认领。
    if (rest.every((line) => line.trim() === "" || RELATED_ITEM_RE.test(line))) return start;
  }
  return -1;
}

/** 去掉行尾可能残留的 `\r`，让比对与行尾风格无关（`\r\n` 的笔记也得认得出自己那一段）。 */
function normalizeLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.replace(/\r$/, ""));
}

/** 读回我们写的那一段里的链接名（写完自校验用，也用于预估时判断"和现在一样吗"）。 */
export function readRelatedSectionNames(content: string, title = RELATED_SECTION_TITLE): string[] {
  const lines = normalizeLines(content);
  const start = managedSectionStart(lines, title);
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^[ \t]*-[ \t]*\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\][ \t]*$/.exec(line);
    if (match?.[1]) names.push(match[1].trim());
  }
  return names;
}

/**
 * 删掉**我们自己写的那一段** `## 相关笔记`，其余字节原样保留。
 *
 * 保存路径是整篇重写、文件里不存在旧段；回补是原地改文件，不先删就会一段叠一段。
 * 用户自己在正文中间手写的 `## 相关笔记`（后面还接着别的正文）不会被认领，原样留着。
 */
export function stripRelatedSection(content: string, title = RELATED_SECTION_TITLE): { content: string; stripped: boolean } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = normalizeLines(content);
  const start = managedSectionStart(lines, title);
  if (start < 0) return { content, stripped: false };

  // 连同前面的空行一起删，免得每回补一次就多留一行空白。
  let cut = start;
  while (cut > 0 && (lines[cut - 1] ?? "").trim() === "") cut -= 1;
  // 按原文（只按 \n 切，索引与上面一致）切，其余行的字节原样保留。
  const raw = content.split("\n").slice(0, cut).join("\n").replace(/[ \t\r\n]+$/, "");
  return { content: raw ? `${raw}${eol}` : "", stripped: true };
}

/** 把链接名收敛成能安全写进 `[[…]]` 的形态；整个名字不可用时丢掉它。 */
function linkTargets(names: string[]): string[] {
  // 目标不存在是一回事，写出一个语法坏掉的链接是另一回事——后者会把整段读成普通文本。
  return names.filter((name) => !UNLINKABLE.test(name));
}

/**
 * 把 `## 相关笔记` 写成给定的一组链接；没有链接就删掉这一段。
 *
 * `changed: false` 表示文件不必回写——避免无意义的 mtime 变动与同步风暴。这是 `note-markdown.ts`
 * 立的规矩，回补动的是整个库，更要守。
 */
export function upsertRelatedSection(
  content: string,
  names: string[],
  title = RELATED_SECTION_TITLE,
): { content: string; changed: boolean } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const targets = linkTargets(names);
  const stripped = stripRelatedSection(content, title);
  if (targets.length === 0) return { content: stripped.content, changed: stripped.stripped };
  const base = stripped.content.replace(/(\r?\n)+$/, "");
  const section = [`## ${title}`, ...targets.map((name) => `- [[${name}]]`)].join(eol);
  const next = `${base}${eol}${eol}${section}${eol}`;
  return { content: next, changed: next !== content };
}

/* ---------------------------------------------------------------- 扫描与回补 */

/**
 * 扫描库内已有笔记，收齐判定需要的素材。跳过模板/附件/隐藏目录（与打标共用 `walkMarkdownFiles`）。
 *
 * 正文里我们自己写的那一段会被摘掉再参与比较：不然上次写的 `[[链接]]` 会变成下次判定的"证据"，
 * 链接自己把自己越连越牢。
 */
export async function scanVaultNotes(
  root: string,
  fields: string[],
  options: { excludePaths?: string[] } = {},
): Promise<RelatedNoteSource[]> {
  const files = await walkMarkdownFiles(root, options);
  return files.map((file) => ({
    key: file.relPath,
    name: file.fileName,
    fields: pickFields(file.content, fields),
    content: stripRelatedSection(file.content).content,
  }));
}

export interface RelatedProgress {
  stage: "scan" | "write" | "done";
  processed: number;
  total: number;
  message: string;
}

export interface RelatedPlan {
  vaultPath: string;
  totalNotes: number;
  willUpdate: number;
  unchanged: number;
  noFields: number;
  plannedLinks: number;
  samples: { relPath: string; mode: RelatedNoteMode; relatedCount: number }[];
}

export interface RelatedReport {
  vaultPath: string;
  totalNotes: number;
  written: number;
  unchanged: number;
  failed: { relPath: string; reason: string }[];
  linksWritten: number;
}

interface BackfillItem {
  file: VaultFile;
  nextContent: string;
  changed: boolean;
  mode: RelatedNoteMode;
  /** 这篇有没有可比属性；没有就意味着它补不出链接（已有的也会被清掉）。 */
  hasFields: boolean;
}

/**
 * 全库算一遍。**plan 与 run 共用**：计算本身不花钱，重算一次比维护两套"预估/执行"口径便宜，
 * 也不会出现"预估说 12 篇、执行动了 13 篇"这种对不上的账。
 *
 * `prepareRelatedNotes` 只在循环外做一次——这是全库回补能跑得动的关键，见该函数的注释。
 */
async function computeBackfill(vaultPath: string, fields: string[], max: number): Promise<BackfillItem[]> {
  const files = await walkMarkdownFiles(vaultPath);
  const sources: RelatedNoteSource[] = files.map((file) => ({
    key: file.relPath,
    name: file.fileName,
    fields: pickFields(file.content, fields),
    content: stripRelatedSection(file.content).content,
  }));
  const prepared = prepareRelatedNotes(sources);

  return files.map((file, index) => {
    const self = sources[index] as RelatedNoteSource;
    const others = prepared.filter((_, candidateIndex) => candidateIndex !== index);
    const related = findRelatedNoteNames(
      { fields: self.fields, title: noteTitle(file.fileName, file.content) },
      others,
      max,
    );
    const hadSection = stripRelatedSection(file.content).stripped;
    const applied = upsertRelatedSection(file.content, related);
    const hasLinks = readRelatedSectionNames(applied.content).length > 0;
    return {
      file,
      nextContent: applied.content,
      changed: applied.changed,
      mode: !hadSection && hasLinks ? "add" : hadSection && !hasLinks ? "remove" : "update",
      hasFields: Object.values(self.fields).some((values) => values.length > 0),
    };
  });
}

export async function planRelatedBackfill(
  vaultPath: string,
  fields: string[],
  max: number,
  sampleLimit = 30,
): Promise<RelatedPlan> {
  const items = await computeBackfill(vaultPath, fields, max);
  const changed = items.filter((item) => item.changed);
  return {
    vaultPath,
    totalNotes: items.length,
    willUpdate: changed.length,
    unchanged: items.length - changed.length,
    noFields: items.filter((item) => !item.hasFields).length,
    plannedLinks: changed.reduce((sum, item) => sum + readRelatedSectionNames(item.nextContent).length, 0),
    samples: changed.slice(0, sampleLimit).map((item) => ({
      relPath: item.file.relPath,
      mode: item.mode,
      relatedCount: readRelatedSectionNames(item.nextContent).length,
    })),
  };
}

/**
 * 回补：把库里每篇笔记的 `## 相关笔记` 重算一遍。
 *
 * 只写"内容真的会变"的篇；写完**再读回来自校验**链接与预期一致，不一致就整篇放弃并记进 `failed`
 * ——改整个库的东西不能有"写坏了还不知道"的情况（`note-markdown.ts` 立的规矩）。
 */
export async function runRelatedBackfill(
  vaultPath: string,
  fields: string[],
  max: number,
  options: { onProgress?: (progress: RelatedProgress) => void } = {},
): Promise<RelatedReport> {
  const emit = options.onProgress ?? (() => undefined);
  emit({ stage: "scan", processed: 0, total: 0, message: "扫描笔记库…" });
  const items = await computeBackfill(vaultPath, fields, max);

  const toWrite = items.filter((item) => item.changed);
  emit({ stage: "write", processed: 0, total: toWrite.length, message: `写入 ${toWrite.length} 篇…` });

  const report: RelatedReport = {
    vaultPath,
    totalNotes: items.length,
    written: 0,
    unchanged: items.length - toWrite.length,
    failed: [],
    linksWritten: 0,
  };
  let processed = 0;
  for (const item of toWrite) {
    const expected = readRelatedSectionNames(item.nextContent);
    try {
      await writeFile(item.file.absPath, item.nextContent, "utf8");
      const actual = await readFile(item.file.absPath, "utf8");
      const names = readRelatedSectionNames(actual);
      if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
        report.failed.push({ relPath: item.file.relPath, reason: "写回后自校验不一致" });
      } else {
        report.written += 1;
        report.linksWritten += names.length;
      }
    } catch (error) {
      report.failed.push({ relPath: item.file.relPath, reason: error instanceof Error ? error.message : String(error) });
    }
    processed += 1;
    emit({ stage: "write", processed, total: toWrite.length, message: `写入 ${processed}/${toWrite.length}` });
  }

  // 没写的那些篇，它们现在已有的链接也算进这一轮的账。
  for (const item of items.filter((candidate) => !candidate.changed)) {
    report.linksWritten += readRelatedSectionNames(item.file.content).length;
  }

  emit({ stage: "done", processed: toWrite.length, total: toWrite.length, message: `完成：写入 ${report.written} 篇` });
  return report;
}
