/**
 * 本地数据目录的占用账本与可回收空间（设置页「数据与工程」）。
 * 扫描口径与清理口径是同一份数据：界面显示的每一项都必须带「数量 + 能释放多少字节」。
 */

/** 账本分区：数据目录下各自独立计量的区域。 */
export type StorageAreaKey = "database" | "media" | "uploads" | "runs" | "outputs" | "graphBackups";

export interface StorageArea {
  key: StorageAreaKey;
  label: string;
  files: number;
  bytes: number;
  /** 目录尚未创建时为 false，界面显示「尚未产生」而不是「0 字节」。 */
  present: boolean;
}

/** 可回收项标识。 */
export const PRUNE_TARGETS = ["runs", "orphanMedia", "uploadOrphans", "orphanDirs", "graphBackups"] as const;

export type PruneTarget = (typeof PRUNE_TARGETS)[number];

export interface PruneItem {
  target: PruneTarget;
  label: string;
  /** 判定规则原文，界面照抄展示：清理只有说清规则才不是黑箱。 */
  rule: string;
  /** 待清理项数（运行条数 / 资产个数 / 目录个数 / 文件个数）。 */
  count: number;
  /** 预期释放字节数。 */
  bytes: number;
}

export interface ProjectUsage {
  id: string;
  name: string;
  runCount: number;
  /** 该工程全部运行记录对应的产物与中间文件占用；删掉这些运行记录即可回收。 */
  bytes: number;
}

export interface DataOverview {
  dataDir: string;
  totals: { files: number; bytes: number };
  areas: StorageArea[];
  runs: { total: number; running: number; finished: number };
  projects: { total: number; folders: number; withRuns: number; top: ProjectUsage[] };
  cleanup: PruneItem[];
  /** 全部可回收项之和。 */
  reclaimableBytes: number;
  /** 工程图备份的保留份数（与写入端共用同一常量）。 */
  graphBackupKeep: number;
}

export interface PruneOutcome {
  target: PruneTarget;
  label: string;
  /** 实际清理掉的项数。 */
  removed: number;
  /** 实际释放的字节数（只统计清理成功的项）。 */
  bytes: number;
  errors: string[];
}
