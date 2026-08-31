import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { emptyGraph, parseGraph, WORKFLOW_TEMPLATES, type GraphNode, type WorkflowGraph } from "@scribe-flow/shared";
import { projects, type ProjectRow } from "../db/schema";
import type { AppDatabase } from "../db/client";

const createBodySchema = z.object({
  name: z.string().trim().min(1, "工程名称不能为空").max(80, "工程名称过长").optional(),
  description: z.string().max(200).optional(),
  templateId: z.string().optional(),
});

const patchBodySchema = z.object({
  name: z.string().trim().min(1, "工程名称不能为空").max(80, "工程名称过长").optional(),
  description: z.string().max(200).optional(),
});

const putGraphSchema = z.object({
  graph: z.unknown(),
});

const importBodySchema = z.object({
  name: z.string().trim().min(1, "工程名称不能为空").max(80),
  description: z.string().max(200).optional(),
  graph: z.unknown(),
});

function now() {
  return Date.now();
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
    nodeCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    graph: cleanGraph(JSON.parse(row.graphJson) as WorkflowGraph),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function graphForTemplate(templateId: string | undefined): { graph: WorkflowGraph; name: string; description: string } {
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  if (template) {
    return { graph: template.graph, name: template.name, description: template.description };
  }
  return { graph: emptyGraph(), name: "未命名工程", description: "" };
}

export function projectsApi(db: AppDatabase) {
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
    const { name, description, graph: rawGraph } = parsed.data;
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
    const preset = graphForTemplate(parsed.data.templateId);
    const id = `prj_${randomUUID()}`;
    const ts = now();
    const name = parsed.data.name?.trim() || preset.name;
    db.insert(projects)
      .values({
        id,
        name,
        description: parsed.data.description ?? preset.description,
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

  api.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);

    const parsed = patchBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }

    db.update(projects)
      .set({
        name: parsed.data.name ?? row.name,
        description: parsed.data.description ?? row.description,
        updatedAt: now(),
      })
      .where(eq(projects.id, id))
      .run();
    const updated = db.select().from(projects).where(eq(projects.id, id)).get();
    return c.json(toDetail(updated!));
  });

  api.delete("/:id", (c) => {
    const id = c.req.param("id");
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) return c.json({ error: "工程不存在" }, 404);
    db.delete(projects).where(eq(projects.id, id)).run();
    return c.json({ ok: true });
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
