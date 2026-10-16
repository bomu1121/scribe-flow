import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./env";
import { createDatabase, recoverInterruptedRuns } from "./db/client";
import { formatServiceTime, guardServiceProcess, openServiceLog } from "./lib/serviceLog";

const env = loadEnv();
// 服务日志与墓碑要赶在数据库之前就位：它记录的是「进程自己」的生死，
// 而上一次进程怎么死的，只有这一次启动时才发现得了（见 lib/serviceLog.ts）。
const serviceLog = openServiceLog(env.dataDir);
guardServiceProcess(serviceLog);
const db = createDatabase(env.dataDir);
const interruptedRuns = recoverInterruptedRuns(db, { serviceLogPath: serviceLog.file });

if (serviceLog.previousRun) {
  const previous = serviceLog.previousRun;
  const identity =
    previous.pid != null
      ? `pid=${previous.pid}${previous.startedAt != null ? `，启动于 ${formatServiceTime(previous.startedAt)}` : ""}`
      : "墓碑文件损坏，pid 与启动时间未知";
  serviceLog.write(
    `上次服务未正常退出（${identity}，没有留下退出记录）。` +
      "常见原因：改了服务端/共享包代码触发 node --watch 重启、在终端里停掉了服务、或进程崩溃。",
  );
}
serviceLog.write(`服务启动（pid=${process.pid}，端口 ${env.port}）`);
for (const brief of interruptedRuns) {
  serviceLog.write(
    `收尾被中断的运行 ${brief.runId}${brief.nodeLabel ? `：中断时在「${brief.nodeLabel}」${brief.progress ? `，${brief.progress}` : ""}` : "（没有任何节点结果）"}`,
  );
}

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
    console.log(`[server] 服务日志：${serviceLog.file}`);
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
