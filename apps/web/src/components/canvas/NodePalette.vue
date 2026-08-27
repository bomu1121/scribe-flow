<script setup lang="ts">
import { FileOutput, FileText, FileUp, GitMerge, Link2, Mic, Sparkles, WandSparkles } from "lucide-vue-next";
import { NODE_TYPE_LABELS, type NodeType } from "@scribe-flow/shared";

interface PaletteGroup {
  key: string;
  label: string;
  items: { type: NodeType; icon: unknown }[];
}

const groups: PaletteGroup[] = [
  {
    key: "source",
    label: "来源",
    items: [
      { type: "source.bili", icon: Link2 },
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

const emit = defineEmits<{ add: [type: NodeType] }>();

function onDragStart(event: DragEvent, type: NodeType) {
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
        draggable="true"
        @dragstart="onDragStart($event, item.type)"
        @click="emit('add', item.type)"
      >
        <span class="sf-palette-icon">
          <component :is="item.icon" :size="13" />
        </span>
        <span>{{ NODE_TYPE_LABELS[item.type] }}</span>
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
