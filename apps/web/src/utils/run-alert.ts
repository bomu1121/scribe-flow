import type { RunStatus } from "@scribe-flow/shared";

/**
 * 运行结束提醒（系统通知 + 提示音）。
 *
 * 为什么需要它：一次完整运行是「下载 → 转写 → AI 加工」，几分钟到十几分钟都正常，人不会盯着画布。
 * 而在此之前，运行成功是**没有任何反馈**的——SSE 收到 run.done 只更新了界面上的节点状态，
 * 人离开电脑就等于什么都没发生。
 *
 * 设置项在「常规」里；两个开关都关掉时这里什么都不做。
 */

/** 会在提醒里出现的终态；运行中不会走这条路。 */
export type FinishedRunStatus = Exclude<RunStatus, "running">;

/**
 * 通知正文里的状态说法。
 *
 * 与界面标签（`lib/run-meta.ts` 的 `RUN_STATUS_META`）**刻意不同**：那张表是列表里的标签（「成功」），
 * 这里是通知正文的一部分（「视频转笔记：已完成」），语境是句子而不是标签。两张表都是穷尽 `Record`，
 * 新增运行状态时 TypeScript 会同时逼两处都改，所以不必为了"看起来只有一份"而把文案压成一种。
 */
const STATUS_TEXT: Record<FinishedRunStatus, string> = {
  success: "已完成",
  error: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

/**
 * 该不该为这次状态变化提醒。
 *
 * 规则只有一条：**上一次看到的是 running、这一次是终态**。这样
 * - 首屏加载时列表里早就跑完的历史运行（上一次状态是 undefined）不会在刷新页面时集体弹一遍；
 * - 已取消的运行不提醒——那是用户自己点的停止，此时人就在屏幕前，再弹一条是噪音；
 * - 但**已中断要提醒**：那不是用户点的，是服务重启/崩溃把运行掐断了。人可能正离开电脑
 *   等结果，这条通知是「你的运行没了，而且有一半产物在」的唯一线索。
 *
 * 抽成纯函数是为了能被直接断言：它埋在 watch 里的话，要验证只能真跑一次运行去观察。
 */
export function shouldAlertRunEnd(previous: RunStatus | undefined, next: RunStatus): next is FinishedRunStatus {
  if (previous !== "running") return false;
  return next !== "running" && next !== "cancelled";
}

export interface RunAlertPayload {
  runId: string;
  status: FinishedRunStatus;
  projectName: string;
  /** 失败原因，有则拼进通知正文。 */
  error?: string;
}

/** 通知正文；抽成纯函数是为了能被直接断言，不必真的弹一个系统通知。 */
export function runAlertBody(payload: RunAlertPayload): string {
  const status = STATUS_TEXT[payload.status] ?? payload.status;
  const head = payload.projectName ? `${payload.projectName}：${status}` : status;
  return payload.error ? `${head} —— ${payload.error}` : head;
}

/** 通知标题：区分「办完了」和「没办成」，扫一眼就能判断要不要回去处理。 */
export function runAlertTitle(status: FinishedRunStatus): string {
  return status === "success" ? "运行完成" : "运行结束";
}

const notified = new Set<string>();

/** 测试用：清掉去重记录。 */
export function resetRunAlertMemory(): void {
  notified.clear();
}

/**
 * 请求系统通知权限。浏览器要求在用户手势里调用，所以这一定是从设置页的开关里触发的。
 */
export async function ensureNotifyPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * 运行结束时提醒一次。
 *
 * 画布页与全局轮询都会看到同一个运行结束，所以按 runId 去重——重复弹两条通知比不提醒更烦人。
 * 返回值就是「这一次是不是由我提醒的」：重复调用返回 false，测试靠它断言去重确实生效。
 */
export function notifyRunFinished(payload: RunAlertPayload, options: { notify: boolean; sound: boolean }): boolean {
  if (notified.has(payload.runId)) return false;
  notified.add(payload.runId);
  // 只增不删会一直占着内存；提醒过一次的运行再没有留存价值。
  if (notified.size > 200) notified.clear();

  if (options.notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(runAlertTitle(payload.status), { body: runAlertBody(payload), tag: payload.runId });
    } catch {
      // 非安全上下文或权限被系统撤销时构造会抛错；提醒失败不该影响运行本身。
    }
  }
  if (options.sound) playChime();
  return true;
}

/**
 * 提示音用 WebAudio 现场合成，不带音频资源文件：
 * 既不用往仓库塞二进制，也不存在「音频加载不出来」这种半死不活的状态。
 */
function playChime(): void {
  // Node（测试环境）里没有 window；这里不套 try，因为访问未声明的标识符抛的是 ReferenceError。
  const Ctor = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const start0 = ctx.currentTime;
    // 两声上行短音（880Hz → 1320Hz）：听着像「办完了」，而不是单声「哔」那种像出错。
    [880, 1320].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = start0 + index * 0.16;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 600);
  } catch {
    // 提示音是附带的，失败就静默跳过。
  }
}
