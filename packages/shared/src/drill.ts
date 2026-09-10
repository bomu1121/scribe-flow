/**
 * 知识巩固节点（process.drill「练一练」）的产物契约。
 *
 * 产物是一份「练习集」JSON：知识点（points）+ 检验题（items）+ 延伸问题（extensions）。
 * JSON 直接由结果页答题视图消费；Markdown 是导出/下游用的副产品。
 *
 * 本文件只做纯计算（解析、校验、判分、序列化），不依赖 Node 内置以外的任何能力，便于单测。
 * 校验策略（重要）：**逐条丢弃而不是整体失败**——8 题里丢 1 题不影响另外 7 题；
 * 丢弃明细经 drops 返回，由调用方汇总进节点摘要，丢弃率本身就是题目质量的健康指标。
 * 机械校验（引文逐字命中）在配方断言门里也会做一遍；这里做的是结构层兜底。
 */

export const DRILL_KINDS = ["single", "multi", "judge", "cloze"] as const;
export type DrillKind = (typeof DRILL_KINDS)[number];

export const DRILL_DIFFICULTIES = ["basic", "medium", "hard"] as const;
export type DrillDifficulty = (typeof DRILL_DIFFICULTIES)[number];

export const DRILL_POINT_TYPES = ["concept", "fact", "causal", "method", "claim", "boundary"] as const;
export type DrillPointType = (typeof DRILL_POINT_TYPES)[number];

export const DRILL_KIND_LABELS: Record<DrillKind, string> = {
  single: "单选",
  multi: "多选",
  judge: "判断",
  cloze: "填空",
};

export const DRILL_POINT_TYPE_LABELS: Record<DrillPointType, string> = {
  concept: "概念",
  fact: "事实",
  causal: "因果",
  method: "方法",
  claim: "观点",
  boundary: "边界条件",
};

/** 判断题固定选项，避免模型自造「对/错」「是/否」导致判分不可控。 */
export const JUDGE_OPTIONS = ["正确", "错误"] as const;

/** 一个可考察的知识点。 */
export interface DrillPoint {
  id: string;
  /** 知识点名称，≤20 字，可直接展示。 */
  name: string;
  type: DrillPointType;
  /** 一句话说清，≤60 字。 */
  gist: string;
  /** 为什么值得考（易混 / 是后续理解的前提 / 反直觉结论）。 */
  worthTesting?: string;
  /** 逐字摘自原文的一句，用于防幻觉与「看原文」。 */
  sourceQuote?: string;
}

/** 一道检验题。 */
export interface DrillItem {
  id: string;
  pointId: string;
  kind: DrillKind;
  difficulty?: DrillDifficulty;
  stem: string;
  /** judge 固定 ["正确","错误"]；cloze 恒为空数组；single/multi 为 3-5 个选项。 */
  options: string[];
  /** 客观题：options 的子集；cloze：填空答案原文。 */
  answer: string[];
  explanation?: string;
  sourceQuote?: string;
}

/** 「再想一步」延伸问题：不给答案，只给脚手架与方向。 */
export interface DrillExtension {
  pointId: string;
  question: string;
  hint?: string;
  angle?: string;
}

export interface DrillSet {
  schema: 1;
  /** 下游序列化兜底用的类型标记（见 maybeDrillToMarkdown）。 */
  kind: "drillSet";
  title?: string;
  points: DrillPoint[];
  items: DrillItem[];
  extensions: DrillExtension[];
}

/** 一条被丢弃的条目及原因；reason 直接用于节点摘要与排查。 */
export interface DrillDrop {
  where: string;
  reason: string;
}

export interface ParsedDrill {
  /** 结构完全不可用（JSON 非法 / 无有效题目）时为 null。 */
  set: DrillSet | null;
  drops: DrillDrop[];
  /** 整体失败原因（面向用户的中文）；逐条丢弃时为 undefined。 */
  error?: string;
}

const MAX_POINTS = 12;
const MAX_ITEMS = 20;
const MAX_TITLE = 60;
const MIN_OPTIONS = 3;
const MAX_OPTIONS = 5;
/** 题干泄漏检查的最短答案长度：太短的答案（如「正确」）出现在题干里不算泄漏。 */
const LEAK_MIN_LEN = 4;

/**
 * 比对用归一化：全角转半角 → 去 Markdown 强调符 → 去所有空白 → 转小写。
 * 用于引文命中判断与选项/答案比对（行宽、强调符、全角差异不应导致误判）。
 */
export function normalizeForMatch(text: string): string {
  return foldFullWidth(String(text ?? ""))
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 填空判分用归一化：在比对归一化基础上再忽略标点差异。 */
export function normalizeClozeAnswer(text: string): string {
  return normalizeForMatch(text).replace(/[，。、；：！？·—…,.;:!?'"“”‘’()（）《》〈〉【】\[\]{}]/g, "");
}

function foldFullWidth(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0x3000) {
      out += " ";
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += char;
    }
  }
  return out;
}

/** 宽松提取 JSON 对象：裸 JSON → 去 Markdown 围栏 → 截取首尾大括号。 */
function extractJsonObject(raw: string): unknown {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("练习产物为空");
  try {
    return JSON.parse(text);
  } catch {
    // 继续尝试
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    // 继续尝试
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // 落到统一报错
    }
  }
  throw new Error("练习产物不是有效 JSON");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function describeError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message.trim() : "";
  return message || fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** 引文是否能在原文中逐字命中（经归一化比对）。 */
function quoteInSource(quote: string, normalizedSource: string): boolean {
  if (!normalizedSource) return true;
  const normalizedQuote = normalizeForMatch(quote);
  if (!normalizedQuote) return false;
  return normalizedSource.includes(normalizedQuote);
}

interface PointDraft {
  point: DrillPoint;
}

interface ItemDraft {
  item: DrillItem;
}

interface ExtensionDraft {
  extension: DrillExtension;
}

/**
 * 解析 LLM 返回的练习集产物：结构校验 → 逐条丢弃 → 返回可用产物与丢弃明细。
 *
 * @param raw        LLM 原始输出（容忍 ```json 围栏与前后废话）
 * @param sourceText 生成时依据的原文；用于引文命中校验。结果页二次解析时传空串跳过校验。
 */
export function parseDrillSet(raw: string, sourceText = ""): ParsedDrill {
  const drops: DrillDrop[] = [];
  const normalizedSource = normalizeForMatch(sourceText);

  let root: Record<string, unknown> | null = null;
  try {
    root = asRecord(extractJsonObject(raw));
  } catch (err) {
    return { set: null, drops, error: describeError(err, "练习产物解析失败") };
  }
  if (!root) {
    return { set: null, drops, error: "练习产物不是有效的 JSON 对象" };
  }

  let points: PointDraft[];
  let items: ItemDraft[];
  let extensions: ExtensionDraft[];
  try {
    points = collectPoints(root, normalizedSource, drops);
    const pointIds = new Set(points.map((entry) => entry.point.id));
    items = collectItems(root, pointIds, normalizedSource, drops);
    extensions = collectExtensions(root, pointIds, drops);
  } catch (err) {
    return { set: null, drops, error: describeError(err, "练习产物结构不完整") };
  }

  // 没有检验题的知识点不该出现在产物里：连带它的延伸问题一起丢弃。
  const usedPointIds = new Set(items.map((entry) => entry.item.pointId));
  const keptPoints = points.filter((entry) => usedPointIds.has(entry.point.id));
  for (const entry of points) {
    if (!usedPointIds.has(entry.point.id)) {
      drops.push({ where: `知识点「${entry.point.name}」`, reason: "该知识点没有通过校验的题目" });
    }
  }
  const keptExtensions = extensions.filter((entry) => usedPointIds.has(entry.extension.pointId));
  for (const entry of extensions) {
    if (!usedPointIds.has(entry.extension.pointId)) {
      drops.push({ where: "延伸问题", reason: "引用的知识点已被丢弃" });
    }
  }

  if (items.length === 0) {
    return { set: null, drops };
  }

  const title = clip(asText(root.title), MAX_TITLE) || undefined;
  return {
    set: {
      schema: 1,
      kind: "drillSet",
      title,
      points: keptPoints.map((entry) => entry.point),
      items: items.map((entry) => entry.item),
      extensions: keptExtensions.map((entry) => entry.extension),
    },
    drops,
  };
}

function collectPoints(root: Record<string, unknown>, normalizedSource: string, drops: DrillDrop[]): PointDraft[] {
  const raw = asArray(root.points);
  if (raw.length === 0) {
    throw new Error("练习产物缺少知识点（points）");
  }
  const out: PointDraft[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (out.length >= MAX_POINTS) {
      drops.push({ where: `知识点 #${index + 1}`, reason: `超出考察点数量上限（${MAX_POINTS}）` });
      continue;
    }
    const record = asRecord(raw[index]);
    if (!record) {
      drops.push({ where: `知识点 #${index + 1}`, reason: "字段结构不是对象" });
      continue;
    }
    const name = clip(asText(record.name ?? record.title), 40);
    if (!name) {
      drops.push({ where: `知识点 #${index + 1}`, reason: "缺少知识点名称" });
      continue;
    }
    const sourceQuote = asText(record.sourceQuote ?? record.quote);
    if (!sourceQuote) {
      drops.push({ where: `知识点「${name}」`, reason: "缺少原文依据" });
      continue;
    }
    if (!quoteInSource(sourceQuote, normalizedSource)) {
      drops.push({ where: `知识点「${name}」`, reason: "引文未命中原文" });
      continue;
    }
    out.push({
      point: {
        id: asText(record.id) || `p${out.length + 1}`,
        name,
        type: oneOf(asText(record.type), DRILL_POINT_TYPES, "concept"),
        gist: clip(asText(record.gist) || name, 120),
        worthTesting: asText(record.worthTesting) || undefined,
        sourceQuote,
      },
    });
  }
  if (out.length === 0) {
    throw new Error("练习产物没有可用的知识点");
  }
  return out;
}

function collectItems(
  root: Record<string, unknown>,
  pointIds: Set<string>,
  normalizedSource: string,
  drops: DrillDrop[],
): ItemDraft[] {
  const raw = asArray(root.items);
  const out: ItemDraft[] = [];
  const seenStems = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const label = `第 ${index + 1} 题`;
    if (out.length >= MAX_ITEMS) {
      drops.push({ where: label, reason: `超出题目数量上限（${MAX_ITEMS}）` });
      continue;
    }
    const record = asRecord(raw[index]);
    if (!record) {
      drops.push({ where: label, reason: "字段结构不是对象" });
      continue;
    }
    const kindRaw = asText(record.kind);
    if (!(DRILL_KINDS as readonly string[]).includes(kindRaw)) {
      drops.push({ where: label, reason: `题型不支持：${kindRaw || "空"}` });
      continue;
    }
    const kind = kindRaw as DrillKind;
    const pointId = asText(record.pointId);
    if (!pointId || !pointIds.has(pointId)) {
      drops.push({ where: label, reason: "引用了不存在的知识点" });
      continue;
    }
    const stem = asText(record.stem ?? record.question);
    if (!stem) {
      drops.push({ where: label, reason: "缺少题干" });
      continue;
    }
    const stemKey = normalizeForMatch(stem);
    if (seenStems.has(stemKey)) {
      drops.push({ where: label, reason: "重复题目" });
      continue;
    }
    const sourceQuote = asText(record.sourceQuote ?? record.quote);
    if (!sourceQuote) {
      drops.push({ where: label, reason: "缺少原文依据" });
      continue;
    }
    if (!quoteInSource(sourceQuote, normalizedSource)) {
      drops.push({ where: label, reason: "引文未命中原文" });
      continue;
    }

    const options = asArray(record.options).map((option) => asText(option)).filter(Boolean);
    const rawAnswers = asArray(record.answer).map((answer) => asText(answer)).filter(Boolean);
    const normalized = normalizeItemAnswer(kind, options, rawAnswers);
    if (!normalized) {
      drops.push({ where: label, reason: "答案与选项不匹配" });
      continue;
    }
    if (normalized.options.length > 0) {
      const leaked = normalized.answer.some((answer) => {
        const key = normalizeForMatch(answer);
        return key.length >= LEAK_MIN_LEN && stemKey.includes(key);
      });
      if (leaked) {
        drops.push({ where: label, reason: "题干泄漏答案" });
        continue;
      }
    }

    seenStems.add(stemKey);
    out.push({
      item: {
        id: asText(record.id) || `q${out.length + 1}`,
        pointId,
        kind,
        difficulty: DRILL_DIFFICULTIES.includes(asText(record.difficulty) as DrillDifficulty)
          ? (asText(record.difficulty) as DrillDifficulty)
          : undefined,
        stem,
        options: normalized.options,
        answer: normalized.answer,
        explanation: asText(record.explanation) || undefined,
        sourceQuote,
      },
    });
  }
  return out;
}

function normalizeItemAnswer(
  kind: DrillKind,
  options: string[],
  answers: string[],
): { options: string[]; answer: string[] } | null {
  if (kind === "cloze") {
    return answers.length > 0 ? { options: [], answer: answers } : null;
  }
  if (kind === "judge") {
    // 模型可能自造「对/错」「是/否」：统一归一到固定选项，answer 按位置或语义映射。
    const raw = answers[0] ?? "";
    const mapped = mapJudgeAnswer(raw, options);
    return mapped ? { options: [...JUDGE_OPTIONS], answer: [mapped] } : null;
  }
  const unique = dedupeOptions(options);
  if (unique.length < MIN_OPTIONS || unique.length > MAX_OPTIONS) return null;
  const picked: string[] = [];
  for (const answer of answers) {
    const matched = unique.find((option) => normalizeForMatch(option) === normalizeForMatch(answer));
    if (!matched) return null;
    if (!picked.includes(matched)) picked.push(matched);
  }
  if (picked.length === 0) return null;
  if (kind === "single" && picked.length > 1) return null;
  return { options: unique, answer: picked };
}

function dedupeOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const option of options) {
    const key = normalizeForMatch(option);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(option);
  }
  return out;
}

function mapJudgeAnswer(raw: string, options: string[]): "正确" | "错误" | null {
  const key = normalizeForMatch(raw);
  if (!key) return null;
  if (options.length === 2) {
    if (key === normalizeForMatch(options[0])) return "正确";
    if (key === normalizeForMatch(options[1])) return "错误";
  }
  if (["正确", "对", "是", "true", "yes", "t", "√", "对的"].includes(key)) return "正确";
  if (["错误", "错", "否", "false", "no", "f", "×", "x", "错的"].includes(key)) return "错误";
  return null;
}

function collectExtensions(
  root: Record<string, unknown>,
  pointIds: Set<string>,
  drops: DrillDrop[],
): ExtensionDraft[] {
  const raw = asArray(root.extensions);
  const out: ExtensionDraft[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const record = asRecord(raw[index]);
    const question = asText(record?.question);
    if (!record || !question) {
      drops.push({ where: `延伸问题 #${index + 1}`, reason: "缺少问题内容" });
      continue;
    }
    const pointId = asText(record.pointId);
    if (!pointId || !pointIds.has(pointId)) {
      drops.push({ where: "延伸问题", reason: "引用了不存在的知识点" });
      continue;
    }
    out.push({
      extension: {
        pointId,
        question,
        hint: asText(record.hint) || undefined,
        angle: asText(record.angle) || undefined,
      },
    });
  }
  return out;
}

export interface GradeResult {
  correct: boolean;
  /** 多选少选/多选时的中文提示，例如「你少选了 B」。 */
  note?: string;
}

/** 客观题本地判分：零成本、零延迟、可离线重做。 */
export function gradeObjective(item: DrillItem, userAnswer: string[]): GradeResult {
  const picked = (userAnswer ?? []).map((answer) => answer.trim()).filter(Boolean);
  if (picked.length === 0) return { correct: false };

  if (item.kind === "cloze") {
    const expected = item.answer[0] ?? "";
    const correct = picked.some((answer) => normalizeClozeAnswer(answer) === normalizeClozeAnswer(expected));
    return { correct };
  }

  if (item.kind === "single" || item.kind === "judge") {
    const expected = item.answer[0] ?? "";
    return { correct: normalizeForMatch(picked[0]) === normalizeForMatch(expected) };
  }

  const expectedKeys = item.answer.map((answer) => normalizeForMatch(answer));
  const pickedKeys = picked.map((answer) => normalizeForMatch(answer));
  const missing = item.answer.filter((answer) => !pickedKeys.includes(normalizeForMatch(answer)));
  const extra = picked.filter((answer) => !expectedKeys.includes(normalizeForMatch(answer)));
  if (missing.length === 0 && extra.length === 0) return { correct: true };
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`你少选了 ${missing.join("、")}`);
  if (extra.length > 0) parts.push(`你多选了 ${extra.join("、")}`);
  return { correct: false, note: parts.join("；") };
}

/** 导出/下游用：把练习集序列化为可读 Markdown（含题目、答案、解析、原文依据、延伸）。 */
export function drillSetToMarkdown(set: DrillSet): string {
  const lines: string[] = [];
  lines.push(`# ${set.title?.trim() || "知识巩固"}`);
  lines.push("");
  lines.push(
    `共 ${set.points.length} 个考察点 · ${set.items.length} 道题 · ${set.extensions.length} 条延伸`,
  );

  if (set.points.length > 0) {
    lines.push("");
    lines.push("## 考察点");
    lines.push("");
    set.points.forEach((point, index) => {
      lines.push(`${index + 1}. **${point.name}**（${DRILL_POINT_TYPE_LABELS[point.type]}）—— ${point.gist}`);
      if (point.sourceQuote) lines.push(`   > ${escapeQuote(point.sourceQuote)}`);
    });
  }

  if (set.items.length > 0) {
    lines.push("");
    lines.push("## 练习题");
    set.items.forEach((item, index) => {
      const point = set.points.find((entry) => entry.id === item.pointId);
      lines.push("");
      lines.push(`### Q${index + 1}（${DRILL_KIND_LABELS[item.kind]}）${point ? `考察点：${point.name}` : ""}`);
      lines.push("");
      lines.push(item.stem);
      if (item.options.length > 0) {
        lines.push("");
        item.options.forEach((option) => lines.push(`- ${option}`));
      }
      lines.push("");
      lines.push(`**答案**：${item.answer.join("、")}`);
      if (item.explanation) lines.push(`**解析**：${item.explanation}`);
      if (item.sourceQuote) lines.push(`**原文依据**：> ${escapeQuote(item.sourceQuote)}`);
    });
  }

  if (set.extensions.length > 0) {
    lines.push("");
    lines.push("## 再想一步");
    lines.push("");
    set.extensions.forEach((extension, index) => {
      const point = set.points.find((entry) => entry.id === extension.pointId);
      lines.push(`${index + 1}. ${extension.question}${point ? `（${point.name}）` : ""}`);
      if (extension.hint) lines.push(`   - 提示：${extension.hint}`);
      if (extension.angle) lines.push(`   - 方向：${extension.angle}`);
    });
  }

  return lines.join("\n").trimEnd() + "\n";
}

function escapeQuote(text: string): string {
  return text.replace(/\n+/g, " ").trim();
}

/**
 * 下游序列化兜底：文本是 drillSet 产物时转成 Markdown，否则原样返回。
 * 用于 process.merge / process.output，避免原始 JSON 混进笔记文档。
 */
export function maybeDrillToMarkdown(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("{")) return text;
  try {
    const probe = asRecord(JSON.parse(trimmed));
    if (!probe || probe.kind !== "drillSet") return text;
  } catch {
    return text;
  }
  const { set } = parseDrillSet(trimmed, "");
  return set ? drillSetToMarkdown(set) : text;
}
