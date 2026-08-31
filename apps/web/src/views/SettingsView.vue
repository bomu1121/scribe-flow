<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElButton, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElTag } from "element-plus";
import { Cloud, Mic, PlugZap, Save, Trash2 } from "lucide-vue-next";
import ModelSelect from "../components/ModelSelect.vue";
import type { AiProvider, AsrEngine, PromptBlock } from "@scribe-flow/shared";
import { api } from "@/lib/api";
import { useSettingsStore } from "@/stores/settings";
import { usePromptsStore } from "@/stores/prompts";
import { useRunsStore } from "@/stores/runs";

const store = useSettingsStore();
const promptsStore = usePromptsStore();
const runsStore = useRunsStore();

const groups = [
  { key: "ai", label: "AI 模型" },
  { key: "asr", label: "语音识别" },
  { key: "general", label: "常规" },
  { key: "prompts", label: "提示词块库" },
  { key: "bili", label: "B 站账号" },
  { key: "data", label: "数据与工程" },
] as const;

type GroupKey = (typeof groups)[number]["key"];
const active = ref<GroupKey>("ai");

const form = reactive({
  aiProvider: "deepseek" as AiProvider,
  aiBaseUrl: "",
  aiModel: "",
  aiKey: "",
  asrEngine: "mimo" as AsrEngine,
  asrBaseUrl: "",
  asrModel: "",
  asrKey: "",
  concurrency: 2,
  outputDir: "outputs",
});

const DEEPSEEK_DEFAULT_MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;
const aiModelOptions = ref<string[]>([...DEEPSEEK_DEFAULT_MODELS]);
const aiModelLoading = ref(false);
const aiTesting = ref(false);
const asrTesting = ref(false);

watch(
  () => form.aiKey,
  (value) => {
    store.aiKeyDraft = value ?? "";
  },
);
watch(
  () => form.asrKey,
  (value) => {
    store.asrKeyDraft = value ?? "";
  },
);

const aiProviderOptions = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "OpenAI", value: "openai" },
  { label: "自定义", value: "custom" },
];

const asrOptions = [
  { label: "MiMo-V2.5（小米）", value: "mimo", icon: Mic },
  { label: "OpenAI 兼容", value: "openai-compatible", icon: Cloud },
];

const blockForm = reactive({ id: "", name: "", prompt: "" });
const dataInfo = ref<{ dataDir: string; runCount: number; finishedRunCount: number; outputFiles: number; outputBytes: number } | null>(null);

function editBlock(block: PromptBlock) {
  blockForm.id = block.id;
  blockForm.name = block.name;
  blockForm.prompt = block.prompt;
}

function resetBlockForm() {
  blockForm.id = "";
  blockForm.name = "";
  blockForm.prompt = "";
}

async function saveBlock() {
  try {
    if (blockForm.id) await promptsStore.updateBlock(blockForm.id, { name: blockForm.name, prompt: blockForm.prompt });
    else await promptsStore.addBlock(blockForm.name, blockForm.prompt);
    resetBlockForm();
    ElMessage.success("提示词块已保存");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
}

async function removeBlock(block: PromptBlock) {
  try {
    await ElMessageBox.confirm(`删除提示词块「${block.name}」？引用它的节点将无法再选中该块。`, "删除提示词块", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    await promptsStore.removeBlock(block.id);
    if (blockForm.id === block.id) resetBlockForm();
    ElMessage.success("已删除");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "删除失败");
  }
}

async function loadDataInfo() {
  dataInfo.value = await api.get("/api/settings/data");
}

async function clearFinishedRuns() {
  try {
    await ElMessageBox.confirm("删除全部已结束的运行及其产物文件？进行中的运行不受影响。", "清理运行记录", {
      confirmButtonText: "清理",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    const result = await api.post<{ deleted: number }>("/api/settings/clear-runs");
    ElMessage.success(`已清理 ${result.deleted} 条运行记录`);
    await runsStore.load();
    await loadDataInfo();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "清理失败");
  }
}

function syncAiModelOptions(models?: string[]) {
  const options = models && models.length > 0 ? [...models] : [...DEEPSEEK_DEFAULT_MODELS];
  if (form.aiModel && !options.includes(form.aiModel)) options.unshift(form.aiModel);
  aiModelOptions.value = options;
}

async function refreshAiModels() {
  if (form.aiProvider !== "deepseek") return;
  aiModelLoading.value = true;
  try {
    const models = await store.fetchAiModels({
      provider: form.aiProvider,
      baseUrl: form.aiBaseUrl,
      model: form.aiModel,
      apiKey: form.aiKey || undefined,
    });
    if (models.length > 0) {
      if (form.aiModel && !models.includes(form.aiModel)) form.aiModel = models[0];
      syncAiModelOptions(models);
    }
  } catch {
    // 拉取模型列表失败不阻塞页面加载或保存
  } finally {
    aiModelLoading.value = false;
  }
}

function fillForm() {
  if (!store.settings) return;
  form.aiProvider = store.settings.ai.provider;
  form.aiBaseUrl = store.settings.ai.baseUrl;
  form.aiModel = store.settings.ai.model;
  form.asrEngine = store.settings.asr.engine;
  form.asrBaseUrl = store.settings.asr.baseUrl;
  form.asrModel = store.settings.asr.model;
  form.concurrency = store.settings.general.concurrency;
  form.outputDir = store.settings.general.outputDir;
  form.aiKey = store.aiKeyDraft || "";
  form.asrKey = store.asrKeyDraft || "";
  if (form.aiProvider === "deepseek") {
    if (aiModelOptions.value.length === 0) syncAiModelOptions();
    else if (form.aiModel && !aiModelOptions.value.includes(form.aiModel)) aiModelOptions.value.unshift(form.aiModel);
  } else {
    aiModelOptions.value = [];
  }
}

onMounted(async () => {
  await store.load();
  fillForm();
  await promptsStore.load();
  if (form.aiProvider === "deepseek" && (store.settings?.ai.hasKey || form.aiKey)) {
    await refreshAiModels();
  }
});

function switchProvider(provider: AiProvider) {
  form.aiProvider = provider;
  if (provider === "deepseek") {
    form.aiBaseUrl = "https://api.deepseek.com/v1";
    form.aiModel = "deepseek-chat";
    syncAiModelOptions();
  } else if (provider === "openai") {
    form.aiBaseUrl = "https://api.openai.com/v1";
    form.aiModel = "gpt-4o-mini";
    aiModelOptions.value = [];
  } else {
    aiModelOptions.value = [];
  }
}

function switchAsr(engine: AsrEngine) {
  form.asrEngine = engine;
  if (engine === "mimo") {
    form.asrBaseUrl = "https://api.xiaomimimo.com/v1";
    form.asrModel = "mimo-v2.5-asr";
  } else {
    form.asrBaseUrl = "";
    form.asrModel = "whisper-1";
  }
}

async function saveAll() {
  try {
    if (form.aiProvider === "deepseek") await refreshAiModels();
    await store.save({
      ai: { provider: form.aiProvider, baseUrl: form.aiBaseUrl, model: form.aiModel, apiKey: form.aiKey || undefined },
      asr: { engine: form.asrEngine, baseUrl: form.asrBaseUrl, model: form.asrModel, apiKey: form.asrKey || undefined },
      general: { concurrency: form.concurrency, outputDir: form.outputDir },
    });
    ElMessage.success("设置已保存");
    await store.load();
    fillForm();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
}

async function testAi() {
  aiTesting.value = true;
  aiModelLoading.value = true;
  try {
    const result = await store.testAi({
      provider: form.aiProvider,
      baseUrl: form.aiBaseUrl,
      model: form.aiModel,
      apiKey: form.aiKey || undefined,
    });
    ElMessage.success(`AI 连接正常：${(result.content ?? "连接正常").slice(0, 40)}`);
    if (result.models?.length > 0) {
      if (form.aiModel && !result.models.includes(form.aiModel)) form.aiModel = result.models[0];
      syncAiModelOptions(result.models);
    }
    if (result.modelsError) ElMessage.warning(`连接正常，但拉取模型列表失败：${result.modelsError}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "AI 连接失败");
  } finally {
    aiTesting.value = false;
    aiModelLoading.value = false;
  }
}

async function testAsr() {
  asrTesting.value = true;
  try {
    const content = await store.testAsr({
      engine: form.asrEngine,
      baseUrl: form.asrBaseUrl,
      model: form.asrModel,
      apiKey: form.asrKey || undefined,
    });
    ElMessage.success(`ASR 连接正常：${(content ?? "连接正常").slice(0, 40)}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "ASR 连接失败");
  } finally {
    asrTesting.value = false;
  }
}
</script>

<template>
  <div class="sf-settings">
    <aside class="sf-settings-nav">
      <button
        v-for="group in groups"
        :key="group.key"
        type="button"
        class="sf-settings-nav-item"
        :class="{ active: active === group.key }"
        @click="active = group.key"
      >
        {{ group.label }}
      </button>
    </aside>

    <section class="sf-settings-body">
      <template v-if="active === 'ai'">
        <h2 class="sf-settings-title">AI 模型</h2>
        <p class="sf-settings-desc">AI 校对与 AI 加工节点使用 OpenAI 兼容接口，密钥只保存在服务端。</p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">提供商</span>
            <el-select v-model="form.aiProvider" class="sf-field-control" @change="switchProvider">
              <el-option v-for="opt in aiProviderOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </label>
          <label class="sf-field">
            <span class="sf-field-label">接口地址</span>
            <el-input v-model="form.aiBaseUrl" class="sf-field-control" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">模型</span>
            <el-select
              v-if="form.aiProvider === 'deepseek'"
              v-model="form.aiModel"
              class="sf-field-control"
              filterable
              :loading="aiModelLoading"
              placeholder="deepseek-chat"
            >
              <el-option v-for="model in aiModelOptions" :key="model" :label="model" :value="model" />
            </el-select>
            <el-input v-else v-model="form.aiModel" class="sf-field-control" placeholder="deepseek-chat" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">
              API Key
              <el-tag v-if="store.settings?.ai.hasKey" type="success" size="small">已保存</el-tag>
              <el-tag v-else type="warning" size="small">未配置</el-tag>
            </span>
            <el-input v-model="form.aiKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.ai.hasKey ? '已保存，留空则不修改' : 'sk-…'" />
          </label>
          <div class="sf-settings-actions">
            <el-button class="sf-btn" plain :loading="aiTesting" @click="testAi"><PlugZap :size="14" /><span>测试连接</span></el-button>
            <el-button class="sf-btn" type="primary" @click="saveAll"><span>保存设置</span></el-button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'asr'">
        <h2 class="sf-settings-title">语音识别</h2>
        <p class="sf-settings-desc">转写节点使用云 ASR，支持 MiMo-V2.5 与 OpenAI 兼容端点。</p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">引擎</span>
            <ModelSelect
              v-model="form.asrEngine"
              :options="asrOptions"
              placeholder="选择 ASR 引擎"
              :prefix-icon="Mic"
              @change="(value: string) => switchAsr(value as AsrEngine)"
            />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">接口地址</span>
            <el-input v-model="form.asrBaseUrl" class="sf-field-control" :placeholder="form.asrEngine === 'mimo' ? 'https://api.xiaomimimo.com/v1' : 'https://api.openai.com/v1'" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">模型</span>
            <el-input v-model="form.asrModel" class="sf-field-control" :placeholder="form.asrEngine === 'mimo' ? 'mimo-v2.5-asr' : 'whisper-1'" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">
              API Key
              <el-tag v-if="store.settings?.asr.hasKey" type="success" size="small">已保存</el-tag>
              <el-tag v-else type="warning" size="small">未配置</el-tag>
            </span>
            <el-input v-model="form.asrKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.asr.hasKey ? '已保存，留空则不修改' : 'API Key'" />
          </label>
          <div class="sf-settings-actions">
            <el-button class="sf-btn" plain :loading="asrTesting" @click="testAsr"><PlugZap :size="14" /><span>测试连接</span></el-button>
            <el-button class="sf-btn" type="primary" @click="saveAll"><span>保存设置</span></el-button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'general'">
        <h2 class="sf-settings-title">常规</h2>
        <p class="sf-settings-desc">运行并发与输出目录。</p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">并发数（1-4）</span>
            <el-input v-model.number="form.concurrency" type="number" min="1" max="4" class="sf-field-control" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">输出目录</span>
            <el-input v-model="form.outputDir" class="sf-field-control" placeholder="outputs" />
          </label>
          <div class="sf-settings-actions">
            <el-button class="sf-btn" type="primary" @click="saveAll"><span>保存设置</span></el-button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'prompts'">
        <h2 class="sf-settings-title">提示词块库</h2>
        <p class="sf-settings-desc">内置块只读；自定义块由 AI 加工节点引用，修改后下一次运行生效。</p>
        <div class="sf-blocks">
          <article v-for="block in promptsStore.allBlocks" :key="block.id" class="sf-block-card">
            <header class="sf-block-head">
              <span class="sf-block-name">{{ block.name }}</span>
              <el-tag v-if="block.builtin" size="small" type="info">内置</el-tag>
              <span class="sf-block-actions">
                <template v-if="!block.builtin">
                  <el-button size="small" text @click="editBlock(block)">编辑</el-button>
                  <el-button size="small" text class="sf-danger-text" @click="removeBlock(block)"><Trash2 :size="13" /></el-button>
                </template>
              </span>
            </header>
            <p class="sf-block-prompt">{{ block.prompt.slice(0, 120) }}{{ block.prompt.length > 120 ? "…" : "" }}</p>
          </article>
        </div>

        <div class="sf-block-form">
          <h3 class="sf-block-form-title">{{ blockForm.id ? "编辑自定义块" : "新增自定义块" }}</h3>
          <label class="sf-field">
            <span class="sf-field-label">名称</span>
            <el-input v-model="blockForm.name" class="sf-field-control" placeholder="如：会议纪要提炼" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">提示词</span>
            <el-input v-model="blockForm.prompt" type="textarea" :rows="6" class="sf-field-control" placeholder="输入系统提示词…" />
          </label>
          <div class="sf-settings-actions">
            <el-button class="sf-btn" type="primary" :disabled="!blockForm.name.trim() || !blockForm.prompt.trim()" @click="saveBlock"><Save :size="14" /><span>保存提示词块</span></el-button>
            <el-button v-if="blockForm.id" class="sf-btn" plain @click="resetBlockForm"><span>取消编辑</span></el-button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'data'">
        <h2 class="sf-settings-title">数据与工程</h2>
        <p class="sf-settings-desc">运行记录与产物文件都保存在本地数据目录。</p>
        <div class="sf-settings-form">
          <div class="sf-data-grid">
            <div class="sf-data-cell"><span class="sf-data-label">数据目录</span><span class="sf-data-value tnum">{{ dataInfo?.dataDir ?? "—" }}</span></div>
            <div class="sf-data-cell"><span class="sf-data-label">运行记录</span><span class="sf-data-value tnum">{{ dataInfo?.runCount ?? "—" }} 条（可清理 {{ dataInfo?.finishedRunCount ?? 0 }} 条）</span></div>
            <div class="sf-data-cell"><span class="sf-data-label">输出文件</span><span class="sf-data-value tnum">{{ dataInfo?.outputFiles ?? "—" }} 个</span></div>
          </div>
          <div class="sf-settings-actions">
            <el-button class="sf-btn" plain @click="loadDataInfo"><span>刷新</span></el-button>
            <el-button class="sf-btn" type="danger" plain @click="clearFinishedRuns"><span>清理已结束运行</span></el-button>
          </div>
        </div>
      </template>

      <template v-else>
        <h2 class="sf-settings-title">{{ groups.find((g) => g.key === active)?.label }}</h2>
        <p class="sf-settings-desc">该分组将在后续里程碑接入。</p>
        <div class="sf-settings-placeholder">规划中</div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.sf-settings {
  height: 100%;
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  background: var(--color-bg);
}

.sf-settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 10px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-y: auto;
}

.sf-settings-nav-item {
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-settings-nav-item:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-settings-nav-item.active {
  background: var(--color-ink);
  color: var(--color-surface);
}

.sf-settings-body {
  padding: 24px 28px 40px;
  max-width: 720px;
  overflow-y: auto;
}

.sf-settings-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-settings-desc {
  margin: 4px 0 18px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.sf-settings-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 460px;
}

.sf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sf-field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-field-control {
  width: 100%;
}

.sf-settings-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.sf-btn {
  gap: 6px;
}

.sf-settings-placeholder {
  padding: 32px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-tertiary);
  font-size: 13px;
  text-align: center;
}

.sf-blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

.sf-block-card {
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-block-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-block-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-block-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
}

.sf-block-prompt {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-block-form {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
}

.sf-block-form-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-data-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.sf-data-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-data-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-data-value {
  font-size: 12px;
  color: var(--color-text);
  word-break: break-all;
}

.sf-danger-text {
  color: var(--color-error);
}
</style>
