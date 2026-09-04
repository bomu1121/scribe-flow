/**
 * 下拉浮层“模态守卫”
 *
 * 目标：任何下拉/选择/右键菜单打开时，抑制页面其他区域的 hover / click，
 * 形成参考产品那种“面板打开后，背后不再响应交互”的效果。
 *
 * 实现不渲染额外遮罩 DOM，而是给 <html> 加 `sf-dropdown-modal-open` 类，
 * 配合 app.css 里的规则把非浮层内容设为 `pointer-events: none`。
 * 浮层本身仍可交互，点击外部会落到 body 并触发各浮层自带的 dismiss 逻辑。
 *
 * 覆盖范围：
 * - Element Plus：el-select / el-dropdown / el-picker 等 `.el-*-popper`
 * - Reka UI：menu / context-menu / popover 内容（data-reka-*）
 * - 自研 ModelSelect：若仍有非 portal 的菜单节点，也纳入兜底
 */

const POPUP_SELECTORS = [
  // Element Plus
  ".el-select__popper",
  ".el-dropdown__popper",
  ".el-picker__popper",
  ".el-cascader__popper",
  ".el-autocomplete__popper",
  // Reka UI
  "[data-reka-menu-content]",
  "[data-reka-popover-content]",
  // 兜底
  ".sf-node-menu",
  ".sf-model-select__menu",
].join(",");

let observer: MutationObserver | null = null;
let rafId = 0;

function isVisiblePopup(el: Element): boolean {
  if (!el.isConnected) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return el.getClientRects().length > 0;
}

function sync() {
  const root = document.documentElement;
  if (!root) return;
  const anyOpen = Array.from(root.querySelectorAll<Element>(POPUP_SELECTORS)).some(isVisiblePopup);
  root.classList.toggle("sf-dropdown-modal-open", anyOpen);
}

function scheduleSync() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(sync);
}

/** 在应用启动时调用一次，之后通过 MutationObserver 自动维护守卫状态。 */
export function initDropdownModal() {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-state"],
  });
  sync();
}
