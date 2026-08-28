<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElButton, ElInput, ElMessage, ElOption, ElSegmented, ElSelect } from "element-plus";
import { PlugZap } from "lucide-vue-next";
import type { AiProvider, AsrEngine } from "@scribe-flow/shared";
import { useSettingsStore } from "@/stores/settings";

const store = useSettingsStore();

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

const aiProviderOptions = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "OpenAI", value: "openai" },
  { label: "自定义", value: "custom" },
];

const asrOptions = [
  { label: "MiMo-V2.5（小米）", value: "mimo" },
  { label: "OpenAI 兼容", value: "openai-compatible" },
];

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
}

onMounted(async () => {
  await store.load();
  fillForm();
});

function switchProvider(provider: AiProvider) {
  form.aiProvider = provider;
  if (provider === "deepseek") {
    form.aiBaseUrl = "https://api.deepseek.com/v1";
    form.aiModel = "deepseek-chat";
  } else if (provider === "openai") {
    form.aiBaseUrl = "https://api.openai.com/v1";
    form.aiModel = "gpt-4o-mini";
  }
}

function switchAsr(engine: AsrEngine) {
  form.asrEngine = engine;
  if (engine === "mimo") {
    form.asrBaseUrl = "https://api.xiaomimimo.com/v1";
    form.asrModel = "mimo-v2.5-asr";
  } else if (!form.asrBaseUrl) {
    form.asrBaseUrl = "";
    form.asrModel = "whisper-1";
  }
}

async function saveAll() {
  try {
    await store.save({
      ai: { provider: form.aiProvider, baseUrl: form.aiBaseUrl, model: form.aiModel, apiKey: form.aiKey || undefined },
      asr: { engine: form.asrEngine, baseUrl: form.asrBaseUrl, model: form.asrModel, apiKey: form.asrKey || undefined },
      general: { concurrency: form.concurrency, outputDir: form.outputDir },
    });
    form.aiKey = "";
    form.asrKey = "";
    ElMessage.success("设置已保存");
    await store.load();
    fillForm();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
}

async function testAi() {
  try {
    const content = await store.testAi();
    ElMessage.success(`AI 连接正常：${content.slice(0, 40)}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "AI 连接失败");
  }
}

async function testAsr() {
  try {
    const content = await store.testAsr();
    ElMessage.success(`ASR 连接正常：${content.slice(0, 40)}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "ASR 连接失败");
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
            <el-input v-model="form.aiModel" class="sf-field-control" placeholder="deepseek-chat" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">API Key</span>
            <el-input v-model="form.aiKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.ai.hasKey ? '已保存，留空则不修改' : 'sk-…'" />
          </label>
          <div class="sf-settings-actions">
            <el-button class="sf-btn" plain @click="testAi"><PlugZap :size="14" /><span>测试连接</span></el-button>
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
            <el-segmented v-model="form.asrEngine" :options="asrOptions" block @change="switchAsr" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">接口地址</span>
            <el-input v-model="form.asrBaseUrl" class="sf-field-control" placeholder="https://api.xiaomimimo.com/v1" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">模型</span>
            <el-input v-model="form.asrModel" class="sf-field-control" placeholder="mimo-v2.5-asr" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">API Key</span>
            <el-input v-model="form.asrKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.asr.hasKey ? '已保存，留空则不修改' : 'API Key'" />
          </label>
          <div class="sf-settings-actions">
            <el-button class="sf-btn" plain @click="testAsr"><PlugZap :size="14" /><span>测试连接</span></el-button>
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
</style>
