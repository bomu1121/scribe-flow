import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { formatFileNameDate, parseGraph, type UpdateSettingsRequest } from "@scribe-flow/shared";
import { createDatabase, type AppDatabase } from "../db/client";
import { projects, runNodeResults, runs } from "../db/schema";
import { RunEngine } from "./engine";
import { getSettings, updateSettings } from "./settings";
import { sleep } from "./sleep";
import { buildDataOverview, resolveOutputRoot } from "./storage";

/**
 * 「常规」分组里运行与产出默认值的端到端验收。
 *
 * 刻意跑真实引擎而不是只调渲染函数：这些设置的价值就在「落到磁盘上的文件名与位置」，
 * 只测纯函数测不出 engine 有没有真的用上它们。
 */

const tmpDirs: string[] = [];

async function waitUntilFinished(db: AppDatabase, runId: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let row = db.select().from(runs).where(eq(runs.id, runId)).get();
  while ((!row || row.status === "running") && Date.now() < deadline) {
    await sleep(25);
    row = db.select().from(runs).where(eq(runs.id, runId)).get();
  }
  expect(row).toBeTruthy();
  expect(row!.status).not.toBe("running");
}

afterEach(async () => {
  // sqlite 句柄可能在 Windows 上短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

/**
 * 建一个「文本 → 合并（一个或多个）」的工程。
 * 合并节点没有下游，所以运行收尾会把它落盘——正是这里要验的那条链路。
 */
async function makeProject(projectName: string, labels: string[]) {
  const root = await mkdtemp(join(tmpdir(), "scribe-general-"));
  tmpDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);

  const graph = parseGraph({
    schemaVersion: 1,
    nodes: [
      { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: "用于验收的正文内容。" } },
      ...labels.map((label, index) => ({
        id: `n_merge_${index}`,
        type: "process.merge",
        position: { x: 200, y: index * 160 },
        data: { label, title: `笔记 ${index}` },
      })),
    ],
    edges: labels.map((_, index) => ({ id: `e${index}`, source: "n_src", target: `n_merge_${index}`, sourceHandle: "transcript", targetHandle: "noteBlock" })),
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  const projectId = `prj_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  db.insert(projects)
    .values({ id: projectId, name: projectName, description: "", graphJson: JSON.stringify(graph), schemaVersion: 1, createdAt: now, updatedAt: now })
    .run();
  return { root, dataDir, db, projectId, graph };
}

/** 跑一次并把「产物在库里的路径」按节点 id 归好返回。 */
async function runOnce(ctx: Awaited<ReturnType<typeof makeProject>>) {
  const runId = `run_${Math.random().toString(36).slice(2, 10)}`;
  ctx.db.insert(runs).values({ id: runId, projectId: ctx.projectId, status: "running", scope: "all", createdAt: Date.now(), graphJson: JSON.stringify(ctx.graph) }).run();
  new RunEngine(ctx.db, ctx.dataDir).start(runId, ctx.projectId, ctx.graph, "all");
  await waitUntilFinished(ctx.db, runId);
  const rows = ctx.db.select().from(runNodeResults).where(eq(runNodeResults.runId, runId)).all();
  return { runId, paths: rows.filter((row) => row.outputPath).map((row) => row.outputPath!) };
}

describe("常规：产物落盘", () => {
  it("文件名按模板渲染，默认落在数据目录下的 outputs/<runId>/", async () => {
    const ctx = await makeProject("模板测试", ["合并"]);
    updateSettings(ctx.db, { general: { fileNameTemplate: "{date}-{project}" } });

    const { runId, paths } = await runOnce(ctx);
    const expected = `outputs/${runId}/${formatFileNameDate(new Date())}-模板测试.md`;

    expect(paths).toEqual([expected]);
    expect(await readFile(join(ctx.dataDir, expected), "utf8")).toContain("用于验收的正文内容。");
  });

  it("多份产物且模板没写 {node} 时自动补节点名，节点同名也不互相覆盖", async () => {
    const ctx = await makeProject("多产物测试", ["提炼", "提炼"]);
    updateSettings(ctx.db, { general: { fileNameTemplate: "{project}" } });

    const { runId, paths } = await runOnce(ctx);
    expect(paths.sort()).toEqual([`outputs/${runId}/多产物测试-提炼-2.md`, `outputs/${runId}/多产物测试-提炼.md`]);
  });

  it("输出目录可以填数据目录之外的绝对路径，账本会把它标出来", async () => {
    const ctx = await makeProject("外置目录测试", ["合并"]);
    const external = join(ctx.root, "我的笔记");
    updateSettings(ctx.db, { general: { outputDir: external } });

    const { runId, paths } = await runOnce(ctx);
    const abs = join(external, runId, "外置目录测试.md");

    expect(resolveOutputRoot(ctx.dataDir, external)).toBe(resolve(external));
    // 数据目录之外用绝对路径记录，否则读回时会被当成相对路径拼到数据目录下。
    expect(paths).toEqual([abs.split(sep).join("/")]);
    expect((await stat(abs)).isFile()).toBe(true);

    const overview = await buildDataOverview({
      db: ctx.db,
      dataDir: ctx.dataDir,
      outputRoot: resolveOutputRoot(ctx.dataDir, external),
      deleteRun: () => Promise.resolve(),
    });
    const area = overview.areas.find((item) => item.key === "outputs");
    expect(area?.label).toContain("数据目录之外");
    expect(area?.files).toBe(1);
  });

  it("相对路径用 .. 爬到数据目录之外时回退到默认目录", async () => {
    const ctx = await makeProject("越界目录测试", ["合并"]);
    updateSettings(ctx.db, { general: { outputDir: "../outside" } });

    const { runId, paths } = await runOnce(ctx);
    expect(paths).toEqual([`outputs/${runId}/越界目录测试.md`]);
  });
});

/** 只要一个能读写的空库，不需要跑引擎。 */
async function tempDb(): Promise<AppDatabase> {
  const root = await mkdtemp(join(tmpdir(), "scribe-general-settings-"));
  tmpDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  return createDatabase(dataDir);
}

describe("常规：设置读写", () => {
  it("新增的字段有默认值，写入后能读回", async () => {
    const db = await tempDb();

    expect(getSettings(db).general).toMatchObject({
      concurrency: 2,
      outputDir: "outputs",
      fileNameTemplate: "{project}",
      maxRetries: 2,
      retryBackoffSec: 3,
      runEndNotify: true,
      runEndSound: false,
    });

    const patch: UpdateSettingsRequest = {
      general: {
        concurrency: 3,
        outputDir: "D:\\笔记",
        fileNameTemplate: "{date}-{project}",
        maxRetries: 0,
        retryBackoffSec: 8,
        runEndNotify: false,
        runEndSound: true,
      },
    };
    updateSettings(db, patch);
    // maxRetries 的合法值是 0，读写不能把它当成「没传」而丢掉。
    expect(getSettings(db).general).toMatchObject({
      concurrency: 3,
      outputDir: "D:\\笔记",
      fileNameTemplate: "{date}-{project}",
      maxRetries: 0,
      retryBackoffSec: 8,
      runEndNotify: false,
      runEndSound: true,
    });
  });

  it("超出范围的数值被收口，而不是原样落库", async () => {
    const db = await tempDb();

    updateSettings(db, { general: { concurrency: 99, maxRetries: 99, retryBackoffSec: 999 } });
    expect(getSettings(db).general).toMatchObject({ concurrency: 4, maxRetries: 10, retryBackoffSec: 60 });
  });
});
