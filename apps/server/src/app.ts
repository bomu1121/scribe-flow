import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { health } from "./routes/health";
import { projectsApi } from "./routes/projects";
import { videosApi } from "./routes/videos";
import { authApi } from "./routes/auth";
import { bilibiliApi } from "./routes/bilibili";
import { filesApi } from "./routes/files";
import { settingsApi } from "./routes/settings";
import { promptsApi } from "./routes/prompts";
import { projectRunsApi, runsApi } from "./routes/runs";
import { RunEngine } from "./lib/engine";
import type { AppDatabase } from "./db/client";

export interface AppOptions {
  dataDir: string;
  uploadsDir: string;
  maxUploadMb: number;
  /** 生产部署时的前端 dist 目录；为空表示由 Vite 独立托管。 */
  staticDir?: string;
}

export function createApp(db: AppDatabase, options: AppOptions) {
  const app = new Hono();
  const engine = new RunEngine(db, options.dataDir);

  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/api/health", health);
  app.route("/api/projects", projectsApi(db));
  app.route("/api/projects/:id/runs", projectRunsApi(db, engine));
  app.route("/api/runs", runsApi(db, engine, options.dataDir));
  app.route("/api/videos", videosApi);
  app.route("/api/auth", authApi(db));
  app.route("/api/bilibili", bilibiliApi(db));
  app.route("/api/files", filesApi(options.uploadsDir, options.maxUploadMb));
  app.route("/api/settings", settingsApi(db, engine, options.dataDir));
  app.route("/api/prompts", promptsApi(db));

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
