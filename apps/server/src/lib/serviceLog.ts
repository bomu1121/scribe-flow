import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 服务日志：把进程级「生死事件」写进 `data/logs/service.log`。
 *
 * 为什么必须有：运行日志（`run_node_logs`）记的是「运行为什么断的现场」，
 * 而「服务进程自己为什么没了」此前只存在于启动它的那个终端窗口里。实测踩过两次
 * 「运行跑一半服务没了」，每次都只能靠翻终端、扫文件修改时间反推。
 *
 * 为什么用「墓碑」而不只靠进程内钩子：实测（2026-10-16，node 22 + Windows）
 * `node --watch` 重启子进程时，子进程既收不到 SIGTERM 也不走 exit/beforeExit——
 * 它是被直接替换掉的，进程内什么都来不及写。所以「上次没正常退出」这个事实只能由
 * **下一个进程**记录：上一个进程正常退出时会删掉 `service.running` 墓碑文件，
 * 新进程启动时若看见墓碑还在，说明上次是被重启 / 强杀 / 崩溃收走的。
 *
 * 文件不轮转：这里只记稀疏的进程级事件（启动、退出、崩溃），一年也就几百行；
 * 轮转反而可能把「上一次为什么死」转没了。
 */

export interface PreviousServiceRun {
  /** 上次进程的 pid；墓碑文件损坏时为 null。 */
  pid: number | null;
  /** 上次进程的启动时间；墓碑文件损坏时为 null。 */
  startedAt: number | null;
}

export interface ServiceLog {
  /** 日志文件绝对路径。中断收尾会把这条路径写进运行日志，人才找得到。 */
  file: string;
  /** 上一次进程是否未正常退出；是则带它的 pid 与启动时间。 */
  previousRun: PreviousServiceRun | null;
  /** 追加一条服务日志：同步落盘，同时回显到控制台（终端里那一份不能因此消失）。 */
  write(message: string): void;
  /** 删掉本次进程的墓碑；正常退出与崩溃收尾都要调，否则下次启动会误报「上次未正常退出」。 */
  clearTombstone(): void;
}

/** 与 engine.ts 的「沿用上游」提示同一种时间口径，界面上读到的两个时间可以直接对。 */
export function formatServiceTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function readTombstone(path: string): PreviousServiceRun {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PreviousServiceRun>;
    return {
      pid: typeof raw.pid === "number" ? raw.pid : null,
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : null,
    };
  } catch {
    // 文件在但读不出内容（比如写了一半就被杀），仍然算「上次未正常退出」，
    // 只是 pid/时间未知——不能因为解析失败就把它当成没发生过。
    return { pid: null, startedAt: null };
  }
}

/**
 * 建立本次进程的服务日志与墓碑，返回「上次有没有正常退出」。
 *
 * 与 `guardServiceProcess` 分开是为了测试：装进程钩子会拦住 vitest 自己的信号、
 * 还会跨用例累积监听器，所以文件与钩子各有一个入口。
 */
export function openServiceLog(dataDir: string): ServiceLog {
  const dir = join(dataDir, "logs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "service.log");
  const tombstone = join(dir, "service.running");

  const previousRun = existsSync(tombstone) ? readTombstone(tombstone) : null;
  try {
    writeFileSync(tombstone, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), "utf8");
  } catch {
    // 墓碑写不进去只影响「下次能不能发现这次异常结束」，服务本身该照常起。
  }

  const clearTombstone = () => {
    try {
      rmSync(tombstone, { force: true });
    } catch {
      // 清不掉墓碑只会让下次启动多一条「上次未正常退出」，比因为清不动而崩掉好。
    }
  };

  const write = (message: string) => {
    const line = `[${formatServiceTime(Date.now())}] ${message}\n`;
    try {
      appendFileSync(file, line, "utf8");
    } catch {
      // 落盘失败不拖垮服务：控制台那份还在。
    }
    console.log(`[server] ${message}`);
  };

  return { file, previousRun, write, clearTombstone };
}

/**
 * 装上进程级钩子：崩溃写栈、信号留一句「是被人停的」、退出清墓碑。
 *
 * 只注册 uncaughtException 就够——实测 node 22 默认 `--unhandled-rejections=throw` 下，
 * 未处理的 promise 拒绝会**原样**（带原始堆栈）走到这里；若再注册 unhandledRejection
 * 反而会覆盖 Node 默认的崩溃行为，把一个会崩的缺陷变成静默继续。
 * 钩子里一律显式 `process.exit`：保持「有问题就挂」的既有语义，只多一份落盘。
 */
export function guardServiceProcess(log: ServiceLog): void {
  let finalized = false;
  const stop = (message: string | null, code: number) => {
    if (message) log.write(message);
    log.clearTombstone();
    finalized = true;
    process.exit(code);
  };

  process.on("uncaughtException", (err) => {
    stop(`进程崩溃（uncaughtException）：\n${err?.stack ?? String(err)}`, 1);
  });

  process.on("exit", (code) => {
    if (finalized) return;
    log.write(`进程退出（code=${code}）`);
    log.clearTombstone();
  });

  // 终端里 Ctrl+C / 外部停止请求：留一行「是被人停的」，与「被替换/崩溃」区分开。
  // SIGBREAK 是 Windows 专有信号，在 Linux 上（Docker 部署）注册会抛 ERR_UNKNOWN_SIGNAL——按平台装。
  const signals: Array<[NodeJS.Signals, number]> = [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ];
  if (process.platform === "win32") signals.push(["SIGBREAK", 149]);
  for (const [signal, code] of signals) {
    process.on(signal, () => stop(`收到 ${signal}（Ctrl+C 或外部停止请求），进程退出`, code));
  }
}
