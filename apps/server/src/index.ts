import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./env";
import { createDatabase, recoverInterruptedRuns } from "./db/client";

const env = loadEnv();
const db = createDatabase(env.dataDir);
recoverInterruptedRuns(db);
const app = createApp(db, {
  dataDir: env.dataDir,
  uploadsDir: env.uploadsDir,
  maxUploadMb: env.maxUploadMb,
  staticDir: env.staticDir,
  docsDir: env.docsDir,
});

/**
 * 绑定端口失败时先等一会儿再试，而不是当场退出。
 *
 * 实测把整栈打死过一次：开发时连着改好几个服务端文件，`node --watch` 会排队重启，
 * 上一个进程还没来得及释放 8787、新的就撞上 `EADDRINUSE`；那是未捕获的 'error' 事件，
 * 进程带着退出码 1 死掉，`scripts/start-dev.mjs` 看到子进程退出就把前端也一起收了——
 * 表现成「改了几次代码，前后端全没了」。
 *
 * 重试是有界的（约 5 秒）：端口真被别人占着（比如另一个项目也在 8787）时，
 * 会给出明确文案后退出，而不是无限等待。
 */
const BIND_RETRY_DELAY_MS = 500;
const BIND_MAX_ATTEMPTS = 10;

const server = serve(
  {
    fetch: app.fetch,
    port: env.port,
  },
  (info) => {
    console.log(`[server] ScribeFlow 后端已启动：http://localhost:${info.port}`);
    console.log(`[server] 数据目录：${env.dataDir}`);
  },
);

let attempts = 0;
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EADDRINUSE") {
    console.error("[server] 启动失败：", err);
    process.exit(1);
    return;
  }
  attempts += 1;
  if (attempts >= BIND_MAX_ATTEMPTS) {
    console.error(
      `[server] 端口 ${env.port} 被占用，等了 ${(BIND_MAX_ATTEMPTS * BIND_RETRY_DELAY_MS) / 1000} 秒仍没能绑定。\n` +
        "         多半是另有一个 ScribeFlow（或别的程序）在跑：先把它停掉，或换一个端口（环境变量 PORT）。",
    );
    process.exit(1);
    return;
  }
  console.warn(`[server] 端口 ${env.port} 还没释放（第 ${attempts} 次重试）…`);
  setTimeout(() => {
    server.listen(env.port);
  }, BIND_RETRY_DELAY_MS);
});
