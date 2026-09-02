<script setup lang="ts">
import { FileOutput, FileText, FileUp, FolderHeart, GitBranch, GitMerge, Link2, ListTree, Mic, Network, Replace, Sparkles, WandSparkles } from "lucide-vue-next";
import { NODE_TYPE_LABELS, type NodeType } from "@scribe-flow/shared";

type PaletteItemType = NodeType | "source.biliCollection";

interface PaletteItem {
  type: PaletteItemType;
  icon: unknown;
  label?: string;
  /** 动作型入口不落画布节点，点击后由父级打开选择器。 */
  action?: boolean;
}

interface PaletteGroup {
  key: string;
  label: string;
  items: PaletteItem[];
}

const groups: PaletteGroup[] = [
  {
    key: "source",
    label: "来源",
    items: [
      { type: "source.bili", icon: Link2 },
      { type: "source.biliCollection", icon: FolderHeart, label: "B站收藏", action: true },
      { type: "source.file", icon: FileUp },
      { type: "source.text", icon: FileText },
    ],
  },
  {
    key: "transcribe",
    label: "转写",
    items: [{ type: "process.transcribe", icon: Mic }],
  },
  {
    key: "ai",
    label: "AI 加工",
    items: [
      { type: "process.refine", icon: WandSparkles },
      { type: "process.prompt", icon: Sparkles },
      { type: "process.chapter", icon: ListTree },
      { type: "process.mindmap", icon: Network },
    ],
  },
  {
    key: "text-logic",
    label: "文本与逻辑",
    items: [
      { type: "process.text", icon: Replace },
      { type: "flow.if", icon: GitBranch },
    ],
  },
  {
    key: "organize",
    label: "组织与输出",
    items: [
      { type: "process.merge", icon: GitMerge },
      { type: "process.output", icon: FileOutput },
    ],
  },
];

const emit = defineEmits<{ add: [type: PaletteItemType] }>();

function onDragStart(event: DragEvent, type: PaletteItemType) {
  event.dataTransfer?.setData("application/scribe-node", type);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}
</script>

<template>
  <aside class="sf-palette">
    <div v-for="group in groups" :key="group.key" class="sf-palette-group">
      <div class="sf-palette-group-label">{{ group.label }}</div>
      <button
        v-for="item in group.items"
        :key="item.type"
        type="button"
        class="sf-palette-item"
        :draggable="!item.action"
        :title="item.action ? '点击打开 B 站收藏/历史多选' : undefined"
        @dragstart="onDragStart($event, item.type)"
        @click="emit('add', item.type)"
      >
        <span class="sf-palette-icon">
          <component :is="item.icon" :size="13" />
        </span>
        <span>{{ item.label ?? NODE_TYPE_LABELS[item.type as NodeType] }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sf-palette {
  width: 200px;
  flex-shrink: 0;
  padding: 12px 8px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-y: auto;
}

.sf-palette-group {
  margin-bottom: 16px;
}

.sf-palette-group-label {
  padding: 0 10px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.sf-palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: grab;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-palette-item:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-palette-item:active {
  cursor: grabbing;
}

.sf-palette-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  background: var(--color-ink-soft);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
</style>
