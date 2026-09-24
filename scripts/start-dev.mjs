#!/usr/bin/env node
/**
 * ScribeFlow 一键启动（开发用）：拉起前后端，界面真的就绪后再打开浏览器。
 *
 * 下面三处写法都是实测踩出来的，别退回更直觉但会坏掉的版本：
 *
 *   1. 带中文的逻辑不能写在 .cmd 里。双击含中文的 .cmd 时，cmd.exe 是按**控制台代码页**
 *      （中文 Windows 是 cp936）解码文件字节的，UTF-8 的中文会变成乱码；乱码再撞上命令
 *      分隔符就会把整行拆坏——实测一个带中文注释的 if 块直接报「'?' 不是内部或外部命令」。
 *      所以根目录的 start-dev.cmd 只留 ASCII 外壳 + `chcp 65001`，中文输出全部由这里发。
 *
 *   2. 不走 `pnpm dev`（即 `pnpm --parallel`）。在中文 Windows + pnpm 11.7 上实测：--parallel
 *      下后端的 `tsx watch` 子进程会静默卡在启动前，既不打印「后端已启动」也不监听 8787，
 *      而同样的脚本用 `pnpm --filter <包> dev` 单独跑就正常。既然并行器不可靠，这里就自己把
 *      两个包各起一个子进程（同一控制台，关窗即全部停止）。
 *
 *   3. 不能把 5173 当成「界面地址」。这台机器上同时跑着好几个项目的 dev server，5173 经常
 *      被别人占着，此时 Vite 会**静默**退到 5174——于是「端口通不通」的探针和「浏览器打开
 *      哪个页面」都会落到别人的应用上。所以这里既要从输出里读出 Vite 真正用的端口，又要用
 *      页面里的 ScribeFlow 标记确认那就是本项目的界面。
 *
 *   4. 浏览器要等**后端也起来**再打开。tsx 冷启动比 Vite 慢得多，而页面一加载就请求
 *      /api/projects、/api/runs…，只等前端就打开的话，用户看到的是满屏 ECONNREFUSED 还得
 *      手动刷新。所以先等接口应答（上限 30 秒）再开浏览器；等不到也照开，但把原因写清楚。
 *
 * 用法：node scripts/start-dev.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 写 localhost 而不是 127.0.0.1：Vite 绑的是它自己解析出的 localhost，本机上是 ::1。
const API_URL = "http://localhost:8787/";
const UI_PORTS = [5173, 5174, 5175, 5176];
const UI_READY_TIMEOUT_MS = 120_000;
const PORT_DISCOVERY_TIMEOUT_MS = 60_000;
const API_WAIT_MS = 30_000;
const WINDOWS = process.platform === "win32";

const say = (text = "") => console.log(text);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");

const responds = async (url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

const isOurUi = async (port) => {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    return (await res.text()).includes("ScribeFlow");
  } catch {
    return false;
  }
};

/** 在候选端口里找本项目的界面：端口有人应答不算数，页面得真是 ScribeFlow。 */
const findRunningUi = async () => {
  for (const port of UI_PORTS) {
    if (await isOurUi(port)) return `http://localhost:${port}/`;
  }
  return null;
};

const openBrowser = (url) => {
  // Windows 上 `start` 的第一个参数是窗口标题，空标题必须占位，否则 URL 会被当成标题
  const [file, args] = WINDOWS
    ? ["cmd", ["/c", "start", "", url]]
    : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  spawn(file, args, { detached: true, stdio: "ignore" }).unref();
};

/**
 * 各起一个 dev 子进程，输出原样转发到本控制台（不加 pnpm 那种包名前缀，两路日志都是原样）。
 * @param onWebPort 从 web 输出里读出 Vite 实际监听的端口后回调
 */
const startDevServers = (onWebPort) => {
  const spawnDev = (pkgFilter) =>
    spawn("pnpm", ["--filter", pkgFilter, "dev"], {
      cwd: ROOT,
      stdio: ["inherit", "pipe", "pipe"],
      shell: WINDOWS,
    });

  // 后端先起：tsx 冷启动比 Vite 慢，让它早点开始编译，前端就绪时它通常也快好了
  const server = spawnDev("@scribe-flow/server");
  const web = spawnDev("@scribe-flow/web");

  let buffer = "";
  web.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    buffer += stripAnsi(chunk.toString());
    const found = buffer.match(/local:\s*https?:\/\/localhost:(\d+)/i);
    if (found) onWebPort(Number(found[1]));
  });
  web.stderr.on("data", (chunk) => process.stderr.write(chunk));
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  return [web, server];
};

const waitForUi = async (url) => {
  const deadline = Date.now() + UI_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await responds(url)) return true;
    await wait(500);
  }
  return false;
};

/** 后端比前端慢（tsx 冷启动），而页面一加载就要 /api/projects 这些接口。 */
const waitForApi = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await responds(API_URL)) return true;
    await wait(500);
  }
  return false;
};

const sayApiDownHint = () => {
  say(`  [!] 接口 ${API_URL} 没有响应，页面上 /api 请求会失败。`);
  say("      若上方写着 EADDRINUSE，多半是刚关掉上一次服务、端口还没回收，过一两分钟再启动。");
};

const run = (command, args) =>
  spawn(command, args, { cwd: ROOT, stdio: "inherit", shell: WINDOWS });
const waitFor = (child) => new Promise((done) => child.on("exit", (code) => done(code ?? 0)));

const main = async () => {
  process.title = "ScribeFlow 开发服务";
  say();
  say("  ScribeFlow 开发环境");
  say("  --------------------------------------");
  say();

  if (spawnSync("pnpm", ["--version"], { stdio: "ignore", shell: WINDOWS }).status !== 0) {
    say("  [x] 没找到 pnpm。先装 Node.js 22，再执行：npm i -g pnpm");
    return 1;
  }

  if (!existsSync(join(ROOT, "node_modules"))) {
    say("  [*] 首次运行，先装依赖，可能要几分钟...");
    say();
    if ((await waitFor(run("pnpm", ["install"]))) !== 0) {
      say();
      say("  [x] 依赖安装失败，已中止。");
      return 1;
    }
  }

  const runningUi = await findRunningUi();
  if (runningUi) {
    say(`  [=] 界面已经在运行（${runningUi}），直接打开浏览器。`);
    say("  （要停服务：关掉当初启动它的那个控制台窗口；找不到窗口就结束 node.exe。）");
    openBrowser(runningUi);
    if (!(await waitForApi(3000))) sayApiDownHint();
    return 0;
  }

  say("  [*] 正在启动前后端...");
  say();
  say("  关掉本窗口即停止服务。");
  say();

  let uiUrl = null;
  const children = startDevServers((port) => {
    uiUrl ??= `http://localhost:${port}/`;
  });
  const stopAll = () => children.forEach((child) => child.kill());

  // Ctrl+C 由控制台发给窗口里的所有进程，这里只需要别把「用户主动停止」当成本次启动失败
  // （否则外层 .cmd 会停下来等一次回车）。
  process.on("SIGINT", () => {
    stopAll();
    process.exit(0);
  });

  const discoveryDeadline = Date.now() + PORT_DISCOVERY_TIMEOUT_MS;
  while (!uiUrl && Date.now() < discoveryDeadline) {
    await wait(200);
    if (children.some((child) => child.exitCode !== null)) break;
  }
  uiUrl ??= await findRunningUi();

  if (!uiUrl) {
    say("  [!] 没能认出前端地址（既没从输出里读到 Vite 的端口，候选端口上也没有本项目的界面）。");
    say("      看上面的报错；前端可能起在了别的端口上。");
  } else if (await waitForUi(uiUrl)) {
    // 前端能开了不代表能用：页面一加载就打接口，所以先等后端，别让用户对着满屏 ECONNREFUSED 刷新
    say(`  [=] 界面已就绪（${uiUrl}），等后端起来再打开浏览器...`);
    const apiUp = await waitForApi(API_WAIT_MS);
    say(`  [=] 正在打开浏览器：${uiUrl}`);
    openBrowser(uiUrl);
    if (!apiUp) sayApiDownHint();
  } else {
    say(`  [!] 等了 ${UI_READY_TIMEOUT_MS / 1000} 秒 ${uiUrl} 还没就绪，浏览器没有自动打开。`);
  }

  // 任意一端退出就把另一端也收掉：留半个环境只会让人以为“服务还在跑”。
  const code = await Promise.race(children.map(waitFor));
  stopAll();
  if (code !== 0) {
    say();
    say("  [!] 开发服务退出了，原因见上方输出。");
  }
  return code;
};

process.exitCode = await main();
