import { parseDrillSet, type DrillDrop, type DrillSet } from "@scribe-flow/shared";

/**
 * 知识巩固节点辅助：解析 LLM 返回的练习集、汇总丢弃明细、生成节点摘要。
 * 与 lib/mindmap.ts 同一定位：只做纯计算，不依赖数据库与网络，便于单测。
 */

export interface BuiltDrill {
  set: DrillSet | null;
  drops: DrillDrop[];
  /** 节点卡片/运行详情展示的摘要，形如「8 个考察点 · 8 题 · 6 条延伸 · 丢弃 2（引文未命中原文）」。 */
  summary: string;
  /** 丢弃明细的一行文本，写进运行日志便于排查。 */
  dropDetail: string;
  /** 整体不可用时的中文原因。 */
  error?: string;
}

/**
 * 把模型输出编译成可用的练习集。
 *
 * @param raw        模型原始输出（步骤链末端产物）
 * @param sourceText 本次输入原文，用于引文命中校验
 * @param options    withExtensions=false 时确定性剔除延伸问题（不依赖模型自觉）
 */
export function buildDrill(
  raw: string,
  sourceText: string,
  options: { withExtensions?: boolean } = {},
): BuiltDrill {
  const { set, drops, error } = parseDrillSet(raw, sourceText);
  const withExtensions = options.withExtensions !== false;
  const normalized: DrillSet | null = set && !withExtensions ? { ...set, extensions: [] } : set;

  if (!normalized) {
    return {
      set: null,
      drops,
      summary: "",
      dropDetail: "",
      error: error ?? (drops.length > 0 ? `生成的题目全部未通过校验：${describeDrops(drops)}` : "没有生成可用的练习题，请重跑本节点"),
    };
  }

  return {
    set: normalized,
    drops,
    summary: summarizeDrill(normalized, drops),
    dropDetail: describeDrops(drops),
  };
}

/** 节点摘要：把丢弃情况显式暴露在卡片上，丢弃率本身就是题目质量的健康指标。 */
export function summarizeDrill(set: DrillSet, drops: DrillDrop[]): string {
  const base = `${set.points.length} 个考察点 · ${set.items.length} 题 · ${set.extensions.length} 条延伸`;
  if (drops.length === 0) return base;
  return `${base} · 丢弃 ${drops.length}（${dropReasons(drops)}）`;
}

/** 丢弃原因去重后按频次排序，最多取 2 类，避免摘要过长。 */
export function dropReasons(drops: DrillDrop[]): string {
  const counts = new Map<string, number>();
  for (const drop of drops) counts.set(drop.reason, (counts.get(drop.reason) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason, count]) => (count > 1 ? `${reason} ×${count}` : reason))
    .join("、");
}

/** 逐条丢弃明细（含位置），写进运行日志。 */
export function describeDrops(drops: DrillDrop[]): string {
  return drops.map((drop) => `${drop.where}：${drop.reason}`).join("；");
}

/** 按节点参数生成注入配方的「出题要求」文本。 */
export function buildDrillParams(data: Record<string, unknown>): string {
  const pointCount = clampInt(data.pointCount, 3, 12, 6);
  const kinds = normalizeKinds(data.kinds);
  const difficulty = labelDifficulty(String(data.difficulty ?? "medium"));
  const withExtensions = data.withExtensions !== false;
  const focus = String(data.focus ?? "").trim();

  const lines = [
    "【出题要求】",
    `考察点数量：不超过 ${pointCount} 个`,
    `题型：${kinds.map((kind) => KIND_LABELS[kind]).join("、")}`,
    `难度：${difficulty}`,
    `输出延伸问题：${withExtensions ? "是" : "否"}`,
  ];
  if (focus) lines.push(`考察侧重：${focus}`);
  return lines.join("\n");
}

const KIND_LABELS: Record<string, string> = {
  single: "单选",
  multi: "多选",
  judge: "判断",
  cloze: "填空",
};

const DEFAULT_KINDS = ["single", "judge", "cloze"];

function normalizeKinds(value: unknown): string[] {
  const list = Array.isArray(value) ? value.map((item) => String(item)) : [];
  const filtered = list.filter((kind) => kind in KIND_LABELS);
  return filtered.length > 0 ? [...new Set(filtered)] : DEFAULT_KINDS;
}

function labelDifficulty(value: string): string {
  if (value === "basic") return "基础（面向完全没接触过该主题的人）";
  if (value === "hard") return "挑战（需要推理或多点结合才能答对）";
  return "适中（理解原文即可答对）";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}
