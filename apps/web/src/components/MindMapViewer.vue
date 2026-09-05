<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const props = withDefaults(
  defineProps<{
    markdown?: string;
    height?: string;
    /** 首帧适配与数据更新是否播放过渡动画；小尺寸/浮层内预览建议 false，避免缩放抖动。 */
    animated?: boolean;
  }>(),
  {
    markdown: "",
    height: "600px",
    animated: true,
  },
);

const rootRef = ref<HTMLElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const renderError = ref("");
/** 首次布局 + 居中适配完成前隐藏 svg，避免“未适配状态”闪现造成抖动/错位。 */
const isReady = ref(false);
let mm: Markmap | null = null;
let resizeObserver: ResizeObserver | null = null;
let frame = 0;
let disposed = false;
/** 有完整渲染（数据解析 + 布局 + 居中）待执行：首次挂载或 markdown 变化时置位。 */
let pendingRender = true;
let rendering = false;
let renderAgain = false;
let lastSize = { width: 0, height: 0 };

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function cancelFrame() {
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}

function svgUsable(): boolean {
  const svg = svgRef.value;
  return Boolean(svg && svg.clientWidth > 0 && svg.clientHeight > 0);
}

function renderOptions() {
  const baseOptions = {
    // Markmap 的 JSON frontmatter 选项（color/colorFreezeLevel 等）当前在这个版本下会导致渲染空白，
    // 因此这里只保留基础交互选项，颜色/文字样式通过 CSS 变量统一控制。
    // autoFit 关闭：布局与适配统一走下方 setData → 单次 fit，避免多次适配互相打断产生抖动。
    autoFit: false,
    duration: props.animated ? 300 : 0,
  };
  return baseOptions as unknown as ConstructorParameters<typeof Markmap>[1];
}

/** 完整渲染：解析 → 布局 → 单次居中适配。任何并发/重复请求只排队一次，避免重复适配。 */
async function render() {
  if (rendering) {
    renderAgain = true;
    return;
  }
  rendering = true;
  try {
    await renderCore();
  } finally {
    rendering = false;
  }
  if (renderAgain) {
    renderAgain = false;
    scheduleRender();
  }
}

async function renderCore() {
  const svg = svgRef.value;
  // 容器不可见（0 尺寸）时不创建实例：等 ResizeObserver 通知后再渲染，避免拿到退化的布局度量。
  if (!svg || !svgUsable() || disposed) return;
  const source = props.markdown || "";
  renderError.value = "";
  isReady.value = false;
  try {
    const transformer = new Transformer();
    const { root } = transformer.transform(source);
    if (!mm) {
      mm = Markmap.create(svg, renderOptions());
    } else {
      mm.setOptions(renderOptions());
    }
    await mm.setData(root);
    if (disposed || !svgUsable()) return;
    // 等一帧，确保布局/文字度量落定后再计算适配变换
    await nextFrame();
    if (disposed || !svgUsable()) return;
    await mm.fit();
    if (!disposed) isReady.value = true;
  } catch (err) {
    if (!disposed) {
      renderError.value = err instanceof Error ? err.message : String(err);
      console.error("[MindMapViewer]", err);
    }
  }
}

function scheduleRender() {
  cancelFrame();
  frame = requestAnimationFrame(() => {
    frame = 0;
    void ensureCanvas();
  });
}

/** 渲染/重适配的统一入口：处理首次渲染、数据更新、容器从隐藏恢复、尺寸变化。 */
async function ensureCanvas() {
  const svg = svgRef.value;
  if (!svg || disposed) return;
  if (!svgUsable()) {
    lastSize = { width: 0, height: 0 };
    return;
  }
  const width = svg.clientWidth;
  const height = svg.clientHeight;
  const cameFromHidden = lastSize.width <= 0 || lastSize.height <= 0;
  const sizeChanged = width !== lastSize.width || height !== lastSize.height;
  lastSize = { width, height };

  // 渲染失败后不自动重试（避免容器抖动触发的无效循环），等 markdown 变化再渲染。
  if (!mm && !pendingRender && renderError.value) return;

  if (pendingRender || !mm) {
    if (rendering) {
      renderAgain = true;
      return;
    }
    pendingRender = false;
    await render();
    return;
  }

  if (cameFromHidden || sizeChanged) {
    // 从不可见恢复时 markmap 可能在 0 尺寸下重排过，先强制按真实尺寸重排再适配；
    // 仅尺寸变化则直接重新适配，保证内容始终居中于容器。
    if (cameFromHidden) {
      await mm.renderData();
    }
    await mm.fit();
  }
}

onMounted(() => {
  pendingRender = true;
  scheduleRender();
  if (rootRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => scheduleRender());
    resizeObserver.observe(rootRef.value);
  }
});

watch(
  () => props.markdown,
  () => {
    pendingRender = true;
    scheduleRender();
  },
);

onBeforeUnmount(() => {
  disposed = true;
  cancelFrame();
  resizeObserver?.disconnect();
  resizeObserver = null;
  mm?.destroy();
  mm = null;
});
</script>

<template>
  <div ref="rootRef" class="sf-mindmap-viewer" :class="{ 'is-ready': isReady }" :style="{ height }">
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

/* 首帧隐藏：布局并居中完成前不显示 svg 内容，避免未适配内容闪现/抖动 */
.sf-mindmap-viewer:not(.is-ready) .sf-mindmap-svg {
  visibility: hidden;
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
