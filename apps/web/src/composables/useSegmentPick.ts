import { computed } from "vue";
import { collectSegmentOptions, stalePickKeys, type NodePick, type SegmentOption } from "@scribe-flow/shared";
import type { ScribeNodeData } from "@/utils/flow";

/**
 * 节点视角的「上游可挑素材」。
 *
 * 两个使用方共用同一份计算，避免各写一份走偏：
 * - 「素材挑选」节点（flow.pick）卡片本身；
 * - 各消费节点高级设置里的素材挑选。
 */
export function useSegmentPick(data: () => ScribeNodeData, nodeId: () => string) {
  const options = computed<SegmentOption[]>(() => {
    const graph = data().ctx?.getGraph?.();
    if (!graph) return [];
    return collectSegmentOptions(graph, nodeId());
  });

  const staleKeys = computed(() => stalePickKeys(options.value, data().pick));

  /** 是否值得展示选择器：真的有可挑素材，或已经配过挑选（便于取消/清理）。 */
  const visible = computed(() => {
    const pick = data().pick as NodePick | undefined;
    return options.value.length > 0 || Object.keys(pick ?? {}).length > 0;
  });

  /** 已选段数（未配置的来源视为全选）。 */
  const selectedCount = computed(() => {
    const pick = data().pick as NodePick | undefined;
    return options.value.filter((option) => {
      const chosen = pick?.[option.originNodeId];
      return chosen === undefined || chosen.includes(option.key);
    }).length;
  });

  return { options, staleKeys, visible, selectedCount };
}
