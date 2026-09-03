import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  NODE_TYPE_LABELS,
  parseGraph,
  type NodeOutput,
  type RunEvent,
  type RunMeta,
  type RunNodeLog,
  type RunNodeResult,
  type RunScope,
  type StartRunRequest,
} from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { projects, runNodeLogs, runNodeResults, runs, type RunRow } from "../db/schema";
import { nextRunId, type RunEngine } from "../lib/engine";
import { getAiConfig, getAsrConfig } from "../lib/settings";

const startSchema = z
  .object({
    scope: z.enum(["all", "fromNode", "node"]),
    nodeId: z.string().optional(),
  })
  .refine((data) => data.scope === "all" || Boolean(data.nodeId), {
    message: "scope 为 fromNode/node 时必须提供 nodeId",
    path: ["nodeId"],
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
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
  };
}

function rowToNodeResult(row: (typeof runNodeResults)["$inferSelect"]): RunNodeResult {
  return {
    nodeId: row.nodeId,
    nodeType: row.nodeType,
    nodeLabel: row.nodeLabel ?? undefined,
    status: row.status,
    elapsedMs: row.elapsedMs,
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
    output: row.outputKind
      ? { kind: row.outputKind, text: row.outputText ?? undefined, path: row.outputPath ?? undefined, size: row.outputSize ?? undefined }
      : undefined,
  };
}

function nodeIdsForScope(graph: ReturnType<typeof parseGraph>, scope: RunScope, nodeId?: string): Set<string> {
  const all = new Set(graph.nodes.map((n) => n.id));
  if (scope === "node" && nodeId) return new Set([nodeId]);
  if (scope === "fromNode" && nodeId) {
    const result = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges) {
        if (result.has(edge.source) && !result.has(edge.target)) {
          result.add(edge.target);
          changed = true;
        }
      }
    }
    return result;
  }
  return all;
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
  const needsAi = graph.nodes.some((n) => scopeNodeIds.has(n.id) && (n.type === "process.refine" || n.type === "process.prompt" || n.type === "process.mindmap"));
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
  db.insert(runs).values({ id, projectId, status: "running", scope, nodeId: scope === "all" ? undefined : nodeId, createdAt, graphJson: JSON.stringify(graph) }).run();
  return { id, graph };
}

export function projectRunsApi(db: AppDatabase, engine: RunEngine) {
  const api = new Hono();

  api.post("/", async (c) => {
    const projectId = String(c.req.param("id"));
    const parsed = startSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
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
    const limit = Math.min(200, Number(c.req.query("limit") ?? 100) || 100);
    let rows: RunRow[];
    if (projectId) {
      rows = db.select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt)).limit(limit).all();
    } else {
      rows = db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit).all();
    }
    const projectNames = new Map(db.select().from(projects).all().map((p) => [p.id, p.name]));
    return c.json({ items: rows.map((row) => rowToMeta(row, projectNames.get(row.projectId))) });
  });

  api.get("/:id", (c) => {
    const detail = engine.detail(c.req.param("id"));
    if (!detail.run) return c.json({ error: "运行不存在" }, 404);
    return c.json({ ...detail.run, nodeResults: detail.nodes, graph: detail.graph, inputs: detail.inputs });
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
    if (!db.select().from(runs).where(eq(runs.id, runId)).get()) return c.json({ error: "运行不存在" }, 404);
    let rows = db.select().from(runNodeLogs).where(eq(runNodeLogs.runId, runId)).orderBy(runNodeLogs.createdAt).all();
    if (nodeId) rows = rows.filter((r) => r.nodeId === nodeId);
    const labels = new Map(db.select().from(runNodeResults).where(eq(runNodeResults.runId, runId)).all().map((r) => [r.nodeId, r.nodeLabel ?? r.nodeType]));
    const items: RunNodeLog[] = rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      nodeId: row.nodeId,
      nodeLabel: labels.get(row.nodeId),
      kind: row.kind,
      content: row.content,
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
    const abs = resolve(dataDir, row.outputPath);
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
    const abs = resolve(dataDir, row.outputPath);
    const data = await readFile(abs);
    const name = row.outputPath.split("/").pop() ?? "output";
    c.header("Content-Type", name.endsWith(".wav") ? "audio/wav" : "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
    return c.body(data as never);
  });

  return api;
}
