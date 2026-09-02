<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const props = withDefaults(
  defineProps<{
    markdown?: string;
    height?: string;
  }>(),
  {
    markdown: "",
    height: "600px",
  },
);

const rootRef = ref<HTMLElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const renderError = ref("");
let mm: Markmap | null = null;
let resizeObserver: ResizeObserver | null = null;

async function render() {
  if (!svgRef.value) return;
  renderError.value = "";
  try {
    const transformer = new Transformer();
    const { root } = transformer.transform(props.markdown || "");
    const baseOptions = {
      autoFit: true,
      duration: 300,
    };
    // 说明：Markmap 的 JSON frontmatter 选项（color/colorFreezeLevel 等）当前在这个版本下会导致渲染空白，
    // 因此这里只保留基础交互选项，颜色/文字样式通过 CSS 变量统一控制。
    const createOptions = baseOptions as unknown as ConstructorParameters<typeof Markmap>[1];

    if (!mm) {
      mm = Markmap.create(svgRef.value, createOptions, root);
    } else {
      await mm.setData(root);
      mm.fit();
    }
    if (svgRef.value.clientWidth > 0 && svgRef.value.clientHeight > 0) {
      mm.fit();
    }
  } catch (err) {
    renderError.value = err instanceof Error ? err.message : String(err);
    console.error("[MindMapViewer]", err);
  }
}

function scheduleRender() {
  requestAnimationFrame(() => {
    void render();
  });
}

onMounted(() => {
  scheduleRender();
  if (rootRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (!mm && svgRef.value && svgRef.value.clientWidth > 0 && svgRef.value.clientHeight > 0) {
        scheduleRender();
      } else if (mm && svgRef.value && svgRef.value.clientWidth > 0 && svgRef.value.clientHeight > 0) {
        mm.fit();
      }
    });
    resizeObserver.observe(rootRef.value);
  }
});

watch(
  () => props.markdown,
  () => {
    scheduleRender();
  },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  mm?.destroy();
  mm = null;
});
</script>

<template>
  <div ref="rootRef" class="sf-mindmap-viewer" :style="{ height }">
    <svg ref="svgRef" class="sf-mindmap-svg" />
    <p v-if="renderError" class="sf-mindmap-error">{{ renderError }}</p>
    <p v-else-if="!markdown" class="sf-mindmap-empty">暂无思维导图内容</p>
  </div>
</template>

<style scoped>
.sf-mindmap-viewer {
  position: relative;
  width: 100%;
  min-height: 200px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

.sf-mindmap-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.sf-mindmap-empty,
.sf-mindmap-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 20px;
  color: var(--color-text-tertiary);
  font-size: 13px;
  text-align: center;
}

.sf-mindmap-error {
  color: var(--color-error);
  white-space: pre-wrap;
  word-break: break-word;
}

/* Markmap 依赖这些 CSS 变量让 foreignObject 内的文字可见并匹配 ScribeFlow 风格 */
.sf-mindmap-viewer :deep(.markmap) {
  --markmap-font: 300 14px/1.5 sans-serif;
  --markmap-text-color: var(--color-text);
  --markmap-a-color: var(--color-brand);
  --markmap-code-bg: var(--color-surface-muted);
  --markmap-code-color: var(--color-text-secondary);
}

.sf-mindmap-viewer :deep(.markmap-link) {
  stroke: var(--edge-color);
}


</style>
