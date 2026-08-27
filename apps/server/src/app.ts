import { Hono } from "hono";
import { cors } from "hono/cors";
import { health } from "./routes/health";
import { projectsApi } from "./routes/projects";
import type { AppDatabase } from "./db/client";

export function createApp(db: AppDatabase) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/api/health", health);
  app.route("/api/projects", projectsApi(db));

  app.notFound((c) => c.json({ error: "接口不存在" }, 404));

  app.onError((err, c) => {
    console.error("[server] 未处理错误：", err);
    return c.json({ error: err.message || "服务器内部错误" }, 500);
  });

  return app;
}
