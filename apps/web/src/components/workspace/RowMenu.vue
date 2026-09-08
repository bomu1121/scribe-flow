<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check } from "lucide-vue-next";

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: unknown;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  divided?: boolean;
  checked?: boolean;
}

const props = defineProps<{
  x: number;
  y: number;
  items: RowMenuItem[];
}>();

const emit = defineEmits<{ close: []; select: [key: string] }>();

const root = ref<HTMLElement | null>(null);
const pos = ref({ left: props.x, top: props.y });
const activeIndex = ref(-1);

function clampPosition() {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const { innerWidth, innerHeight } = window;
  pos.value = {
    left: Math.max(8, Math.min(props.x, innerWidth - rect.width - 8)),
    top: Math.max(8, Math.min(props.y, innerHeight - rect.height - 8)),
  };
}

function focusIndex(index: number) {
  const buttons = root.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
  if (!buttons) return;
  const clamped = Math.max(0, Math.min(index, buttons.length - 1));
  activeIndex.value = clamped;
  buttons[clamped]?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
    return;
  }
  const items = props.items.filter((item) => !item.disabled);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusIndex(activeIndex.value + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusIndex(activeIndex.value - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    focusIndex(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusIndex(items.length - 1);
  }
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (root.value && !root.value.contains(target)) emit("close");
}

function onWindowBlur() {
  emit("close");
}

function onWindowScroll() {
  emit("close");
}

function onWindowResize() {
  emit("close");
}

function select(key: string) {
  emit("select", key);
  emit("close");
}

onMounted(() => {
  clampPosition();
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("scroll", onWindowScroll, true);
  window.addEventListener("resize", onWindowResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("scroll", onWindowScroll, true);
  window.removeEventListener("resize", onWindowResize);
});

watch(
  () => [props.x, props.y] as const,
  () => {
    pos.value = { left: props.x, top: props.y };
    requestAnimationFrame(clampPosition);
  },
);
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="wp-menu" role="menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">
      <template v-for="item in items" :key="item.key">
        <div v-if="item.divided" class="wp-menu-divider" />
        <button
          type="button"
          role="menuitem"
          class="wp-menu-item"
          :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled }"
          :disabled="item.disabled"
          @click="select(item.key)"
        >
          <span v-if="item.icon" class="wp-menu-icon">
            <component :is="item.icon" :size="14" />
          </span>
          <span class="wp-menu-label">{{ item.label }}</span>
          <span v-if="item.hint" class="wp-menu-hint">{{ item.hint }}</span>
          <span v-if="item.checked" class="wp-menu-check"><Check :size="13" /></span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
