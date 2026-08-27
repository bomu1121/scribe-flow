import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./env";

const env = loadEnv();
const app = createApp();

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
