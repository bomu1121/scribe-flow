<script setup lang="ts">
import { computed } from "vue";
import { FileOutput, FileText, FileUp, GitMerge, Link2, Mic, Sparkles, WandSparkles } from "lucide-vue-next";
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger } from "reka-ui";
import { NODE_PORTS, NODE_TYPE_LABELS, type NodeType } from "@scribe-flow/shared";
import type { ScribeNodeData } from "@/utils/flow";

const props = defineProps<NodeProps<ScribeNodeData>>();

const nodeType = computed<NodeType>(() => props.data.nodeType);
const ports = computed(() => NODE_PORTS[nodeType.value]);
const label = computed(() => props.data.label || NODE_TYPE_LABELS[nodeType.value]);

const typeIcon = computed(() => {
  switch (nodeType.value) {
    case "source.bili":
      return Link2;
    case "source.file":
      return FileUp;
    case "source.text":
      return FileText;
    case "process.transcribe":
      return Mic;
    case "process.refine":
      return WandSparkles;
    case "process.prompt":
      return Sparkles;
    case "process.merge":
      return GitMerge;
    case "process.output":
      return FileOutput;
  }
});

const statusClass = computed(() => (props.data.status ? `is-${props.data.status}` : "is-idle"));
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div class="sf-node" :class="[statusClass, { 'is-selected': props.selected }]">
        <Handle
          v-for="port in ports.inputs"
          :key="port.id"
          :id="port.id"
          type="target"
          :position="Position.Left"
          class="sf-handle sf-handle--target"
        />
        <div class="sf-node-head">
          <span class="sf-node-icon">
            <component :is="typeIcon" :size="13" />
          </span>
          <span class="sf-node-label">{{ label }}</span>
          <span class="sf-node-status" />
        </div>
        <div class="sf-node-meta">
          <span class="sf-node-type">{{ NODE_TYPE_LABELS[nodeType] }}</span>
          <span v-if="props.data.summary" class="sf-node-summary">{{ props.data.summary }}</span>
        </div>
        <Handle
          v-for="port in ports.outputs"
          :key="port.id"
          :id="port.id"
          type="source"
          :position="Position.Right"
          class="sf-handle sf-handle--source"
        />
      </div>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="sf-node-menu" align="start">
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M3 接入">运行此节点</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M3 接入">从此节点运行</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item" @select="props.data.ctx?.duplicate()">复制</ContextMenuItem>
        <ContextMenuItem class="sf-node-menu-item" :disabled="true" title="M3 接入">复制输出</ContextMenuItem>
        <ContextMenuSeparator class="sf-node-menu-sep" />
        <ContextMenuItem class="sf-node-menu-item sf-node-menu-item--danger" @select="props.data.ctx?.remove()">删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>

<style scoped>
.sf-node {
  position: relative;
  width: 200px;
  padding: 10px 12px;
  border: 1px solid var(--node-border);
  border-radius: var(--node-radius);
  background: var(--color-surface);
  box-shadow: var(--shadow-xs);
  transition:
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}

.sf-node.is-selected {
  border-color: var(--node-selected-border);
  box-shadow: 0 0 0 1px var(--node-selected-border);
}

.sf-node.is-running {
  border-color: var(--node-running-border);
}

.sf-node.is-running .sf-node-status {
  background: var(--color-brand);
  animation: sf-pulse var(--dur-3) var(--ease-out) infinite alternate;
}

.sf-node.is-done .sf-node-status {
  background: var(--color-success);
}

.sf-node.is-error {
  border-color: var(--color-error);
}

.sf-node.is-error .sf-node-status {
  background: var(--color-error);
}

.sf-node-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.sf-node-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.sf-node-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sf-node-status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-border-strong);
  flex-shrink: 0;
}

.sf-node-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 7px;
  min-height: 14px;
}

.sf-node-type {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
}

.sf-node-summary {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.sf-handle {
  width: 9px;
  height: 9px;
  border: 2px solid var(--color-surface);
  background: var(--handle-color);
}

.sf-handle:hover {
  background: var(--handle-hover-color);
}

.sf-node-menu {
  z-index: 1300;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}

.sf-node-menu-item {
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--color-text);
  cursor: pointer;
}

.sf-node-menu-item[data-highlighted] {
  outline: none;
  background: var(--color-ink-soft);
}

.sf-node-menu-item[data-disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.sf-node-menu-item--danger {
  color: var(--color-error);
}

.sf-node-menu-item--danger[data-highlighted] {
  background: var(--color-error-soft);
}

.sf-node-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border);
}

@keyframes sf-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}
</style>
