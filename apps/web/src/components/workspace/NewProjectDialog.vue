<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElRadioButton, ElRadioGroup } from "element-plus";
import { toast } from "@/lib/toast";
import { Plus } from "lucide-vue-next";
import {
  NODE_TYPE_LABELS,
  TEMPLATE_SOURCE_LABELS,
  buildTemplateGraph,
  supportsSource,
  visibleTemplates,
  type ProjectMeta,
  type TemplateSourceKind,
  type WorkflowTemplate,
} from "@scribe-flow/shared";
import { useProjectsStore } from "@/stores/projects";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  open: boolean;
  /** 创建位置：null/缺省为根层级。 */
  defaultFolderId?: string | null;
  /** 创建位置展示文案。 */
  folderLabel?: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  created: [project: ProjectMeta];
}>();

const SOURCE_PREFS_KEY = "scribe-flow.newProjectSource";
const SOURCE_KINDS: TemplateSourceKind[] = ["bili", "file", "text"];

const store = useProjectsStore();
const settingsStore = useSettingsStore();
const name = ref("");
const creating = ref(false);
const source = ref<TemplateSourceKind>(readSourcePref());

/** 记住上次选的来源：常用「粘贴文稿」的人不必每次改。 */
function readSourcePref(): TemplateSourceKind {
  try {
    const saved = localStorage.getItem(SOURCE_PREFS_KEY);
    if (saved && SOURCE_KINDS.includes(saved as TemplateSourceKind)) return saved as TemplateSourceKind;
  } catch {
    // 隐私模式/损坏状态：回到默认值
  }
  return "bili";
}

function writeSourcePref() {
  try {
    localStorage.setItem(SOURCE_PREFS_KEY, source.value);
  } catch {
    // 隐私模式等场景静默降级
  }
}

const dialogVisible = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

/** 按「通用 / 垂直」分组列出当前来源可用的链路（如「选段加工」只对音视频来源成立）。 */
const templateGroups = computed(() => {
  // 展示范围（设置页）里收起的节点，它的链路整条不出现。
  const visible = visibleTemplates(settingsStore.settings?.visibility?.hiddenNodes).filter((tpl) => supportsSource(tpl, source.value));
  return (
    [
      { key: "通用", label: "通用链路" },
      { key: "垂直", label: "垂直领域" },
    ] as const
  )
    .map((group) => ({ ...group, items: visible.filter((tpl) => tpl.group === group.key) }))
    .filter((group) => group.items.length > 0);
});

/** 当前来源下一个可用的链路：用来在切来源后给提示，也避免「点了没反应」的错觉。 */
const firstAvailable = computed<WorkflowTemplate | undefined>(() => templateGroups.value[0]?.items[0]);

/** 按钮上那行小字：按当前来源把这条链路会落到画布上的节点顺序念一遍，省得点进去才知道。
 *  只看节点类型（不看节点自定义名），相邻同类型合并——这里要的是「形状」，不是节点名。 */
function pipelineHint(template: WorkflowTemplate): string {
  const graph = buildTemplateGraph(template.id, { source: source.value });
  if (!graph) return "";
  const types = graph.nodes.map((node) => node.type);
  return types
    .filter((type, index) => index === 0 || type !== types[index - 1])
    .map((type) => NODE_TYPE_LABELS[type])
    .join(" → ");
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = "";
    creating.value = false;
    source.value = readSourcePref();
  },
);

function close() {
  if (creating.value) return;
  emit("update:open", false);
}

async function pick(templateId?: string) {
  creating.value = true;
  try {
    const payload: { name?: string; templateId?: string; source?: TemplateSourceKind; folderId?: string } = {};
    const trimmed = name.value.trim();
    if (trimmed) payload.name = trimmed;
    if (templateId) {
      payload.templateId = templateId;
      payload.source = source.value;
      writeSourcePref();
    }
    if (props.defaultFolderId) payload.folderId = props.defaultFolderId;
    const project = await store.createProject(payload);
    emit("created", project);
    emit("update:open", false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "创建工程失败");
    creating.value = false;
  }
}
</script>

<template>
  <ElDialog v-model="dialogVisible" title="新建工程" width="560px" :close-on-click-modal="false" align-center append-to-body @closed="name = ''">
    <p v-if="folderLabel" class="np-location">创建位置：{{ folderLabel }}</p>
    <el-input v-model="name" class="np-name" placeholder="工程名称（留空使用链路名）" maxlength="80" @keyup.enter.prevent="pick()" />

    <div class="np-source">
      <span class="np-source-label">来源</span>
      <el-radio-group v-model="source" size="small">
        <el-radio-button v-for="kind in SOURCE_KINDS" :key="kind" :value="kind" :label="TEMPLATE_SOURCE_LABELS[kind]" />
      </el-radio-group>
      <span class="np-source-hint">链路只画加工步骤，来源节点按这里的选择放好，之后也能在画布上换</span>
    </div>

    <div class="np-tpl-grid">
      <button type="button" class="np-tpl np-tpl--blank" :disabled="creating" @click="pick()">
        <span class="np-tpl-name"><Plus :size="13" />空白工程</span>
        <span class="np-tpl-desc">从空画布开始搭建加工流</span>
      </button>
      <template v-for="group in templateGroups" :key="group.key">
        <div class="np-tpl-group">{{ group.label }}</div>
        <button v-for="tpl in group.items" :key="tpl.id" type="button" class="np-tpl" :disabled="creating" @click="pick(tpl.id)">
          <span class="np-tpl-name">{{ tpl.name }}</span>
          <span class="np-tpl-desc">{{ tpl.description }}</span>
          <span class="np-tpl-hint">{{ pipelineHint(tpl) }}</span>
        </button>
      </template>
    </div>

    <div class="np-foot">
      <span class="np-hint">
        当前来源「{{ TEMPLATE_SOURCE_LABELS[source] }}」有 {{ templateGroups.reduce((sum, group) => sum + group.items.length, 0) }} 条链路
        <template v-if="firstAvailable">，不确定就从「{{ firstAvailable.name }}」开始</template>。
        需要选提示词块的链路，建好后在画布上的「AI 加工」节点里选。
      </span>
      <el-button plain :disabled="creating" @click="close">取消</el-button>
    </div>
  </ElDialog>
</template>
