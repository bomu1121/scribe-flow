import type { RunStatus } from "@scribe-flow/shared";

export interface RunStatusMeta {
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
  cancelled: { label: "已取消", color: "var(--color-text-tertiary)", hint: "已停止或取消" },
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

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatRunTime(ts);
}

export function formatElapsed(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
