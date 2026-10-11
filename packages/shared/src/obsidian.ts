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

/** 内置预设：给用户一个起点，而不是逼他凭空想字段名。 */
export const EXTRACT_FIELD_PRESETS: Array<{ id: string; label: string; fields: string[] }> = [
  { id: "history", label: "历史笔记", fields: ["人物", "事件", "时期"] },
  { id: "general", label: "通用", fields: ["人物", "机构", "概念"] },
  { id: "none", label: "不抽", fields: [] },
];

/** 字段名会被当成 YAML 键，上限按"够用且不失控"取。 */
export const MAX_EXTRACT_FIELDS = 8;

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
