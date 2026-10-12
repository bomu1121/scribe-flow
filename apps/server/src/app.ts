import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { health } from "./routes/health";
import { projectsApi } from "./routes/projects";
import { foldersApi } from "./routes/folders";
import { videosApi } from "./routes/videos";
import { authApi } from "./routes/auth";
import { bilibiliApi } from "./routes/bilibili";
import { filesApi } from "./routes/files";
import { settingsApi } from "./routes/settings";
import { nutstoreApi } from "./routes/nutstore";
import { promptsApi } from "./routes/prompts";
import { compareApi } from "./routes/compare";
import { projectRunsApi, runsApi } from "./routes/runs";
import { mediaApi } from "./routes/media";
import { taxonomyApi } from "./routes/taxonomy";
import { docsApi } from "./routes/docs";
import { RunEngine } from "./lib/engine";
import type { AppDatabase } from "./db/client";

export interface AppOptions {
  dataDir: string;
  uploadsDir: string;
  maxUploadMb: number;
  /** 生产部署时的前端 dist 目录；为空表示由 Vite 独立托管。 */
  staticDir?: string;
  /** 仓库根的 docs/ 目录，供只读的文档阅读器使用。 */
  docsDir: string;
}

export function createApp(db: AppDatabase, options: AppOptions) {
  const app = new Hono();
  const engine = new RunEngine(db, options.dataDir);

  // 跨站防线：本服务无应用层认证，全靠「只有本机前端会调它」这一假设；但浏览器里
  // 任何网页都能对 127.0.0.1:8787 发 fetch（CORS 只影响能否读到响应，拦不住 POST 副作用）。
  // 放行口径：无 Origin（curl / 服务端调用 / 同源 GET 导航）、与请求 Host 同源、
  // 本机开发前端（Vite 5173 / preview 4173）、以及 CORS_ORIGIN 里显式配置的来源。
  // 注意 CORS_ORIGIN 设成 "*" 只放开响应头，不放开这道门——要跨域访问请写具体来源。
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin) {
      const normalized = origin.toLowerCase();
      const host = (c.req.header("Host") ?? "").toLowerCase();
      const sameOrigin = host !== "" && (normalized === `http://${host}` || normalized === `https://${host}`);
      const devOrigin = normalized === "http://localhost:5173" || normalized === "http://127.0.0.1:5173" || normalized === "http://localhost:4173" || normalized === "http://127.0.0.1:4173";
      const configured = (process.env.CORS_ORIGIN ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .includes(normalized);
      if (!sameOrigin && !devOrigin && !configured) {
        return c.json({ error: "跨站请求被拒绝：本服务仅限本机使用，跨域访问需在服务端配置 CORS_ORIGIN" }, 403);
      }
    }
    return next();
  });

  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/api/health", health);
  app.route("/api/projects", projectsApi(db, engine, options.dataDir));
  app.route("/api/folders", foldersApi(db));
  app.route("/api/projects/:id/runs", projectRunsApi(db, engine));
  app.route("/api/runs", runsApi(db, engine, options.dataDir));
  app.route("/api/videos", videosApi);
  app.route("/api/auth", authApi(db));
  app.route("/api/bilibili", bilibiliApi(db));
  app.route("/api/files", filesApi(options.uploadsDir, options.maxUploadMb));
  app.route("/api/settings", settingsApi(db, engine, options.dataDir));
  app.route("/api/nutstore", nutstoreApi(db, engine, options.dataDir));
  app.route("/api/prompts", promptsApi(db));
  app.route("/api/compare", compareApi(db));
  app.route("/api/media", mediaApi(db, options.dataDir));
  app.route("/api/taxonomy", taxonomyApi(db, engine));
  app.route("/api/docs", docsApi(options.docsDir));

  app.notFound((c) => c.json({ error: "接口不存在" }, 404));

  if (options.staticDir) {
    app.use("*", serveStatic({ root: options.staticDir }));
    app.get("*", serveStatic({ path: "./index.html", root: options.staticDir }));
  }

  app.onError((err, c) => {
    console.error("[server] 未处理错误：", err);
    return c.json({ error: err.message || "服务器内部错误" }, 500);
  });

  return app;
}
