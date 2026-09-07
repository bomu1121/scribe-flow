import { randomUUID } from "node:crypto";
import { desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { emptyGraph, parseGraph, WORKFLOW_TEMPLATES, type GraphNode, type WorkflowGraph } from "@scribe-flow/shared";
import { folders, projects, runs, type ProjectRow } from "../db/schema";
import type { AppDatabase } from "../db/client";
import type { RunEngine } from "../lib/engine";

const createBodySchema = z.object({
  name: z.string().trim().min(1, "工程名称不能为空").max(80, "工程名称过长").optional(),
  description: z.string().max(200).optional(),
  templateId: z.string().optional(),
  folderId: z.string().optional(),
});

const patchBodySchema = z.object({
  name: z.string().trim().min(1, "工程名称不能为空").max(80, "工程名称过长").optional(),
  description: z.string().max(200).optional(),
  /** 所属工程文件夹：null 表示移到根层级；缺省表示不修改。 */
  folderId: z.string().nullable().optional(),
});

const putGraphSchema = z.object({
  graph: z.unknown(),
});

const orderBodySchema = z.object({
  folderId: z.string().nullable(),
  /** 该文件夹下工程的完整顺序；数组下标即新 position。 */
  ids: z.array(z.string()).min(1),
});

const importBodySchema = z.object({
  name: z.string().trim().min(1, "工程名称不能为空").max(80),
  description: z.string().max(200).optional(),
  folderId: z.string().optional(),
  graph: z.unknown(),
});

function now() {
  return Date.now();
}

/** 校验目标文件夹存在；folderId 为空表示根层级。返回错误信息或 null。 */
function validateFolder(db: AppDatabase, folderId: string | null | undefined): string | null {
  if (!folderId) return null;
  const folder = db.select().from(folders).where(eq(folders.id, folderId)).get();
  return folder ? null : "目标文件夹不存在，请刷新后重试";
}

/** 去掉工程图里的运行态字段，工程 JSON 只保存定义，不保存 status/summary/preview。 */
function cleanGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const data = { ...(node.data as Record<string, unknown>) };
      delete data.status;
      delete data.summary;
      delete data.preview;
      delete data.delta;
      return { ...node, data } as GraphNode;
    }),
  };
}

function toListItem(row: ProjectRow) {
  let nodeCount = 0;
  try {
    const graph = JSON.parse(row.graphJson) as WorkflowGraph;
    nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  } catch {
    nodeCount = 0;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    folderId: row.folderId ?? null,
    nodeCount,
    position: row.position ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    folderId: row.folderId ?? null,
    position: row.position ?? 0,
    graph: cleanGraph(JSON.parse(row.graphJson) as WorkflowGraph),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 计算某文件夹下新建工程应使用的 position（旧数据 position 可能为空，按 0 参与比较）。 */
function nextProjectPosition(db: AppDatabase, folderId: string | null): number {
  const siblings = db
    .select()
    .from(projects)
    .where(folderId ? eq(projects.folderId, folderId) : isNull(projects.folderId))
    .all();
  return siblings.reduce((max, p) => Math.max(max, p.position ?? 0), 0) + 1;
}

function graphForTemplate(templateId: string | undefined): { graph: WorkflowGraph; name: string; description: string } {
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  if (template) {
    return { graph: template.graph, name: template.name, description: template.description };
  }
  return { graph: emptyGraph(), name: "未命名工程", description: "" };
}

export function projectsApi(db: AppDatabase, engine: RunEngine) {
  const api = new Hono();

  api.get("/", (c) => {
    const rows = db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
    return c.json({ items: rows.map(toListItem) });
  });

  api.post("/import", async (c) => {
    const parsed = importBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "导入数据不合法" }, 400);
    }
    const folderError = validateFolder(db, parsed.data.folderId);
    if (folderError) return c.json({ error: folderError }, 400);
    const { name, description, folderId, graph: rawGraph } = parsed.data;
    let graph: WorkflowGraph;
    try {
      graph = parseGraph(rawGraph);
    } catch {
      return c.json({ error: "工程文件校验失败：存在非法节点或连线" }, 400);
    }
    const id = `prj_${randomUUID()}`;
    const ts = now();
    db.insert(projects)
      .values({
        id,
        name,
        description: description ?? "",
        folderId: folderId ?? null,
        position: nextProjectPosition(db, folderId ?? null),
        graphJson: JSON.stringify(graph),
        schemaVersion: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    return c.json(toDetail(row!), 201);
  });

  api.get("/:id/export", (c) => {
    const row = db.select().from(projects).where(eq(projects.id, c.req.param("id"))).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);
    return c.json({
      schemaVersion: 1,
      kind: "scribe-flow.project",
      id: row.id,
      name: row.name,
      description: row.description,
      graph: cleanGraph(JSON.parse(row.graphJson) as WorkflowGraph),
      exportedAt: new Date().toISOString(),
    });
  });

  api.get("/:id/graph", (c) => {
    const row = db.select().from(projects).where(eq(projects.id, c.req.param("id"))).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);
    return c.json({ graph: cleanGraph(JSON.parse(row.graphJson) as WorkflowGraph), updatedAt: row.updatedAt });
  });

  api.put("/:id/graph", async (c) => {
    const id = c.req.param("id");
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);

    const parsed = putGraphSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }

    let graph: WorkflowGraph;
    try {
      graph = cleanGraph(parseGraph(parsed.data.graph));
    } catch {
      return c.json({ error: "画布数据校验失败：存在非法节点或连线" }, 400);
    }

    db.update(projects)
      .set({ graphJson: JSON.stringify(graph), updatedAt: now() })
      .where(eq(projects.id, id))
      .run();
    return c.json({ ok: true, updatedAt: now() });
  });

  api.post("/", async (c) => {
    const parsed = createBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    const folderError = validateFolder(db, parsed.data.folderId);
    if (folderError) return c.json({ error: folderError }, 400);
    const preset = graphForTemplate(parsed.data.templateId);
    const id = `prj_${randomUUID()}`;
    const ts = now();
    const name = parsed.data.name?.trim() || preset.name;
    db.insert(projects)
      .values({
        id,
        name,
        description: parsed.data.description ?? preset.description,
        folderId: parsed.data.folderId ?? null,
        position: nextProjectPosition(db, parsed.data.folderId ?? null),
        graphJson: JSON.stringify(preset.graph),
        schemaVersion: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    return c.json(toDetail(row!), 201);
  });

  api.get("/:id", (c) => {
    const row = db.select().from(projects).where(eq(projects.id, c.req.param("id"))).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);
    return c.json(toDetail(row));
  });

  api.put("/order", async (c) => {
    const parsed = orderBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    const { folderId, ids } = parsed.data;
    if (folderId) {
      const folder = db.select().from(folders).where(eq(folders.id, folderId)).get();
      if (!folder) return c.json({ error: "目标文件夹不存在，请刷新后重试" }, 400);
    }
    const siblings = db
      .select()
      .from(projects)
      .where(folderId ? eq(projects.folderId, folderId) : isNull(projects.folderId))
      .all();
    const siblingIds = new Set(siblings.map((p) => p.id));
    if (ids.some((id) => !siblingIds.has(id))) {
      return c.json({ error: "排序列表包含不属于该文件夹的工程" }, 400);
    }
    ids.forEach((id, index) => {
      db.update(projects)
        .set({ position: index + 1, updatedAt: now() })
        .where(eq(projects.id, id))
        .run();
    });
    return c.json({ ok: true });
  });

  api.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);

    const parsed = patchBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    const folderError = validateFolder(db, parsed.data.folderId);
    if (folderError) return c.json({ error: folderError }, 400);
    const nextFolderId = parsed.data.folderId !== undefined ? parsed.data.folderId : row.folderId;
    const moved = (nextFolderId ?? null) !== (row.folderId ?? null);

    db.update(projects)
      .set({
        name: parsed.data.name ?? row.name,
        description: parsed.data.description ?? row.description,
        folderId: nextFolderId,
        position: moved ? nextProjectPosition(db, nextFolderId ?? null) : row.position,
        updatedAt: now(),
      })
      .where(eq(projects.id, id))
      .run();
    const updated = db.select().from(projects).where(eq(projects.id, id)).get();
    return c.json(toDetail(updated!));
  });

  api.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);
    const running = db.select().from(runs).where(eq(runs.projectId, id)).all().find((r) => r.status === "running");
    if (running) {
      return c.json({ error: `工程「${row.name}」正在运行，请先停止或等待结束后再删除` }, 400);
    }
    const removedRuns = await engine.deleteProject(id);
    return c.json({ ok: true, removedRuns });
  });

  api.post("/:id/duplicate", (c) => {
    const id = c.req.param("id");
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);

    const newId = `prj_${randomUUID()}`;
    const ts = now();
    db.insert(projects)
      .values({
        id: newId,
        name: `${row.name} 副本`,
        description: row.description,
        folderId: row.folderId,
        position: nextProjectPosition(db, row.folderId ?? null),
        graphJson: row.graphJson,
        schemaVersion: row.schemaVersion,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    const created = db.select().from(projects).where(eq(projects.id, newId)).get();
    return c.json(toDetail(created!), 201);
  });

  return api;
}
