/** 坚果云 WebDAV 相关设置与接口类型。 */

export interface NutstoreSettings {
  /** WebDAV 服务器地址，例如 https://dav.jianguoyun.com/dav/ */
  serverUrl: string;
  /** 坚果云账号（邮箱）。 */
  account: string;
  /** 是否已保存应用密码；密钥只存在服务端，读取接口不返回明文。 */
  hasPassword: boolean;
  /**
   * 备份目录。**填本地文件夹就走坚果云客户端同步（不需要账号密码），填云端路径就走 WebDAV 直连**——
   * 由路径形状自动判定，没有"模式开关"。这是刻意的：少一个开关就少一处能配错的地方。
   */
  backupDir: string;
  /** Obsidian 笔记云端目录，例如 /ScribeFlow/Obsidian（只有「Obsidian 直连云端」会用到）。 */
  obsidianRemotePath: string;
  /** 是否把 process.obsidian 节点的读写目标切到坚果云 WebDAV。 */
  obsidianMode: boolean;
}

/** 备份落点：本地文件夹 或 云端 WebDAV 路径。 */
export type BackupLocation = "local" | "remote";

/**
 * 判一个备份目录是本地还是云端。
 *
 * 依据是**形状**：Windows 盘符绝对路径（`D:\...`）或 UNC（`\\server\share`）算本地，
 * 其余（含 `/我的坚果云/...` 这种以 `/` 开头的云端路径）算云端。
 */
export function backupLocationOf(dir: string): BackupLocation {
  const value = dir.trim();
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") ? "local" : "remote";
}

/** 拼备份子路径：本地用 `\`、云端用 `/`，免得在 Windows 上混写。 */
export function joinBackupPath(base: string, child: string): string {
  const trimmed = base.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return child;
  return backupLocationOf(base) === "local" ? `${trimmed}\\${child}` : `${trimmed}/${child}`;
}

export type NutstoreEntryType = "folder" | "file";

export interface NutstoreListEntry {
  /** 逻辑远程路径，例如 /ScribeFlow/Obsidian/00-Inbox/笔记.md */
  path: string;
  name: string;
  type: NutstoreEntryType;
  size?: number;
  etag?: string;
  /** 毫秒时间戳。 */
  lastModified?: number;
}

export interface NutstoreListResult {
  path: string;
  items: NutstoreListEntry[];
  /** 坚果云单次 PROPFIND 约 750 条上限；达到上限时为 true，表示列表可能不完整。 */
  truncated: boolean;
}

export interface NutstoreTestResult {
  ok: true;
  serverUrl: string;
  account: string;
  remotePath: string;
  webdav: string;
}

export interface NutstoreReadResult {
  path: string;
  name: string;
  content: string;
  size: number;
  etag?: string;
  lastModified?: number;
}

export type NutstoreSyncDirection = "push" | "pull";

export interface NutstoreSyncResult {
  direction: NutstoreSyncDirection;
  localRoot: string;
  remotePath: string;
  /** 实际写入/下载成功的 .md 数量。 */
  transferred: number;
  /** 因远端较新/本地较新而未覆盖的冲突/跳过数量。 */
  skipped: number;
  /** 被跳过/冲突的明细，便于设置页展示。 */
  skippedItems?: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; message: string }>;
}

export interface NutstoreBackupItem {
  path: string;
  name: string;
  size?: number;
  lastModified?: number;
}

export interface NutstoreBackupResult {
  /** 这次备份落在哪：本地文件夹路径，或云端逻辑路径。 */
  dir: string;
  /** 落点是本地还是云端。 */
  location: BackupLocation;
  files: string[];
  uploadedAt: number;
}

export interface NutstoreRestoreResult {
  ok: true;
  /** 恢复前自动备份当前库时生成的目录（后悔药）。 */
  autoBackupPath: string;
  /** 被恢复的备份目录。 */
  restoredPath: string;
  restoredAt: number;
  /** 参与整库热替换的数据表。 */
  tables: string[];
}
