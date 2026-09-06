<script setup lang="ts">
import { computed } from "vue";
import { PanelLeftClose } from "lucide-vue-next";
import { useUiStore, type RailTab } from "@/stores/ui";
import ProjectsPanel from "./ProjectsPanel.vue";
import RunsPanel from "./RunsPanel.vue";
import NodesPanel from "./NodesPanel.vue";

const ui = useUiStore();

const tabs: { key: RailTab; label: string }[] = [
  { key: "projects", label: "工程" },
  { key: "runs", label: "运行库" },
  { key: "nodes", label: "节点" },
];

const current = computed(() => ui.panelTab);
</script>

<template>
  <div class="wp">
    <header class="wp-head">
      <div class="wp-seg" role="tablist" aria-label="左侧面板视图">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          role="tab"
          class="wp-seg-btn"
          :class="{ active: current === tab.key }"
          :aria-selected="current === tab.key"
          @click="ui.openPanel(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>
      <button type="button" class="wp-close" title="收起面板" aria-label="收起面板" @click="ui.closePanel()">
        <PanelLeftClose :size="14" />
      </button>
    </header>

    <ProjectsPanel v-if="current === 'projects'" />
    <RunsPanel v-else-if="current === 'runs'" />
    <NodesPanel v-else />
  </div>
</template>
