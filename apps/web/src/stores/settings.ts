import { defineStore } from "pinia";
import { ref, watch } from "vue";

const STORAGE_KEY = "scribe-flow-settings";

interface PersistedSettings {
  defaultPromptBlockId: string;
  autoRun: boolean;
  concurrency: number;
}

function load(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedSettings) : {};
  } catch {
    return {};
  }
}

export const useSettingsStore = defineStore("settings", () => {
  const saved = load();

  const defaultPromptBlockId = ref(saved.defaultPromptBlockId ?? "builtin.insight");
  const autoRun = ref(saved.autoRun ?? false);
  const concurrency = ref(saved.concurrency ?? 2);

  watch(
    [defaultPromptBlockId, autoRun, concurrency],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            defaultPromptBlockId: defaultPromptBlockId.value,
            autoRun: autoRun.value,
            concurrency: concurrency.value,
          } satisfies PersistedSettings),
        );
      } catch {
        // 存储不可用时静默忽略
      }
    },
    { deep: false },
  );

  return { defaultPromptBlockId, autoRun, concurrency };
});
