import { readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { DataOverview, PruneItem, PruneOutcome, PruneTarget, ProjectUsage, StorageArea, StorageAreaKey } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { folders, mediaAssets, projects, runMedia, runs, type MediaAssetRow, type ProjectRow, type RunRow } from "../db/schema";

/** 工程图备份每个工程保留的份数；写入端（routes/projects.ts）与清理端共用，避免两边口径漂移。 */
export const GRAPH_BACKUP_KEEP = 20;

/**
 * 上传原件被视为可回收的最小闲置时长。
 * 上传与「跑一次」之间隔着用户编画布的时间，只看「有没有被引用」会删掉刚上传还没用过的文件。
 */
export const UPLOAD_ORPHAN_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const UPLOAD_ORPHAN_MIN_AGE_DAYS = Math.round(UPLOAD_ORPHAN_MIN_AGE_MS / (24 * 60 * 60 * 1000));

const AREA_META: Array<{ key: StorageAreaKey; label: string }> = [
  { key: "database", label: "数据库（工程 / 运行记录 / 密钥）" },
  { key: "media", label: "媒体库（下载与归一化后的视频）" },
  { key: "uploads", label: "上传原件（本地上传的音视频）" },
  { key: "runs", label: "运行中间产物（节点片段与字幕）" },
  { key: "outputs", label: "输出文件（成稿 Markdown）" },
  { key: "graphBackups", label: "工程图备份（每次保存的上一版）" },
];

/**
 * 产物目录名必须落在数据目录内。
 * general.outputDir 是外部可改的字符串，engine 直接 `join(dataDir, outputDir)`；
 * 配成 `..` 之类会把扫描与清理的作用域抬到数据目录之外，因此这里统一收口。
 */
export function resolveOutputDir(dataDir: string, configured: string): string {
  const name = (configured || "").trim().replace(/[\\/]+$/, "");
  if (!name) return "outputs";
  const rel = relative(dataDir, resolve(dataDir, name));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return "outputs";
  return rel;
}

export interface StorageDeps {
  db: AppDatabase;
  dataDir: string;
  /** 产物目录名（已由 resolveOutputDir 收口），相对 dataDir。 */
  outputDir: string;
  /** 删除一条运行记录（含其产物目录与媒体 GC）；由 engine 提供。 */
  deleteRun: (runId: string) => Promise<void>;
}

interface FileEntry {
  /** 相对所属根目录的路径，统一用 "/" 分隔（Windows 下 join 会给反斜杠）。 */
  relPath: string;
  bytes: number;
  mtimeMs: number;
}

interface Usage {
  files: number;
  bytes: number;
}

const ZERO: Usage = { files: 0, bytes: 0 };

async function listFiles(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const walk = async (dir: string, rel: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(join(dir, entry.name)).catch(() => null);
      if (!info) continue;
      out.push({ relPath: childRel, bytes: info.size, mtimeMs: info.mtimeMs });
    }
  };
  await walk(root, "");
  return out;
}

async function listDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function isDir(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true;
}

function total(entries: FileEntry[]): Usage {
  return entries.reduce<Usage>((acc, entry) => ({ files: acc.files + 1, bytes: acc.bytes + entry.bytes }), { ...ZERO });
}

/** 按第一层名字分组：runs/<runId>/… 与 outputs/<runId>/… 靠它拿到「每条运行占多少」。 */
function groupByTopLevel(entries: FileEntry[]): Map<string, Usage> {
  const grouped = new Map<string, Usage>();
  for (const entry of entries) {
    const slash = entry.relPath.indexOf("/");
    const key = slash === -1 ? entry.relPath : entry.relPath.slice(0, slash);
    const current = grouped.get(key) ?? { ...ZERO };
    current.files += 1;
    current.bytes += entry.bytes;
    grouped.set(key, current);
  }
  return grouped;
}

function addUsage(a: Usage, b: Usage): Usage {
  return { files: a.files + b.files, bytes: a.bytes + b.bytes };
}

/** 一次 survey 的产物：账本、各区域的原始文件清单、以及按运行 id 归并好的占用。 */
interface Survey {
  dataDir: string;
  outputDir: string;
  areas: StorageArea[];
  mediaEntries: FileEntry[];
  uploadEntries: FileEntry[];
  backupEntries: FileEntry[];
  runDirNames: string[];
  outputDirNames: string[];
  /** runs/ 与产物目录下直接散落的顶层文件（不属于任何运行的残渣）。 */
  strayEntries: Array<{ name: string; path: string; bytes: number }>;
  /** runId -> runs/<runId> 的占用；孤立项要按根目录分别取，不能与产物目录混算。 */
  runGroups: Map<string, Usage>;
  /** runId -> <outputDir>/<runId> 的占用。 */
  outputGroups: Map<string, Usage>;
  /** runId -> 两个根目录的合计占用，用于「这条运行占多少」。 */
  runUsage: Map<string, Usage>;
}

async function survey(deps: StorageDeps): Promise<Survey> {
  const { dataDir, outputDir } = deps;
  // 六个分区里只有五个是目录；数据库是数据目录下的三个文件，单独 stat。
  const dirOf = (key: Exclude<StorageAreaKey, "database">) =>
    join(dataDir, { media: "media", uploads: "uploads", runs: "runs", outputs: outputDir, graphBackups: "graph-backups" }[key]);

  const [dbEntries, mediaEntries, uploadEntries, runEntries, outputEntries, backupEntries, runDirNames, outputDirNames] = await Promise.all([
    (async () => {
      const base = join(dataDir, "scribe-flow.sqlite");
      const found: FileEntry[] = [];
      for (const suffix of ["", "-wal", "-shm"]) {
        const info = await stat(`${base}${suffix}`).catch(() => null);
        if (info?.isFile()) found.push({ relPath: `scribe-flow.sqlite${suffix}`, bytes: info.size, mtimeMs: info.mtimeMs });
      }
      return found;
    })(),
    listFiles(dirOf("media")),
    listFiles(dirOf("uploads")),
    listFiles(dirOf("runs")),
    listFiles(dirOf("outputs")),
    listFiles(dirOf("graphBackups")),
    listDirs(dirOf("runs")),
    listDirs(dirOf("outputs")),
  ]);

  const entriesOf: Record<StorageAreaKey, FileEntry[]> = {
    database: dbEntries,
    media: mediaEntries,
    uploads: uploadEntries,
    runs: runEntries,
    outputs: outputEntries,
    graphBackups: backupEntries,
  };
  const presentOf: Record<StorageAreaKey, boolean> = {
    database: dbEntries.length > 0,
    media: await isDir(dirOf("media")),
    uploads: await isDir(dirOf("uploads")),
    runs: await isDir(dirOf("runs")),
    outputs: await isDir(dirOf("outputs")),
    graphBackups: await isDir(dirOf("graphBackups")),
  };

  const runUsage = new Map<string, Usage>();
  const runGroups = groupByTopLevel(runEntries);
  const outputGroups = groupByTopLevel(outputEntries);
  for (const key of new Set([...runGroups.keys(), ...outputGroups.keys()])) {
    runUsage.set(key, addUsage(runGroups.get(key) ?? ZERO, outputGroups.get(key) ?? ZERO));
  }

  return {
    dataDir,
    outputDir,
    areas: AREA_META.map((meta) => {
      const usage = total(entriesOf[meta.key]);
      return { key: meta.key, label: meta.label, files: usage.files, bytes: usage.bytes, present: presentOf[meta.key] };
    }),
    mediaEntries,
    uploadEntries,
    backupEntries,
    runDirNames,
    outputDirNames,
    strayEntries: [
      ...topLevelFiles(runEntries, dirOf("runs")),
      ...topLevelFiles(outputEntries, dirOf("outputs")),
    ],
    runGroups,
    outputGroups,
    runUsage,
  };
}

function topLevelFiles(entries: FileEntry[], root: string): Array<{ name: string; path: string; bytes: number }> {
  return entries
    .filter((entry) => !entry.relPath.includes("/"))
    .map((entry) => ({ name: entry.relPath, path: join(root, entry.relPath), bytes: entry.bytes }));
}

/** 库里的行：判定「什么该清」全靠它跟盘上对照。 */
interface Catalogue {
  runRows: RunRow[];
  projectRows: ProjectRow[];
  assets: MediaAssetRow[];
  /** run_media 里出现过的 assetId：被任何运行引用即不算孤立。 */
  referencedAssetIds: Set<string>;
  folderCount: number;
}

function loadCatalogue(db: AppDatabase): Catalogue {
  return {
    runRows: db.select().from(runs).all(),
    projectRows: db.select().from(projects).all(),
    assets: db.select().from(mediaAssets).all(),
    referencedAssetIds: new Set(db.select({ assetId: runMedia.assetId }).from(runMedia).all().map((row) => row.assetId)),
    folderCount: db.select().from(folders).all().length,
  };
}

function usageOf(surveyRef: Survey, runId: string): Usage {
  return surveyRef.runUsage.get(runId) ?? ZERO;
}

/** 孤立媒体资产：没有任何运行引用，且不处于下载中（下载中的行可能正在写文件，一律不动）。 */
function orphanMediaAssets(catalogue: Catalogue): MediaAssetRow[] {
  return catalogue.assets.filter((asset) => !catalogue.referencedAssetIds.has(asset.id) && asset.status !== "restoring");
}

/** 媒体文件在盘上的字节数；文件已丢失时为 0（此时删的只是行）。 */
function mediaFileBytes(surveyRef: Survey, asset: MediaAssetRow): number {
  if (!asset.filePath.startsWith("media/")) return 0;
  const rel = asset.filePath.slice("media/".length);
  return surveyRef.mediaEntries.find((entry) => entry.relPath === rel)?.bytes ?? 0;
}

/** 盘上存留、但已无对应运行记录的文件与目录（异常退出与删除竞态留下的残骸）。 */
function orphanPaths(surveyRef: Survey, catalogue: Catalogue): Array<{ name: string; path: string; bytes: number }> {
  const known = new Set(catalogue.runRows.map((row) => row.id));
  const dirsOf = (names: string[], root: string, groups: Map<string, Usage>) =>
    names
      .filter((name) => !known.has(name))
      .map((name) => ({ name, path: join(root, name), bytes: groups.get(name)?.bytes ?? 0 }));
  return [
    ...dirsOf(surveyRef.runDirNames, join(surveyRef.dataDir, "runs"), surveyRef.runGroups),
    ...dirsOf(surveyRef.outputDirNames, join(surveyRef.dataDir, surveyRef.outputDir), surveyRef.outputGroups),
    ...surveyRef.strayEntries.filter((entry) => !known.has(entry.name)),
  ];
}

/**
 * 工程图备份的可回收部分：已删除工程的留档全部可清，仍在的工程按文件名字典序（= 时间序）保留最近 GRAPH_BACKUP_KEEP 份。
 */
function staleGraphBackups(surveyRef: Survey, catalogue: Catalogue): FileEntry[] {
  const stale: FileEntry[] = [];
  const byProject = new Map<string, FileEntry[]>();
  for (const entry of surveyRef.backupEntries) {
    // 文件名形如 <projectId>.<ISO 时间戳>.json；用「工程 id + .」前缀匹配，避免 id 之间前缀互相误伤。
    const owner = catalogue.projectRows.find((row) => entry.relPath.startsWith(`${row.id}.`));
    if (!owner) {
      stale.push(entry);
      continue;
    }
    const bucket = byProject.get(owner.id) ?? [];
    bucket.push(entry);
    byProject.set(owner.id, bucket);
  }
  for (const bucket of byProject.values()) {
    bucket.sort((a, b) => a.relPath.localeCompare(b.relPath));
    stale.push(...bucket.slice(0, Math.max(0, bucket.length - GRAPH_BACKUP_KEEP)));
  }
  return stale;
}

function uploadOrphans(surveyRef: Survey, catalogue: Catalogue): FileEntry[] {
  const referenced = new Set(catalogue.assets.map((asset) => asset.filePath).filter((path) => path.startsWith("uploads/")));
  const deadline = Date.now() - UPLOAD_ORPHAN_MIN_AGE_MS;
  return surveyRef.uploadEntries.filter((entry) => !referenced.has(`uploads/${entry.relPath}`) && entry.mtimeMs < deadline);
}

function buildCleanup(surveyRef: Survey, catalogue: Catalogue): PruneItem[] {
  const finishedRuns = catalogue.runRows.filter((row) => row.status !== "running");
  const media = orphanMediaAssets(catalogue);
  const uploads = uploadOrphans(surveyRef, catalogue);
  const orphans = orphanPaths(surveyRef, catalogue);
  const backups = staleGraphBackups(surveyRef, catalogue);

  return [
    {
      target: "runs",
      label: "已结束的运行记录",
      rule: "状态不是「运行中」的运行记录；连同其产物文件、节点日志与中间文件一起删除。进行中的运行不受影响。",
      count: finishedRuns.length,
      bytes: finishedRuns.reduce((acc, row) => acc + usageOf(surveyRef, row.id).bytes, 0),
    },
    {
      target: "orphanMedia",
      label: "孤立媒体资产",
      rule: "媒体库里已不被任何运行引用的视频文件；正在下载中的资产不动。",
      count: media.length,
      bytes: media.reduce((acc, asset) => acc + mediaFileBytes(surveyRef, asset), 0),
    },
    {
      target: "uploadOrphans",
      label: "孤立上传原件",
      rule: `上传目录里既不被任何媒体资产引用、又闲置超过 ${UPLOAD_ORPHAN_MIN_AGE_DAYS} 天的文件。`,
      count: uploads.length,
      bytes: total(uploads).bytes,
    },
    {
      target: "orphanDirs",
      label: "盘上孤立文件与目录",
      rule: "运行中间产物与输出目录下、已经没有对应运行记录的目录与散落文件（异常退出时残留）。",
      count: orphans.length,
      bytes: orphans.reduce((acc, orphan) => acc + orphan.bytes, 0),
    },
    {
      target: "graphBackups",
      label: "可回收的工程图备份",
      rule: `已删除工程的留档，以及每个工程超过最近 ${GRAPH_BACKUP_KEEP} 份之外的历史版本。`,
      count: backups.length,
      bytes: total(backups).bytes,
    },
  ];
}

function buildProjectUsage(surveyRef: Survey, catalogue: Catalogue): ProjectUsage[] {
  const byProject = new Map<string, ProjectUsage>();
  for (const row of catalogue.runRows) {
    const usage = usageOf(surveyRef, row.id);
    const current = byProject.get(row.projectId) ?? { id: row.projectId, name: "", runCount: 0, bytes: 0 };
    current.runCount += 1;
    current.bytes += usage.bytes;
    byProject.set(row.projectId, current);
  }
  const nameOf = new Map(catalogue.projectRows.map((row) => [row.id, row.name]));
  return [...byProject.values()]
    .map((item) => ({ ...item, name: nameOf.get(item.id) ?? "（已删除的工程）" }))
    .sort((a, b) => b.bytes - a.bytes || b.runCount - a.runCount)
    .slice(0, 10);
}

export async function buildDataOverview(deps: StorageDeps): Promise<DataOverview> {
  const surveyRef = await survey(deps);
  const catalogue = loadCatalogue(deps.db);
  const cleanup = buildCleanup(surveyRef, catalogue);
  return {
    dataDir: deps.dataDir,
    totals: surveyRef.areas.reduce((acc, area) => ({ files: acc.files + area.files, bytes: acc.bytes + area.bytes }), { ...ZERO }),
    areas: surveyRef.areas,
    runs: {
      total: catalogue.runRows.length,
      running: catalogue.runRows.filter((row) => row.status === "running").length,
      finished: catalogue.runRows.filter((row) => row.status !== "running").length,
    },
    projects: {
      total: catalogue.projectRows.length,
      folders: catalogue.folderCount,
      withRuns: new Set(catalogue.runRows.map((row) => row.projectId)).size,
      top: buildProjectUsage(surveyRef, catalogue),
    },
    cleanup,
    reclaimableBytes: cleanup.reduce((acc, item) => acc + item.bytes, 0),
    graphBackupKeep: GRAPH_BACKUP_KEEP,
  };
}

/** 先按同一份 survey 重新算一遍计划再执行，保证「界面显示几项」与「点下去删几项」永远一致。 */
export async function pruneStorage(deps: StorageDeps, targets: PruneTarget[]): Promise<PruneOutcome[]> {
  const surveyRef = await survey(deps);
  const catalogue = loadCatalogue(deps.db);
  const wanted = new Set(targets);
  const outcomes: PruneOutcome[] = [];
  for (const item of buildCleanup(surveyRef, catalogue)) {
    if (!wanted.has(item.target)) continue;
    outcomes.push(await applyPrune(deps, surveyRef, catalogue, item));
  }
  return outcomes;
}

async function applyPrune(deps: StorageDeps, surveyRef: Survey, catalogue: Catalogue, item: PruneItem): Promise<PruneOutcome> {
  const outcome: PruneOutcome = { target: item.target, label: item.label, removed: 0, bytes: 0, errors: [] };
  const fail = (path: string, err: unknown) => outcome.errors.push(`${path}：${err instanceof Error ? err.message : String(err)}`);

  if (item.target === "runs") {
    for (const row of catalogue.runRows.filter((candidate) => candidate.status !== "running")) {
      const usage = usageOf(surveyRef, row.id);
      try {
        await deps.deleteRun(row.id);
        outcome.removed += 1;
        outcome.bytes += usage.bytes;
      } catch (err) {
        fail(row.id, err);
      }
    }
    return outcome;
  }

  if (item.target === "orphanMedia") {
    for (const asset of orphanMediaAssets(catalogue)) {
      const bytes = mediaFileBytes(surveyRef, asset);
      try {
        if (asset.filePath.startsWith("media/")) await rm(resolve(deps.dataDir, asset.filePath), { force: true });
        deps.db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id)).run();
        outcome.removed += 1;
        outcome.bytes += bytes;
      } catch (err) {
        fail(asset.filePath, err);
      }
    }
    return outcome;
  }

  if (item.target === "uploadOrphans") {
    for (const entry of uploadOrphans(surveyRef, catalogue)) {
      try {
        await rm(join(deps.dataDir, "uploads", entry.relPath), { force: true });
        outcome.removed += 1;
        outcome.bytes += entry.bytes;
      } catch (err) {
        fail(`uploads/${entry.relPath}`, err);
      }
    }
    return outcome;
  }

  if (item.target === "orphanDirs") {
    for (const orphan of orphanPaths(surveyRef, catalogue)) {
      try {
        await rm(orphan.path, { recursive: true, force: true });
        outcome.removed += 1;
        outcome.bytes += orphan.bytes;
      } catch (err) {
        fail(orphan.name, err);
      }
    }
    return outcome;
  }

  for (const entry of staleGraphBackups(surveyRef, catalogue)) {
    try {
      await rm(join(deps.dataDir, "graph-backups", entry.relPath), { force: true });
      outcome.removed += 1;
      outcome.bytes += entry.bytes;
    } catch (err) {
      fail(entry.relPath, err);
    }
  }
  return outcome;
}

/**
 * 在系统文件管理器里定位数据目录。
 * 平台差异只有这三行；explorer.exe 成功时也可能返回非 0，所以调用方只看能否 spawn。
 */
export function fileManagerCommand(platform: NodeJS.Platform, target: string): [string, string[]] {
  if (platform === "win32") return ["explorer.exe", [target]];
  if (platform === "darwin") return ["open", [target]];
  return ["xdg-open", [target]];
}
