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
  WORKFLOW_TEMPLATES,
  type ProjectMeta,
  type SourceVideoItem,
  type TemplateSourceKind,
  type WorkflowTemplate,
} from "@scribe-flow/shared";
import SourcePickerDialog from "@/components/canvas/SourcePickerDialog.vue";
import { applyBiliVideos } from "@/utils/bili-source";
import { useProjectsStore } from "@/stores/projects";
import { useAuthStore } from "@/stores/auth";
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

/**
 * 来源选项：三种模板来源，外加「B站收藏」。
 *
 * 「B站收藏」不是第四种模板来源——落到图上仍是 B 站来源节点，可用链路与「B站链接」完全一样，
 * 区别只在建工程前先打开收藏夹选择器，把勾选的视频写进那个来源节点
 * （一个视频 = 普通来源卡片，多个 = 一张多选卡片）。
 */
type SourceChoice = TemplateSourceKind | "fav";
const SOURCE_CHOICES: SourceChoice[] = ["bili", "fav", "file", "text"];
const SOURCE_LABELS: Record<SourceChoice, string> = { ...TEMPLATE_SOURCE_LABELS, fav: "B站收藏" };

const store = useProjectsStore();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const name = ref("");
const creating = ref(false);
const source = ref<SourceChoice>(readSourcePref());
const pickerOpen = ref(false);
/** 先点了哪条链路：收藏夹里勾完视频就拿它建工程；没点链路就打开选择器时为空。 */
const pendingTemplateId = ref<string | null>(null);

/** 图上要用的来源种类：「B站收藏」按 B 站来源建链，只是来源节点由勾选的视频填好。 */
const graphSource = computed<TemplateSourceKind>(() => (source.value === "fav" ? "bili" : source.value));

/** 记住上次选的来源：常用「粘贴文稿」的人不必每次改。 */
function readSourcePref(): SourceChoice {
  try {
    const saved = localStorage.getItem(SOURCE_PREFS_KEY);
    if (saved && SOURCE_CHOICES.includes(saved as SourceChoice)) return saved as SourceChoice;
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
  const visible = visibleTemplates(settingsStore.settings?.visibility?.hiddenNodes).filter((tpl) => supportsSource(tpl, graphSource.value));
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
  const graph = buildTemplateGraph(template.id, { source: graphSource.value });
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
    pendingTemplateId.value = null;
    pickerOpen.value = false;
    source.value = readSourcePref();
  },
);

function close() {
  if (creating.value) return;
  emit("update:open", false);
}

async function pick(templateId?: string) {
  // 「B站收藏」来源：先挑视频再建工程（取消就什么都不建），所以这里不直接建。
  if (templateId && source.value === "fav") {
    await openPicker(templateId);
    return;
  }
  creating.value = true;
  try {
    const payload: { name?: string; templateId?: string; source?: TemplateSourceKind; folderId?: string } = {};
    const trimmed = name.value.trim();
    if (trimmed) payload.name = trimmed;
    if (templateId) {
      payload.templateId = templateId;
      payload.source = graphSource.value;
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

async function openPicker(templateId: string) {
  // 侧栏这里没人替我们拉登录态（B 站头像按钮在画布编辑器那一侧），第一次进来看状态还没加载过。
  if (authStore.status === "loading") await authStore.refresh();
  if (!authStore.loggedIn) {
    toast.info("请先扫码登录 B 站（打开任意工程，右上角 B 站头像），再从收藏夹建工程");
    return;
  }
  pendingTemplateId.value = templateId;
  pickerOpen.value = true;
}

/** 收藏夹里勾完视频：按刚点的那条链路建工程，来源节点用勾选的视频填好。 */
async function onPickerConfirm(videos: SourceVideoItem[]) {
  const templateId = pendingTemplateId.value;
  pendingTemplateId.value = null;
  if (!templateId || videos.length === 0) return;
  const template = WORKFLOW_TEMPLATES.find((tpl) => tpl.id === templateId);
  const graph = buildTemplateGraph(templateId, { source: "bili" });
  if (!template || !graph) return;

  creating.value = true;
  try {
    // 名依次回落到：用户填的 → 单个视频标题 → 链路名（与接口自己对未知模板的回落口径一致）。
    const fallbackName = videos.length === 1 ? videos[0].title : template.name;
    const project = await store.createProjectFromGraph({
      name: (name.value.trim() || fallbackName).slice(0, 80),
      description: `B站收藏 · ${videos.length} 个视频`,
      folderId: props.defaultFolderId ?? undefined,
      graph: applyBiliVideos(graph, videos, "B站收藏"),
    });
    writeSourcePref();
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
        <el-radio-button v-for="kind in SOURCE_CHOICES" :key="kind" :value="kind" :label="SOURCE_LABELS[kind]" />
      </el-radio-group>
      <span class="np-source-hint">
        {{
          source === "fav"
            ? "点链路后会先打开收藏夹，勾选视频即建工程；勾 1 个是普通来源卡片，多个合成一张多选卡片"
            : "链路只画加工步骤，来源节点按这里的选择放好，之后也能在画布上换"
        }}
      </span>
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
        当前来源「{{ SOURCE_LABELS[source] }}」有 {{ templateGroups.reduce((sum, group) => sum + group.items.length, 0) }} 条链路
        <template v-if="firstAvailable">，不确定就从「{{ firstAvailable.name }}」开始</template>。
        需要选提示词块的链路，建好后在画布上的「AI 加工」节点里选。
      </span>
      <el-button plain :disabled="creating" @click="close">取消</el-button>
    </div>
  </ElDialog>

  <!-- 「B站收藏」来源的选视频：要盖在这个弹窗上面（EP 弹窗 z-index 从 2000 起算）。 -->
  <SourcePickerDialog v-model:open="pickerOpen" raised @confirm="onPickerConfirm" />
</template>
