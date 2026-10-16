import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { createDatabase } from "../db/client";
import { appSettings, runNodeInputs, runNodeResults, runs } from "../db/schema";

/**
 * 「换了素材却只重跑下游」的运行前预检。
 *
 * 背景（2026-10-15 实际发生）：在《中美社保对比》上跑完后把来源卡换成另一个视频，只重跑溯源节点，
 * 上游「校对」沿用了旧视频的产物，报告把旧素材的内容归到了新视频头上，且从产物上完全看不出来。
 *
 * 这组用例的重点一半在**不误拦**：素材没变、跑全流程、身份判不出来时都必须照旧放行。
 */
const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-stale-material-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  // 种 AI 与 ASR 密钥：运行预检里「缺密钥就别启动」排在前面，不种的话测不到后面那条预检
  //（全流程那条含转写节点，缺 ASR 密钥会被另一条预检拦下）。
  db.insert(appSettings).values({ key: "ai.apiKey", value: "sk-test", updatedAt: Date.now() }).run();
  db.insert(appSettings).values({ key: "asr.apiKey", value: "sk-asr", updatedAt: Date.now() }).run();
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, db };
}

type App = ReturnType<typeof createApp>;

const json = (app: App, path: string, method: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** 来源卡 → 校对 → 溯源，和出事的那个工程同一形状。 */
const chainGraph = (bvid: string) => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "n_src",
      type: "source.bili",
      position: { x: 0, y: 0 },
      data: { url: `https://www.bilibili.com/video/${bvid}`, bvid, page: 1, title: "测试视频" },
    },
    { id: "n_asr", type: "process.transcribe", position: { x: 200, y: 0 }, data: {} },
    { id: "n_refine", type: "process.refine", position: { x: 400, y: 0 }, data: { label: "校对" } },
    { id: "n_trace", type: "process.prompt", position: { x: 600, y: 0 }, data: { label: "信息溯源", promptBlockId: "builtin.trace.v3" } },
  ],
  // 与真实工程同形状：来源卡出的是 audio，得经转写才有文稿。
  edges: [
    { id: "e1", source: "n_src", target: "n_asr", sourceHandle: "audio", targetHandle: "audio" },
    { id: "e2", source: "n_asr", target: "n_refine", sourceHandle: "transcript", targetHandle: "transcript" },
    { id: "e3", source: "n_refine", target: "n_trace", sourceHandle: "transcript", targetHandle: "transcript" },
  ],
});

async function createProject(app: App, graph: unknown, name = "预检验收") {
  const created = await json(app, "/api/projects", "POST", { name });
  expect(created.status).toBe(201);
  const projectId = ((await created.json()) as { id: string }).id;
  const put = await json(app, `/api/projects/${projectId}/graph`, "PUT", { graph });
  expect(put.status).toBe(200);
  return projectId;
}

/** 伪造一次「校对节点跑过一次」的历史：产物 + 它消费过的素材身份。 */
function seedRefineHistory(db: ReturnType<typeof createDatabase>, projectId: string, itemKey: string) {
  const runId = `run_seed_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(runs).values({ id: runId, projectId, status: "success", scope: "all", createdAt: Date.now(), graphJson: "{}" }).run();
  db.insert(runNodeResults)
    .values({
      id: `nnr_${runId}`,
      runId,
      nodeId: "n_refine",
      nodeType: "process.refine",
      nodeLabel: "校对",
      status: "done",
      outputKind: "text",
      outputText: "这是上一个素材的校对稿。",
      updatedAt: Date.now(),
    })
    .run();
  db.insert(runNodeInputs)
    .values({ id: `nni_${runId}`, runId, targetNodeId: "n_refine", sourceNodeId: "n_src", kind: "text", text: "这是上一个素材的校对稿。", itemKey, position: 0, createdAt: Date.now() })
    .run();
  return runId;
}

/** 停止该工程正在跑的运行：引擎按工程串行，留着会让下一条用例起不来。 */
async function stopRun(app: App, projectId: string) {
  const latest = await (await app.request(`/api/runs?projectId=${projectId}&status=running&limit=1`)).json();
  const id = (latest as { items?: { id: string }[] }).items?.[0]?.id;
  if (id) await json(app, `/api/runs/${id}/stop`, "POST", {});
}

async function startRun(app: App, projectId: string, body: unknown) {
  const res = await json(app, `/api/projects/${projectId}/runs`, "POST", body);
  return { status: res.status, body: (await res.json()) as { error?: string; id?: string } };
}

describe("换了素材只重跑下游：运行前预检", () => {
  it("来源卡换成另一个视频后只重跑溯源节点 → 拒绝，并说清两个素材是谁", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app, chainGraph("BV19JhW6vExZ"));
    // 历史产物是社保那个视频算出来的，而来源卡现在是美联储
    seedRefineHistory(db, projectId, "bvid:BV1DTWw6UE1y:1");

    const { status, body } = await startRun(app, projectId, { scope: "fromNode", nodeId: "n_trace" });
    expect(status).toBe(400);
    expect(body.error).toContain("BV1DTWw6UE1y");
    expect(body.error).toContain("校对");
    // 起点必须说清：只说「运行上游节点」的话，只跑「校对」会被再拦一次（它上游的转写也是旧的）
    expect(body.error).toContain("请从「转写」开始跑");
    // 画布上会有好几个「AI 加工」，只说默认名等于没说：带上它选的提示词才定位得到
    expect(body.error).toContain("信息溯源 · 上网查证");
  });

  it("拒绝发生在启动前：库里不会多出一条运行记录（而不是「跑起来立刻失败」）", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app, chainGraph("BV19JhW6vExZ"));
    seedRefineHistory(db, projectId, "bvid:BV1DTWw6UE1y:1");
    const before = db.select().from(runs).where(eq(runs.projectId, projectId)).all().length;

    await startRun(app, projectId, { scope: "fromNode", nodeId: "n_trace" });

    expect(db.select().from(runs).where(eq(runs.projectId, projectId)).all().length).toBe(before);
  });

  it("**不误拦**：素材没变时照旧放行（同一张卡、同一集）", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app, chainGraph("BV1DTWw6UE1y"));
    seedRefineHistory(db, projectId, "bvid:BV1DTWw6UE1y:1");
    const { status } = await startRun(app, projectId, { scope: "fromNode", nodeId: "n_trace" });
    expect(status).toBe(202);
    // 让它跑完/停掉，避免影响后续用例（同一进程内的引擎不接受同工程并发运行）
    await stopRun(app, projectId);
  });

  it("**不误拦**：跑全流程时不存在沿用旧产物的问题", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app, chainGraph("BV19JhW6vExZ"));
    seedRefineHistory(db, projectId, "bvid:BV1DTWw6UE1y:1");
    const { status, body } = await startRun(app, projectId, { scope: "all" });
    // 全流程会重跑来源卡与校对，不存在「沿用旧产物」，这条预检不该出现
    expect(body.error ?? "").not.toContain("先运行上游节点");
    expect(status).toBe(202);
    await stopRun(app, projectId);
  });

  it("**不误拦**：历史产物没有记素材身份时判不出来，放行", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app, chainGraph("BV19JhW6vExZ"));
    const runId = seedRefineHistory(db, projectId, "placeholder");
    // 抹掉身份记录：更早版本留下的产物就是这样，无从判断，只能放行
    db.delete(runNodeInputs).where(eq(runNodeInputs.runId, runId)).run();
    const { status } = await startRun(app, projectId, { scope: "fromNode", nodeId: "n_trace" });
    expect(status).toBe(202);
    await stopRun(app, projectId);
  });

  it("**不误拦**：跑的是来源卡自己（没有上游）", async () => {
    const { app, db } = await setup();
    const projectId = await createProject(app, chainGraph("BV19JhW6vExZ"));
    seedRefineHistory(db, projectId, "bvid:BV1DTWw6UE1y:1");
    const { status } = await startRun(app, projectId, { scope: "node", nodeId: "n_src" });
    expect(status).not.toBe(400);
  });
});
