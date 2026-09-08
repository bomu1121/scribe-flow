<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput } from "element-plus";
import { toast } from "@/lib/toast";
import { Plus } from "lucide-vue-next";
import { WORKFLOW_TEMPLATES, type ProjectMeta } from "@scribe-flow/shared";
import { useProjectsStore } from "@/stores/projects";

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

const store = useProjectsStore();
const name = ref("");
const creating = ref(false);

const dialogVisible = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = "";
      creating.value = false;
    }
  },
);

function close() {
  if (creating.value) return;
  emit("update:open", false);
}

async function pick(templateId?: string) {
  creating.value = true;
  try {
    const payload: { name?: string; templateId?: string; folderId?: string } = {};
    const trimmed = name.value.trim();
    if (trimmed) payload.name = trimmed;
    if (templateId) payload.templateId = templateId;
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
  <ElDialog v-model="dialogVisible" title="新建工程" width="520px" :close-on-click-modal="false" align-center append-to-body @closed="name = ''">
    <p v-if="folderLabel" class="np-location">创建位置：{{ folderLabel }}</p>
    <el-input v-model="name" class="np-name" placeholder="工程名称（留空使用模板默认名）" maxlength="80" @keyup.enter.prevent="pick()" />
    <div class="np-tpl-grid">
      <button type="button" class="np-tpl" :disabled="creating" @click="pick()">
        <span class="np-tpl-name"><Plus :size="13" />空白工程</span>
        <span class="np-tpl-desc">从空画布开始搭建加工流</span>
      </button>
      <button v-for="tpl in WORKFLOW_TEMPLATES" :key="tpl.id" type="button" class="np-tpl" :disabled="creating" @click="pick(tpl.id)">
        <span class="np-tpl-name">{{ tpl.name }}</span>
        <span class="np-tpl-desc">{{ tpl.description }}</span>
      </button>
    </div>
    <div class="np-foot">
      <span class="np-hint">工作流模板只决定加工路径；提示词块与思维导图在对应节点中配置。</span>
      <el-button plain :disabled="creating" @click="close">取消</el-button>
    </div>
  </ElDialog>
</template>
