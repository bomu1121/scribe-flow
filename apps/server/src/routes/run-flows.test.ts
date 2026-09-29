import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDatabase } from "../db/client";

/**
 * 运行链路的端到端集成测试（进程内，不需要起 dev server）。
 *
 * 这三组断言原先住在三个手工脚本里：`scripts/m3-api-check.mjs`、`m4-api-check.mjs`、`m6-api-check.mjs`。
 * 它们要先把 `pnpm dev` 拉起来、按固定端口访问一个真实服务，因此**从不在 CI 跑**——
 * 一年也不会有人发现自己写的断言已经失效。同一批断言放进 vitest 后，
 * 走的是 `createApp()` + `app.request()`，既没有端口也没有外部依赖，CI 每次都会跑。
 *
 * 留在手工脚本里的只剩那些**需要真实外部凭据**的检查：m2（B 站扫码登录）与 drill（真实 AI 密钥）。
 */
const cleanupDirs: string[] = [];

afterEach(async () => {
  // Windows 上 sqlite 句柄可能短暂占用文件，删除失败可忽略（留在系统临时目录）。
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sf-run-flows-"));
  cleanupDirs.push(root);
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase(dataDir);
  const app = createApp(db, { dataDir, uploadsDir: join(dataDir, "uploads"), maxUploadMb: 10, docsDir: join(root, "docs") });
  return { app, db, dataDir };
}

type App = ReturnType<typeof createApp>;

const json = (app: App, path: string, method: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const getJson = async <T>(app: App, path: string): Promise<T> => (await (await app.request(path)).json()) as T;

/** 建工程 → 写图 → 跑一次，返回工程与运行 id。 */
async function runGraph(app: App, graph: unknown, name = "集成验收") {
  const created = await json(app, "/api/projects", "POST", { name });
  expect(created.status).toBe(201);
  const projectId = ((await created.json()) as { id: string }).id;

  const put = await json(app, `/api/projects/${projectId}/graph`, "PUT", { graph });
  expect(put.status).toBe(200);

  const started = await json(app, `/api/projects/${projectId}/runs`, "POST", { scope: "all" });
  expect(started.status).toBe(202);
  const runId = ((await started.json()) as { id: string }).id;
  return { projectId, runId };
}

type RunDetail = {
  status: string;
  summary?: string;
  nodeResults?: { nodeId: string; status: string; output?: Record<string, unknown> }[];
};

/** 轮询到运行结束。引擎在进程内跑，正常几百毫秒内结束。 */
async function waitRun(app: App, runId: string, timeoutMs = 20_000): Promise<RunDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await getJson<RunDetail>(app, `/api/runs/${runId}`);
    if (detail.status !== "running") return detail;
    if (Date.now() > deadline) throw new Error(`运行超时：${runId}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const nodeOf = (detail: RunDetail, nodeId: string) => detail.nodeResults?.find((n) => n.nodeId === nodeId);

/* ------------------------------------------------------------------ 图定义 */

const textGraph = {
  schemaVersion: 1,
  nodes: [
    { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "这是引擎验收文稿。\n第二段内容。" } },
    { id: "n_merge", type: "process.merge", position: { x: 200, y: 0 }, data: { label: "合并", title: "验收笔记" } },
    { id: "n_out", type: "process.output", position: { x: 400, y: 0 }, data: { label: "输出", fileName: "验收.md" } },
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_merge", sourceHandle: "transcript", targetHandle: "noteBlock" },
    { id: "e2", source: "n_merge", target: "n_out", sourceHandle: "noteDoc", targetHandle: "noteDoc" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const branchGraph = {
  schemaVersion: 1,
  nodes: [
    { id: "n_src", type: "source.text", position: { x: 0, y: 0 }, data: { label: "文本", text: "这是 用于条件分支验收的 文稿， 内容 足够长。" } },
    {
      id: "n_if",
      type: "flow.if",
      position: { x: 200, y: 0 },
      data: { label: "条件分支", condition: { field: "charCount", op: "gt", value: "10" } },
    },
    {
      id: "n_true_text",
      type: "process.text",
      position: { x: 420, y: -80 },
      data: { label: "正则清理", operation: "regexReplace", pattern: "\\s+", replace: "", flags: "g" },
    },
    { id: "n_false_text", type: "process.text", position: { x: 420, y: 80 }, data: { label: "不走的文本", operation: "cleanup" } },
    { id: "n_true_out", type: "process.output", position: { x: 640, y: -80 }, data: { label: "输出 true", fileName: "true.md" } },
    { id: "n_false_out", type: "process.output", position: { x: 640, y: 80 }, data: { label: "输出 false", fileName: "false.md" } },
  ],
  edges: [
    { id: "e1", source: "n_src", target: "n_if", sourceHandle: "transcript", targetHandle: "in" },
    { id: "e2", source: "n_if", target: "n_true_text", sourceHandle: "true", targetHandle: "in" },
    { id: "e3", source: "n_if", target: "n_false_text", sourceHandle: "false", targetHandle: "in" },
    { id: "e4", source: "n_true_text", target: "n_true_out", sourceHandle: "out", targetHandle: "noteDoc" },
    { id: "e5", source: "n_false_text", target: "n_false_out", sourceHandle: "out", targetHandle: "noteDoc" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

/* ------------------------------------------------------------------ 文本链路 */

describe("文本链路端到端（原 scripts/m3-api-check.mjs）", () => {
  it("设置默认值与保存", async () => {
    const { app } = await setup();
    const settings = await getJson<{ ai: { provider: string }; asr: { engine: string } }>(app, "/api/settings");
    expect(settings.ai.provider).toBe("deepseek");
    expect(settings.asr.engine).toBe("mimo");

    const put = await json(app, "/api/settings", "PUT", { general: { concurrency: 2, outputDir: "outputs" } });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { general: { concurrency: number } }).general.concurrency).toBe(2);
  });

  it("跑通三节点文本链路，产物落盘带路径", async () => {
    const { app } = await setup();
    const { projectId, runId } = await runGraph(app, textGraph);

    const detail = await waitRun(app, runId);
    expect(detail.status).toBe("success");
    expect(detail.nodeResults?.every((n) => n.status === "done")).toBe(true);
    expect(detail.nodeResults?.some((n) => String(n.output?.path ?? "").endsWith("验收.md"))).toBe(true);

    const list = await getJson<{ items: { id: string }[] }>(app, "/api/runs");
    expect(list.items.some((r) => r.id === runId)).toBe(true);

    await json(app, `/api/projects/${projectId}`, "DELETE");
  });

  it("单节点重跑复用上一次产物；stop 与删除接口可用", async () => {
    const { app } = await setup();
    const { projectId, runId } = await runGraph(app, textGraph);
    await waitRun(app, runId);

    const retry = await json(app, `/api/runs/${runId}/nodes/n_merge/retry`, "POST");
    expect(retry.status).toBe(202);
    const retryBody = (await retry.json()) as { id: string; scope: string };
    expect(retryBody.scope).toBe("node");

    const retryDetail = await waitRun(app, retryBody.id);
    expect(retryDetail.status).toBe("success");
    expect(nodeOf(retryDetail, "n_merge")?.status).toBe("done");

    const stop = await json(app, `/api/runs/${runId}/stop`, "POST");
    expect(stop.status).toBe(200);
    expect(((await stop.json()) as { ok: boolean }).ok).toBe(true);

    expect((await json(app, `/api/runs/${retryBody.id}`, "DELETE")).status).toBe(200);
    expect((await json(app, `/api/runs/${runId}`, "DELETE")).status).toBe(200);
    expect((await json(app, `/api/projects/${projectId}`, "DELETE")).status).toBe(200);
  });

  it("SSE 端点以事件流响应", async () => {
    // 只断言契约（200 + text/event-stream），不断言事件内容：文本链路在进程内几百毫秒就跑完，
    // 而「快照与订阅之间运行结束」的建连竞态是 README 里登记的已知缺口——
    // 在这里断言事件序列会把一个已知缺陷变成随机失败的测试。
    const { app } = await setup();
    const { projectId, runId } = await runGraph(app, textGraph);

    const res = await app.request(`/api/runs/${runId}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    await res.body?.cancel().catch(() => undefined);

    await waitRun(app, runId);
    await json(app, `/api/projects/${projectId}`, "DELETE");
  });
});

/* -------------------------------------------------- 提示词块 / 日志 / 账本 */

describe("提示词块、运行日志与数据账本（原 scripts/m4-api-check.mjs）", () => {
  it("提示词块库 CRUD，且内置块不可删", async () => {
    const { app } = await setup();

    const created = await json(app, "/api/prompts", "POST", { name: "验收块", prompt: "这是验收提示词。" });
    expect(created.status).toBe(201);
    const blockId = ((await created.json()) as { id: string }).id;
    expect(blockId.startsWith("custom.")).toBe(true);

    const patched = await json(app, `/api/prompts/${blockId}`, "PATCH", { name: "验收块（改）", prompt: "修改后的提示词。" });
    expect(patched.status).toBe(200);

    const list = await getJson<{ items: { id: string; name?: string; builtin?: boolean }[] }>(app, "/api/prompts");
    expect(list.items.some((b) => b.id === blockId && b.name?.includes("（改）"))).toBe(true);
    // 内置块数量不写死：新增内置块是常态，写死只会记录过去的事实。
    expect(list.items.filter((b) => b.builtin).length).toBeGreaterThan(0);

    expect((await json(app, `/api/prompts/${blockId}`, "DELETE")).status).toBe(200);
    expect((await json(app, "/api/prompts/builtin.insight", "DELETE")).status).toBe(400);
  });

  it("运行日志带输入与输出文件信息，且可按节点过滤", async () => {
    const { app } = await setup();
    const { projectId, runId } = await runGraph(app, textGraph, "日志验收");
    const detail = await waitRun(app, runId);
    expect(detail.status).toBe("success");

    const logs = await getJson<{ items: { kind: string; content: string; nodeId?: string }[] }>(app, `/api/runs/${runId}/logs`);
    expect(logs.items.length).toBeGreaterThanOrEqual(2);
    expect(logs.items.some((l) => l.kind === "input")).toBe(true);
    expect(logs.items.some((l) => l.kind === "info" && l.content.includes("验收.md"))).toBe(true);

    const nodeLogs = await getJson<{ items: { nodeId?: string }[] }>(app, `/api/runs/${runId}/logs?nodeId=n_out`);
    expect(nodeLogs.items.every((l) => l.nodeId === "n_out")).toBe(true);

    await json(app, `/api/projects/${projectId}`, "DELETE");
  });

  it("数据账本六个分区、合计自洽、清理计划只验契约", async () => {
    const { app } = await setup();
    const { projectId, runId } = await runGraph(app, textGraph, "账本验收");
    await waitRun(app, runId);

    type Ledger = {
      areas: { key: string; bytes: number; files: number }[];
      totals: { bytes: number; files: number };
      runs: { total: number; finished: number };
      projects: { total: number };
      cleanup: { target: string; count: number; bytes: number; rule: string }[];
      reclaimableBytes: number;
    };
    const overview = await getJson<Ledger>(app, "/api/settings/data");
    const keys = overview.areas.map((a) => a.key);
    for (const key of ["database", "media", "uploads", "runs", "outputs", "graphBackups"]) expect(keys).toContain(key);

    expect(overview.totals.bytes).toBe(overview.areas.reduce((sum, a) => sum + a.bytes, 0));
    expect(overview.totals.files).toBe(overview.areas.reduce((sum, a) => sum + a.files, 0));
    expect(overview.areas.find((a) => a.key === "outputs")?.files ?? 0).toBeGreaterThanOrEqual(1);
    expect(overview.runs.total).toBeGreaterThanOrEqual(1);
    expect(overview.runs.finished).toBeGreaterThanOrEqual(1);
    expect(overview.projects.total).toBeGreaterThanOrEqual(1);
    expect(overview.cleanup.length).toBe(5);
    expect(overview.cleanup.every((item) => typeof item.count === "number" && typeof item.bytes === "number" && typeof item.rule === "string")).toBe(true);
    expect(overview.reclaimableBytes).toBe(overview.cleanup.reduce((sum, item) => sum + item.bytes, 0));

    // 只验入参契约：真正的删除路径由 storage 的单测在临时目录里覆盖，
    // 集成测试不去动自己的数据目录。
    expect((await json(app, "/api/settings/prune", "POST", {})).status).toBe(400);
    expect((await json(app, "/api/settings/prune", "POST", { targets: ["nope"] })).status).toBe(400);

    await json(app, `/api/projects/${projectId}`, "DELETE");
  });
});

/* -------------------------------------------------------- 条件分支与文本工具 */

describe("条件分支与文本工具（原 scripts/m6-api-check.mjs）", () => {
  it("非法的重试配置被图校验拒绝", async () => {
    const { app } = await setup();
    const created = await json(app, "/api/projects", "POST", { name: "非法重试" });
    const projectId = ((await created.json()) as { id: string }).id;

    const invalid = structuredClone(branchGraph) as typeof branchGraph & { nodes: { data: Record<string, unknown> }[] };
    invalid.nodes[1].data.retry = { maxRetries: -1, backoffMs: 3000 };

    const put = await json(app, `/api/projects/${projectId}/graph`, "PUT", { graph: invalid });
    expect(put.status).toBe(400);
    await json(app, `/api/projects/${projectId}`, "DELETE");
  });

  it("branch 只走 true 路，false 路连同下游一起跳过", async () => {
    const { app } = await setup();
    const { projectId, runId } = await runGraph(app, branchGraph, "分支验收");
    const detail = await waitRun(app, runId);

    expect(detail.status).toBe("success");
    expect(nodeOf(detail, "n_true_text")?.status).toBe("done");
    expect(nodeOf(detail, "n_false_text")?.status).toBe("skipped");
    expect(nodeOf(detail, "n_true_out")?.status).toBe("done");
    expect(nodeOf(detail, "n_false_out")?.status).toBe("skipped");
    expect(String(nodeOf(detail, "n_true_text")?.output?.text ?? "")).not.toContain(" ");

    await json(app, `/api/projects/${projectId}`, "DELETE");
  });
});
