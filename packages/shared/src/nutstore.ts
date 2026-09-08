/** 坚果云 WebDAV 相关设置与接口类型。 */

export interface NutstoreSettings {
  /** WebDAV 服务器地址，例如 https://dav.jianguoyun.com/dav/ */
  serverUrl: string;
  /** 坚果云账号（邮箱）。 */
  account: string;
  /** 是否已保存应用密码；密钥只存在服务端，读取接口不返回明文。 */
  hasPassword: boolean;
  /** 本应用数据备份/同步根目录，例如 /ScribeFlow */
  remoteRoot: string;
  /** Obsidian 笔记云端目录，例如 /ScribeFlow/Obsidian */
  obsidianRemotePath: string;
  /** 是否把 process.obsidian 节点的读写目标切到坚果云 WebDAV。 */
  obsidianMode: boolean;
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
  remotePath: string;
  files: string[];
  uploadedAt: number;
}

export interface NutstoreRestoreResult {
  ok: true;
  /** 恢复前自动备份当前库时生成的云端目录（后悔药）。 */
  autoBackupPath: string;
  /** 被恢复的云端备份目录。 */
  remotePath: string;
  restoredAt: number;
  /** 参与整库热替换的数据表。 */
  tables: string[];
}
