import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { BUILTIN_PROMPT_BLOCKS, type PromptBlock } from "@scribe-flow/shared";
import { api } from "@/lib/api";

export const usePromptsStore = defineStore("prompts", () => {
  const customBlocks = ref<PromptBlock[]>([]);
  const loading = ref(false);

  const allBlocks = computed<PromptBlock[]>(() => [...BUILTIN_PROMPT_BLOCKS, ...customBlocks.value]);

  async function load() {
    loading.value = true;
    try {
      const data = await api.get<{ items: PromptBlock[] }>("/api/prompts");
      customBlocks.value = (data.items ?? []).filter((block) => !block.builtin);
    } finally {
      loading.value = false;
    }
  }

  function getBlock(id: string | undefined): PromptBlock | undefined {
    return allBlocks.value.find((b) => b.id === id);
  }

  async function addBlock(name: string, prompt: string): Promise<PromptBlock> {
    const block = await api.post<PromptBlock>("/api/prompts", { name, prompt });
    await load();
    return block;
  }

  async function updateBlock(id: string, patch: Partial<Pick<PromptBlock, "name" | "prompt">>) {
    await api.patch<PromptBlock>(`/api/prompts/${id}`, patch);
    await load();
  }

  async function removeBlock(id: string) {
    await api.delete<{ ok: boolean }>(`/api/prompts/${id}`);
    await load();
  }

  return { BUILTIN_PROMPT_BLOCKS, customBlocks, loading, allBlocks, load, getBlock, addBlock, updateBlock, removeBlock };
});
