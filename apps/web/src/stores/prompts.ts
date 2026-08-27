import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { BUILTIN_PROMPT_BLOCKS, type PromptBlock } from "@scribe-flow/shared";

const STORAGE_KEY = "scribe-flow-prompt-blocks";

function loadCustom(): PromptBlock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PromptBlock[]) : [];
  } catch {
    return [];
  }
}

export const usePromptsStore = defineStore("prompts", () => {
  const customBlocks = ref<PromptBlock[]>(loadCustom());

  const allBlocks = computed<PromptBlock[]>(() => [...BUILTIN_PROMPT_BLOCKS, ...customBlocks.value]);

  watch(
    customBlocks,
    () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customBlocks.value));
      } catch {
        // 存储不可用时静默忽略
      }
    },
    { deep: true },
  );

  function getBlock(id: string | undefined): PromptBlock | undefined {
    return allBlocks.value.find((b) => b.id === id);
  }

  function addBlock(name: string, prompt: string): PromptBlock {
    const id = `custom.${Date.now().toString(36)}`;
    const block: PromptBlock = { id, name, prompt, builtin: false };
    customBlocks.value = [...customBlocks.value, block];
    return block;
  }

  function updateBlock(id: string, patch: Partial<Pick<PromptBlock, "name" | "prompt">>) {
    customBlocks.value = customBlocks.value.map((b) => (b.id === id ? { ...b, ...patch } : b));
  }

  function removeBlock(id: string) {
    customBlocks.value = customBlocks.value.filter((b) => b.id !== id);
  }

  return { BUILTIN_PROMPT_BLOCKS, customBlocks, allBlocks, getBlock, addBlock, updateBlock, removeBlock };
});
