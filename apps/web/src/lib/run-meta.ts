import type { RunMeta, RunStatus } from "@scribe-flow/shared";

interface RunStatusMeta {
  label: string;
  /** 语义色（设计令牌变量名，行内样式引用）。 */
  color: string;
  /** 简要文案提示。 */
  hint: string;
}

export const RUN_STATUS_META: Record<RunStatus, RunStatusMeta> = {
  running: { label: "运行中", color: "var(--color-brand)", hint: "正在执行" },
  success: { label: "成功", color: "var(--color-success)", hint: "执行完成" },
  error: { label: "失败", color: "var(--color-error)", hint: "执行出错" },
  cancelled: { label: "已取消", color: "var(--color-text-tertiary)", hint: "被手动停止" },
  // 与「已取消」分开：这个是服务重启/崩溃把运行掐断了，人并没有下过停止指令。
  interrupted: { label: "已中断", color: "var(--color-warning)", hint: "服务重启，运行被掐断" },
};

export function runShortId(id: string): string {
  return id.slice(-6);
}

/** 侧栏轻量时间格式：今天显示时分，其余显示日期。 */
export function formatRunTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return time;
  const sameYear = date.getFullYear() === now.getFullYear();
  return sameYear ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}` : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatElapsed(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * 「运行记录」每一行的标题。
 *
 * 名字由服务端在创建时给出（`第 N 次运行`，从某节点重跑时会带 `· 重跑「节点名」`，见
 * `apps/server/src/lib/run-name.ts`），用户可以随时改成自己的说法；**只有手动清空才为空**，
 * 那时这一行只剩时间——「把这行交回给时间」是正当操作，界面不替它编一个。
 *
 * **绝不回落到状态词。** 左侧栏是当笔记目录读的，不是状态盘：一列「成功 / 成功 / 已中断」里，
 * 成功两字每行都重复（等于没说），而「已中断」会把一条**其实产出了东西**的运行说成空手而归，
 * 正好盖掉要看的东西。状态该在结果页上看，那里有上下文。
 *
 * 也不用「文件名 · 字数」占位：同一个工程跑十次，那串字长得一模一样
 * （都是「视频转笔记(单线).md · 6753 字」），放在那里只是噪音。
 */
export function runDisplayName(run: Pick<RunMeta, "name">): string {
  return run.name?.trim() ?? "";
}

/**
 * 行内改名提交时该发什么请求；返回 undefined 表示「不用发」。
 *
 * 与文件夹那套（`ProjectFolderNode.commitRename`）只差一处：**这里允许清空**。
 * 文件夹名是必填的，空值只能当作「改到一半反悔了」直接放弃；而运行记录的名字本来就是可空的
 * （没名字就只显示时间），所以清空是「把这行交回给时间」这个正当操作，不是空输入框的副作用。
 */
export function resolveRenameRequest(current: string, input: string): { name: string | null } | undefined {
  const next = input.trim();
  if (next === current) return undefined;
  return { name: next || null };
}

/**
 * 行的悬停提示：被列表省掉的东西都收在这里——产物摘要、错误、耗时、短 id。
 * 列表要干净，但「这次到底产出了什么」不能真丢，不然历史就没法查了。
 */
export function runRowTooltip(run: RunMeta): string {
  const head = runDisplayName(run) || RUN_STATUS_META[run.status].label;
  const parts: string[] = [];
  if (run.summary) parts.push(run.summary);
  if (run.error) parts.push(run.error);
  if (run.elapsedMs) parts.push(`耗时 ${formatElapsed(run.elapsedMs)}`);
  parts.push(`#${runShortId(run.id)}`);
  return `${head}：${parts.join(" · ")} · 右键可重命名`;
}
