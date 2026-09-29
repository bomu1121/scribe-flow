import { onBeforeUnmount, watch } from "vue";

/**
 * 浮层打开时锁住 body 滚动：打开加类名、关闭摘掉，卸载兜底再摘一次。
 *
 * 三个使用方（`PromptBlockDiffDialog.vue` / `RunLogDialog.vue` / `SourcePickerDialog.vue`）
 * 原本各有一份逐字相同的实现与各一个类名（`pbd-lock` / `rl-lock` / `sp-lock`），
 * 现在只保留一份：类名沿用其中原来的 `pbd-lock`，规则落在全局样式 `styles/app.css`
 * （Teleport 到 body 的浮层不能依赖组件内 scoped 样式，见 `scripts/ui-lint.mjs`）。
 *
 * **引用计数**：类名只有一份，多个浮层同时打开时不能由先关的那个解锁——
 * 这与原来「各用各的类名、各自 add/remove」的实际效果一致（关掉一个，body 仍然锁着）。
 */
const BODY_LOCK_CLASS = "pbd-lock";

/** 当前持有锁的浮层数；归零才真正摘掉类名。 */
let holderCount = 0;

export function useBodyScrollLock(isOpen: () => boolean) {
  let held = false;

  function lock() {
    if (held) return;
    held = true;
    holderCount += 1;
    document.body.classList.add(BODY_LOCK_CLASS);
  }

  function unlock() {
    if (!held) return;
    held = false;
    holderCount = Math.max(0, holderCount - 1);
    if (holderCount === 0) document.body.classList.remove(BODY_LOCK_CLASS);
  }

  watch(isOpen, (open) => (open ? lock() : unlock()), { immediate: true });
  onBeforeUnmount(unlock);
}
