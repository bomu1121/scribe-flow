import { defineStore } from "pinia";
import { ref } from "vue";
import type { AppSettings, UpdateSettingsRequest } from "@scribe-flow/shared";
import { api } from "@/lib/api";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings | null>(null);
  const loading = ref(false);

  async function load() {
    loading.value = true;
    try {
      settings.value = await api.get<AppSettings>("/api/settings");
    } finally {
      loading.value = false;
    }
  }

  async function save(patch: UpdateSettingsRequest) {
    settings.value = await api.put<AppSettings>("/api/settings", patch);
  }

  async function testAi(): Promise<string> {
    const result = await api.post<{ ok: boolean; content?: string }>("/api/settings/test/ai");
    return result.content ?? "连接正常";
  }

  async function testAsr(): Promise<string> {
    const result = await api.post<{ ok: boolean; content?: string }>("/api/settings/test/asr");
    return result.content ?? "连接正常";
  }

  return { settings, loading, load, save, testAi, testAsr };
});
