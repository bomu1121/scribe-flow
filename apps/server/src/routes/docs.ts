import { Hono } from "hono";
import { DocAccessError, listDocs, readDoc } from "../lib/docs";

/**
 * 项目文档阅读接口（只读）。给左侧栏的「项目文档」入口用，方便开发时直接在产品里看文档。
 *
 * 目录不存在时（例如生产镜像没有 COPY docs/）不报 500，而是返回 `available: false`，
 * 让前端给出「当前部署未包含文档目录」的明确提示。
 *
 * `GET /?body=1` 连正文一起返回。阅读器的正文合计几百 KB 且几乎都是纯文本，而打开阅读器要读的
 * 是「列表 + 首篇正文」：分成两次请求时，第二个请求往往要新建一条 TCP 连接，而开发环境里对
 * `localhost:5173` 新建连接要等约 205 ms（Vite 只监听 IPv4，见 AGENTS.md 的「别踩的坑」）。
 * 一次拿全后打开只剩一次请求，之后切换文档不再发请求（实测打开到正文可读 355 → 62 ms）。
 */
export function docsApi(docsDir: string) {
  const api = new Hono();

  api.get("/", (c) => {
    const withBody = c.req.query("body") === "1";
    const docs = listDocs(docsDir, { withBody });
    return c.json({
      available: docs.length > 0,
      dir: docsDir,
      items: docs,
    });
  });

  api.get("/file", (c) => {
    const path = c.req.query("path") ?? "";
    try {
      const doc = readDoc(docsDir, path);
      return c.json(doc);
    } catch (err) {
      if (err instanceof DocAccessError) return c.json({ error: err.message }, err.status as 400);
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return c.json({ error: "文档不存在" }, 404);
      throw err;
    }
  });

  return api;
}
