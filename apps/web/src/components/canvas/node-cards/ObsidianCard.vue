<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElOption, ElSelect } from "element-plus/es/components/select/index.mjs";
import { RefreshCw } from "lucide-vue-next";
import { PROMPT_ARTIFACT_FULL_LABELS } from "@scribe-flow/shared";
import { useSettingsStore } from "@/stores/settings";
import NodeFieldLabel from "../NodeFieldLabel.vue";
import type { OutletPlan } from "@/utils/artifact-plan";

const props = defineProps<{ folder?: string; plan?: OutletPlan }>();
const emit = defineEmits<{ update: [value: { folder?: string }] }>();

/**
 * 预告文案：一份输入一行（带做法名）。一份里混着几类（两份产物先合并再进来）就把几类都写出来。
 *
 * 措辞是「本次将写入」而不是「已写入」：这是照着画布算的，不是在读运行结果。
 */
const planLines = computed(() =>
  (props.plan?.pieces ?? []).map((piece) => ({
    key: piece.nodeId,
    label: piece.kinds.map((kind) => PROMPT_ARTIFACT_FULL_LABELS[kind]).join(" + "),
    name: piece.blockName,
  })),
);

/**
 * 画布缩放（由节点外壳 provide）：这个 el-select 的浮层会被 Teleport 到 body，
 * 出了 Vue Flow 的 transform 子树，所以得把缩放一路写进浮层里 —— 口径与自研 ModelSelect 一致，
 * 落点与理由见 element-theme.css 的 `.sf-canvas-zoom-popper` 那条。
 */
const flowZoom = inject<{ value: number } | number>("sf-flow-zoom", 1);
const canvasZoom = computed(() => (typeof flowZoom === "number" ? flowZoom : flowZoom.value));
const popperStyle = computed(() => ({ "--sf-canvas-zoom": String(canvasZoom.value) }));

const store = useSettingsStore();
const folders = computed(() => store.obsidianFolders);
const refreshing = ref(false);
/**
 * 设置页里的默认保存目录：节点留空时实际写到这儿。
 *
 * 占位文案必须说的是这件事——早先写死成「默认 00-Inbox」，而 00-Inbox 只是产品默认值，
 * 用户改了设置之后卡片仍显示这个名字，看起来像"它擅自放了一个我库里没有的目录"。
 */
const defaultFolder = computed(() => store.settings?.obsidian.folder || "");

const hint = computed(() => {
  if (folders.value.length === 0) return "目录列表为空，请先到设置页读取 Obsidian 目录";
  return defaultFolder.value
    ? `留空即跟随设置里的默认目录（${defaultFolder.value}）；标题 / 来源 / 作者 / 链接自动从上游获取`
    : "留空即跟随设置里的默认目录；标题 / 来源 / 作者 / 链接自动从上游获取";
});

async function refreshFolders() {
  refreshing.value = true;
  try {
    await store.loadObsidianFolders();
  } finally {
    refreshing.value = false;
  }
}

function onFolderChange(value: string | number | undefined) {
  emit("update", { folder: value ? String(value) : "" });
}
</script>

<template>
  <div class="sf-obsidian-card">
    <div class="sf-node-field">
      <NodeFieldLabel label="保存目录" :hint="hint" />
      <div class="sf-obsidian-folder-row">
        <ElSelect
          :model-value="folder || ''"
          class="sf-node-control"
          size="small"
          clearable
          filterable
          popper-class="sf-canvas-zoom-popper"
          :popper-style="popperStyle"
          :loading="refreshing"
          :placeholder="defaultFolder ? `跟随设置：${defaultFolder}` : '跟随设置'"
          @update:model-value="onFolderChange"
        >
          <ElOption v-for="dir in folders" :key="dir" :label="dir" :value="dir" />
        </ElSelect>
        <ElButton size="small" text :loading="refreshing" title="重新读取目录" @click="refreshFolders">
          <RefreshCw :size="13" />
        </ElButton>
      </div>
    </div>

    <!--
      「本次将写入什么」：这一张卡是整条链路的出口，用户在这上面才第一次看到产物是几篇、几类。
      两类同时存在时补一句互链——那是落盘时真会做的配对（溯源报告 ←→ 同源笔记），不看预告就只能等跑完才知道。
    -->
    <div v-if="plan && planLines.length > 0" class="sf-obsidian-plan">
      <p class="sf-obsidian-plan-head">
        本次将写入 <b>{{ plan.count }}</b> 篇<template v-if="!plan.perPiece && plan.pieces.length > 1">（{{ plan.pieces.length }} 份输入合成一篇）</template>：
      </p>
      <ul class="sf-obsidian-plan-list">
        <li v-for="line in planLines" :key="line.key">
          {{ line.label }}<template v-if="line.name"> · {{ line.name }}</template>
        </li>
      </ul>
      <p v-if="plan.interlink" class="sf-obsidian-plan-link">写入后两篇会互相链接（Obsidian 双链）</p>
    </div>
  </div>
</template>

<style scoped>
.sf-obsidian-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sf-obsidian-folder-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

/**
 * 预告块。刻意比目录那一段轻：它是一句说明，不是又一个要填的控件。
 * 色只用 `--color-text-secondary/tertiary` 与分隔用的 `--color-border`，不引入新令牌。
 */
.sf-obsidian-plan {
  padding-top: 6px;
  border-top: 1px dashed var(--color-border);
}

.sf-obsidian-plan-head {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 16px;
}

.sf-obsidian-plan-head b {
  font-weight: 600;
}

.sf-obsidian-plan-list {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 16px;
}

.sf-obsidian-plan-list li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-obsidian-plan-link {
  margin: 2px 0 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 16px;
}
</style>
