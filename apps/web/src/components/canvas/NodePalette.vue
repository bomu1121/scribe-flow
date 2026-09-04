<script setup lang="ts">
import { ref } from "vue";
import { PhBookOpenText, PhFileArrowDown, PhFileText, PhFolderStar, PhGearSix, PhGitBranch, PhGitMerge, PhMagicWand, PhMicrophone, PhShareNetwork, PhSparkle, PhSquaresFour, PhSwap, PhTreeStructure, PhUploadSimple, PhVideo } from "@phosphor-icons/vue";
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
      { type: "source.bili", icon: PhVideo },
      { type: "source.biliCollection", icon: PhFolderStar, label: "B站收藏", action: true },
      { type: "source.file", icon: PhUploadSimple },
      { type: "source.text", icon: PhFileText },
    ],
  },
  {
    key: "transcribe",
    label: "转写",
    items: [{ type: "process.transcribe", icon: PhMicrophone }],
  },
  {
    key: "ai",
    label: "AI 加工",
    items: [
      { type: "process.refine", icon: PhMagicWand },
      { type: "process.prompt", icon: PhSparkle },
      { type: "process.chapter", icon: PhTreeStructure },
      { type: "process.mindmap", icon: PhShareNetwork },
    ],
  },
  {
    key: "text-logic",
    label: "文本与逻辑",
    items: [
      { type: "process.text", icon: PhSwap },
      { type: "flow.if", icon: PhGitBranch },
    ],
  },
  {
    key: "organize",
    label: "组织与输出",
    items: [
      { type: "process.merge", icon: PhGitMerge },
      { type: "process.output", icon: PhFileArrowDown },
      { type: "process.obsidian", icon: PhBookOpenText },
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
    <div class="sf-palette-rail">
      <button
        type="button"
        class="sf-palette-node-btn"
        :class="{ active: open }"
        :title="open ? '收起节点列表' : '节点'"
        :aria-label="open ? '收起节点列表' : '节点'"
        @click="toggle"
      >
        <PhSquaresFour :size="17" />
      </button>
    </div>

    <div class="sf-palette-foot">
      <button type="button" class="sf-palette-settings" title="设置" aria-label="设置" @click="ui.openSettings()">
        <PhGearSix :size="16" />
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
              <component :is="item.icon" :size="16" />
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
  width: var(--sidebar-width);
  flex-shrink: 0;
  padding: 8px 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

.sf-palette-rail {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 2px;
  gap: 4px;
}

.sf-palette-node-btn,
.sf-palette-settings {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
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

.sf-palette-node-btn:hover,
.sf-palette-node-btn.active,
.sf-palette-settings:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-palette.is-open .sf-palette-node-btn {
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.sf-palette-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
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
