import { reactive } from "vue";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  /** 0 表示不自动关闭，需要用户手动关闭。 */
  duration: number;
}

export interface ToastOptions {
  title?: string;
  duration?: number;
}

export type ToastInput = string | ({ message: string } & ToastOptions);

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3500,
  error: 0,
  warning: 5000,
  info: 3500,
};

const state = reactive<{ items: ToastItem[] }>({ items: [] });
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let seed = 0;

function push(type: ToastType, input: ToastInput, options: ToastOptions = {}): number {
  const normalized = typeof input === "string" ? { message: input } : input;
  const id = ++seed;
  const item: ToastItem = {
    id,
    type,
    title: options.title ?? normalized.title,
    message: normalized.message,
    duration: options.duration ?? normalized.duration ?? DEFAULT_DURATION[type],
  };

  state.items.push(item);

  if (item.duration > 0) {
    timers.set(
      id,
      setTimeout(() => {
        remove(id);
      }, item.duration),
    );
  }

  return id;
}

function remove(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const index = state.items.findIndex((item) => item.id === id);
  if (index >= 0) state.items.splice(index, 1);
}

function clear() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  state.items.splice(0, state.items.length);
}

export const toast = {
  success: (input: ToastInput, options?: ToastOptions) => push("success", input, options),
  error: (input: ToastInput, options?: ToastOptions) => push("error", input, options),
  warning: (input: ToastInput, options?: ToastOptions) => push("warning", input, options),
  info: (input: ToastInput, options?: ToastOptions) => push("info", input, options),
  remove,
  clear,
};

export function useToastState() {
  return state;
}
