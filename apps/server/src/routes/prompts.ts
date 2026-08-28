import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { BUILTIN_PROMPT_BLOCKS, type PromptBlock } from "@scribe-flow/shared";
import type { AppDatabase } from "../db/client";
import { promptBlocks, type PromptBlockRow } from "../db/schema";

const createSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(40, "名称过长"),
  prompt: z.string().trim().min(1, "提示词不能为空").max(20000, "提示词过长"),
});

const updateSchema = createSchema.partial();

function toBlock(row: PromptBlockRow): PromptBlock {
  return { id: row.id, name: row.name, prompt: row.prompt, builtin: Boolean(row.builtin) };
}

export function promptsApi(db: AppDatabase) {
  const api = new Hono();

  api.get("/", (c) => {
    const custom = db.select().from(promptBlocks).orderBy(desc(promptBlocks.updatedAt)).all().map(toBlock);
    return c.json({ items: [...BUILTIN_PROMPT_BLOCKS, ...custom] });
  });

  api.post("/", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    const now = Date.now();
    const id = `custom.${randomUUID()}`;
    db.insert(promptBlocks).values({ id, name: parsed.data.name, prompt: parsed.data.prompt, builtin: 0, createdAt: now, updatedAt: now }).run();
    const row = db.select().from(promptBlocks).where(eq(promptBlocks.id, id)).get();
    return c.json(toBlock(row!), 201);
  });

  api.patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (id.startsWith("builtin.")) return c.json({ error: "内置提示词块不可修改" }, 400);
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, 400);
    }
    const row = db.select().from(promptBlocks).where(eq(promptBlocks.id, id)).get();
    if (!row) return c.json({ error: "提示词块不存在" }, 404);
    db.update(promptBlocks)
      .set({ ...(parsed.data.name ? { name: parsed.data.name } : {}), ...(parsed.data.prompt ? { prompt: parsed.data.prompt } : {}), updatedAt: Date.now() })
      .where(eq(promptBlocks.id, id))
      .run();
    const updated = db.select().from(promptBlocks).where(eq(promptBlocks.id, id)).get();
    return c.json(toBlock(updated!));
  });

  api.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (id.startsWith("builtin.")) return c.json({ error: "内置提示词块不可删除" }, 400);
    const row = db.select().from(promptBlocks).where(eq(promptBlocks.id, id)).get();
    if (!row) return c.json({ error: "提示词块不存在" }, 404);
    db.delete(promptBlocks).where(eq(promptBlocks.id, id)).run();
    return c.json({ ok: true });
  });

  return api;
}
