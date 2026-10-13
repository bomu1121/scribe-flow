import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDatabase } from "../db/client";

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-projects-api-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app };
}

type App = ReturnType<typeof createApp>;

const EMPTY_GRAPH = { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

function textNode(id: string, index: number) {
  return { id, type: "source.text", position: { x: index * 100, y: 0 }, data: { text: "占位文稿" } };
}

function graphOf(nodes: ReturnType<typeof textNode>[]) {
  return { schemaVersion: 1, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

/** 建一个带 2 个节点的工程，返回它的 id。 */
async function seedProject(app: App, name = "护栏测试工程") {
  const created = await app.request("/api/projects/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      graph: graphOf([textNode("n_a", 0), textNode("n_b", 1)]),
    }),
  });
  return ((await json(created)) as { id: string }).id;
}

async function putGraph(app: App, id: string, body: unknown) {
  return app.request(`/api/projects/${id}/graph`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function nodeCount(app: App, id: string) {
  const res = await app.request(`/api/projects/${id}`);
  const data = (await json(res)) as { graph: { nodes: unknown[] } };
  return data.graph.nodes.length;
}

/**
 * 空图覆盖非空工程必须显式确认。
 *
 * 背景：前端的空图确认框只守得住「用户在画布上把节点删空」；编辑器以一个空画布启动时
 * （读工程失败、旧标签页还留着空画布）它的护栏等于不存在，一次自动保存就把整份工程写没
 * （2026-10-13 实际发生）。这道判断放在服务端，因为它与客户端时序无关。
 */
describe("工程图写回：空图覆盖非空工程的确认", () => {
  it("不带 confirmEmpty 写空图 → 409，且服务端保留原图", async () => {
    const { app } = await setup();
    const id = await seedProject(app);

    const res = await putGraph(app, id, { graph: EMPTY_GRAPH });
    expect(res.status).toBe(409);
    expect((await json(res)).needConfirmEmpty).toBe(true);
    expect(await nodeCount(app, id)).toBe(2);
  });

  it("带 confirmEmpty 写空图 → 200，确实清空", async () => {
    const { app } = await setup();
    const id = await seedProject(app);

    const res = await putGraph(app, id, { graph: EMPTY_GRAPH, confirmEmpty: true });
    expect(res.status).toBe(200);
    expect(await nodeCount(app, id)).toBe(0);
  });

  it("非空图覆盖非空工程不受影响", async () => {
    const { app } = await setup();
    const id = await seedProject(app);

    const res = await putGraph(app, id, { graph: graphOf([textNode("n_only", 0)]) });
    expect(res.status).toBe(200);
    expect(await nodeCount(app, id)).toBe(1);
  });

  it("空图覆盖本来就空的工程不拦（没有可丢的内容）", async () => {
    const { app } = await setup();
    const id = await seedProject(app);
    await putGraph(app, id, { graph: EMPTY_GRAPH, confirmEmpty: true });

    const res = await putGraph(app, id, { graph: EMPTY_GRAPH });
    expect(res.status).toBe(200);
  });
});
