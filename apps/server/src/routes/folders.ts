import { randomUUID } from "node:crypto";
import { eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { FolderDeleteResult, ProjectFolder } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { folders, projects, type FolderRow } from "../db/schema";

/**
 * 工程文件夹 API。
 * 文件夹给“工程（项目）”分类整理，可嵌套；删除文件夹只把其中的工程移回根层级，不删除工程。
 */

const createBodySchema = z.object({
  name: z.string().trim().min(1, "文件夹名称不能为空").max(80, "文件夹名称过长"),
  parentId: z.string().nullable().optional(),
});

const patchBodySchema = z.object({
  name: z.string().trim().min(1, "文件夹名称不能为空").max(80, "文件夹名称过长").optional(),
  /** null 表示移动到根层级；缺省表示不修改。 */
  parentId: z.string().nullable().optional(),
});

function now() {
  return Date.now();
}

function toFolder(row: FolderRow): ProjectFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 同层重名检查（同一父级下不允许同名文件夹，避免路径歧义）。 */
function hasSiblingConflict(db: AppDatabase, name: string, parentId: string | null | undefined, excludeId?: string): boolean {
  const siblings = db
    .select()
    .from(folders)
    .where(parentId === null || parentId === undefined ? isNull(folders.parentId) : eq(folders.parentId, parentId))
    .all();
  return siblings.some((f) => f.id !== excludeId && f.name.toLowerCase() === name.toLowerCase());
}

/** 检查把 folderId 移入 newParentId 是否会造成循环（目标是自身或自身的子孙）。 */
function wouldCreateCycle(db: AppDatabase, folderId: string, newParentId: string | null | undefined): boolean {
  let cursor = newParentId ?? null;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = db.select().from(folders).where(eq(folders.id, cursor)).get();
    cursor = parent?.parentId ?? null;
  }
  return false;
}

/** 收集以 rootId 为根的整棵子树（含自身）。 */
function collectSubtreeIds(db: AppDatabase, rootId: string): string[] {
  const result: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const children = db.select().from(folders).where(eq(folders.parentId, current)).all();
    for (const child of children) queue.push(child.id);
  }
  return result;
}

export function foldersApi(db: AppDatabase) {
  const api = new Hono();

  api.get("/", (c) => {
    const rows = db.select().from(folders).all();
    return c.json({ items: rows.map(toFolder) });
  });

  api.post("/", async (c) => {
    const parsed = createBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    const { name, parentId } = parsed.data;
    if (parentId) {
      const parent = db.select().from(folders).where(eq(folders.id, parentId)).get();
      if (!parent) return c.json({ error: "目标文件夹不存在，请刷新后重试" }, 400);
    }
    if (hasSiblingConflict(db, name, parentId)) {
      return c.json({ error: "同一位置已存在同名文件夹" }, 400);
    }
    const id = `fld_${randomUUID()}`;
    const ts = now();
    db.insert(folders)
      .values({ id, name, parentId: parentId ?? null, createdAt: ts, updatedAt: ts })
      .run();
    const row = db.select().from(folders).where(eq(folders.id, id)).get();
    return c.json(toFolder(row!), 201);
  });

  api.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const row = db.select().from(folders).where(eq(folders.id, id)).get();
    if (!row) return c.json({ error: "文件夹不存在" }, 404);

    const parsed = patchBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    const name = parsed.data.name ?? row.name;
    const parentId = parsed.data.parentId !== undefined ? parsed.data.parentId : row.parentId;
    if (parentId) {
      if (parentId === id) return c.json({ error: "不能移动到自身内部" }, 400);
      const parent = db.select().from(folders).where(eq(folders.id, parentId)).get();
      if (!parent) return c.json({ error: "目标文件夹不存在，请刷新后重试" }, 400);
    }
    if (wouldCreateCycle(db, id, parentId)) {
      return c.json({ error: "不能移动到自己的子文件夹内" }, 400);
    }
    if (hasSiblingConflict(db, name, parentId, id)) {
      return c.json({ error: "同一位置已存在同名文件夹" }, 400);
    }
    db.update(folders)
      .set({ name, parentId: parentId ?? null, updatedAt: now() })
      .where(eq(folders.id, id))
      .run();
    const updated = db.select().from(folders).where(eq(folders.id, id)).get();
    return c.json(toFolder(updated!));
  });

  api.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const root = db.select().from(folders).where(eq(folders.id, id)).get();
    if (!root) return c.json({ error: "文件夹不存在" }, 404);

    const folderIds = collectSubtreeIds(db, id);
    // 工程不随文件夹删除：全部移回根层级，避免误删用户工程。
    const updateResult = db
      .update(projects)
      .set({ folderId: null })
      .where(inArray(projects.folderId, folderIds))
      .run();
    db.delete(folders).where(inArray(folders.id, folderIds)).run();

    const result: FolderDeleteResult = {
      ok: true,
      removedFolders: folderIds.length,
      detachedProjects: updateResult.changes,
    };
    return c.json(result);
  });

  return api;
}
