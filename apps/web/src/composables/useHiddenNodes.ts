import { computed } from "vue";
import { useSettingsStore } from "@/stores/settings";

/**
 * 设置页「展示范围」里被收起的节点类型。
 *
 * 只影响新建时的可选项（节点面板、链路列表、提示词块库），已有工程里的节点照常显示与运行，
 * 规则见 `packages/shared/src/visibility.ts`；设置尚未加载时按「都没收起」处理。
 */
export function useHiddenNodes() {
  const store = useSettingsStore();
  return computed(() => store.settings?.visibility?.hiddenNodes ?? []);
}
