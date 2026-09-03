import { defineStore } from "pinia";
import { ref } from "vue";

/** 全局 UI 状态：用于跨布局/画布组件打开同一个浮层。 */
export const useUiStore = defineStore("ui", () => {
  const settingsOpen = ref(false);

  function openSettings() {
    settingsOpen.value = true;
  }

  function closeSettings() {
    settingsOpen.value = false;
  }

  return { settingsOpen, openSettings, closeSettings };
});
