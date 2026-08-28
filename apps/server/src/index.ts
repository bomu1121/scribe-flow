import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./env";
import { createDatabase } from "./db/client";

const env = loadEnv();
const db = createDatabase(env.dataDir);
const app = createApp(db, { dataDir: env.dataDir, uploadsDir: env.uploadsDir, maxUploadMb: env.maxUploadMb });

serve(
  {
    fetch: app.fetch,
    port: env.port,
  },
  (info) => {
    console.log(`[server] ScribeFlow 后端已启动：http://localhost:${info.port}`);
    console.log(`[server] 数据目录：${env.dataDir}`);
  },
);
