import { onScopeDispose, ref, watch, type Ref } from "vue";

/**
 * 「值得显示的忙碌」：把布尔值过一道闸，避免请求太快时闪一下加载态。
 *
 * 两条规则：
 * 1. **开始后 `delay` 毫秒内结束 → 全程不显示**。按钮点一下、20ms 后结果就回来了，
 *    还去灰一下、转一圈、改一行字，用户看到的是"闪动"而不是"加载"。
 * 2. **一旦显示，至少显示 `minDuration`**。否则 200–300ms 的请求会得到一个转了几十毫秒的图标，
 *    比不显示更像故障。
 *
 * 数字取自 Mozilla Acorn（Firefox 设计系统）：
 * "Don't show a spinner animation if the wait time for the action will be less than 200ms.
 *  Any animation under 200ms can be seen as a quick flash and potentially confuse users." /
 * "We recommend 400ms minimum display time."
 * 依据与对照见 docs/research/loading-flicker-research.md。
 *
 * 用法：`const showBusy = useDelayedBusy(busy);` —— 再用它去控制**视觉**（转圈图标、置灰）。
 * **不要**用它去控制"防重复提交"：那要看原始的那个 `busy`（立刻置位），否则延迟窗口里能被点第二次。
 */
export interface DelayedBusyOptions {
  /** 超过多少毫秒才值得显示，默认 200。 */
  delay?: number;
  /** 显示后至少停留多少毫秒，默认 400。 */
  minDuration?: number;
}

export function useDelayedBusy(active: Ref<boolean>, options: DelayedBusyOptions = {}): Ref<boolean> {
  const delay = options.delay ?? 200;
  const minDuration = options.minDuration ?? 400;
  const shown = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownAt = 0;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  watch(active, (on) => {
    clearTimer();
    if (on) {
      timer = setTimeout(() => {
        shown.value = true;
        shownAt = Date.now();
        timer = undefined;
      }, delay);
      return;
    }
    if (!shown.value) return; // 还没露过面就结束了：什么也不做，这正是"不闪"的来源
    const rest = minDuration - (Date.now() - shownAt);
    if (rest <= 0) {
      shown.value = false;
      return;
    }
    timer = setTimeout(() => {
      shown.value = false;
      timer = undefined;
    }, rest);
  });

  onScopeDispose(clearTimer);
  return shown;
}
