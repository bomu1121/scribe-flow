import { onBeforeUnmount, watch } from "vue";

/**
 * 浮层的「Escape 关闭」：按「当前是否打开」挂/摘一份 window keydown 监听。
 *
 * 两个使用方共用同一份生命周期，避免各写一遍「打开时挂、关闭时摘」：
 * - `PromptBlockDiffDialog.vue`（提示词块对比）
 * - `RunLogDialog.vue`（运行日志）
 *
 * 监听状态跟着打开态走（`immediate: true`），所以浮层关掉后它立刻就不再吞 Escape；
 * 组件卸载时再摘一次，防止「打开态没回落就卸载」留下的悬挂监听。
 */
export function useEscapeClose(isOpen: () => boolean, close: () => void) {
  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && isOpen()) close();
  }

  watch(
    isOpen,
    (open) => {
      if (open) window.addEventListener("keydown", onKeydown);
      else window.removeEventListener("keydown", onKeydown);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
}
