import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "../db/client";
import { mediaAssets, runMedia, runs } from "../db/schema";
import { RunEngine } from "./engine";
import { attachRunMedia, biliContentKey, fileContentKey } from "./media-store";

const cleanupDirs: string[] = [];

afterEach(async () => {
  // sqlite 句柄可能在 Windows 上短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-media-gc-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(join(dataDir, "media"), { recursive: true });
  await mkdir(join(dataDir, "uploads"), { recursive: true });
  const db = createDatabase(dataDir);
  const engine = new RunEngine(db, dataDir);
  return { db, engine, dataDir };
}

function insertRun(db: AppDatabase, runId: string) {
  const createdAt = Date.now();
  db.insert(runs)
    .values({
      id: runId,
      projectId: "p-test",
      status: "success",
      scope: "all",
      createdAt,
      finishedAt: createdAt,
      elapsedMs: 1,
    })
    .run();
}

async function insertAsset(db: AppDatabase, assetId: string, relPath: string, dataDir: string, kind: "bili" | "file" = "bili") {
  const ts = Date.now();
  const abs = join(dataDir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "media-bytes");
  db.insert(mediaAssets)
    .values({
      id: assetId,
      contentKey: `key-${assetId}`,
      kind,
      status: "ready",
      filePath: relPath,
      mime: "video/mp4",
      size: 11,
      title: `title-${assetId}`,
      createdAt: ts,
      updatedAt: ts,
      lastUsedAt: ts,
    })
    .run();
}

describe("media-store", () => {
  it("内容键稳定且区分清晰度", () => {
    expect(biliContentKey("BV1xx", 1, 80)).toBe(biliContentKey("BV1xx", 1, 80));
    expect(biliContentKey("BV1xx", 1, 80)).not.toBe(biliContentKey("BV1xx", 1, 64));
    expect(fileContentKey("uploads/a.mp4")).toBe(fileContentKey("uploads/a.mp4"));
  });

  it("删除运行：media/ 文件随引用归零删除，uploads/ 直放原件保留", async () => {
    const { db, engine, dataDir } = await setup();
    insertRun(db, "run-gc-1");
    await insertAsset(db, "asset-a", "media/asset-a.mp4", dataDir);
    await insertAsset(db, "asset-b", "uploads/original.mp4", dataDir, "file");
    attachRunMedia(db, { runId: "run-gc-1", nodeId: "n1", sourceIndex: 0, assetId: "asset-a", status: "ready" });
    attachRunMedia(db, { runId: "run-gc-1", nodeId: "n2", sourceIndex: 0, assetId: "asset-b", status: "ready" });

    await engine.deleteRun("run-gc-1");

    expect(db.select().from(mediaAssets).where(inArray(mediaAssets.id, ["asset-a", "asset-b"])).all()).toHaveLength(0);
    expect(db.select().from(runMedia).all()).toHaveLength(0);
    await expect(stat(join(dataDir, "media/asset-a.mp4"))).rejects.toThrow();
    await expect(stat(join(dataDir, "uploads/original.mp4"))).resolves.toBeTruthy();
  });

  it("两个运行共享资产：只删其中一个运行不影响文件", async () => {
    const { db, engine, dataDir } = await setup();
    insertRun(db, "run-share-1");
    insertRun(db, "run-share-2");
    await insertAsset(db, "asset-shared", "media/asset-shared.mp4", dataDir);
    attachRunMedia(db, { runId: "run-share-1", nodeId: "n1", sourceIndex: 0, assetId: "asset-shared", status: "ready" });
    attachRunMedia(db, { runId: "run-share-2", nodeId: "n1", sourceIndex: 0, assetId: "asset-shared", status: "ready" });

    await engine.deleteRun("run-share-1");
    expect(db.select().from(mediaAssets).all()).toHaveLength(1);
    await expect(stat(join(dataDir, "media/asset-shared.mp4"))).resolves.toBeTruthy();

    await engine.deleteRun("run-share-2");
    expect(db.select().from(mediaAssets).all()).toHaveLength(0);
    await expect(stat(join(dataDir, "media/asset-shared.mp4"))).rejects.toThrow();
  });
});
