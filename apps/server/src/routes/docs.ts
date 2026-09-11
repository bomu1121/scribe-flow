import { Hono } from "hono";
import { DocAccessError, isArchivedDoc, listDocs, readDoc } from "../lib/docs";

/**
 * 项目文档阅读接口（只读）。给左侧栏的「项目文档」入口用，方便开发时直接在产品里看文档。
 *
 * 目录不存在时（例如生产镜像没有 COPY docs/）不报 500，而是返回 `available: false`，
 * 让前端给出「当前部署未包含文档目录」的明确提示。
 */
export function docsApi(docsDir: string) {
  const api = new Hono();

  api.get("/", (c) => {
    const docs = listDocs(docsDir);
    return c.json({
      available: docs.length > 0,
      dir: docsDir,
      items: docs.map((doc) => ({ ...doc, archived: isArchivedDoc(doc.path) })),
    });
  });

  api.get("/file", (c) => {
    const path = c.req.query("path") ?? "";
    try {
      const doc = readDoc(docsDir, path);
      return c.json({ ...doc, archived: isArchivedDoc(doc.path) });
    } catch (err) {
      if (err instanceof DocAccessError) return c.json({ error: err.message }, err.status as 400);
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return c.json({ error: "文档不存在" }, 404);
      throw err;
    }
  });

  return api;
}
