import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import type { RunMeta } from "@scribe-flow/shared";
import { createApp } from "../app";
import { createDatabase } from "../db/client";
import { projects, runs } from "../db/schema";
import { defaultRunName, runNameForScope } from "../lib/run-name";

/**
 * 运行记录的默认名：列表与详情页都靠它认人。
 * 这里钉住四件事——新运行自动带名、从节点重跑带节点名、用户改名/清空优先、历史数据只回填一次。
 */

const cleanupDirs: string[] = [];
/** 与 client.ts 里 `RUN_NAME_MIGRATION_KEY` 保持一致：测试要模拟「升级前的旧库」。 */
const MIGRATION_KEY = "migration.runs-default-name";

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-run-name-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, db, dataDir };
}

/** 建一个只有「文本 → 文本工具」的工程：全本地节点，跑起来不需要任何密钥。 */
async function createProject(app: ReturnType<typeof createApp>, name = "运行记录默认名验收") {
  const graph = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文稿", text: "一段用于验收的文稿。" } },
      { id: "n_tool", type: "process.text", position: { x: 300, y: 0 }, data: { label: "文本工具", operation: "cleanup" } },
    ],
    edges: [{ id: "e1", source: "n_src", target: "n_tool", sourceHandle: "transcript", targetHandle: "in" }],
  };
  const project = (await (
    await app.request("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, graph }),
    })
  ).json()) as { id: string };
  return project.id;
}

async function startRun(app: ReturnType<typeof createApp>, projectId: string, body: unknown = { scope: "all" }) {
  const res = await app.request(`/api/projects/${projectId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as RunMeta & { error?: string } };
}

/** 直接把库里的运行收尾：同一工程同时只允许一个运行，起第二条前要把第一条跑完。 */
function finishAllRuns(db: ReturnType<typeof createDatabase>): void {
  db.update(runs).set({ status: "success" }).run();
}

/** 用另一个连接删掉迁移标记，模拟「这个库是升级前建的」。 */
function clearMigrationFlag(dataDir: string): void {
  const sqlite = new Database(join(dataDir, "scribe-flow.sqlite"));
  try {
    sqlite.exec(`DELETE FROM app_settings WHERE key = '${MIGRATION_KEY}'`);
  } finally {
    sqlite.close();
  }
}

describe("运行记录的默认名", () => {
  it("新建运行落库时就带名字，并按工程内的创建顺序编号", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app);

    const first = await startRun(app, projectId);
    expect(first.body.name).toBe("第 1 次运行");

    finishAllRuns(db);
    const second = await startRun(app, projectId);
    expect(second.body.name).toBe("第 2 次运行");

    // 另一个工程从「第 1 次运行」重新数，编号不跨工程串。
    const otherProject = await createProject(app, "另一个工程");
    finishAllRuns(db);
    const other = await startRun(app, otherProject);
    expect(other.body.name).toBe("第 1 次运行");
  });

  it("从某个节点重跑时带上节点名，免得看不出这次只跑了哪一步", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app);
    await startRun(app, projectId);
    finishAllRuns(db);

    const rerun = await startRun(app, projectId, { scope: "node", nodeId: "n_tool" });
    expect(rerun.body.name).toBe("第 2 次运行 · 重跑「文本工具」");
  });

  it("用户改名覆盖默认名，清空后名字真的为空（列表回落到只显示时间）", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app);
    await startRun(app, projectId);
    const runId = db.select().from(runs).all()[0].id;

    const rename = (name: string) =>
      app.request(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    expect(((await (await rename("第 12 期 · 记忆系统")).json()) as RunMeta).name).toBe("第 12 期 · 记忆系统");
    // 详情接口（结果页每次进来都调它）也必须带名字：漏了它，刷新一页改过的名就没了。
    expect(((await (await app.request(`/api/runs/${runId}`)).json()) as RunMeta).name).toBe("第 12 期 · 记忆系统");
    // 清空后接口不再回名字字段（RunMeta.name 是可选的，库里记 null）。
    expect(((await (await rename("")).json()) as RunMeta).name).toBeUndefined();
    expect(db.select().from(runs).all()[0].name).toBeNull();
  });

  it("历史运行（名字为空）在打开库时补一次默认名，用户起过的名字不被覆盖", async () => {
    const { db, dataDir } = await setup();
    db.insert(projects)
      .values({ id: "p1", name: "旧工程", description: "", graphJson: "{}", schemaVersion: 1, createdAt: 1, updatedAt: 1 })
      .run();
    const seed = (id: string, createdAt: number, name: string | null) =>
      db.insert(runs).values({ id, projectId: "p1", status: "success", scope: "all", createdAt, name }).run();
    seed("run_1", 100, null);
    seed("run_2", 200, "改名过的第二次");
    seed("run_3", 300, null);

    clearMigrationFlag(dataDir);
    const reopened = createDatabase(dataDir);
    const byId = new Map(reopened.select().from(runs).all().map((row) => [row.id, row.name]));
    expect(byId.get("run_1")).toBe("第 1 次运行");
    expect(byId.get("run_2")).toBe("改名过的第二次");
    // 编号按创建顺序数（含已有名字的那条），所以第三条是「第 3 次运行」而不是「第 2 次运行」。
    expect(byId.get("run_3")).toBe("第 3 次运行");
  });

  it("回填只做一次：迁移之后用户手动清空的名字，重开库不会被重新命名", async () => {
    const { db, dataDir } = await setup();
    db.insert(projects)
      .values({ id: "p1", name: "旧工程", description: "", graphJson: "{}", schemaVersion: 1, createdAt: 1, updatedAt: 1 })
      .run();
    db.insert(runs).values({ id: "run_1", projectId: "p1", status: "success", scope: "all", createdAt: 100, name: null }).run();

    clearMigrationFlag(dataDir);
    createDatabase(dataDir); // 第一次打开：回填，并写下迁移标记
    db.update(runs).set({ name: null }).where(eq(runs.id, "run_1")).run();

    const again = createDatabase(dataDir); // 第二次打开：标记已在，不该再动这行
    expect(again.select().from(runs).all().find((row) => row.id === "run_1")?.name).toBeNull();
  });

  it("节点已被删除的重跑仍能起名（不因为找不到节点就空着）", () => {
    const graph = { schemaVersion: 1 as const, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };
    expect(runNameForScope(defaultRunName(3), graph, "node", "n_missing")).toBe("第 3 次运行 · 重跑「未知节点」");
    expect(runNameForScope(defaultRunName(3), graph, "all")).toBe("第 3 次运行");
  });
});
