<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { PhBookOpenText, PhFileArrowDown, PhFileText, PhFolderStar, PhGitBranch, PhGitMerge, PhMagicWand, PhMicrophone, PhShareNetwork, PhSparkle, PhSwap, PhTreeStructure, PhUploadSimple, PhVideo } from "@phosphor-icons/vue";
import { toast } from "@/lib/toast";
import { NODE_TYPE_LABELS, type NodeType } from "@scribe-flow/shared";
import { useUiStore } from "@/stores/ui";

type CatalogItemType = NodeType | "source.biliCollection";

interface CatalogItem {
  type: CatalogItemType;
  icon: unknown;
  label?: string;
  description: string;
  /** 动作型入口（如“B站收藏”多选）不落画布，点击后由编辑器侧弹选择器。 */
  action?: boolean;
}

interface CatalogGroup {
  key: string;
  label: string;
  items: CatalogItem[];
}

const groups: CatalogGroup[] = [
  {
    key: "source",
    label: "来源",
    items: [
      { type: "source.bili", icon: PhVideo, description: "B 站视频 / 合集" },
      { type: "source.biliCollection", icon: PhFolderStar, label: "B站收藏", action: true, description: "从收藏夹多选视频" },
      { type: "source.file", icon: PhUploadSimple, description: "本地上传音视频" },
      { type: "source.text", icon: PhFileText, description: "粘贴一段文稿" },
    ],
  },
  {
    key: "transcribe",
    label: "转写",
    items: [{ type: "process.transcribe", icon: PhMicrophone, description: "音视频转写为文稿" }],
  },
  {
    key: "ai",
    label: "AI 加工",
    items: [
      { type: "process.refine", icon: PhMagicWand, description: "AI 校对修正" },
      { type: "process.prompt", icon: PhSparkle, description: "提示词块加工" },
      { type: "process.chapter", icon: PhTreeStructure, description: "按结构分章" },
      { type: "process.mindmap", icon: PhShareNetwork, description: "整理为思维导图" },
    ],
  },
  {
    key: "text-logic",
    label: "文本与逻辑",
    items: [
      { type: "process.text", icon: PhSwap, description: "文本转换 / 替换" },
      { type: "flow.if", icon: PhGitBranch, description: "条件分支" },
    ],
  },
  {
    key: "organize",
    label: "组织与输出",
    items: [
      { type: "process.merge", icon: PhGitMerge, description: "合并多个输入" },
      { type: "process.output", icon: PhFileArrowDown, description: "保存为文件产物" },
      { type: "process.obsidian", icon: PhBookOpenText, description: "写入 Obsidian 库" },
    ],
  },
];

const route = useRoute();
const ui = useUiStore();

const inCanvas = computed(() => route.name === "project-editor");

function add(type: CatalogItemType) {
  if (!inCanvas.value) {
    toast.info("请先打开一个工程画布");
    return;
  }
  ui.requestAddNode(type);
}

function onDragStart(event: DragEvent, item: CatalogItem) {
  if (!inCanvas.value || item.action) return;
  event.dataTransfer?.setData("application/scribe-node", item.type);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function displayName(item: CatalogItem): string {
  return item.label ?? NODE_TYPE_LABELS[item.type as NodeType];
}
</script>

<template>
  <div class="wp-view wp-nodes">
    <p v-if="!inCanvas" class="wp-note">打开一个工程画布后，才能在这里添加节点。</p>
    <p v-else class="wp-note">点击添加到画布中心，或拖到画布上的目标位置。</p>

    <div class="wp-nodes-scroll">
      <section v-for="group in groups" :key="group.key" class="wp-group">
        <h3 class="wp-group-title">{{ group.label }}</h3>
        <div class="wp-group-items">
          <button
            v-for="item in group.items"
            :key="item.type"
            type="button"
            class="wp-node-item"
            :class="{ action: item.action, disabled: !inCanvas }"
            :disabled="!inCanvas"
            :draggable="inCanvas && !item.action"
            :title="item.description"
            @dragstart="onDragStart($event, item)"
            @click="add(item.type)"
          >
            <span class="wp-node-icon">
              <component :is="item.icon" :size="16" />
            </span>
            <span class="wp-node-name">{{ displayName(item) }}</span>
            <span v-if="item.action" class="wp-node-action">…</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
