<script setup lang="ts">
import { ref } from "vue";
import { BookOpen, FileOutput, FileText, FileUp, FolderHeart, GitBranch, GitMerge, Link2, ListTree, Mic, Network, PanelLeftClose, PanelLeftOpen, Replace, Settings, Sparkles, WandSparkles } from "lucide-vue-next";
import { NODE_TYPE_LABELS, type NodeType } from "@scribe-flow/shared";
import { useUiStore } from "@/stores/ui";

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
      { type: "process.obsidian", icon: BookOpen },
    ],
  },
];

const emit = defineEmits<{ add: [type: PaletteItemType] }>();
const ui = useUiStore();

const open = ref(false);

function toggle() {
  open.value = !open.value;
}

function onAdd(type: PaletteItemType) {
  emit("add", type);
  // 选择后自动收起浮层，保持画布主导。
  open.value = false;
}

function onDragStart(event: DragEvent, type: PaletteItemType) {
  event.dataTransfer?.setData("application/scribe-node", type);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}
</script>

<template>
  <aside class="sf-palette" :class="{ 'is-open': open }">
    <button
      type="button"
      class="sf-palette-toggle"
      :title="open ? '收起节点库' : '展开节点库'"
      :aria-label="open ? '收起节点库' : '展开节点库'"
      @click="toggle"
    >
      <component :is="open ? PanelLeftClose : PanelLeftOpen" :size="16" />
    </button>

    <div class="sf-palette-rail">
      <div v-for="group in groups" :key="group.key" class="sf-palette-rail-group">
        <button
          v-for="item in group.items"
          :key="item.type"
          type="button"
          class="sf-palette-rail-item"
          :draggable="!item.action"
          :title="item.label ?? NODE_TYPE_LABELS[item.type as NodeType]"
          @dragstart="onDragStart($event, item.type)"
          @click="onAdd(item.type)"
        >
          <span class="sf-palette-icon">
            <component :is="item.icon" :size="15" />
          </span>
        </button>
      </div>
    </div>

    <div class="sf-palette-foot">
      <button type="button" class="sf-palette-settings" title="设置" aria-label="设置" @click="ui.openSettings()">
        <Settings :size="16" />
      </button>
    </div>

    <Transition name="sf-palette-expand">
      <div v-if="open" class="sf-palette-expanded">
        <div v-for="group in groups" :key="group.key" class="sf-palette-group">
          <div class="sf-palette-group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.type"
            type="button"
            class="sf-palette-item"
            :draggable="!item.action"
            :title="item.label ?? NODE_TYPE_LABELS[item.type as NodeType]"
            @dragstart="onDragStart($event, item.type)"
            @click="onAdd(item.type)"
          >
            <span class="sf-palette-icon">
              <component :is="item.icon" :size="13" />
            </span>
            <span>{{ item.label ?? NODE_TYPE_LABELS[item.type as NodeType] }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </aside>
</template>

<style scoped>
.sf-palette {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 52px;
  flex-shrink: 0;
  padding: 8px 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

.sf-palette-toggle {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-bottom: 8px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-palette-toggle:hover,
.sf-palette.is-open .sf-palette-toggle {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-palette-rail {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.sf-palette-rail-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 4px;
}

.sf-palette-rail-item,
.sf-palette-settings {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin: 2px 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-palette-rail-item:hover,
.sf-palette-settings:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-palette-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.sf-palette-foot {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px solid var(--color-border);
}

.sf-palette-expanded {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 100%;
  width: 200px;
  z-index: var(--z-popover);
  padding: 12px 8px;
  overflow-y: auto;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  box-shadow: var(--shadow-card);
}

.sf-palette-expanded .sf-palette-group {
  margin-bottom: 16px;
}

.sf-palette-group-label {
  padding: 0 10px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.sf-palette-expanded .sf-palette-item {
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

.sf-palette-expanded .sf-palette-item:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-palette-expanded .sf-palette-item:active {
  cursor: grabbing;
}

.sf-palette-expand-enter-active,
.sf-palette-expand-leave-active {
  transition:
    opacity var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out);
}

.sf-palette-expand-enter-from,
.sf-palette-expand-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}
</style>
