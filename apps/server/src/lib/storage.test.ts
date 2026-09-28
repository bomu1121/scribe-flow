import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PruneItem } from "@scribe-flow/shared";
import { DEFAULT_OUTPUT_DIR } from "@scribe-flow/shared";
import { createDatabase, type AppDatabase } from "../db/client";
import { mediaAssets, projects, runMedia, runs } from "../db/schema";
import { RunEngine } from "./engine";
import {
  buildDataOverview,
  fileManagerCommand,
  isInsideDataDir,
  pruneStorage,
  resolveArtifactPath,
  resolveOutputRoot,
  toStoredArtifactPath,
  UPLOAD_ORPHAN_MIN_AGE_MS,
  type StorageDeps,
} from "./storage";

const cleanupDirs: string[] = [];

afterEach(async () => {
  // Windows 上 sqlite 句柄可能短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

/** outputDir 传的是设置里那份原始字符串（可为相对名、绝对路径或空），deps 里存的是收口后的绝对根目录。 */
async function setup(outputDir = DEFAULT_OUTPUT_DIR) {
  const root = await mkdtemp(join(tmpdir(), "sf-storage-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const engine = new RunEngine(db, dataDir);
  const deps: StorageDeps = { db, dataDir, outputRoot: resolveOutputRoot(dataDir, outputDir), deleteRun: (runId) => engine.deleteRun(runId) };
  return { db, engine, dataDir, deps };
}

/** 写文件并造出需要的字节数；返回写入的字节数。 */
async function write(root: string, relPath: string, bytes: number): Promise<number> {
  const abs = join(root, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "x".repeat(bytes));
  return bytes;
}

async function ageFile(absPath: string, ageMs: number) {
  const when = new Date(Date.now() - ageMs);
  await utimes(absPath, when, when);
}

function insertProject(db: AppDatabase, id: string, name: string) {
  const ts = Date.now();
  db.insert(projects)
    .values({ id, name, description: "", graphJson: JSON.stringify({ nodes: [], edges: [] }), createdAt: ts, updatedAt: ts })
    .run();
}

function insertRun(db: AppDatabase, id: string, projectId: string, status: "success" | "error" | "running" = "success") {
  const ts = Date.now();
  db.insert(runs)
    .values({ id, projectId, status, scope: "all", createdAt: ts, finishedAt: status === "running" ? null : ts, elapsedMs: 1 })
    .run();
}

function insertAsset(db: AppDatabase, id: string, filePath: string, status: "ready" | "restoring" = "ready") {
  const ts = Date.now();
  db.insert(mediaAssets)
    .values({ id, contentKey: `key-${id}`, kind: "bili", status, filePath, mime: "video/mp4", createdAt: ts, updatedAt: ts, lastUsedAt: ts })
    .run();
}

function insertRunMedia(db: AppDatabase, runId: string, assetId: string) {
  db.insert(runMedia)
    .values({ id: `rm_${runId}_${assetId}`, runId, nodeId: "n_src", sourceIndex: 0, assetId, status: "ready", createdAt: Date.now() })
    .run();
}

function itemOf(items: PruneItem[], target: PruneItem["target"]): PruneItem {
  const found = items.find((item) => item.target === target);
  if (!found) throw new Error(`缺少清理项 ${target}`);
  return found;
}

describe("resolveOutputRoot", () => {
  const dataDir = join(tmpdir(), "sf-data-abs");
  const fallback = join(dataDir, DEFAULT_OUTPUT_DIR);

  it("空值与结尾斜杠都落到默认目录", () => {
    expect(resolveOutputRoot(dataDir, "")).toBe(fallback);
    expect(resolveOutputRoot(dataDir, "   ")).toBe(fallback);
    expect(resolveOutputRoot(dataDir, "notes/")).toBe(join(dataDir, "notes"));
  });

  it("相对路径用 .. 爬出数据目录时回退到默认值", () => {
    expect(resolveOutputRoot(dataDir, "..")).toBe(fallback);
    expect(resolveOutputRoot(dataDir, "../../outside")).toBe(fallback);
  });

  it("绝对路径原样采用：用户可以显式把成稿写到数据目录之外", () => {
    const outside = join(tmpdir(), "elsewhere");
    expect(resolveOutputRoot(dataDir, outside)).toBe(resolve(outside));
    expect(isInsideDataDir(dataDir, resolveOutputRoot(dataDir, outside))).toBe(false);
    expect(isInsideDataDir(dataDir, resolveOutputRoot(dataDir, "notes"))).toBe(true);
  });

  it("数据目录内的嵌套名保留", () => {
    expect(resolveOutputRoot(dataDir, "out/md")).toBe(join(dataDir, "out", "md"));
  });
});

describe("产物路径的存取", () => {
  const dataDir = join(tmpdir(), "sf-data-abs");

  it("数据目录内记相对路径，之外记绝对路径", () => {
    expect(toStoredArtifactPath(dataDir, join(dataDir, "outputs", "run_1", "a.md"))).toBe("outputs/run_1/a.md");
    const outside = join(tmpdir(), "elsewhere", "run_1", "a.md");
    expect(toStoredArtifactPath(dataDir, outside)).toBe(outside.split(sep).join("/"));
  });

  it("两种记法都能解析回绝对路径", () => {
    expect(resolveArtifactPath(dataDir, "outputs/run_1/a.md")).toBe(resolve(join(dataDir, "outputs/run_1/a.md")));
    const outside = join(tmpdir(), "elsewhere", "a.md");
    expect(resolveArtifactPath(dataDir, outside.split(sep).join("/"))).toBe(resolve(outside));
  });
});

describe("buildDataOverview 账本", () => {
  it("各分区独立计量，并识别尚未产生的分区", async () => {
    const { dataDir, deps } = await setup();
    await write(dataDir, "uploads/a.mp4", 100);
    await write(dataDir, "media/asset_1.mp4", 200);
    await write(dataDir, "runs/run_1/nodes/n1/part.txt", 30);
    await write(dataDir, "outputs/run_1/note.md", 7);
    await write(dataDir, "graph-backups/pj_a.stamp.json", 13);

    const overview = await buildDataOverview(deps);
    const area = (key: string) => overview.areas.find((candidate) => candidate.key === key);

    expect(area("uploads")).toMatchObject({ files: 1, bytes: 100, present: true });
    expect(area("media")).toMatchObject({ files: 1, bytes: 200, present: true });
    expect(area("runs")).toMatchObject({ files: 1, bytes: 30, present: true });
    expect(area("outputs")).toMatchObject({ files: 1, bytes: 7, present: true });
    expect(area("graphBackups")).toMatchObject({ files: 1, bytes: 13, present: true });
    // 数据库分区跟着 createDatabase 建库，至少有一个主库文件。
    expect(area("database")?.files).toBeGreaterThanOrEqual(1);
    expect(area("database")?.present).toBe(true);

    // 合计 = 各分区之和，防止界面上的总数与明细对不上。
    expect(overview.totals.bytes).toBe(overview.areas.reduce((acc, item) => acc + item.bytes, 0));
    expect(overview.totals.files).toBe(overview.areas.reduce((acc, item) => acc + item.files, 0));
  });

  it("自定义产物目录名同样被计量", async () => {
    const { dataDir, deps } = await setup("笔记/成稿");
    await write(dataDir, join("笔记", "成稿", "run_1", "a.md"), 42);
    const overview = await buildDataOverview(deps);
    expect(overview.areas.find((area) => area.key === "outputs")).toMatchObject({ files: 1, bytes: 42, present: true });
  });

  it("运行计数区分运行中与已结束", async () => {
    const { db, deps } = await setup();
    insertProject(db, "pj_a", "工程 A");
    insertRun(db, "run_1", "pj_a", "success");
    insertRun(db, "run_2", "pj_a", "running");
    const overview = await buildDataOverview(deps);
    expect(overview.runs).toEqual({ total: 2, running: 1, finished: 1 });
    expect(overview.projects).toMatchObject({ total: 1, withRuns: 1 });
  });
});

describe("可回收判定", () => {
  it("孤立媒体资产：无引用才算，下载中的不动", async () => {
    const { dataDir, db, deps } = await setup();
    await write(dataDir, "media/asset_used.mp4", 10);
    await write(dataDir, "media/asset_orphan.mp4", 20);
    await write(dataDir, "media/asset_downloading.mp4", 40);
    insertAsset(db, "asset_used", "media/asset_used.mp4");
    insertAsset(db, "asset_orphan", "media/asset_orphan.mp4");
    insertAsset(db, "asset_downloading", "media/asset_downloading.mp4", "restoring");
    insertRun(db, "run_1", "pj_a");
    insertRunMedia(db, "run_1", "asset_used");

    const item = itemOf((await buildDataOverview(deps)).cleanup, "orphanMedia");
    expect(item).toMatchObject({ count: 1, bytes: 20 });
  });

  it("孤立上传原件：要同时满足无引用与超过闲置期", async () => {
    const { dataDir, db, deps } = await setup();
    await write(dataDir, "uploads/used.mp4", 11);
    const freshBytes = await write(dataDir, "uploads/fresh.mp4", 22);
    const staleBytes = await write(dataDir, "uploads/stale.mp4", 33);
    await ageFile(join(dataDir, "uploads", "stale.mp4"), UPLOAD_ORPHAN_MIN_AGE_MS + 60_000);
    insertAsset(db, "asset_used", "uploads/used.mp4", "ready");

    const item = itemOf((await buildDataOverview(deps)).cleanup, "uploadOrphans");
    expect(freshBytes).toBe(22);
    // fresh.mp4 刚上传还没跑过，必须留着；stale.mp4 闲置超期，可回收。
    expect(item).toMatchObject({ count: 1, bytes: staleBytes });
  });

  it("工程图备份：保留最近 N 份，已删除工程的留档全算", async () => {
    const { dataDir, db, deps } = await setup();
    insertProject(db, "pj_a", "工程 A");
    for (let index = 1; index <= 25; index += 1) {
      const day = String(index).padStart(2, "0");
      await write(dataDir, `graph-backups/pj_a.2026-01-${day}T00-00-00-000Z.json`, 5);
    }
    await write(dataDir, "graph-backups/pj_gone.2026-01-01T00-00-00-000Z.json", 5);
    await write(dataDir, "graph-backups/pj_gone.2026-01-02T00-00-00-000Z.json", 5);

    const overview = await buildDataOverview(deps);
    expect(overview.graphBackupKeep).toBe(20);
    // 25 份留 20 份 → 5 份可回收；已删除工程的 2 份全部可回收。
    expect(itemOf(overview.cleanup, "graphBackups")).toMatchObject({ count: 7, bytes: 35 });
  });

  it("盘上孤立文件与目录：无对应运行记录才算", async () => {
    const { dataDir, db, deps } = await setup();
    insertRun(db, "run_keep", "pj_a");
    await write(dataDir, "runs/run_keep/nodes/n1/a.txt", 3);
    await write(dataDir, "runs/run_stale/nodes/n1/a.txt", 4);
    await write(dataDir, "outputs/run_stale/note.md", 5);
    await write(dataDir, "outputs/loose.md", 6);

    const item = itemOf((await buildDataOverview(deps)).cleanup, "orphanDirs");
    // 两个孤立目录 + 一个散落文件；run_keep 的一份必须留下。
    expect(item).toMatchObject({ count: 3, bytes: 15 });
  });

  it("已结束运行的占用按 runs/ 与产物目录合计，运行中的不计入", async () => {
    const { dataDir, db, deps } = await setup();
    insertRun(db, "run_done", "pj_a", "success");
    insertRun(db, "run_live", "pj_a", "running");
    await write(dataDir, "runs/run_done/nodes/n1/a.txt", 100);
    await write(dataDir, "outputs/run_done/note.md", 50);
    await write(dataDir, "runs/run_live/nodes/n1/a.txt", 900);

    const item = itemOf((await buildDataOverview(deps)).cleanup, "runs");
    expect(item).toMatchObject({ count: 1, bytes: 150 });
  });

  it("工程占用按运行记录归属，可回收量即该工程运行记录的占用之和", async () => {
    const { dataDir, db, deps } = await setup();
    insertProject(db, "pj_a", "工程 A");
    insertProject(db, "pj_b", "工程 B");
    insertRun(db, "run_a1", "pj_a");
    insertRun(db, "run_b1", "pj_b");
    await write(dataDir, "outputs/run_a1/a.md", 300);
    await write(dataDir, "outputs/run_b1/b.md", 100);

    const overview = await buildDataOverview(deps);
    expect(overview.projects.top.map((usage) => [usage.name, usage.runCount, usage.bytes])).toEqual([
      ["工程 A", 1, 300],
      ["工程 B", 1, 100],
    ]);
  });
});

describe("pruneStorage", () => {
  it("孤立媒体资产：删文件也删行，释放字节数与计划一致", async () => {
    const { dataDir, db, deps } = await setup();
    await write(dataDir, "media/asset_orphan.mp4", 64);
    insertAsset(db, "asset_orphan", "media/asset_orphan.mp4");

    const planned = itemOf((await buildDataOverview(deps)).cleanup, "orphanMedia");
    const [outcome] = await pruneStorage(deps, ["orphanMedia"]);

    expect(outcome).toMatchObject({ target: "orphanMedia", removed: 1, bytes: planned.bytes, errors: [] });
    expect(db.select().from(mediaAssets).all()).toHaveLength(0);
    await expect(readdir(join(dataDir, "media"))).resolves.toEqual([]);
  });

  it("盘上孤立目录：只剩真正有运行记录的那一份", async () => {
    const { dataDir, db, deps } = await setup();
    insertRun(db, "run_keep", "pj_a");
    await write(dataDir, "runs/run_keep/nodes/n1/a.txt", 3);
    await write(dataDir, "runs/run_stale/nodes/n1/a.txt", 4);
    await write(dataDir, "outputs/run_stale/note.md", 5);

    const [outcome] = await pruneStorage(deps, ["orphanDirs"]);
    expect(outcome).toMatchObject({ removed: 2, bytes: 9, errors: [] });
    await expect(readdir(join(dataDir, "runs"))).resolves.toEqual(["run_keep"]);
    await expect(readdir(join(dataDir, "outputs"))).resolves.toEqual([]);
  });

  it("工程图备份：留下固定份数，已删除工程的留档清空", async () => {
    const { dataDir, db, deps } = await setup();
    insertProject(db, "pj_a", "工程 A");
    for (let index = 1; index <= 25; index += 1) {
      const day = String(index).padStart(2, "0");
      await write(dataDir, `graph-backups/pj_a.2026-01-${day}T00-00-00-000Z.json`, 5);
    }
    await write(dataDir, "graph-backups/pj_gone.2026-01-01T00-00-00-000Z.json", 5);

    const [outcome] = await pruneStorage(deps, ["graphBackups"]);
    expect(outcome).toMatchObject({ removed: 6, bytes: 30, errors: [] });
    const left = await readdir(join(dataDir, "graph-backups"));
    expect(left).toHaveLength(20);
    expect(left.every((name) => name.startsWith("pj_a."))).toBe(true);
    // 留下的必须是最新的那一批：2026-01-06 之后的都还在，最早 5 份已删。
    expect(left).not.toContain("pj_a.2026-01-01T00-00-00-000Z.json");
    expect(left).toContain("pj_a.2026-01-25T00-00-00-000Z.json");
  });

  it("已结束运行：走 engine.deleteRun，产物目录与运行记录一起消失", async () => {
    const { dataDir, db, deps } = await setup();
    insertRun(db, "run_done", "pj_a", "success");
    insertRun(db, "run_live", "pj_a", "running");
    await write(dataDir, "runs/run_done/nodes/n1/a.txt", 100);
    await write(dataDir, "outputs/run_done/note.md", 50);
    await write(dataDir, "runs/run_live/nodes/n1/a.txt", 900);

    const [outcome] = await pruneStorage(deps, ["runs"]);
    expect(outcome).toMatchObject({ removed: 1, bytes: 150, errors: [] });
    expect(db.select().from(runs).all().map((row) => row.id)).toEqual(["run_live"]);
    await expect(readdir(join(dataDir, "runs"))).resolves.toEqual(["run_live"]);
    await expect(readdir(join(dataDir, "outputs"))).resolves.toEqual([]);
  });

  it("孤立上传原件：只删超期没有被引用的那个", async () => {
    const { dataDir, db, deps } = await setup();
    await write(dataDir, "uploads/used.mp4", 11);
    await write(dataDir, "uploads/fresh.mp4", 22);
    const staleBytes = await write(dataDir, "uploads/stale.mp4", 33);
    await ageFile(join(dataDir, "uploads", "stale.mp4"), UPLOAD_ORPHAN_MIN_AGE_MS + 60_000);
    insertAsset(db, "asset_used", "uploads/used.mp4", "ready");

    const [outcome] = await pruneStorage(deps, ["uploadOrphans"]);
    expect(outcome).toMatchObject({ removed: 1, bytes: staleBytes, errors: [] });
    await expect(readdir(join(dataDir, "uploads"))).resolves.toEqual(expect.arrayContaining(["fresh.mp4", "used.mp4"]));
    expect((await readdir(join(dataDir, "uploads"))).length).toBe(2);
  });

  it("清理一项不动其它项", async () => {
    const { dataDir, deps } = await setup();
    await write(dataDir, "uploads/stale.mp4", 33);
    await ageFile(join(dataDir, "uploads", "stale.mp4"), UPLOAD_ORPHAN_MIN_AGE_MS + 60_000);
    await write(dataDir, "runs/run_stale/nodes/n1/a.txt", 4);

    await pruneStorage(deps, ["orphanDirs"]);
    // orphanDirs 清完了，但上传原件还在，说明目标过滤是按 targets 生效的。
    await expect(readdir(join(dataDir, "uploads"))).resolves.toEqual(["stale.mp4"]);
  });
});

describe("fileManagerCommand", () => {
  const target = join(tmpdir(), "sf");

  it("按平台给出打开文件管理器的命令", () => {
    expect(fileManagerCommand("win32", target)).toEqual(["explorer.exe", [target]]);
    expect(fileManagerCommand("darwin", target)).toEqual(["open", [target]]);
    expect(fileManagerCommand("linux", target)).toEqual(["xdg-open", [target]]);
  });
});
