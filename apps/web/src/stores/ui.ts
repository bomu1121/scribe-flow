import { defineStore } from "pinia";
import { ref } from "vue";

export type RailTab = "projects" | "runs" | "nodes";

const PANEL_STORAGE_KEY = "scribe-flow.panelState";

interface PanelState {
  open: boolean;
  tab: RailTab;
}

function readPanelState(): PanelState {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelState>;
      if (parsed.tab === "projects" || parsed.tab === "runs" || parsed.tab === "nodes") {
        return { open: parsed.open !== false, tab: parsed.tab };
      }
    }
  } catch {
    // 忽略损坏状态
  }
  return { open: true, tab: "projects" };
}

export interface NodeAddRequest {
  seq: number;
  type: string;
}

/** 全局 UI 状态：设置浮层、单面板（活动条 + 唯一侧栏）与节点添加总线。 */
export const useUiStore = defineStore("ui", () => {
  const settingsOpen = ref(false);
  /** 项目文档阅读器浮层。 */
  const docsOpen = ref(false);
  /** 快捷新建（粘贴 B 站链接直接建工程）浮层；入口在工作台面板与首页。 */
  const quickCreateOpen = ref(false);
  /** 快捷新建的目标文件夹：null 表示根层级。 */
  const quickCreateFolderId = ref<string | null>(null);
  /** 单面板：open=false 时收起为纯活动条。 */
  const panelState = ref<PanelState>(readPanelState());
  const panelOpen = ref(panelState.value.open);
  const panelTab = ref<RailTab>(panelState.value.tab);

  /** 节点库“点选添加”总线：由节点面板写入，ProjectEditorView 消费。 */
  const nodeAddRequest = ref<NodeAddRequest | null>(null);
  let nodeRequestSeq = 0;

  function persistPanel() {
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ open: panelOpen.value, tab: panelTab.value }));
    } catch {
      // 隐私模式等场景静默降级
    }
  }

  function openSettings() {
    settingsOpen.value = true;
  }

  function closeSettings() {
    settingsOpen.value = false;
  }

  function openDocs() {
    docsOpen.value = true;
  }

  function closeDocs() {
    docsOpen.value = false;
  }

  /** 打开快捷新建；folderId 决定工程建在哪个文件夹（缺省根层级）。 */
  function openQuickCreate(folderId: string | null = null) {
    quickCreateFolderId.value = folderId;
    quickCreateOpen.value = true;
  }

  /** 打开/收起面板；切换 tab 时自动打开。 */
  function openPanel(tab: RailTab) {
    panelOpen.value = true;
    panelTab.value = tab;
    persistPanel();
  }

  function closePanel() {
    panelOpen.value = false;
    persistPanel();
  }

  function togglePanel(tab?: RailTab) {
    if (panelOpen.value && (!tab || panelTab.value === tab)) {
      closePanel();
    } else {
      panelOpen.value = true;
      if (tab) panelTab.value = tab;
      persistPanel();
    }
  }

  function requestAddNode(type: string) {
    nodeRequestSeq += 1;
    nodeAddRequest.value = { seq: nodeRequestSeq, type };
  }

  return {
    settingsOpen,
    docsOpen,
    quickCreateOpen,
    quickCreateFolderId,
    panelOpen,
    panelTab,
    nodeAddRequest,
    openSettings,
    closeSettings,
    openDocs,
    closeDocs,
    openQuickCreate,
    openPanel,
    closePanel,
    togglePanel,
    requestAddNode,
  };
});
