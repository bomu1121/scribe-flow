<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElOption, ElSelect } from "element-plus/es/components/select/index.mjs";
import { RefreshCw } from "lucide-vue-next";
import { PROMPT_ARTIFACT_FULL_LABELS } from "@scribe-flow/shared";
import { useSettingsStore } from "@/stores/settings";
import NodeFieldLabel from "../NodeFieldLabel.vue";
import type { OutletPlan } from "@/utils/artifact-plan";

const props = defineProps<{ folder?: string; traceFolder?: string; plan?: OutletPlan }>();
const emit = defineEmits<{ update: [value: { folder?: string; traceFolder?: string }] }>();

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

/** 普通笔记的实际目录（节点 > 设置默认 > 00-Inbox），与引擎的取值链一致。 */
const effectiveNoteFolder = computed(() => props.folder || defaultFolder.value || "00-Inbox");
/** 溯源报告的实际目录：节点单独选了就用它，否则跟普通笔记同目录（与引擎口径一致）。 */
const effectiveTraceFolder = computed(() => props.traceFolder || effectiveNoteFolder.value);
/** 上游有溯源报告才显示这个字段：没有报告时多一个目录选择只是噪音。 */
const hasTraceProduct = computed(() => (props.plan?.pieces ?? []).some((piece) => piece.kinds.includes("trace-report")));
const traceHint = computed(() => {
  if (folders.value.length === 0) return "目录列表为空，请先到设置页读取 Obsidian 目录";
  return props.traceFolder
    ? "溯源报告写进这个目录；与普通笔记的双链仍会跨目录生效"
    : `留空＝和普通笔记放一起（${effectiveNoteFolder.value}）；填了就把溯源报告单独存过去`;
});
const tracePlaceholder = computed(() => `跟随保存目录：${effectiveNoteFolder.value}`);

/**
 * 预告文案：一份输入一行（带做法名）。一份里混着几类（两份产物先合并再进来）就把几类都写出来。
 * 两类分了不同目录时，行尾补上各自的去向——否则用户只能去猜「报告到底进哪个夹子」。
 *
 * 措辞是「本次将写入」而不是「已写入」：这是照着画布算的，不是在读运行结果。
 */
const planLines = computed(() =>
  (props.plan?.pieces ?? []).map((piece) => ({
    key: piece.nodeId,
    label: piece.kinds.map((kind) => PROMPT_ARTIFACT_FULL_LABELS[kind]).join(" + "),
    name: piece.blockName,
    // 只有「这一份纯粹是溯源报告」才进溯源目录；混着两类时引擎按普通笔记落盘。
    dir: piece.kinds.length === 1 && piece.kinds[0] === "trace-report" ? effectiveTraceFolder.value : effectiveNoteFolder.value,
  })),
);
const showPlanDirs = computed(() => hasTraceProduct.value && effectiveTraceFolder.value !== effectiveNoteFolder.value);

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

function onTraceFolderChange(value: string | number | undefined) {
  emit("update", { traceFolder: value ? String(value) : "" });
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
      溯源报告的单独目录：只有上游真的会产出溯源报告时才出现。
      留空＝跟上面的保存目录走——老工程不填这个字段，行为与改动前一致。
    -->
    <div v-if="hasTraceProduct" class="sf-node-field">
      <NodeFieldLabel label="溯源报告目录" :hint="traceHint" />
      <div class="sf-obsidian-folder-row">
        <ElSelect
          :model-value="traceFolder || ''"
          class="sf-node-control"
          size="small"
          clearable
          filterable
          popper-class="sf-canvas-zoom-popper"
          :popper-style="popperStyle"
          :placeholder="tracePlaceholder"
          @update:model-value="onTraceFolderChange"
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
          <span v-if="showPlanDirs" class="sf-obsidian-plan-dir">→ {{ line.dir }}</span>
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

/* 两类分了不同目录时，行尾补去向；比做法名轻一档，不抢主信息的注意力 */
.sf-obsidian-plan-dir {
  color: var(--color-text-tertiary);
}
</style>
