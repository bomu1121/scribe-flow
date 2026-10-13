/**
 * Obsidian 库面向界面的共享类型。
 *
 * 这一页要回答用户三个问题——**存到哪、能不能存、以后怎么找回来**——所以需要一份
 * 「库自检结果」，而不是又一组输入框。检查是完全本地的（数文件、看权限），不联网、不花钱。
 */

/** Obsidian 库的自检结果。 */
export interface ObsidianVaultCheck {
  /** 用户填的原始路径。 */
  input: string;
  /** 解析后的绝对路径。 */
  resolved: string;
  exists: boolean;
  isDirectory: boolean;
  /** 库里的 `.md` 篇数。 */
  noteCount: number;
  /** 为真表示只数到上限就停了，`noteCount` 是下限。 */
  noteCountCapped: boolean;
  /** 笔记实际落到的完整路径（库 + 保存文件夹）。 */
  targetDir: string;
  /** 目标文件夹所在处可写（不可写则运行到该节点会失败）。 */
  writable: boolean;
  /** 库是否落在坚果云客户端的同步文件夹里；`nutstore` 表示客户端会自动上云。 */
  syncFolder: "nutstore" | "unknown";
  /** 库是否落在应用自己的数据目录里（异常配置，值得提醒）。 */
  insideDataDir: boolean;
  /** 有问题时的一句话结论，可直接展示；没问题时为空。 */
  problem?: string;
}

/** `GET /api/settings/obsidian/folders` 的响应。 */
export interface ObsidianFoldersResult {
  items: string[];
}

/**
 * 词库编辑器的显示样式。三种都由用户自己挑（设置页顶部一个三选一）。
 *
 * 这是**纯展示层**的选择：不改任何数据、不影响落盘，只决定那一块怎么画。
 */
export type TagViewMode = "color" | "plain" | "list";

export const TAG_VIEW_MODES: Array<{ id: TagViewMode; label: string; hint: string }> = [
  { id: "color", label: "彩色标记", hint: "一级一个色相：色点 + 淡底，二级继承；一眼看出分组" },
  { id: "plain", label: "单色", hint: "不上色，靠字重、缩进与留白分层" },
  { id: "list", label: "清单", hint: "一行一个标签，带用量条——标签多的时候最好扫" },
];

/**
 * 默认显示样式。**单色**：仓库整体的克制风格本来就是一档灰，彩色标记是给"想一眼看出分组"的人
 * 额外准备的可选项（用户在看完第一版后把默认从 `color` 改成了 `plain`）。
 */
export const DEFAULT_TAG_VIEW: TagViewMode = "plain";

/**
 * 一级分组可用的色相。**只有 5 个**：仓库调色板里 `brand` 与 `info` 都是蓝，
 * 按顺序取会撞色——第一版原型里「来源」和「概念」看起来一模一样，是看图才发现并改掉的。
 * 第 6 个起回落中性灰。
 */
export const TAG_GROUP_TONES = [
  { dot: "var(--color-brand)", soft: "var(--color-brand-soft)" },
  { dot: "var(--color-accent-indigo)", soft: "var(--color-accent-indigo-soft)" },
  { dot: "var(--color-success)", soft: "var(--color-success-soft)" },
  { dot: "var(--color-warning)", soft: "var(--color-warning-soft)" },
  { dot: "var(--color-accent-pink)", soft: "var(--color-accent-pink-soft)" },
] as const;

/** 中性色：色相用完时用，**自动维护的分组固定用它**（它由入库时自动写，不该和人维护的一样有声有色）。 */
export const NEUTRAL_TAG_TONE = { dot: "var(--color-text-tertiary)", soft: "var(--color-surface-muted)" } as const;

/** 第 `index` 个一级分组用哪个色相；超出色相表就回落中性。 */
export function tagGroupTone(index: number): { dot: string; soft: string } {
  return index >= 0 && index < TAG_GROUP_TONES.length ? TAG_GROUP_TONES[index] : NEUTRAL_TAG_TONE;
}

/** 一个标签在库里被多少篇笔记用过。 */
export interface ObsidianTagUsage {
  /** 完整标签名，形如 `来源/B站`（一级也是标签，可能没有 `/`）。 */
  tag: string;
  count: number;
}

/**
 * `GET /api/settings/obsidian/tags` 的响应。
 *
 * 「用了多少篇」是判断"这个标签该不该删"的唯一依据：库是空的或某个标签一篇都没用过，
 * 才敢动它。与属性名那份统计同一套口径（本地扫 front matter 与正文，不花钱），到上限会说 `capped`。
 */
export interface ObsidianTagUsageResult {
  items: ObsidianTagUsage[];
  scanned: number;
  capped: boolean;
}

/** 库里出现过的一个属性名，以及有多少篇笔记用它。 */
export interface ObsidianFieldSuggestion {
  name: string;
  count: number;
}

/**
 * `GET /api/settings/obsidian/fields` 的响应。
 *
 * `scanned` 是实际读过的篇数，`capped` 为真表示到上限就停了——统计是**下限**，界面要说清这一点，
 * 不然用户会以为"库里就这么几个属性名"。
 */
export interface ObsidianFieldsResult {
  items: ObsidianFieldSuggestion[];
  scanned: number;
  capped: boolean;
}

/**
 * 「从正文抽取额外属性」的字段名。
 *
 * 这不是历史笔记专用功能——它是**用户可配**的：AI 会把这些字段名当成笔记属性名，
 * 把正文里对应的东西抽出来写进 front matter。历史类笔记用「人物 / 事件 / 时期」，
 * 换成「人物 / 机构 / 概念」或你自己的任意词都行；留空就是不抽。
 *
 * 早先这一组是**写死在引擎里**的——那时的场景只有历史笔记，所以「人物 / 事件 / 时期」
 * 看起来像个通用功能，对别的门类却莫名其妙。现在它只是默认值 + 一份预设。
 */
export const DEFAULT_EXTRACT_FIELDS = ["人物", "事件", "时期"];

/**
 * 「常用属性名」建议：不是预设、不改变任何状态，只是**下拉里可点的名字**。
 *
 * 与「抽取哪些属性」的建议列表分工：库里有过的名字排前面（那是用户自己的用词习惯），
 * 这一组兜底给第一次用的人一个起点——纯自由填写等于让人凭空想字段名，这是 Stripe metadata
 * 那种"零预设"设计最明确的短板。先后顺序按"越通用越靠前"，历史/事件类的放最后。
 */
export const COMMON_EXTRACT_FIELDS = ["概念", "机构", "地点", "作品", "关键词", "主题", "人物", "事件", "时期"];

/**
 * 「常用组合」：一键把字段列表换成某一组。
 *
 * **标签说的是"套用后会得到什么"，不是"这套是给哪种笔记用的"。** 早先这一组叫
 * 「历史笔记 / 通用 / 不抽」，而第一项又恰好等于产品默认值——于是这个功能看起来像"历史笔记专用"，
 * 用户也确实是这么反馈的。现在标签直接列出字段名，默认值也不再由界面高亮成"当前用的是哪套"。
 */
export const EXTRACT_FIELD_PRESETS: Array<{ id: string; label: string; fields: string[] }> = [
  { id: "history", label: "人物 · 事件 · 时期", fields: ["人物", "事件", "时期"] },
  { id: "general", label: "人物 · 机构 · 概念", fields: ["人物", "机构", "概念"] },
  { id: "none", label: "清空", fields: [] },
];

/** 字段名会被当成 YAML 键，上限按"够用且不失控"取。 */
export const MAX_EXTRACT_FIELDS = 8;

/**
 * 「相关笔记」那一段的标题。
 *
 * 服务端按它写进笔记、界面按它做预览与说明，两处必须是同一个字符串：标题一旦对不上，
 * 回补时就认不出自己上次写的那一段，结果每回补一次就多叠一段。
 */
export const RELATED_SECTION_TITLE = "相关笔记";

/** 回补时一篇笔记会怎么变。 */
export type RelatedNoteMode = "add" | "update" | "remove";

/**
 * 相关笔记回补的预估。**不调模型、不花钱**——这一步只读库、算判定，成本是 IO。
 * 与重打标的预估（`RetagPlanView`）分开是因为两者代价差一个量级：那边要点"发车"才付钱，
 * 这边可以随手点。界面因此也不必做得一样重。
 */
export interface RelatedPlanView {
  vaultPath: string;
  totalNotes: number;
  /** 会被写入/改写的篇数（新增、更新，或删掉已不成立的那一段）。 */
  willUpdate: number;
  unchanged: number;
  /** 库里没有任何可比属性的篇数：它们补不出链接，原有的也会被清掉。 */
  noFields: number;
  /** 这一轮会写出多少条 `[[链接]]`（新写的与保留的两者之和）。 */
  plannedLinks: number;
  samples: { relPath: string; mode: RelatedNoteMode; relatedCount: number }[];
}

export interface RelatedReportView {
  totalNotes: number;
  /** 实际回写的篇数。 */
  written: number;
  unchanged: number;
  failed: { relPath: string; reason: string }[];
  /** 最终落在库里的链接总数。 */
  linksWritten: number;
}

export type RelatedJobStatus = "running" | "done" | "error";

/**
 * 相关笔记回补任务。与重打标一样没有 SSE 通道，界面按 jobId 轮询——
 * 仓库里 `RunEvent` 是运行专用的，为一个本地任务新开事件流不划算。
 */
export interface RelatedJobView {
  id: string;
  status: RelatedJobStatus;
  stage: "scan" | "write" | "done";
  processed: number;
  total: number;
  message: string;
  error?: string;
  /** 只有 status 为 done 时才有。 */
  report?: RelatedReportView;
}

/**
 * 收敛用户/接口传来的字段名：去空白、丢掉会破坏 YAML 键的字符、去重、限个数。
 * 坏数据不该让入库整条链路失败，所以这里只做过滤，不抛错。
 */
export function sanitizeExtractFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const name = String(item ?? "")
      .replace(/[:#\r\n\t]/g, "")
      .trim()
      .slice(0, 12);
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_EXTRACT_FIELDS) break;
  }
  return out;
}
