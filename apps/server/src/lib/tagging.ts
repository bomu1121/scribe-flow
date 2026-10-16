/**
 * 笔记标签的判定与全库重打标。
 *
 * ## 为什么要有指纹表
 * 重打标最贵的动作是"把笔记发给模型"。指纹（`note_tag_fingerprints`）记住「这篇上次是在什么内容、
 * 用什么词库上判过的」，于是三种情况都不花钱：
 * - 内容与词库都没变 → 跳过；
 * - 只有词库长出新标签 → 只判"新标签适不适用"，prompt 里只放新标签（不是整个词库）；
 * - 只有标签被人手改 / 词库删了标签 → 纯本地改写，同样不调模型。
 *
 * ## 三个省钱杠杆（按贡献排序）
 * 1. **增量**：不重跑全库，只处理受影响的笔记；
 * 2. **词法预筛**：新标签先在本地跟特征做子串匹配，命中的才发模型（0 成本）；
 * 3. **批量 + 短特征 + 固定前缀**：20 篇一批、送特征不送全文、词库放在 `system` 里
 *    ——DeepSeek 的上下文缓存要求"从头完全相同的公共前缀"，`system` 正好是它。
 *
 * ## 已知会漏的一种情况
 * 新标签与老笔记**字面不重合**时（标签叫「平台经济」而笔记里只写了「抽成」），预筛不会把它送进模型。
 * 补法是 `deep`（跳过预筛、全库语义匹配，明确更贵），或把标签名起得贴近原文用词。
 */

import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TagTaxonomy } from "@scribe-flow/shared";
import {
  addApiUsage,
  addTagToTaxonomy,
  emptyApiUsage,
  isAutoTag,
  managedTags,
  normalizeNoteTag,
  normalizeTagPath,
  normalizeTagSegment,
  stableHash,
  tagKey,
  tagPathGroup,
  taxonomyHash,
  writableTags,
} from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { appSettings, noteTagFingerprints } from "../db/schema";
import { chatCompletion, type AiConfig, type ApiUsage } from "./ai";
import { canRewriteTags, extractFeatures, parseNoteTags, upsertFrontMatterTags, walkMarkdownFiles, type VaultFile } from "./note-markdown";

/** 一次调用判定多少篇：越大越省（指令与词库被摊薄），但每篇的判定质量会降。 */
const CLASSIFY_BATCH = 20;

/** 模型每篇最多给几个标签。 */
const MAX_TAGS_PER_NOTE = 6;

/** 允许新增时，每批最多接受几个新标签；防止一次调用把词库撑爆。 */
const MAX_NEW_TAGS_PER_BATCH = 3;

type NoteMode = "full" | "incremental" | "cleanup" | "skip" | "unparsable";

interface NoteDecision {
  file: VaultFile;
  features: string;
  currentTags: string[];
  /** 指纹表里记的「我们上次写进这篇的标签」，用来在词库删条目后仍认得出哪些是我们的。 */
  ownedPrevious: string[];
  mode: NoteMode;
  reason?: string;
  /** 增量模式下与这篇字面匹配上的新标签。 */
  candidateTags: string[];
  /** 写入 front matter 的最终标签；未参与本次处理的笔记为 undefined。 */
  tagsOverride?: string[];
}

export interface RetagProgress {
  stage: "scan" | "classify" | "write" | "done";
  processed: number;
  total: number;
  message: string;
}

export interface RetagPlan {
  vaultPath: string;
  totalNotes: number;
  /** 需要**全量**判定的笔记（新笔记，或内容/标签被人改过）。 */
  fullNotes: string[];
  /** 内容没变、只是词库长了新标签且本地预筛命中的笔记。 */
  incrementalNotes: string[];
  /** 只需删除已从词库移除的标签（纯本地改写，不调模型）。 */
  cleanupNotes: string[];
  /** 完全不用动的笔记数。 */
  unchanged: number;
  /** 结构坏掉、只能跳过的笔记。 */
  unparsable: { relPath: string; reason: string }[];
  /** 相比历史记录，词库里多出来的标签（增量判定就是拿它们去比）。 */
  addedTags: string[];
  /** 已从词库移除的标签（会被从笔记里清掉）。 */
  removedTags: string[];
  /** 预估调用次数：全量与增量各自按批大小向上取整。 */
  estimatedCalls: number;
}

export interface RetagReport {
  vaultPath: string;
  totalNotes: number;
  /** 实际回写的笔记数。 */
  written: number;
  unchanged: number;
  failed: { relPath: string; reason: string }[];
  addedTags: string[];
  removedTags: string[];
  /** 本次由 AI 补进词库的新叶子标签。 */
  learnedTags: string[];
  calls: number;
  usage: ApiUsage;
  /** AI 补过叶子后的词库；调用方负责落库。 */
  taxonomy: TagTaxonomy;
  taxonomyChanged: boolean;
}

/** 内容指纹：特征 + 当前标签集合。任一变化都意味着"上次的判定不再可信"。 */
function contentFingerprint(features: string, tags: string[]): string {
  return stableHash(`${features}\n##${[...tags].sort().join(",")}`);
}

/**
 * 从**写入后**的正文算指纹。
 *
 * 判定（`decide`）、批量写回、入库单篇写回三处必须走同一个函数：只要有一处口径不同，
 * 下一轮就会误判成"内容变了"而白白重判全库。这类不一致不会报错，只会默默多花钱。
 */
function fingerprintOf(fileName: string, content: string): string {
  const { frontmatter, inline } = parseNoteTags(content);
  const all = [...new Set([...frontmatter, ...inline].map(normalizeNoteTag).filter(Boolean))];
  return contentFingerprint(extractFeatures(fileName, content), all);
}

function fileNameOf(relPath: string): string {
  return relPath.split("/").pop()?.replace(/\.md$/, "") ?? relPath;
}

/**
 * 上次跑用的词库快照。
 *
 * 为什么不能拿"所有笔记曾经写过的标签"当基准：词库里**从没被任何笔记用上**的条目
 * 不在那个集合里，于是每一轮都会被当成"新标签"，增量路径永远不收敛。
 * 快照记的是"上次完整判定时手上有什么词库"，与用没用过无关。
 */
const TAXONOMY_SNAPSHOT_KEY = "obsidian.tagTaxonomySnapshot";

function readTaxonomySnapshot(db: AppDatabase): TagTaxonomy | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, TAXONOMY_SNAPSHOT_KEY)).get();
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TagTaxonomy) : null;
  } catch {
    return null;
  }
}

function writeTaxonomySnapshot(db: AppDatabase, taxonomy: TagTaxonomy): void {
  const now = Date.now();
  const value = JSON.stringify(taxonomy);
  db.insert(appSettings)
    .values({ key: TAXONOMY_SNAPSHOT_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } })
    .run();
}

export function vaultKey(vaultPath: string): string {
  return resolve(vaultPath);
}

/**
 * 库路径必须是一个真实存在的目录。
 *
 * 少了这一步，路径写错（或库在另一台机器上）会一路走到底：遍历读不到任何东西 →
 * 报告「全库 0 篇 · 预计 0 次调用」→ 看起来像"没事可做"。这是最危险的一种错——不报错，
 * 还给出一个可信的数字。
 */
export async function assertVaultPath(vaultPath: string): Promise<void> {
  const info = await stat(vaultPath).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Obsidian 库路径不存在或不是目录：${vaultPath}`);
}

interface StoredFingerprint {
  contentHash: string;
  taxonomyHash: string;
  tags: string[];
}

function loadFingerprints(db: AppDatabase, vaultPath: string): Map<string, StoredFingerprint> {
  const rows = db.select().from(noteTagFingerprints).where(eq(noteTagFingerprints.vaultPath, vaultKey(vaultPath))).all();
  const map = new Map<string, StoredFingerprint>();
  for (const row of rows) {
    map.set(row.notePath, { contentHash: row.contentHash, taxonomyHash: row.taxonomyHash, tags: parseTagsJson(row.tagsJson) });
  }
  return map;
}

function parseTagsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    // 坏数据当作"什么都没记"，下一轮会重新判定这些笔记。
  }
  return [];
}

function saveFingerprint(
  db: AppDatabase,
  vaultPath: string,
  notePath: string,
  contentHash: string,
  taxHash: string,
  tags: string[],
): void {
  const now = Date.now();
  const tagsJson = JSON.stringify(tags);
  db.insert(noteTagFingerprints)
    .values({ id: randomUUID(), vaultPath: vaultKey(vaultPath), notePath, contentHash, taxonomyHash: taxHash, tagsJson, updatedAt: now, createdAt: now })
    .onConflictDoUpdate({
      target: [noteTagFingerprints.vaultPath, noteTagFingerprints.notePath],
      set: { contentHash, taxonomyHash: taxHash, tagsJson, updatedAt: now },
    })
    .run();
}

/**
 * 词法预筛：新标签的名字（末段与所属一级）是否出现在笔记特征里。
 * 这里刻意不做语义判断——它只是"谁值得花模型钱"的第一道闸门。
 */
function matchesLexically(features: string, tag: string): boolean {
  const haystack = features.toLowerCase();
  const leaf = (tag.split("/").pop() ?? tag).toLowerCase();
  const group = tagPathGroup(tag).toLowerCase();
  return (leaf.length >= 2 && haystack.includes(leaf)) || (group.length >= 2 && haystack.includes(group));
}

interface DecideResult {
  decisions: NoteDecision[];
  addedTags: string[];
  removedTags: string[];
  taxHash: string;
}

/**
 * 逐篇决定处理方式；plan 与 run 共用，保证"预估"与"实际执行"口径一致。
 *
 * **只处理用户维护的话题标签**：来源与 UP 主这两个自动标签（`B站`、`UP：某某`）由元数据在生成笔记时写入，
 * 不在这里新增、也不在这里清理（要改就让用户去 Obsidian 里自己改）。
 */
async function decide(
  db: AppDatabase,
  vaultPath: string,
  taxonomy: TagTaxonomy,
  options: { deep?: boolean },
): Promise<DecideResult> {
  await assertVaultPath(vaultPath);
  const files = await walkMarkdownFiles(vaultPath);
  const fingerprints = loadFingerprints(db, vaultPath);
  const taxHash = taxonomyHash(taxonomy);
  const topic = new Set(managedTags(taxonomy).map(tagKey));
  const managedNow = new Set(managedTags(taxonomy).map(tagKey));

  // 基准是"上次跑用的词库"而不是"笔记用过的标签"：后者会让从没被用上的词库条目每轮都算新增。
  const snapshot = readTaxonomySnapshot(db);
  const previousWritable = snapshot ? new Set(writableTags(snapshot).map(tagKey)) : null;
  const freshVault = fingerprints.size === 0 && !snapshot;
  const addedTags = freshVault
    ? []
    : writableTags(taxonomy).filter((tag) => !previousWritable || !previousWritable.has(tagKey(tag)));
  const removedTags = snapshot
    ? managedTags(snapshot).filter((tag) => !managedNow.has(tagKey(tag))).sort()
    : [];

  const decisions: NoteDecision[] = [];
  for (const file of files) {
    const features = extractFeatures(file.fileName, file.content);
    const { frontmatter, inline } = parseNoteTags(file.content);
    const currentTags = [...new Set([...frontmatter, ...inline].map(normalizeNoteTag).filter(Boolean))];
    const contentHash = contentFingerprint(features, currentTags);
    const stored = fingerprints.get(file.relPath);
    const ownedPrevious = stored?.tags ?? [];

    const rewritable = canRewriteTags(file.content);
    if (!rewritable.ok) {
      decisions.push({ file, features, currentTags, ownedPrevious, mode: "unparsable", reason: rewritable.reason, candidateTags: [] });
      continue;
    }

    // 我们管得着的标签 = 词库里现在还留着的（含一级）+ 历史上我们写过的（词库删条目后仍要能清理）。
    // **两个自动标签（来源 / UP 主）永远不在清理范围内**：老指纹里可能记着它们（那时它们还属于词库），
    // 但产品上它们归元数据管，删了就找不回来了——用户要改自己改。
    const isOurs = (tag: string) =>
      topic.has(tagKey(tag)) || ownedPrevious.some((prev) => tagKey(prev) === tagKey(tag));
    const stale = currentTags.filter((tag) => !isAutoTag(tag) && isOurs(tag) && !topic.has(tagKey(tag)));

    let mode: NoteMode = "skip";
    let candidateTags: string[] = [];
    if (!stored || stored.contentHash !== contentHash) {
      mode = "full";
    } else if (stored.taxonomyHash !== taxHash && addedTags.length > 0) {
      // 这篇上次判定的词库比现在旧，且这期间有新标签 → 只补判新增的那些。
      const matched = options.deep ? addedTags : addedTags.filter((tag) => matchesLexically(features, tag));
      if (matched.length > 0) {
        mode = "incremental";
        candidateTags = matched;
      }
    }
    if (mode === "skip" && stale.length > 0) mode = "cleanup";

    decisions.push({ file, features, currentTags, ownedPrevious, mode, candidateTags });
  }

  return { decisions, addedTags, removedTags, taxHash };
}

export async function planRetag(
  db: AppDatabase,
  vaultPath: string,
  taxonomy: TagTaxonomy,
  options: { deep?: boolean } = {},
): Promise<RetagPlan> {
  const { decisions, addedTags, removedTags } = await decide(db, vaultPath, taxonomy, options);
  const byMode = (mode: NoteMode) => decisions.filter((d) => d.mode === mode);
  return {
    vaultPath,
    totalNotes: decisions.length,
    fullNotes: byMode("full").map((d) => d.file.relPath),
    incrementalNotes: byMode("incremental").map((d) => d.file.relPath),
    cleanupNotes: byMode("cleanup").map((d) => d.file.relPath),
    unchanged: byMode("skip").length,
    unparsable: byMode("unparsable").map((d) => ({ relPath: d.file.relPath, reason: d.reason ?? "无法解析" })),
    addedTags,
    removedTags,
    estimatedCalls: Math.ceil(byMode("full").length / CLASSIFY_BATCH) + Math.ceil(byMode("incremental").length / CLASSIFY_BATCH),
  };
}

/**
 * 判定用的 system 提示词。**必须逐字节稳定**，否则前缀缓存命中不了、省钱的前提就没了——
 * 所以这里不掺任何随批次变化的东西（批次内容全在 user 里）。
 */
function buildSystemPrompt(available: string[]): string {
  return [
    "你是 Obsidian 笔记的分类助手。我会给你一批笔记的摘要，请为每一篇选出适用的标签。",
    "",
    "规则：",
    `1. 优先从「可用标签」里选，最多 ${MAX_TAGS_PER_NOTE} 个；只选确实相关的，宁少勿多。`,
    "2. 标签必须与「可用标签」里的写法逐字一致（形如「一级/二级」或「一级」）。",
    "3. 判断不了就返回空数组，不要硬凑。",
    '4. 只输出 JSON，格式：[{"id":1,"tags":["..."]}]，不要解释、不要代码围栏。',
    "",
    "可用标签：",
    JSON.stringify(available),
  ].join("\n");
}

function buildUserPrompt(batch: { id: number; features: string }[]): string {
  return JSON.stringify(batch.map((item) => ({ id: item.id, 笔记: item.features })));
}

/** 解析模型返回的 `[{id, tags}]`；坏 JSON 与越界 id 一律丢掉，不猜。 */
function parseClassifyResponse(raw: string, validIds: Set<number>): Map<number, string[]> {
  const tagsById = new Map<number, string[]>();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return tagsById;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return tagsById;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as { id?: unknown; tags?: unknown };
      const id = typeof record.id === "number" ? record.id : Number(record.id);
      if (!Number.isInteger(id) || !validIds.has(id)) continue;
      const tags = Array.isArray(record.tags) ? record.tags : [];
      tagsById.set(
        id,
        [...new Set(tags.map((tag) => normalizeTagPath(String(tag))).filter(Boolean))].slice(0, MAX_TAGS_PER_NOTE + MAX_NEW_TAGS_PER_BATCH),
      );
    }
  } catch {
    // 解析失败即"这批什么都没判出来"，由调用方记失败并继续下一批。
  }
  return tagsById;
}

interface ClassifyOutcome {
  tagsById: Map<string, string[]>;
  nextTaxonomy: TagTaxonomy;
  learnedTags: string[];
  calls: number;
  usage: ApiUsage;
  failed: { key: string; reason: string }[];
}

/** 判定用的最小输入：一个稳定的 key（相对路径或节点 id）加一段特征。 */
export interface ClassifyItem {
  key: string;
  features: string;
}

/**
 * 分批判定，返回「key → 最终话题标签」。
 *
 * `available` 是这次允许模型选的标签：全量模式传整个词库，增量模式只传新标签——
 * 同一个函数因此同时具备"完整分类"与"只判新增"两种能力，也自动把增量那次的
 * prompt 缩到只剩几个标签。
 */
export async function classifyItems(
  aiConfig: AiConfig,
  items: ClassifyItem[],
  taxonomy: TagTaxonomy,
  options: { allowNewTags: boolean; available: string[]; signal?: AbortSignal },
): Promise<ClassifyOutcome> {
  const outcome: ClassifyOutcome = { tagsById: new Map(), nextTaxonomy: taxonomy, learnedTags: [], calls: 0, usage: emptyApiUsage(), failed: [] };
  if (items.length === 0 || options.available.length === 0) return outcome;

  const system = buildSystemPrompt(options.available);
  const availableKeys = new Set(options.available.map(tagKey));
  const groups = new Set(Object.keys(taxonomy).map((group) => group.toLowerCase()));

  for (let offset = 0; offset < items.length; offset += CLASSIFY_BATCH) {
    if (options.signal?.aborted) break;
    const batch = items.slice(offset, offset + CLASSIFY_BATCH);
    const batchIds = new Set(batch.map((_, index) => index + 1));
    const user = buildUserPrompt(batch.map((item, index) => ({ id: index + 1, features: item.features })));

    let raw = "";
    try {
      const result = await chatCompletion(aiConfig, system, user, options.signal);
      raw = result.content;
      outcome.calls += 1;
      outcome.usage = addApiUsage(outcome.usage, result.usage);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const item of batch) outcome.failed.push({ key: item.key, reason });
      continue;
    }

    const parsed = parseClassifyResponse(raw, batchIds);
    if (parsed.size === 0) {
      for (const item of batch) outcome.failed.push({ key: item.key, reason: "模型没有返回可解析的分类结果" });
      continue;
    }

    let newTagBudget = MAX_NEW_TAGS_PER_BATCH;
    for (const [index, item] of batch.entries()) {
      const proposed = parsed.get(index + 1);
      if (!proposed) {
        outcome.failed.push({ key: item.key, reason: "模型漏掉了这篇笔记" });
        continue;
      }
      const accepted: string[] = [];
      for (const tag of proposed) {
        if (availableKeys.has(tagKey(tag))) {
          accepted.push(tag);
          continue;
        }
        // 词库外的标签只有在「允许新增 + 一级已是已有分组 + 还有预算」时才收。
        // 一级结构由人定、模型只能补叶子——否则词库会被模型长出一堆自造分类，聚合口径就散了。
        const group = tagPathGroup(tag);
        const leaf = tag.split("/").slice(1).join("/");
        if (!options.allowNewTags || !leaf || !groups.has(group.toLowerCase()) || newTagBudget <= 0) continue;
        const normalized = normalizeTagPath(`${group}/${leaf}`);
        if (!normalized) continue;
        outcome.nextTaxonomy = addTagToTaxonomy(outcome.nextTaxonomy, group, leaf);
        if (!outcome.learnedTags.some((existing) => tagKey(existing) === tagKey(normalized))) outcome.learnedTags.push(normalized);
        accepted.push(normalized);
        newTagBudget -= 1;
      }
      outcome.tagsById.set(item.key, accepted);
    }
  }

  return outcome;
}

export interface NoteTaggingOutcome {
  /** 判定出来的话题标签（已过滤到词库内 / 允许新增的范围）。 */
  topicTags: string[];
  learnedTags: string[];
  taxonomy: TagTaxonomy;
  usage: ApiUsage;
  calls: number;
  error?: string;
}

/**
 * 给**单篇**笔记判定话题标签：入库时用（与全库重打标共用同一条 prompt 路径，
 * 所以两处判出来的口径必然一致）。
 *
 * `source` 只用于日志性质的说明，不参与判定——判定只看特征。
 */
export async function tagNoteContent(
  aiConfig: AiConfig,
  taxonomy: TagTaxonomy,
  options: { key: string; fileName: string; content: string; allowNewTags: boolean; signal?: AbortSignal },
): Promise<NoteTaggingOutcome> {
  const available = writableTags(taxonomy);
  const outcome = await classifyItems(aiConfig, [{ key: options.key, features: extractFeatures(options.fileName, options.content) }], taxonomy, {
    allowNewTags: options.allowNewTags,
    available,
    signal: options.signal,
  });
  return {
    topicTags: outcome.tagsById.get(options.key) ?? [],
    learnedTags: outcome.learnedTags,
    taxonomy: outcome.nextTaxonomy,
    usage: outcome.usage,
    calls: outcome.calls,
    error: outcome.failed[0]?.reason,
  };
}

/**
 * 记下这篇笔记的判定指纹，好让全库重打标跳过它。入库时（engine）与批量写回共用。
 *
 * `ownedTags` 只用来记"哪些标签是我们的"——必须**排除人手写的标签**，
 * 否则下一次重打标会把人的标签误认成自己的，然后在词库变化时把它删掉。
 */
export function rememberNoteTags(
  db: AppDatabase,
  vaultPath: string,
  relPath: string,
  content: string,
  ownedTags: string[],
  taxonomy: TagTaxonomy,
): void {
  const ownedKeys = new Set(managedTags(taxonomy).map(tagKey));
  const owned = [...new Set(ownedTags.map(normalizeTagPath).filter((tag) => tag && ownedKeys.has(tagKey(tag))))];
  saveFingerprint(db, vaultPath, relPath, fingerprintOf(fileNameOf(relPath), content), taxonomyHash(taxonomy), owned);
}

/**
 * 合成写入 front matter 的最终标签：人写的原样保留，两个自动标签（来源 / UP 主）原样保留，
 * 话题标签由我们重排。`incremental` 为真表示"旧的话题标签仍然有效"（增量模式没重新判它们）。
 *
 * 自动标签在这里**只保留、不推导**：它们归元数据管，回补不碰——既不新增也不删。
 */
function mergeTopicTags(note: NoteDecision, accepted: string[] | undefined, taxonomy: TagTaxonomy, incremental: boolean): string[] {
  const topic = new Set(managedTags(taxonomy).map(tagKey));
  const isOurs = (tag: string) => topic.has(tagKey(tag)) || note.ownedPrevious.some((prev) => tagKey(prev) === tagKey(tag));
  const preserved = note.currentTags.filter((tag) => isOurs(tag) && topic.has(tagKey(tag)));
  const human = note.currentTags.filter((tag) => !isOurs(tag) || isAutoTag(tag));

  const next = incremental ? [...preserved] : [];
  for (const tag of accepted ?? []) if (!next.some((existing) => tagKey(existing) === tagKey(tag))) next.push(tag);
  const merged = [...human, ...next];
  return merged.filter((tag, index) => merged.findIndex((other) => tagKey(other) === tagKey(tag)) === index);
}

export async function runRetag(
  db: AppDatabase,
  aiConfig: AiConfig,
  vaultPath: string,
  taxonomy: TagTaxonomy,
  options: { allowNewTags: boolean; deep?: boolean; signal?: AbortSignal; onProgress?: (progress: RetagProgress) => void },
): Promise<RetagReport> {
  const emit = options.onProgress ?? (() => undefined);
  emit({ stage: "scan", processed: 0, total: 0, message: "扫描笔记库…" });
  const started = await decide(db, vaultPath, taxonomy, options);
  const { decisions, addedTags, removedTags } = started;
  // 词库会被"AI 补叶子"改写，所以从这一份工作副本上推，最终交回调用方落库。
  let workingTaxonomy: TagTaxonomy = { ...taxonomy };

  const report: RetagReport = {
    vaultPath,
    totalNotes: decisions.length,
    written: 0,
    unchanged: 0,
    failed: decisions.filter((d) => d.mode === "unparsable").map((d) => ({ relPath: d.file.relPath, reason: d.reason ?? "无法解析" })),
    addedTags,
    removedTags,
    learnedTags: [],
    calls: 0,
    usage: emptyApiUsage(),
    taxonomy,
    taxonomyChanged: false,
  };

  const full = decisions.filter((d) => d.mode === "full");
  const incremental = decisions.filter((d) => d.mode === "incremental");
  const totalToJudge = full.length + incremental.length;

  if (full.length > 0) {
    emit({ stage: "classify", processed: 0, total: totalToJudge, message: `判定 ${full.length} 篇（全量）…` });
    const outcome = await classifyItems(aiConfig, full.map((note) => ({ key: note.file.relPath, features: note.features })), workingTaxonomy, {
      allowNewTags: options.allowNewTags,
      available: writableTags(workingTaxonomy),
      signal: options.signal,
    });
    report.calls += outcome.calls;
    report.usage = addApiUsage(report.usage, outcome.usage);
    report.failed.push(...outcome.failed.map((item) => ({ relPath: item.key, reason: item.reason })));
    workingTaxonomy = outcome.nextTaxonomy;
    report.learnedTags = [...outcome.learnedTags];
    for (const note of full) note.tagsOverride = mergeTopicTags(note, outcome.tagsById.get(note.file.relPath), workingTaxonomy, false);
  }

  if (incremental.length > 0) {
    // 增量只把「新增标签」放进可用标签：问题从"重新分类"收窄成"这些新标签适用吗"。
    const available = [...new Set([...incremental.flatMap((note) => note.candidateTags), ...report.learnedTags])];
    emit({ stage: "classify", processed: full.length, total: totalToJudge, message: `判定 ${incremental.length} 篇（仅新标签）…` });
    const outcome = await classifyItems(aiConfig, incremental.map((note) => ({ key: note.file.relPath, features: note.features })), workingTaxonomy, {
      allowNewTags: options.allowNewTags,
      available,
      signal: options.signal,
    });
    report.calls += outcome.calls;
    report.usage = addApiUsage(report.usage, outcome.usage);
    report.failed.push(...outcome.failed.map((item) => ({ relPath: item.key, reason: item.reason })));
    workingTaxonomy = outcome.nextTaxonomy;
    for (const tag of outcome.learnedTags) {
      if (!report.learnedTags.some((existing) => tagKey(existing) === tagKey(tag))) report.learnedTags.push(tag);
    }
    for (const note of incremental) note.tagsOverride = mergeTopicTags(note, outcome.tagsById.get(note.file.relPath), workingTaxonomy, true);
  }

  // 纯本地改写：删掉已从词库移除的标签。不调模型，所以对全库跑也不花钱。
  for (const note of decisions.filter((d) => d.mode === "cleanup")) {
    note.tagsOverride = mergeTopicTags(note, [], workingTaxonomy, true);
  }

  const toWrite = decisions.filter((d) => d.mode === "full" || d.mode === "incremental" || d.mode === "cleanup");
  let processed = 0;
  for (const note of toWrite) {
    processed += 1;
    if (note.tagsOverride === undefined) {
      report.unchanged += 1;
      continue;
    }
    const applied = upsertFrontMatterTags(note.file.content, note.tagsOverride);
    if (!applied.ok) {
      report.failed.push({ relPath: note.file.relPath, reason: applied.reason });
      continue;
    }
    try {
      if (applied.changed) {
        await writeFile(note.file.absPath, applied.content, "utf8");
        report.written += 1;
      } else {
        report.unchanged += 1;
      }
      // 指纹按**写入后**的内容算，否则下一轮会以为"内容变了"而重复判定。
      rememberNoteTags(db, vaultPath, note.file.relPath, applied.content, note.tagsOverride, workingTaxonomy);
    } catch (error) {
      report.failed.push({ relPath: note.file.relPath, reason: error instanceof Error ? error.message : String(error) });
    }
    emit({ stage: "write", processed, total: toWrite.length, message: `写入 ${processed}/${toWrite.length}` });
  }

  report.unchanged += decisions.filter((d) => d.mode === "skip").length;
  report.taxonomy = workingTaxonomy;
  report.taxonomyChanged = report.learnedTags.length > 0;
  // 快照记"这一轮用的词库"，下一轮靠它算增量。中断时不写，避免把没跑完的一轮当成基准。
  writeTaxonomySnapshot(db, workingTaxonomy);
  emit({ stage: "done", processed: toWrite.length, total: toWrite.length, message: `完成：写入 ${report.written} 篇，调用 ${report.calls} 次` });
  return report;
}
