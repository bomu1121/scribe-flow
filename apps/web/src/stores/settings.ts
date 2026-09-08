import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type {
  AiProvider,
  AppSettings,
  AsrEngine,
  NutstoreBackupItem,
  NutstoreListResult,
  NutstoreReadResult,
  NutstoreRestoreResult,
  NutstoreSyncResult,
  UpdateSettingsRequest,
} from "@scribe-flow/shared";
import { api } from "@/lib/api";

const AI_KEY_DRAFT_STORAGE = "scribe-flow.aiKeyDraft";
const ASR_KEY_DRAFT_STORAGE = "scribe-flow.asrKeyDraft";

function readKeyDraft(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeKeyDraft(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // 隐私模式或 storage 不可用时静默降级为内存态
  }
}

export interface AiTestPayload {
  provider?: AiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface AsrTestPayload {
  engine?: AsrEngine;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface AiTestResult {
  content: string;
  models: string[];
  modelsError?: string;
}

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings | null>(null);
  const loading = ref(false);
  /** Obsidian 库内目录列表，由设置页读取后供节点下拉选择复用。 */
  const obsidianFolders = ref<string[]>([]);
  /** 保存在 sessionStorage 中，刷新页面后仍可回显；关闭标签页后清除。 */
  const aiKeyDraft = ref(readKeyDraft(AI_KEY_DRAFT_STORAGE));
  const asrKeyDraft = ref(readKeyDraft(ASR_KEY_DRAFT_STORAGE));

  watch(aiKeyDraft, (value) => writeKeyDraft(AI_KEY_DRAFT_STORAGE, value));
  watch(asrKeyDraft, (value) => writeKeyDraft(ASR_KEY_DRAFT_STORAGE, value));

  async function load() {
    loading.value = true;
    try {
      settings.value = await api.get<AppSettings>("/api/settings");
      await loadObsidianFolders();
    } finally {
      loading.value = false;
    }
  }

  async function save(patch: UpdateSettingsRequest) {
    settings.value = await api.put<AppSettings>("/api/settings", patch);
  }

  async function loadObsidianFolders() {
    try {
      const data = await api.get<{ items: string[] }>("/api/settings/obsidian/folders");
      obsidianFolders.value = data.items ?? [];
    } catch {
      // 读取目录失败不应阻塞设置页/节点；由用户在设置页手动重试并看到明确错误。
      obsidianFolders.value = [];
    }
  }

  async function testAi(payload?: AiTestPayload): Promise<AiTestResult> {
    const result = await api.post<{ ok: boolean; content?: string; models?: string[]; modelsError?: string }>("/api/settings/test/ai", payload);
    return { content: result.content ?? "连接正常", models: result.models ?? [], modelsError: result.modelsError };
  }

  async function fetchAiModels(payload?: AiTestPayload): Promise<string[]> {
    const result = await api.post<{ ok: boolean; models?: string[] }>("/api/settings/ai/models", payload);
    return result.models ?? [];
  }

  async function testAsr(payload?: AsrTestPayload): Promise<string> {
    const result = await api.post<{ ok: boolean; content?: string }>("/api/settings/test/asr", payload);
    return result.content ?? "连接正常";
  }

  async function testNutstore(payload?: { serverUrl?: string; account?: string; password?: string; remotePath?: string }) {
    const result = await api.post<{ ok: boolean; webdav: string }>("/api/nutstore/test", payload);
    return result.webdav;
  }

  async function listNutstore(path?: string): Promise<NutstoreListResult> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return api.get<NutstoreListResult>(`/api/nutstore/list${query}`);
  }

  async function listNutstoreFolders(path?: string, maxDepth = 3): Promise<string[]> {
    const query = new URLSearchParams();
    if (path) query.set("path", path);
    query.set("maxDepth", String(maxDepth));
    const result = await api.get<{ items: string[] }>(`/api/nutstore/folders?${query.toString()}`);
    return result.items ?? [];
  }

  async function readNutstore(path: string): Promise<NutstoreReadResult> {
    return api.get<NutstoreReadResult>(`/api/nutstore/read?path=${encodeURIComponent(path)}`);
  }

  async function pushNutstore(localPath?: string, remotePath?: string): Promise<NutstoreSyncResult> {
    return api.post<NutstoreSyncResult>("/api/nutstore/sync/push", { localPath, remotePath });
  }

  async function pullNutstore(localPath?: string, remotePath?: string): Promise<NutstoreSyncResult> {
    return api.post<NutstoreSyncResult>("/api/nutstore/sync/pull", { localPath, remotePath });
  }

  async function backupNutstore(): Promise<{ remotePath: string; files: string[]; uploadedAt: number }> {
    return api.post<{ remotePath: string; files: string[]; uploadedAt: number }>("/api/nutstore/backup");
  }

  async function restoreNutstore(backupPath: string): Promise<NutstoreRestoreResult> {
    return api.post<NutstoreRestoreResult>("/api/nutstore/restore", { path: backupPath });
  }

  async function listNutstoreBackups(): Promise<NutstoreBackupItem[]> {
    const result = await api.get<{ items: NutstoreBackupItem[] }>("/api/nutstore/backups");
    return result.items ?? [];
  }

  return { settings, loading, obsidianFolders, aiKeyDraft, asrKeyDraft, load, save, loadObsidianFolders, testAi, testAsr, fetchAiModels, testNutstore, listNutstore, listNutstoreFolders, readNutstore, pushNutstore, pullNutstore, backupNutstore, restoreNutstore, listNutstoreBackups };
});
