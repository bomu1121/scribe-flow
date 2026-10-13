import { describe, expect, it, vi, afterEach } from "vitest";
import { effectScope, nextTick, ref, type Ref } from "vue";
import { useDelayedBusy } from "./busy";

/**
 * 这一层只做一件事：把"忙"翻译成"值得显示的忙"。三条规则各有用例钉住——
 * 少了第一条，快请求会闪；少了第二条，200–300ms 的请求会得到一个转了几十毫秒的图标。
 *
 * 注意 `watch` 默认是异步刷新的：改完 `active` 要 `await nextTick()`，否则定时器还没挂上就推进了假时间。
 */
describe("useDelayedBusy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const run = (active: Ref<boolean>) => {
    const scope = effectScope();
    return { shown: scope.run(() => useDelayedBusy(active))!, stop: () => scope.stop() };
  };

  it("请求在 delay 内结束：全程不显示（这就是不闪的来源）", async () => {
    vi.useFakeTimers();
    const active = ref(false);
    const { shown, stop } = run(active);

    active.value = true;
    await nextTick();
    vi.advanceTimersByTime(50);
    active.value = false;
    await nextTick();
    vi.advanceTimersByTime(2000);

    expect(shown.value).toBe(false);
    stop();
  });

  it("请求够慢：delay 之后显示，结束时立刻收起（已超过最短时长）", async () => {
    vi.useFakeTimers();
    const active = ref(false);
    const { shown, stop } = run(active);

    active.value = true;
    await nextTick();
    vi.advanceTimersByTime(199);
    expect(shown.value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown.value).toBe(true);

    vi.advanceTimersByTime(600);
    active.value = false;
    await nextTick();
    expect(shown.value).toBe(false);
    stop();
  });

  it("刚好卡在中间：显示后即使立刻结束，也要留住 minDuration（从**它出现那一刻**算起）", async () => {
    vi.useFakeTimers();
    const active = ref(false);
    const { shown, stop } = run(active);

    active.value = true;
    await nextTick();
    vi.advanceTimersByTime(250); // 转圈在 200ms 时就出现了
    expect(shown.value).toBe(true);

    active.value = false; // 请求在 250ms 结束
    await nextTick();
    vi.advanceTimersByTime(140); // 显示时长 190ms，还不到 400
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(200); // 340ms
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(20); // 360ms → 越过 400ms 那条线
    expect(shown.value).toBe(false);
    stop();
  });

  it("组件销毁时不留定时器（卸载后再跑也不会把 shown 改回去）", async () => {
    vi.useFakeTimers();
    const active = ref(false);
    const { shown, stop } = run(active);

    active.value = true;
    await nextTick();
    vi.advanceTimersByTime(250);
    expect(shown.value).toBe(true);
    stop();
    active.value = false;
    await nextTick();
    vi.advanceTimersByTime(2000);
    expect(shown.value).toBe(true); // 已经不在作用域里了，谁都不该再动它
  });
});
