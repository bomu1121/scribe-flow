import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { AiProvider, AppSettings, AsrEngine, UpdateSettingsRequest } from "@scribe-flow/shared";
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
    const data = await api.get<{ items: string[] }>("/api/settings/obsidian/folders");
    obsidianFolders.value = data.items ?? [];
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

  return { settings, loading, obsidianFolders, aiKeyDraft, asrKeyDraft, load, save, loadObsidianFolders, testAi, testAsr, fetchAiModels };
});
