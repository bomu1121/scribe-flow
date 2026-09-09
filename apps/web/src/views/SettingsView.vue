<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElInput, ElInputNumber, ElMessageBox, ElOption, ElSelect, ElSwitch } from "element-plus";
import { Cloud, Download, FolderOpen, Mic, PlugZap, RefreshCw, RotateCcw, Save, Trash2, Upload } from "lucide-vue-next";
import { toast } from "@/lib/toast";
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
  { key: "search", label: "外部溯源" },
  { key: "general", label: "常规" },
  { key: "obsidian", label: "Obsidian" },
  { key: "nutstore", label: "坚果云" },
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
  searchKey: "",
  searchMaxResults: 5,
  concurrency: 2,
  outputDir: "outputs",
  obsidianVaultPath: "",
  obsidianFolder: "00-Inbox",
  obsidianTagTaxonomyText: "{}",
  obsidianAutoTagEnabled: true,
  obsidianTagMinCount: 5,
  obsidianTagMaxCount: 10,
  obsidianAutoLinkEnabled: true,
  obsidianAutoLinkMax: 5,
  obsidianAutoLinkBidirectional: false,
  nutstoreServerUrl: "https://dav.jianguoyun.com/dav/",
  nutstoreAccount: "",
  nutstorePassword: "",
  nutstoreRemoteRoot: "/我的坚果云/ScribeFlow",
  nutstoreObsidianRemotePath: "/我的坚果云/ScribeFlow/Obsidian",
  nutstoreObsidianMode: false,
});

const DEEPSEEK_DEFAULT_MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;
const aiModelOptions = ref<string[]>([...DEEPSEEK_DEFAULT_MODELS]);
const aiModelLoading = ref(false);
const aiTesting = ref(false);
const asrTesting = ref(false);
const nutstoreTesting = ref(false);

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
const nutstoreRemoteFolders = ref<string[]>([]);
const nutstoreRemoteFiles = ref<Array<{ path: string; name: string; type: "folder" | "file"; size?: number; lastModified?: number }>>([]);
const nutstoreReading = ref(false);
const nutstoreSyncing = ref(false);
const nutstoreBackingUp = ref(false);
const nutstoreRestoring = ref(false);
const nutstoreBackups = ref<Array<{ path: string; name: string; lastModified?: number }>>([]);
const nutstoreBackupFiles = ref<Array<{ path: string; name: string; type: "folder" | "file"; size?: number }>>([]);
const remotePreview = ref<{ path: string; content: string } | null>(null);
const nutstoreResult = ref<{
  action: string;
  detail?: string;
  transferred?: number;
  skipped?: number;
  skippedItems?: Array<{ path: string; reason: string }>;
  errors?: Array<{ path: string; message: string }>;
  items?: string[];
} | null>(null);

const seriesFilter = ref("all");
const versionFilter = ref("all");

function blockSeries(block: PromptBlock): string {
  return block.series || (block.builtin ? "其他内置" : "自定义");
}

const seriesOptions = computed(() => {
  const seen = new Set<string>();
  for (const block of promptsStore.allBlocks) seen.add(blockSeries(block));
  return Array.from(seen);
});

const versionOptions = computed(() => {
  const seen = new Set<string>();
  for (const block of promptsStore.allBlocks) {
    if (seriesFilter.value !== "all" && blockSeries(block) !== seriesFilter.value) continue;
    if (block.version) seen.add(block.version);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

const filteredBlocks = computed(() => {
  return promptsStore.allBlocks.filter((block) => {
    if (seriesFilter.value !== "all" && blockSeries(block) !== seriesFilter.value) return false;
    if (versionFilter.value !== "all" && block.version !== versionFilter.value) return false;
    return true;
  });
});

watch(seriesFilter, () => {
  if (versionFilter.value !== "all" && !versionOptions.value.includes(versionFilter.value)) {
    versionFilter.value = "all";
  }
});

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
    toast.success("提示词块已保存");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "保存失败");
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
    toast.success("已删除");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "删除失败");
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
    toast.success(`已清理 ${result.deleted} 条运行记录`);
    await runsStore.load();
    await loadDataInfo();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "清理失败");
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
  form.searchMaxResults = store.settings.search.maxResults;
  form.concurrency = store.settings.general.concurrency;
  form.outputDir = store.settings.general.outputDir;
  form.obsidianVaultPath = store.settings.obsidian.vaultPath;
  form.obsidianFolder = store.settings.obsidian.folder;
  form.obsidianTagTaxonomyText = JSON.stringify(store.settings.obsidian.tagTaxonomy ?? {}, null, 2);
  form.obsidianAutoTagEnabled = store.settings.obsidian.autoTagEnabled;
  form.obsidianTagMinCount = store.settings.obsidian.tagMinCount;
  form.obsidianTagMaxCount = store.settings.obsidian.tagMaxCount;
  form.obsidianAutoLinkEnabled = store.settings.obsidian.autoLinkEnabled;
  form.obsidianAutoLinkMax = store.settings.obsidian.autoLinkMax;
  form.obsidianAutoLinkBidirectional = store.settings.obsidian.autoLinkBidirectional;
  form.nutstoreServerUrl = store.settings.nutstore.serverUrl;
  form.nutstoreAccount = store.settings.nutstore.account;
  form.nutstoreRemoteRoot = store.settings.nutstore.remoteRoot;
  form.nutstoreObsidianRemotePath = store.settings.nutstore.obsidianRemotePath;
  form.nutstoreObsidianMode = store.settings.nutstore.obsidianMode;
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
  await store.loadObsidianFolders();
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
  let tagTaxonomy: Record<string, string[]>;
  try {
    tagTaxonomy = JSON.parse(form.obsidianTagTaxonomyText || "{}") as Record<string, string[]>;
  } catch {
    toast.error("标签词表不是合法 JSON，请检查格式");
    return;
  }
  try {
    if (form.aiProvider === "deepseek") await refreshAiModels();
    await store.save({
      ai: { provider: form.aiProvider, baseUrl: form.aiBaseUrl, model: form.aiModel, apiKey: form.aiKey || undefined },
      asr: { engine: form.asrEngine, baseUrl: form.asrBaseUrl, model: form.asrModel, apiKey: form.asrKey || undefined },
      search: { provider: "tavily", apiKey: form.searchKey || undefined, maxResults: form.searchMaxResults },
      general: { concurrency: form.concurrency, outputDir: form.outputDir },
      obsidian: {
        vaultPath: form.obsidianVaultPath,
        folder: form.obsidianFolder,
        tagTaxonomy,
        autoTagEnabled: form.obsidianAutoTagEnabled,
        tagMinCount: form.obsidianTagMinCount,
        tagMaxCount: form.obsidianTagMaxCount,
        autoLinkEnabled: form.obsidianAutoLinkEnabled,
        autoLinkMax: form.obsidianAutoLinkMax,
        autoLinkBidirectional: form.obsidianAutoLinkBidirectional,
      },
      nutstore: {
        serverUrl: form.nutstoreServerUrl,
        account: form.nutstoreAccount,
        password: form.nutstorePassword || undefined,
        remoteRoot: form.nutstoreRemoteRoot,
        obsidianRemotePath: form.nutstoreObsidianRemotePath,
        obsidianMode: form.nutstoreObsidianMode,
      },
    });
    toast.success("设置已保存");
    await store.load();
    await store.loadObsidianFolders();
    fillForm();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "保存失败");
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
    toast.success(`AI 连接正常：${(result.content ?? "连接正常").slice(0, 40)}`);
    if (result.models?.length > 0) {
      if (form.aiModel && !result.models.includes(form.aiModel)) form.aiModel = result.models[0];
      syncAiModelOptions(result.models);
    }
    if (result.modelsError) toast.warning(`连接正常，但拉取模型列表失败：${result.modelsError}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "AI 连接失败");
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
    toast.success(`ASR 连接正常：${(content ?? "连接正常").slice(0, 40)}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "ASR 连接失败");
  } finally {
    asrTesting.value = false;
  }
}

async function testNutstore() {
  nutstoreTesting.value = true;
  try {
    const webdav = await store.testNutstore({
      serverUrl: form.nutstoreServerUrl,
      account: form.nutstoreAccount,
      password: form.nutstorePassword || undefined,
      remotePath: "/",
    });
    toast.success(`坚果云连接正常：${webdav}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "坚果云连接失败");
  } finally {
    nutstoreTesting.value = false;
  }
}

async function loadNutstoreFolders() {
  nutstoreReading.value = true;
  try {
    const dirs = await store.listNutstoreFolders(form.nutstoreObsidianRemotePath, 3);
    nutstoreRemoteFolders.value = dirs;
    nutstoreResult.value = {
      action: "读取云端目录",
      detail: `读取完成，共发现 ${dirs.length} 个子目录（根：${form.nutstoreObsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian"}）`,
      items: dirs,
    };
    toast.success(`已读取坚果云 Obsidian 目录：${dirs.length} 个`);
  } catch (err) {
    nutstoreResult.value = { action: "读取云端目录", errors: [{ path: form.nutstoreObsidianRemotePath || "", message: err instanceof Error ? err.message : "读取坚果云目录失败" }] };
    toast.error(err instanceof Error ? err.message : "读取坚果云目录失败");
  } finally {
    nutstoreReading.value = false;
  }
}

async function loadNutstoreFiles() {
  nutstoreReading.value = true;
  try {
    const result = await store.listNutstore(form.nutstoreObsidianRemotePath);
    nutstoreRemoteFiles.value = result.items;
    const markdownFiles = result.items.filter((item) => item.type === "file" && item.name.endsWith(".md"));
    nutstoreResult.value = {
      action: "读取云端文件",
      detail: `读取完成：目录项 ${result.items.length} 个，其中 Markdown ${markdownFiles.length} 个（根：${form.nutstoreObsidianRemotePath || "/我的坚果云/ScribeFlow/Obsidian"}）${result.truncated ? "；注意：结果可能不完整" : ""}`,
      items: markdownFiles.map((item) => item.name),
    };
    if (result.truncated) toast.warning("目录项较多，坚果云单次列表可能不完整，建议按子目录逐层读取");
    else toast.success(`已读取坚果云文件：${result.items.length} 个`);
  } catch (err) {
    nutstoreResult.value = { action: "读取云端文件", errors: [{ path: form.nutstoreObsidianRemotePath || "", message: err instanceof Error ? err.message : "读取坚果云文件失败" }] };
    toast.error(err instanceof Error ? err.message : "读取坚果云文件失败");
  } finally {
    nutstoreReading.value = false;
  }
}

async function previewRemoteFile(path: string) {
  try {
    const result = await store.readNutstore(path);
    remotePreview.value = { path: result.path, content: result.content.slice(0, 5000) };
    nutstoreResult.value = { action: "读取远程笔记", detail: `已读取 ${result.path}（${result.size} 字节）` };
  } catch (err) {
    nutstoreResult.value = { action: "读取远程笔记", errors: [{ path, message: err instanceof Error ? err.message : "读取坚果云笔记失败" }] };
    toast.error(err instanceof Error ? err.message : "读取坚果云笔记失败");
  }
}

async function pushObsidian() {
  nutstoreSyncing.value = true;
  try {
    const result = await store.pushNutstore(undefined, form.nutstoreObsidianRemotePath);
    nutstoreResult.value = {
      action: "推送本地到坚果云",
      detail: `完成：推送 ${result.transferred} 篇，跳过/冲突 ${result.skipped} 篇，失败 ${result.errors.length} 篇`,
      transferred: result.transferred,
      skipped: result.skipped,
      skippedItems: result.skippedItems,
      errors: result.errors,
    };
    const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个（云端较新/冲突）` : "";
    const errors = result.errors.length > 0 ? `，${result.errors.length} 个失败` : "";
    toast.success(`已推送 ${result.transferred} 篇笔记到坚果云${skipped}${errors}`);
  } catch (err) {
    nutstoreResult.value = { action: "推送本地到坚果云", errors: [{ path: "", message: err instanceof Error ? err.message : "推送失败" }] };
    toast.error(err instanceof Error ? err.message : "推送失败");
  } finally {
    nutstoreSyncing.value = false;
  }
}

async function pullObsidian() {
  nutstoreSyncing.value = true;
  try {
    const result = await store.pullNutstore(undefined, form.nutstoreObsidianRemotePath);
    nutstoreResult.value = {
      action: "拉取坚果云到本地",
      detail: `完成：拉取 ${result.transferred} 篇，跳过/冲突 ${result.skipped} 篇，失败 ${result.errors.length} 篇`,
      transferred: result.transferred,
      skipped: result.skipped,
      skippedItems: result.skippedItems,
      errors: result.errors,
    };
    const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个（本地较新/冲突）` : "";
    const errors = result.errors.length > 0 ? `，${result.errors.length} 个失败` : "";
    toast.success(`已从坚果云拉取 ${result.transferred} 篇笔记${skipped}${errors}`);
  } catch (err) {
    nutstoreResult.value = { action: "拉取坚果云到本地", errors: [{ path: "", message: err instanceof Error ? err.message : "拉取失败" }] };
    toast.error(err instanceof Error ? err.message : "拉取失败");
  } finally {
    nutstoreSyncing.value = false;
  }
}

async function backupToNutstore() {
  nutstoreBackingUp.value = true;
  try {
    const result = await store.backupNutstore();
    nutstoreBackups.value = await store.listNutstoreBackups();
    nutstoreResult.value = { action: "备份到坚果云", detail: `备份完成：${result.remotePath}`, items: result.files };
    toast.success(`已备份到坚果云：${result.remotePath}`);
  } catch (err) {
    nutstoreResult.value = { action: "备份到坚果云", errors: [{ path: "", message: err instanceof Error ? err.message : "备份失败" }] };
    toast.error(err instanceof Error ? err.message : "备份失败");
  } finally {
    nutstoreBackingUp.value = false;
  }
}

async function loadNutstoreBackups() {
  nutstoreBackingUp.value = true;
  try {
    nutstoreBackups.value = await store.listNutstoreBackups();
    nutstoreBackupFiles.value = [];
    nutstoreResult.value = { action: "读取备份列表", detail: `读取到 ${nutstoreBackups.value.length} 个云端备份` };
  } catch (err) {
    nutstoreResult.value = { action: "读取备份列表", errors: [{ path: "", message: err instanceof Error ? err.message : "读取备份列表失败" }] };
    toast.error(err instanceof Error ? err.message : "读取备份列表失败");
  } finally {
    nutstoreBackingUp.value = false;
  }
}

async function loadNutstoreBackupFiles(backupPath: string) {
  nutstoreReading.value = true;
  try {
    const result = await store.listNutstore(backupPath);
    nutstoreBackupFiles.value = result.items.filter((item) => item.type === "file").map((item) => ({ path: item.path, name: item.name, type: item.type, size: item.size }));
    nutstoreResult.value = {
      action: "读取备份内容",
      detail: `读取备份目录：${backupPath}，共 ${nutstoreBackupFiles.value.length} 个文件`,
      items: nutstoreBackupFiles.value.map((file) => file.name),
    };
    remotePreview.value = null;
  } catch (err) {
    nutstoreResult.value = { action: "读取备份内容", errors: [{ path: backupPath, message: err instanceof Error ? err.message : "读取备份内容失败" }] };
    toast.error(err instanceof Error ? err.message : "读取备份内容失败");
  } finally {
    nutstoreReading.value = false;
  }
}

async function restoreNutstoreBackup(backup: { path: string; name: string }) {
  try {
    await ElMessageBox.confirm(
      `用备份「${backup.name}」覆盖本机全部数据（项目/文件夹/运行记录/设置/提示词块）？恢复前会自动把当前数据再备份一份到坚果云；此操作不可撤销。`,
      "从坚果云恢复",
      {
        confirmButtonText: "恢复",
        cancelButtonText: "取消",
        type: "warning",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return; // 用户取消
  }
  nutstoreRestoring.value = true;
  try {
    const result = await store.restoreNutstore(backup.path);
    nutstoreResult.value = {
      action: "从坚果云恢复",
      detail: `已恢复备份 ${backup.name}（${result.tables.length} 张表）；恢复前自动备份：${result.autoBackupPath}`,
      items: result.tables,
    };
    toast.success("恢复成功，页面即将刷新");
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    nutstoreResult.value = { action: "从坚果云恢复", errors: [{ path: backup.path, message: err instanceof Error ? err.message : "恢复失败" }] };
    toast.error(err instanceof Error ? err.message : "恢复失败");
    nutstoreRestoring.value = false;
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
              <span v-if="store.settings?.ai.hasKey" class="sf-chip sf-chip--success">已保存</span>
              <span v-else class="sf-chip sf-chip--warning">未配置</span>
            </span>
            <el-input v-model="form.aiKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.ai.hasKey ? '已保存，留空则不修改' : 'sk-…'" />
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="aiTesting" @click="testAi"><PlugZap :size="14" /><span>{{ aiTesting ? "测试中…" : "测试连接" }}</span></button>
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'asr'">
        <h2 class="sf-settings-title">语音识别</h2>
        <p class="sf-settings-desc">转写节点使用云 ASR，支持 MiMo-V2.5 与 OpenAI 兼容端点。</p>
        <div class="sf-settings-form">
          <div class="sf-field">
            <span class="sf-field-label">引擎</span>
            <ModelSelect
              v-model="form.asrEngine"
              :options="asrOptions"
              placeholder="选择 ASR 引擎"
              :prefix-icon="Mic"
              @change="(value: string) => switchAsr(value as AsrEngine)"
            />
          </div>
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
              <span v-if="store.settings?.asr.hasKey" class="sf-chip sf-chip--success">已保存</span>
              <span v-else class="sf-chip sf-chip--warning">未配置</span>
            </span>
            <el-input v-model="form.asrKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.asr.hasKey ? '已保存，留空则不修改' : 'API Key'" />
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="asrTesting" @click="testAsr"><PlugZap :size="14" /><span>{{ asrTesting ? "测试中…" : "测试连接" }}</span></button>
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'search'">
        <h2 class="sf-settings-title">外部溯源</h2>
        <p class="sf-settings-desc">用于“信息溯源（结构化核对版）”对外部人物/机构/研究/新闻做联网核查。当前接入 Tavily Search API。</p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">
              Tavily API Key
              <span v-if="store.settings?.search.hasKey" class="sf-chip sf-chip--success">已保存</span>
              <span v-else class="sf-chip sf-chip--warning">未配置</span>
            </span>
            <el-input v-model="form.searchKey" type="password" show-password class="sf-field-control" :placeholder="store.settings?.search.hasKey ? '已保存，留空则不修改' : 'tvly-…'" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">每条最多返回结果数</span>
            <el-input-number v-model="form.searchMaxResults" :min="1" :max="10" class="sf-field-control" />
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
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
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'obsidian'">
        <h2 class="sf-settings-title">Obsidian</h2>
        <p class="sf-settings-desc">配置 Obsidian 库、自动打标与自动关联；Obsidian 笔记节点会自动保存到这里。</p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">Obsidian 库路径</span>
            <el-input v-model="form.obsidianVaultPath" class="sf-field-control" placeholder="D:\知识库" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">默认保存目录</span>
            <el-input v-model="form.obsidianFolder" class="sf-field-control" placeholder="00-Inbox" />
          </label>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" @click="store.loadObsidianFolders()"><span>读取目录</span></button>
          </div>
          <p class="sf-settings-desc">当前已读取目录：{{ store.obsidianFolders.length }} 个</p>

          <div class="sf-settings-divider">AI 结构化提取</div>
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">自动提取 人物 / 事件 / 时期</span>
            <el-switch v-model="form.obsidianAutoTagEnabled" />
          </label>

          <div class="sf-settings-divider">自动关联相关笔记</div>
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">写入后自动关联相关笔记</span>
            <el-switch v-model="form.obsidianAutoLinkEnabled" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">最多关联篇数</span>
            <el-input-number v-model="form.obsidianAutoLinkMax" :min="0" :max="20" size="small" />
          </label>

          <div class="sf-settings-actions">
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'nutstore'">
        <h2 class="sf-settings-title">坚果云</h2>
        <p class="sf-settings-desc">通过 WebDAV 使用坚果云：读取云端 Obsidian 笔记、本地 ↔ 云端推送/拉取、应用数据备份。应用密码只保存在服务端。</p>
        <div class="sf-settings-form">
          <label class="sf-field">
            <span class="sf-field-label">WebDAV 服务器</span>
            <el-input v-model="form.nutstoreServerUrl" class="sf-field-control" placeholder="https://dav.jianguoyun.com/dav/" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">账号（邮箱）</span>
            <el-input v-model="form.nutstoreAccount" class="sf-field-control" placeholder="you@example.com" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">
              应用密码
              <span v-if="store.settings?.nutstore.hasPassword" class="sf-chip sf-chip--success">已保存</span>
              <span v-else class="sf-chip sf-chip--warning">未配置</span>
            </span>
            <el-input v-model="form.nutstorePassword" type="password" show-password class="sf-field-control" :placeholder="store.settings?.nutstore.hasPassword ? '已保存，留空则不修改' : '粘贴坚果云生成的应用密码'" />
            <p class="sf-field-hint">
              坚果云应用密码在<strong>网页版</strong>生成：右上角头像 → 账户信息 → 安全选项 → 第三方应用管理 → 添加应用密码。
              <a href="https://help.jianguoyun.com/?p=2064" target="_blank" rel="noreferrer">查看官方说明</a>
            </p>
          </label>
          <label class="sf-field">
            <span class="sf-field-label">数据根目录</span>
            <el-input v-model="form.nutstoreRemoteRoot" class="sf-field-control" placeholder="/我的坚果云/ScribeFlow" />
          </label>
          <label class="sf-field">
            <span class="sf-field-label">Obsidian 云端目录</span>
            <el-input v-model="form.nutstoreObsidianRemotePath" class="sf-field-control" placeholder="/我的坚果云/ScribeFlow/Obsidian" />
            <p class="sf-field-hint">想让文件出现在本地坚果云客户端，请把路径放在你的同步文件夹下，例如 <strong>/我的坚果云/ScribeFlow</strong>；不要直接填 <strong>/ScribeFlow</strong>。</p>
          </label>
          <label class="sf-field sf-field-row">
            <span class="sf-field-label">Obsidian 笔记节点直接读写坚果云</span>
            <el-switch v-model="form.nutstoreObsidianMode" />
          </label>
          <p class="sf-settings-desc">开启后，Obsidian 节点写入与自动关联扫描都会走坚果云远程目录；目录下拉也会读取云端目录。</p>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="nutstoreTesting" @click="testNutstore"><PlugZap :size="14" /><span>{{ nutstoreTesting ? "测试中…" : "测试连接" }}</span></button>
            <button type="button" class="sf-btn sf-btn--primary" @click="saveAll"><span>保存设置</span></button>
          </div>

          <div class="sf-settings-divider">读取云端</div>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="nutstoreReading" @click="loadNutstoreFolders"><FolderOpen :size="14" /><span>{{ nutstoreReading ? "读取中…" : "读取云端目录" }}</span></button>
            <button type="button" class="sf-btn" :disabled="nutstoreReading" @click="loadNutstoreFiles"><RefreshCw :size="14" /><span>{{ nutstoreReading ? "读取中…" : "读取云端文件" }}</span></button>
          </div>
          <p class="sf-settings-desc">已读取目录：{{ nutstoreRemoteFolders.length }} 个；目录按“{{ form.nutstoreObsidianRemotePath || '/我的坚果云/ScribeFlow/Obsidian' }}”为根递归最多 3 层。</p>
          <div v-if="nutstoreRemoteFolders.length > 0" class="sf-nutstore-list">
            <span v-for="dir in nutstoreRemoteFolders.slice(0, 30)" :key="dir" class="sf-nutstore-tag">{{ dir }}</span>
            <span v-if="nutstoreRemoteFolders.length > 30" class="sf-nutstore-tag sf-nutstore-more">+{{ nutstoreRemoteFolders.length - 30 }}</span>
          </div>
          <div v-if="nutstoreRemoteFiles.length > 0" class="sf-nutstore-list">
            <button
              v-for="file in nutstoreRemoteFiles.filter((f) => f.type === 'file' && f.name.endsWith('.md')).slice(0, 20)"
              :key="file.path"
              type="button"
              class="sf-text-btn"
              @click="previewRemoteFile(file.path)"
            >
              <Cloud :size="13" /><span>{{ file.name }}</span>
            </button>
          </div>
          <p v-if="remotePreview" class="sf-nutstore-preview">{{ remotePreview.content.slice(0, 800) }}{{ remotePreview.content.length > 800 ? "…" : "" }}</p>

          <div class="sf-settings-divider">本地 Obsidian ↔ 坚果云</div>
          <p class="sf-settings-desc">以 Obsidian 设置页里的“Obsidian 库路径”为本地端；只同步 .md 笔记。遇到不一致时会跳过并显示在下方「最近操作结果」中，不会自动覆盖对端较新的文件。</p>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="nutstoreSyncing" @click="pushObsidian"><Upload :size="14" /><span>{{ nutstoreSyncing ? "同步中…" : "推送本地到坚果云" }}</span></button>
            <button type="button" class="sf-btn" :disabled="nutstoreSyncing" @click="pullObsidian"><Download :size="14" /><span>{{ nutstoreSyncing ? "同步中…" : "拉取坚果云到本地" }}</span></button>
          </div>

          <div class="sf-settings-divider">应用数据备份</div>
          <div class="sf-settings-actions">
            <button type="button" class="sf-btn" :disabled="nutstoreBackingUp" @click="backupToNutstore"><Save :size="14" /><span>{{ nutstoreBackingUp ? "备份中…" : "备份数据到坚果云" }}</span></button>
            <button type="button" class="sf-btn" :disabled="nutstoreBackingUp" @click="loadNutstoreBackups"><RefreshCw :size="14" /><span>读取备份列表</span></button>
          </div>
          <div v-if="nutstoreBackups.length > 0" class="sf-nutstore-backup-list">
            <div v-for="backup in nutstoreBackups.slice(0, 10)" :key="backup.path" class="sf-nutstore-backup-row">
              <span class="sf-nutstore-tag">{{ backup.name }}</span>
              <button type="button" class="sf-text-btn" :disabled="nutstoreReading || nutstoreRestoring" @click="loadNutstoreBackupFiles(backup.path)">查看内容</button>
              <button
                type="button"
                class="sf-text-btn sf-text-btn--danger"
                :disabled="nutstoreReading || nutstoreRestoring || nutstoreBackingUp"
                @click="restoreNutstoreBackup(backup)"
              >
                <RotateCcw :size="13" />
                <span>{{ nutstoreRestoring ? "恢复中…" : "恢复" }}</span>
              </button>
            </div>
            <span v-if="nutstoreBackups.length > 10" class="sf-settings-desc">…… 还有 {{ nutstoreBackups.length - 10 }} 个备份未展示</span>
            <p class="sf-settings-desc">「恢复」会用所选备份整库覆盖本机数据：恢复前自动备份当前库；有运行中流程时需先停止；成功后页面自动刷新。</p>
          </div>
          <div v-if="nutstoreBackupFiles.length > 0" class="sf-nutstore-backup-files">
            <button
              v-for="file in nutstoreBackupFiles"
              :key="file.path"
              type="button"
              class="sf-text-btn"
              :disabled="file.name !== 'backup.json'"
              @click="previewRemoteFile(file.path)"
            >
              <Cloud :size="13" /><span>{{ file.name }}{{ file.size != null ? `（${file.size} B）` : "" }}</span>
            </button>
            <p class="sf-settings-desc">提示：backup.json 可点击预览；scribe-flow.sqlite 是 SQLite 数据库文件，请用本地坚果云客户端或数据库工具打开。</p>
          </div>

          <div v-if="nutstoreResult" class="sf-nutstore-result">
            <h3 class="sf-nutstore-result-title">最近操作结果：{{ nutstoreResult.action }}</h3>
            <p v-if="nutstoreResult.detail" class="sf-nutstore-result-detail">{{ nutstoreResult.detail }}</p>
            <div v-if="nutstoreResult.transferred !== undefined || nutstoreResult.skipped !== undefined" class="sf-nutstore-result-stats">
              <span v-if="nutstoreResult.transferred !== undefined">已传输 <strong>{{ nutstoreResult.transferred }}</strong></span>
              <span v-if="nutstoreResult.skipped !== undefined">跳过/冲突 <strong>{{ nutstoreResult.skipped }}</strong></span>
              <span v-if="nutstoreResult.errors?.length">失败 <strong>{{ nutstoreResult.errors.length }}</strong></span>
            </div>
            <ul v-if="nutstoreResult.skippedItems && nutstoreResult.skippedItems.length > 0" class="sf-nutstore-result-list">
              <li v-for="item in nutstoreResult.skippedItems.slice(0, 20)" :key="item.path">
                <span class="sf-nutstore-result-path">{{ item.path }}</span>
                <span class="sf-nutstore-result-reason">{{ item.reason }}</span>
              </li>
              <li v-if="nutstoreResult.skippedItems.length > 20" class="sf-nutstore-result-more">…… 还有 {{ nutstoreResult.skippedItems.length - 20 }} 条未展示</li>
            </ul>
            <ul v-if="nutstoreResult.errors && nutstoreResult.errors.length > 0" class="sf-nutstore-result-list sf-nutstore-result-list--error">
              <li v-for="(item, index) in nutstoreResult.errors.slice(0, 20)" :key="`${item.path}-${index}`">
                <span class="sf-nutstore-result-path">{{ item.path || "操作" }}</span>
                <span class="sf-nutstore-result-reason">{{ item.message }}</span>
              </li>
              <li v-if="nutstoreResult.errors.length > 20" class="sf-nutstore-result-more">…… 还有 {{ nutstoreResult.errors.length - 20 }} 条未展示</li>
            </ul>
            <ul v-if="nutstoreResult.items && nutstoreResult.items.length > 0" class="sf-nutstore-result-list">
              <li v-for="(item, index) in nutstoreResult.items.slice(0, 20)" :key="`${item}-${index}`">
                <span class="sf-nutstore-result-path">{{ item }}</span>
              </li>
              <li v-if="nutstoreResult.items.length > 20" class="sf-nutstore-result-more">…… 还有 {{ nutstoreResult.items.length - 20 }} 条未展示</li>
            </ul>
          </div>
        </div>
      </template>

      <template v-else-if="active === 'prompts'">
        <h2 class="sf-settings-title">提示词块库</h2>
        <p class="sf-settings-desc">内置块只读，可按模板系列与版本筛选；自定义块由 AI 加工节点引用，修改后下一次运行生效。</p>
        <div class="sf-block-filters">
          <label class="sf-field sf-block-filter">
            <span class="sf-field-label">模板系列</span>
            <el-select v-model="seriesFilter" class="sf-field-control" size="small">
              <el-option label="全部系列" value="all" />
              <el-option v-for="series in seriesOptions" :key="series" :label="series" :value="series" />
            </el-select>
          </label>
          <label class="sf-field sf-block-filter">
            <span class="sf-field-label">版本</span>
            <el-select v-model="versionFilter" class="sf-field-control" size="small" :disabled="versionOptions.length === 0">
              <el-option label="全部版本" value="all" />
              <el-option v-for="version in versionOptions" :key="version" :label="version" :value="version" />
            </el-select>
          </label>
        </div>
        <div class="sf-blocks">
          <article v-for="block in filteredBlocks" :key="block.id" class="sf-block-card">
            <header class="sf-block-head">
              <span class="sf-block-name">{{ block.name }}</span>
              <span v-if="block.builtin" class="sf-chip sf-chip--info">内置</span>
              <span v-if="block.version" class="sf-chip sf-chip--warning">{{ block.version }}</span>
              <span v-if="block.recommended" class="sf-chip sf-chip--success">推荐</span>
              <span class="sf-block-actions">
                <template v-if="!block.builtin">
                  <button type="button" class="sf-text-btn" @click="editBlock(block)">编辑</button>
                  <button type="button" class="sf-text-btn sf-text-btn--danger" aria-label="删除提示词块" @click="removeBlock(block)"><Trash2 :size="13" /></button>
                </template>
              </span>
            </header>
            <p v-if="block.series" class="sf-block-series">{{ block.series }}</p>
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
            <button type="button" class="sf-btn sf-btn--primary" :disabled="!blockForm.name.trim() || !blockForm.prompt.trim()" @click="saveBlock"><Save :size="14" /><span>保存提示词块</span></button>
            <button v-if="blockForm.id" type="button" class="sf-btn" @click="resetBlockForm"><span>取消编辑</span></button>
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
            <button type="button" class="sf-btn" @click="loadDataInfo"><span>刷新</span></button>
            <button type="button" class="sf-btn sf-btn--danger" @click="clearFinishedRuns"><span>清理已结束运行</span></button>
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
  background: var(--color-ink-soft);
  color: var(--color-text);
  font-weight: 500;
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

.sf-field-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.sf-field-sep {
  color: var(--color-text-tertiary);
}

.sf-field-mono :deep(.el-textarea__inner) {
  font-family: var(--font-mono);
  font-size: 12px;
}

.sf-field-hint {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-tertiary);
}

.sf-field-hint a {
  color: var(--color-text-secondary);
  text-decoration: underline;
}

.sf-settings-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.sf-settings-divider {
  margin: 4px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    opacity var(--dur-1) var(--ease-out);
}

.sf-btn:hover:not(:disabled) {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sf-btn--primary {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-surface);
}

.sf-btn--primary:hover:not(:disabled) {
  border-color: var(--color-text);
  background: var(--color-text);
  color: var(--color-surface);
}

.sf-btn--danger {
  color: var(--color-error);
}

.sf-btn--danger:hover:not(:disabled) {
  background: var(--color-error-soft);
  color: var(--color-error);
}

.sf-chip {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.sf-chip--success {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.sf-chip--warning {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.sf-chip--info {
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
}

.sf-text-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.sf-text-btn:hover {
  background: var(--color-ink-soft);
  color: var(--color-text);
}

.sf-text-btn--danger {
  color: var(--color-error);
}

.sf-text-btn--danger:hover {
  background: var(--color-error-soft);
  color: var(--color-error);
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

.sf-block-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.sf-block-filter {
  width: 180px;
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
  gap: 6px;
  flex-wrap: wrap;
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

.sf-block-series {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sf-block-prompt {
  margin: 4px 0 0;
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

.sf-nutstore-result {
  margin-top: 8px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.sf-nutstore-result-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.sf-nutstore-result-detail {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sf-nutstore-result-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sf-nutstore-result-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.sf-nutstore-result-list li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-ink-soft);
  font-size: 11px;
}

.sf-nutstore-result-list--error li {
  background: var(--color-error-soft);
}

.sf-nutstore-result-path {
  color: var(--color-text);
  font-weight: 500;
  word-break: break-all;
}

.sf-nutstore-result-reason {
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.sf-nutstore-result-more {
  color: var(--color-text-tertiary);
}

.sf-nutstore-backup-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0 6px;
}

.sf-nutstore-backup-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-nutstore-backup-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 4px;
}

.sf-nutstore-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 4px;
}

.sf-nutstore-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--color-ink-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.sf-nutstore-more {
  background: transparent;
  border: 1px solid var(--color-border);
}

.sf-nutstore-preview {
  margin: 4px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}

.sf-danger-text {
  color: var(--color-error);
}
</style>
