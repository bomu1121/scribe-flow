import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  NODE_TYPE_LABELS,
  parseGraph,
  RUN_NAME_MAX_LENGTH,
  type NodeOutput,
  type RunEvent,
  type RunMeta,
  type RunNodeLog,
  type RunScope,
  type RunStatus,
} from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { projects, runNodeLogs, runNodeResults, runs, type RunRow } from "../db/schema";
import { nextRunId, type RunEngine } from "../lib/engine";
import { nodeIdsForScope } from "../lib/graph-scope";
import { defaultRunNameFor } from "../lib/run-name";
import { resolveArtifactPath } from "../lib/storage";
import { getAiConfig, getAsrConfig } from "../lib/settings";
import { badRequest } from "../lib/bad-request";
import { listRunMediaViews } from "../lib/media-store";

const startSchema = z
  .object({
    scope: z.enum(["all", "fromNode", "node"]),
    nodeId: z.string().optional(),
  })
  .refine((data) => data.scope === "all" || Boolean(data.nodeId), {
    message: "scope 为 fromNode/node 时必须提供 nodeId",
    path: ["nodeId"],
  });

/** 重命名运行记录：`name` 传 null 或空白表示清掉名字，列表回落到时间与状态。 */
const renameSchema = z.object({
  name: z.string().max(RUN_NAME_MAX_LENGTH, `名称最多 ${RUN_NAME_MAX_LENGTH} 个字`).nullable(),
});

function rowToMeta(row: RunRow, projectName?: string): RunMeta {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName,
    status: row.status,
    scope: row.scope,
    nodeId: row.nodeId ?? undefined,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt ?? undefined,
    elapsedMs: row.elapsedMs ?? undefined,
    name: row.name ?? undefined,
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
  };
}

export function createRun(db: AppDatabase, projectId: string, scope: RunScope, nodeId?: string) {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new Error("工程不存在");
  if (scope !== "all" && !nodeId) throw new Error("缺少节点 ID：scope 为 fromNode/node 时必须提供 nodeId");
  const existingRunning = db.select().from(runs).where(and(eq(runs.projectId, projectId), eq(runs.status, "running"))).get();
  if (existingRunning) throw new Error("该工程已有运行正在进行，请先等待或停止");
  const graph = parseGraph(JSON.parse(project.graphJson));
  if (scope !== "all" && nodeId && !graph.nodes.some((n) => n.id === nodeId)) {
    throw new Error("节点不存在");
  }

  // 执行前预检：缺失必要密钥时直接拒绝启动，避免“跑起来后才失败”。
  const scopeNodeIds = nodeIdsForScope(graph, scope, nodeId);
  const needsAi = graph.nodes.some((n) => scopeNodeIds.has(n.id) && (n.type === "process.refine" || n.type === "process.prompt" || n.type === "process.mindmap" || n.type === "process.drill"));
  const needsAsr = graph.nodes.some((n) => scopeNodeIds.has(n.id) && n.type === "process.transcribe");
  if (needsAi && !getAiConfig(db).apiKey) throw new Error("未配置 AI 模型密钥，请先到设置页填写");
  if (needsAsr && !getAsrConfig(db).apiKey) throw new Error("未配置语音识别密钥，请先到设置页填写");

  // 执行前预检：B 站来源节点必须有可识别的链接/BV 号，避免启动后才失败。
  const emptyBili = graph.nodes.find(
    (n) =>
      scopeNodeIds.has(n.id) &&
      n.type === "source.bili" &&
      !String(n.data.url ?? "").trim() &&
      !String(n.data.bvid ?? "").trim() &&
      !(Array.isArray(n.data.items) && n.data.items.length > 0),
  );
  if (emptyBili) {
    const label = emptyBili.data.label ?? NODE_TYPE_LABELS[emptyBili.type];
    throw new Error(`节点「${label}」的 B 站链接为空，请填写链接或删除该节点`);
  }

  const id = nextRunId();
  const createdAt = Date.now();
  // 落库时就带上默认名：列表与详情页都靠它认人（用户可随时改名覆盖，见 lib/run-name.ts）。
  const name = defaultRunNameFor(db, projectId, graph, scope, nodeId);
  db.insert(runs)
    .values({ id, projectId, status: "running", scope, nodeId: scope === "all" ? undefined : nodeId, createdAt, name, graphJson: JSON.stringify(graph) })
    .run();
  return { id, graph };
}

export function projectRunsApi(db: AppDatabase, engine: RunEngine) {
  const api = new Hono();

  api.post("/", async (c) => {
    const projectId = String(c.req.param("id"));
    const parsed = startSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    try {
      const { id, graph } = createRun(db, projectId, parsed.data.scope, parsed.data.nodeId);
      engine.start(id, projectId, graph, parsed.data.scope, parsed.data.nodeId);
      return c.json(engine.detail(id).run, 202);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "启动运行失败" }, 400);
    }
  });

  return api;
}

export function runsApi(db: AppDatabase, engine: RunEngine, dataDir: string) {
  const api = new Hono();

  api.get("/", (c) => {
    const projectId = c.req.query("projectId");
    const status = c.req.query("status") as RunStatus | undefined;
    const limit = Math.min(200, Number(c.req.query("limit") ?? 100) || 100);
    let rows: RunRow[];
    if (projectId && status) {
      rows = db
        .select()
        .from(runs)
        .where(and(eq(runs.projectId, projectId), eq(runs.status, status)))
        .orderBy(desc(runs.createdAt))
        .limit(limit)
        .all();
    } else if (projectId) {
      rows = db.select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt)).limit(limit).all();
    } else if (status) {
      rows = db.select().from(runs).where(eq(runs.status, status)).orderBy(desc(runs.createdAt)).limit(limit).all();
    } else {
      rows = db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit).all();
    }
    const projectNames = new Map(db.select().from(projects).all().map((p) => [p.id, p.name]));
    return c.json({ items: rows.map((row) => rowToMeta(row, projectNames.get(row.projectId))) });
  });

  api.get("/:id", async (c) => {
    const runId = c.req.param("id");
    const detail = engine.detail(runId);
    if (!detail.run) return c.json({ error: "运行不存在" }, 404);
    const media = await listRunMediaViews(db, dataDir, runId);
    return c.json({ ...detail.run, nodeResults: detail.nodes, graph: detail.graph, inputs: detail.inputs, media });
  });

  api.get("/:id/events", (c) => {
    const runId = c.req.param("id");
    const detail = engine.detail(runId);
    const currentRun = detail.run;
    if (!currentRun) return c.json({ error: "运行不存在" }, 404);

    return streamSSE(c, async (stream) => {
      const send = (event: RunEvent) => stream.writeSSE({ data: JSON.stringify(event) });
      let lastWrite: Promise<unknown> = Promise.resolve();
      let resolveDone: (() => void) | null = null;
      const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const finish = () => resolveDone?.();

      const unsubscribe = engine.subscribe(runId, (event) => {
        lastWrite = send(event);
        if (event.type === "run.done") finish();
      });
      const onAbort = () => finish();
      c.req.raw.signal.addEventListener("abort", onAbort, { once: true });

      // 连接时先补齐当前快照
      await send({ type: "run.started", run: currentRun });
      for (const node of detail.nodes) {
        if (node.status === "done") {
          const preview =
            node.output && (node.output.kind === "text" || node.output.kind === "noteBlock" || node.output.kind === "noteDoc")
              ? (node.output.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || undefined
              : undefined;
          await send({ type: "node.done", runId, nodeId: node.nodeId, summary: node.summary ?? "完成", preview });
        } else if (node.status === "error") {
          await send({ type: "node.error", runId, nodeId: node.nodeId, error: node.error ?? "失败" });
        } else if (node.status === "running") {
          // 连接/重连时补发 running 状态，避免前端只收到 run.started 后没有节点动效。
          await send({ type: "node.started", runId, nodeId: node.nodeId });
        }
      }
      if (currentRun.status !== "running") {
        await send({ type: "run.done", runId, status: currentRun.status });
        await lastWrite;
        unsubscribe();
        c.req.raw.signal.removeEventListener("abort", onAbort);
        return;
      }

      await donePromise;
      await lastWrite;
      unsubscribe();
      c.req.raw.signal.removeEventListener("abort", onAbort);
    });
  });

  api.post("/:id/stop", (c) => {
    const ok = engine.stop(c.req.param("id"));
    return c.json({ ok });
  });

  api.post("/:id/force-stop", (c) => {
    const ok = engine.forceStop(c.req.param("id"));
    return c.json({ ok });
  });

  api.post("/:id/nodes/:nodeId/retry", async (c) => {
    const previous = db.select().from(runs).where(eq(runs.id, c.req.param("id"))).get();
    if (!previous) return c.json({ error: "运行不存在" }, 404);
    try {
      const { id, graph } = createRun(db, previous.projectId, "node", c.req.param("nodeId"));
      engine.start(id, previous.projectId, graph, "node", c.req.param("nodeId"));
      return c.json(engine.detail(id).run, 202);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "重跑失败" }, 400);
    }
  });

  api.patch("/:id", async (c) => {
    const runId = c.req.param("id");
    if (!db.select().from(runs).where(eq(runs.id, runId)).get()) return c.json({ error: "运行不存在" }, 404);
    const parsed = renameSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(c, parsed);
    }
    const trimmed = parsed.data.name?.trim() ?? "";
    db.update(runs)
      .set({ name: trimmed === "" ? null : trimmed })
      .where(eq(runs.id, runId))
      .run();
    const updated = db.select().from(runs).where(eq(runs.id, runId)).get();
    return c.json(rowToMeta(updated!));
  });

  api.delete("/:id", async (c) => {
    const runId = c.req.param("id");
    const row = db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!row) return c.json({ error: "运行不存在" }, 404);
    if (row.status === "running") return c.json({ error: "运行中不可删除，请先停止或等待结束" }, 400);
    await engine.deleteRun(runId);
    return c.json({ ok: true });
  });

  api.get("/:id/logs", (c) => {
    const runId = c.req.param("id");
    const nodeId = c.req.query("nodeId");
    const step = c.req.query("step");
    if (!db.select().from(runs).where(eq(runs.id, runId)).get()) return c.json({ error: "运行不存在" }, 404);
    let rows = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).orderBy(runNodeLogs.createdAt).all();
    if (nodeId) rows = rows.filter((r) => r.nodeId === nodeId);
    if (step) rows = rows.filter((r) => r.step === step);
    const labels = new Map(db.select().from(runNodeResults).where(eq(runNodeResults.runId, runId)).all().map((r) => [r.nodeId, r.nodeLabel ?? r.nodeType]));
    const items: RunNodeLog[] = rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      nodeId: row.nodeId,
      nodeLabel: labels.get(row.nodeId),
      kind: row.kind,
      content: row.content,
      step: row.step ?? undefined,
      inputIndex: row.inputIndex ?? undefined,
      inputTotal: row.inputTotal ?? undefined,
      createdAt: row.createdAt,
    }));
    return c.json({ items });
  });

  api.get("/:id/outputs/:nodeId", (c) => {
    const row = db
      .select()
      .from(runNodeResults)
      .where(eq(runNodeResults.runId, c.req.param("id")))
      .all()
      .find((r) => r.nodeId === c.req.param("nodeId"));
    if (!row) return c.json({ error: "节点结果不存在" }, 404);
    const output: NodeOutput | undefined = row.outputKind
      ? { kind: row.outputKind, text: row.outputText ?? undefined, path: row.outputPath ?? undefined, size: row.outputSize ?? undefined }
      : undefined;
    return c.json({ status: row.status, error: row.error, summary: row.summary, output });
  });

  api.get("/:id/outputs/:nodeId/content", async (c) => {
    const row = db
      .select()
      .from(runNodeResults)
      .where(eq(runNodeResults.runId, c.req.param("id")))
      .all()
      .find((r) => r.nodeId === c.req.param("nodeId"));
    if (!row) return c.json({ error: "节点结果不存在" }, 404);
    if (row.outputText) return c.json({ text: row.outputText, size: row.outputSize ?? row.outputText.length });
    if (!row.outputPath) return c.json({ text: "" });
    const abs = resolveArtifactPath(dataDir, row.outputPath);
    const text = await readFile(abs, "utf8");
    return c.json({ text, size: text.length });
  });

  api.get("/:id/outputs/:nodeId/download", async (c) => {
    const row = db
      .select()
      .from(runNodeResults)
      .where(eq(runNodeResults.runId, c.req.param("id")))
      .all()
      .find((r) => r.nodeId === c.req.param("nodeId"));
    if (!row?.outputPath) return c.json({ error: "没有可下载的文件" }, 404);
    const abs = resolveArtifactPath(dataDir, row.outputPath);
    const data = await readFile(abs);
    const name = row.outputPath.split("/").pop() ?? "output";
    c.header("Content-Type", name.endsWith(".wav") ? "audio/wav" : "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
    return c.body(data as never);
  });

  return api;
}
