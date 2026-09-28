import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DataOverview, PruneOutcome } from "@scribe-flow/shared";
import { createApp } from "../app";
import { createDatabase } from "../db/client";
import { UPLOAD_ORPHAN_MIN_AGE_MS } from "../lib/storage";

const cleanupDirs: string[] = [];

afterEach(async () => {
  // Windows 上 sqlite 句柄可能短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-settings-api-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, dataDir };
}

type App = ReturnType<typeof createApp>;

async function post(app: App, path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const textGraph = {
  schemaVersion: 1,
  nodes: [
    { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "数据账本验收文稿" } },
    { id: "n_merge", type: "process.merge", position: { x: 200, y: 0 }, data: { label: "合并", title: "账本验收" } },
    { id: "n_out", type: "process.output", position: { x: 400, y: 0 }, data: { label: "输出", fileName: "ledger.md" } },
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" },
    { id: "e2", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

async function overviewOf(app: App): Promise<DataOverview> {
  return (await app.request("/api/settings/data")).json();
}

/** 跑一次真实的文本链路，返回 runId（等待到结束）。 */
async function runTextPipeline(app: App, name: string): Promise<string> {
  const project = await post(app, "/api/projects", { name });
  const projectId = (await project.json()).id;
  await app.request(`/api/projects/${projectId}/graph`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: textGraph }),
  });
  const started = await post(app, `/api/projects/${projectId}/runs`, { scope: "all" });
  const runId = (await started.json()).id;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const detail = await (await app.request(`/api/runs/${runId}`)).json();
    if (detail.status !== "running") return runId;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`运行超时：${runId}`);
}

describe("GET /api/settings/data", () => {
  it("账本反映真实产物：跑完一次文本链路后输出分区有文件", async () => {
    const { app } = await setup();
    await runTextPipeline(app, "账本验收");
    const overview = await overviewOf(app);

    expect(overview.areas.map((area) => area.key)).toEqual(["database", "media", "uploads", "runs", "outputs", "graphBackups"]);
    expect(overview.areas.find((area) => area.key === "outputs")).toMatchObject({ files: 1, present: true });
    expect(overview.runs).toEqual({ total: 1, running: 0, finished: 1 });
    expect(overview.projects).toMatchObject({ total: 1, withRuns: 1 });
    expect(overview.reclaimableBytes).toBeGreaterThan(0);
  });
});

describe("POST /api/settings/prune", () => {
  it("清运行记录：运行、产物文件与中间文件一起回收，再查账本归零", async () => {
    const { app, dataDir } = await setup();
    await runTextPipeline(app, "清理验收");
    const before = await overviewOf(app);
    const planned = before.cleanup.find((item) => item.target === "runs");
    expect(planned?.count).toBe(1);

    const response = await post(app, "/api/settings/prune", { targets: ["runs"] });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { outcomes: PruneOutcome[]; removed: number; bytes: number; errors: string[] };
    expect(result.removed).toBe(1);
    expect(result.errors).toEqual([]);
    // 释放的字节数必须落在「计划值」附近：计划算的是删除前实测，执行后不允许凭空多出或少算。
    expect(result.bytes).toBe(planned?.bytes);

    const after = await overviewOf(app);
    expect(after.runs).toEqual({ total: 0, running: 0, finished: 0 });
    expect(after.areas.find((area) => area.key === "outputs")).toMatchObject({ files: 0, bytes: 0 });
    expect(after.areas.find((area) => area.key === "runs")).toMatchObject({ files: 0, bytes: 0 });
    expect(after.reclaimableBytes).toBe(0);
    // 文本链路本来就不写 runs/，目录可能压根没被创建——这里只要求「不剩任何运行目录」。
    await expect(readdir(join(dataDir, "runs")).catch(() => [] as string[])).resolves.toEqual([]);
  });

  it("清孤立上传原件：只删超期那份", async () => {
    const { app, dataDir } = await setup();
    const stalePath = join(dataDir, "uploads", "stale.mp4");
    await mkdir(dirname(stalePath), { recursive: true });
    await writeFile(stalePath, "stale-bytes");
    await writeFile(join(dataDir, "uploads", "fresh.mp4"), "fresh-bytes");
    const old = new Date(Date.now() - UPLOAD_ORPHAN_MIN_AGE_MS - 60_000);
    await utimes(stalePath, old, old);

    const response = await post(app, "/api/settings/prune", { targets: ["uploadOrphans"] });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { removed: number; bytes: number };
    expect(result).toMatchObject({ removed: 1, bytes: 11 });
    await expect(readdir(join(dataDir, "uploads"))).resolves.toEqual(["fresh.mp4"]);
  });

  it("目标列表非法时返回 400 且不清理任何东西", async () => {
    const { app } = await setup();
    expect((await post(app, "/api/settings/prune", {})).status).toBe(400);
    expect((await post(app, "/api/settings/prune", { targets: [] })).status).toBe(400);
    expect((await post(app, "/api/settings/prune", { targets: ["全部"] })).status).toBe(400);
  });
});
